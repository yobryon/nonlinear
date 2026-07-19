import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Domain } from '@nonlinear/core';
import type { User } from '@nonlinear/shared';
import type { Config } from './config.js';

/**
 * SCIM 2.0 user provisioning (RFC 7644), scoped to Users. An identity provider
 * (Entra ID, Okta) creates and deactivates accounts here with a bearer token
 * (SCIM_TOKEN); nonlinear maps SCIM Users onto ordinary member accounts.
 *
 * Groups are intentionally not implemented — team membership in nonlinear is a
 * product concern, not an IdP-driven one (see docs/design/08-users-and-settings).
 */

const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';

function toScim(user: User): Record<string, unknown> {
  return {
    schemas: [USER_SCHEMA],
    id: user.id,
    userName: user.email,
    name: { formatted: user.name },
    displayName: user.name,
    emails: [{ value: user.email, primary: true }],
    active: user.active,
    meta: {
      resourceType: 'User',
      created: user.createdAt,
      lastModified: user.updatedAt,
      location: `/scim/v2/Users/${user.id}`,
    },
  };
}

interface ScimUserBody {
  userName?: string;
  displayName?: string;
  name?: { formatted?: string; givenName?: string; familyName?: string };
  emails?: { value?: string; primary?: boolean }[];
  active?: boolean;
}

function emailOf(body: ScimUserBody): string {
  const primary = body.emails?.find((e) => e.primary) ?? body.emails?.[0];
  return (primary?.value ?? body.userName ?? '').trim().toLowerCase();
}

function nameOf(body: ScimUserBody): string | undefined {
  return (
    body.name?.formatted ||
    [body.name?.givenName, body.name?.familyName].filter(Boolean).join(' ') ||
    body.displayName ||
    undefined
  );
}

export function scimEnabled(config: Config): boolean {
  return Boolean(config.scimToken);
}

export async function registerScim(
  app: FastifyInstance,
  domain: Domain,
  config: Config,
): Promise<void> {
  if (!scimEnabled(config)) return;

  // SCIM clients send application/scim+json; teach Fastify to parse it as JSON.
  if (!app.hasContentTypeParser('application/scim+json')) {
    app.addContentTypeParser('application/scim+json', { parseAs: 'string' }, (_req, body, done) => {
      try {
        done(null, body ? JSON.parse(body as string) : {});
      } catch (err) {
        done(err as Error, undefined);
      }
    });
  }

  const scimError = (reply: FastifyReply, status: number, detail: string) =>
    reply
      .status(status)
      .header('content-type', 'application/scim+json')
      .send({ schemas: [ERROR_SCHEMA], status: String(status), detail });

  const scimJson = (reply: FastifyReply, status: number, body: unknown) =>
    reply.status(status).header('content-type', 'application/scim+json').send(body);

  // Bearer-token gate (constant-time). Applies to every /scim route.
  const authorize = (req: FastifyRequest, reply: FastifyReply): boolean => {
    const header = req.headers.authorization ?? '';
    const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const expected = config.scimToken;
    const a = Buffer.from(presented);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      scimError(reply, 401, 'Invalid SCIM bearer token');
      return false;
    }
    return true;
  };

  app.addHook('onRequest', async (req, reply) => {
    if (req.url.startsWith('/scim/') && !authorize(req, reply)) return reply;
  });

  // List / filter users. Entra & Okta query by `userName eq "..."` before create.
  app.get('/scim/v2/Users', async (req, reply) => {
    const { filter, startIndex, count } = req.query as {
      filter?: string;
      startIndex?: string;
      count?: string;
    };
    let users = (await domain.ctx.storage.users.all()).filter((u) => !u.isAgent);
    const match = filter?.match(/userName\s+eq\s+"([^"]+)"/i);
    if (match) {
      const email = match[1]!.toLowerCase();
      users = users.filter((u) => u.email.toLowerCase() === email);
    }
    users.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const start = Math.max(Number(startIndex ?? 1), 1);
    const perPage = Math.min(Math.max(Number(count ?? 100), 0) || 100, 200);
    const page = users.slice(start - 1, start - 1 + perPage);
    return scimJson(reply, 200, {
      schemas: [LIST_SCHEMA],
      totalResults: users.length,
      startIndex: start,
      itemsPerPage: page.length,
      Resources: page.map(toScim),
    });
  });

  app.get('/scim/v2/Users/:id', async (req, reply) => {
    const user = await domain.ctx.storage.users.get((req.params as { id: string }).id);
    if (!user || user.isAgent) return scimError(reply, 404, 'User not found');
    return scimJson(reply, 200, toScim(user));
  });

  // Provision. Idempotent on email: an existing account is returned (200), a
  // new one is created (201). Providers that pre-check with a filter still work.
  app.post('/scim/v2/Users', async (req, reply) => {
    const body = req.body as ScimUserBody;
    const email = emailOf(body);
    if (!email) return scimError(reply, 400, 'userName or a primary email is required');
    const existing = await domain.ctx.storage.users.getByEmail(email);
    if (existing) {
      if (body.active === false && existing.active) {
        await domain.users.setActive(existing.id, false);
      }
      const fresh = (await domain.ctx.storage.users.get(existing.id))!;
      return scimJson(reply, 200, toScim(fresh));
    }
    const user = await domain.auth.provisionMember({ email, name: nameOf(body) });
    await domain.audit.record({
      action: 'user.provisioned',
      actorId: null,
      actorLabel: 'SCIM',
      targetType: 'user',
      targetId: user.id,
      targetLabel: user.email,
      metadata: { via: 'scim' },
      ip: req.ip,
    });
    return scimJson(reply, 201, toScim(user));
  });

  // Deactivate/reactivate via PATCH (the operation IdPs use for deprovisioning).
  app.patch('/scim/v2/Users/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const existing = await domain.ctx.storage.users.get(id);
    if (!existing || existing.isAgent) return scimError(reply, 404, 'User not found');
    const body = req.body as { Operations?: { op?: string; path?: string; value?: unknown }[] };
    let active: boolean | undefined;
    for (const op of body.Operations ?? []) {
      const isActivePath = op.path?.toLowerCase() === 'active';
      const val =
        isActivePath && op.value !== undefined
          ? op.value
          : (op.value as { active?: boolean } | undefined)?.active;
      if (typeof val === 'boolean') active = val;
      else if (val === 'true' || val === 'false') active = val === 'true';
    }
    if (active === undefined) return scimJson(reply, 200, toScim(existing));
    await applyActive(domain, existing, active, req.ip);
    const fresh = (await domain.ctx.storage.users.get(id))!;
    return scimJson(reply, 200, toScim(fresh));
  });

  // PUT replaces the resource — we honor active + name.
  app.put('/scim/v2/Users/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const existing = await domain.ctx.storage.users.get(id);
    if (!existing || existing.isAgent) return scimError(reply, 404, 'User not found');
    const body = req.body as ScimUserBody;
    if (typeof body.active === 'boolean' && body.active !== existing.active) {
      await applyActive(domain, existing, body.active, req.ip);
    }
    const fresh = (await domain.ctx.storage.users.get(id))!;
    return scimJson(reply, 200, toScim(fresh));
  });

  app.delete('/scim/v2/Users/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const existing = await domain.ctx.storage.users.get(id);
    if (!existing || existing.isAgent) return scimError(reply, 404, 'User not found');
    await applyActive(domain, existing, false, req.ip);
    return reply.status(204).send();
  });
}

async function applyActive(domain: Domain, user: User, active: boolean, ip: string): Promise<void> {
  if (user.active === active) return;
  await domain.users.setActive(user.id, active);
  await domain.audit.record({
    action: active ? 'user.reactivated' : 'user.deactivated',
    actorId: null,
    actorLabel: 'SCIM',
    targetType: 'user',
    targetId: user.id,
    targetLabel: user.email,
    metadata: { via: 'scim' },
    ip,
  });
}
