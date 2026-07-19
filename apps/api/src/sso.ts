import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Domain } from '@nonlinear/core';
import type { SsoUserInfo } from '@nonlinear/shared';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { Config } from './config.js';

/**
 * OIDC single sign-on (authorization-code flow with PKCE). A protocol adapter
 * over the domain: this file owns the handshake with the identity provider
 * (discovery, PKCE, state/nonce, ID-token verification) and hands normalized
 * claims to `domain.auth.findOrProvisionSso`, which owns account resolution.
 *
 * Verified against any spec-compliant OIDC provider (Entra ID, Okta, Keycloak,
 * Auth0, Google). Enable by setting OIDC_ISSUER + OIDC_CLIENT_ID (+ secret).
 */

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  issuer: string;
}

const STATE_COOKIE = 'nl_sso_state';
const NONCE_COOKIE = 'nl_sso_nonce';
const VERIFIER_COOKIE = 'nl_sso_verifier';
const HANDSHAKE_TTL = 600; // seconds

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function ssoEnabled(config: Config): boolean {
  return Boolean(config.sso.issuer && config.sso.clientId);
}

export async function registerSso(
  app: FastifyInstance,
  domain: Domain,
  config: Config,
  setSession: (reply: FastifyReply, token: string) => void,
): Promise<void> {
  if (!ssoEnabled(config)) return;

  const redirectUri = `${config.appUrl}/api/auth/sso/callback`;
  let discovery: Discovery | null = null;
  let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  // Lazy, cached discovery so a slow/unavailable IdP at boot doesn't block startup.
  async function getDiscovery(): Promise<Discovery> {
    if (discovery) return discovery;
    const res = await fetch(`${config.sso.issuer}/.well-known/openid-configuration`);
    if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status}`);
    discovery = (await res.json()) as Discovery;
    jwks = createRemoteJWKSet(new URL(discovery.jwks_uri));
    return discovery;
  }

  const handshakeCookie = (reply: FastifyReply, name: string, value: string) => {
    reply.setCookie(name, value, {
      path: '/api/auth/sso',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.secureCookies,
      maxAge: HANDSHAKE_TTL,
    });
  };
  const clearHandshake = (reply: FastifyReply) => {
    for (const name of [STATE_COOKIE, NONCE_COOKIE, VERIFIER_COOKIE]) {
      reply.clearCookie(name, { path: '/api/auth/sso' });
    }
  };
  const fail = (reply: FastifyReply, code: string) => {
    clearHandshake(reply);
    return reply.redirect(`${config.appUrl}/?sso_error=${encodeURIComponent(code)}`);
  };

  // Begin: stash state/nonce/PKCE verifier in short-lived cookies, redirect to IdP.
  app.get('/api/auth/sso/start', async (req, reply) => {
    let disco: Discovery;
    try {
      disco = await getDiscovery();
    } catch (err) {
      req.log.error(err);
      return fail(reply, 'provider_unavailable');
    }
    const state = base64url(randomBytes(24));
    const nonce = base64url(randomBytes(24));
    const verifier = base64url(randomBytes(48));
    const challenge = base64url(createHash('sha256').update(verifier).digest());
    handshakeCookie(reply, STATE_COOKIE, state);
    handshakeCookie(reply, NONCE_COOKIE, nonce);
    handshakeCookie(reply, VERIFIER_COOKIE, verifier);

    const url = new URL(disco.authorization_endpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', config.sso.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return reply.redirect(url.toString());
  });

  // Return: verify state + code, exchange for tokens, verify ID token, sign in.
  app.get('/api/auth/sso/callback', async (req: FastifyRequest, reply) => {
    const query = req.query as { code?: string; state?: string; error?: string };
    const cookies = req.cookies;
    if (query.error) return fail(reply, query.error);
    if (!query.code || !query.state) return fail(reply, 'missing_code');
    if (!cookies[STATE_COOKIE] || cookies[STATE_COOKIE] !== query.state) {
      return fail(reply, 'bad_state');
    }
    const verifier = cookies[VERIFIER_COOKIE];
    const nonce = cookies[NONCE_COOKIE];
    if (!verifier || !nonce) return fail(reply, 'expired');

    let disco: Discovery;
    try {
      disco = await getDiscovery();
    } catch {
      return fail(reply, 'provider_unavailable');
    }

    // Exchange the authorization code for tokens.
    let idToken: string;
    try {
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code: query.code,
        redirect_uri: redirectUri,
        client_id: config.sso.clientId,
        code_verifier: verifier,
      });
      if (config.sso.clientSecret) body.set('client_secret', config.sso.clientSecret);
      const tokenRes = await fetch(disco.token_endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body,
      });
      if (!tokenRes.ok) {
        req.log.error({ status: tokenRes.status }, 'OIDC token exchange failed');
        return fail(reply, 'token_exchange');
      }
      const tokens = (await tokenRes.json()) as { id_token?: string };
      if (!tokens.id_token) return fail(reply, 'no_id_token');
      idToken = tokens.id_token;
    } catch (err) {
      req.log.error(err);
      return fail(reply, 'token_exchange');
    }

    // Verify the ID token: signature (JWKS), issuer, audience, and nonce.
    let payload: JWTPayload;
    try {
      const verified = await jwtVerify(idToken, jwks!, {
        issuer: disco.issuer,
        audience: config.sso.clientId,
      });
      payload = verified.payload;
    } catch (err) {
      req.log.error(err);
      return fail(reply, 'invalid_token');
    }
    if (payload.nonce !== nonce) return fail(reply, 'bad_nonce');

    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
    const emailVerified = payload.email_verified;
    if (!email) return fail(reply, 'no_email');
    // Only trust an email the provider vouches for (claim absent = trust, per many IdPs).
    if (emailVerified === false) return fail(reply, 'email_unverified');

    // Domain allow-list.
    if (config.sso.allowedDomains.length > 0) {
      const domainPart = email.split('@')[1] ?? '';
      if (!config.sso.allowedDomains.includes(domainPart)) return fail(reply, 'domain_not_allowed');
    }

    const info: SsoUserInfo = {
      subject: String(payload.sub),
      email,
      name: typeof payload.name === 'string' ? payload.name : null,
    };

    try {
      const { user, session, outcome } = await domain.auth.findOrProvisionSso(info, {
        autoProvision: config.sso.autoProvision,
      });
      clearHandshake(reply);
      setSession(reply, session.token);
      const ip = req.ip;
      if (outcome === 'provisioned') {
        await domain.audit.record({
          action: 'user.provisioned',
          actorId: null,
          actorLabel: `SSO (${config.sso.label})`,
          targetType: 'user',
          targetId: user.id,
          targetLabel: user.email,
          metadata: { via: 'sso' },
          ip,
        });
      } else if (outcome === 'linked') {
        await domain.audit.record({
          action: 'user.sso_linked',
          actorId: user.id,
          actorLabel: user.name,
          targetType: 'user',
          targetId: user.id,
          targetLabel: user.email,
          ip,
        });
      }
      await domain.audit.record({
        action: 'user.login',
        actorId: user.id,
        actorLabel: user.name,
        targetType: 'user',
        targetId: user.id,
        targetLabel: user.email,
        metadata: { method: 'sso' },
        ip,
      });
      return reply.redirect(`${config.appUrl}/`);
    } catch (err) {
      req.log.error(err);
      const code = (err as { code?: string }).code ?? 'sso_failed';
      return fail(reply, code);
    }
  });
}
