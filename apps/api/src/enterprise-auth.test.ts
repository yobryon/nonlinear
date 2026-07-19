import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createDomain, createMemoryStorage, type Domain } from '@nonlinear/core';
import type { User } from '@nonlinear/shared';
import { buildServer } from './server.js';
import { loadConfig } from './config.js';

let app: FastifyInstance;
let domain: Domain;
let adminCookie: string;

const SCIM_TOKEN = 'scim-secret-token';
const scimAuth = { authorization: `Bearer ${SCIM_TOKEN}`, 'content-type': 'application/scim+json' };

function sessionCookie(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  const header = Array.isArray(raw) ? raw[0] : raw;
  return String(header).split(';')[0]!;
}

beforeAll(async () => {
  domain = createDomain(createMemoryStorage());
  app = await buildServer(
    domain,
    loadConfig({
      STORAGE: 'memory',
      SCIM_TOKEN,
      OIDC_ISSUER: 'https://login.example.com',
      OIDC_CLIENT_ID: 'nonlinear-app',
      OIDC_LABEL: 'Example ID',
    } as NodeJS.ProcessEnv),
  );
  const reg = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      email: 'admin@acme.com',
      password: 'hunter2hunter2',
      name: 'Admin',
      workspaceName: 'Acme',
    },
  });
  adminCookie = sessionCookie(reg);
});

afterAll(async () => {
  await app.close();
});

describe('meta advertises SSO', () => {
  it('reports the SSO button when OIDC is configured', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/meta' });
    expect(res.json().sso).toEqual({ enabled: true, label: 'Example ID' });
  });
});

describe('SCIM 2.0 Users', () => {
  it('rejects a missing or wrong bearer token', async () => {
    const res = await app.inject({ method: 'GET', url: '/scim/v2/Users' });
    expect(res.statusCode).toBe(401);
    const bad = await app.inject({
      method: 'GET',
      url: '/scim/v2/Users',
      headers: { authorization: 'Bearer nope' },
    });
    expect(bad.statusCode).toBe(401);
  });

  it('provisions, filters, deactivates, and deletes a user', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/scim/v2/Users',
      headers: scimAuth,
      payload: {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'grace@acme.com',
        name: { formatted: 'Grace Hopper' },
        emails: [{ value: 'grace@acme.com', primary: true }],
        active: true,
      },
    });
    expect(create.statusCode).toBe(201);
    const id = create.json().id as string;
    expect(create.json().active).toBe(true);

    // Re-creating the same userName is idempotent (200, same id).
    const again = await app.inject({
      method: 'POST',
      url: '/scim/v2/Users',
      headers: scimAuth,
      payload: { userName: 'grace@acme.com' },
    });
    expect(again.statusCode).toBe(200);
    expect(again.json().id).toBe(id);

    // Filter by userName.
    const filtered = await app.inject({
      method: 'GET',
      url: '/scim/v2/Users?filter=' + encodeURIComponent('userName eq "grace@acme.com"'),
      headers: scimAuth,
    });
    expect(filtered.json().totalResults).toBe(1);
    expect(filtered.json().Resources[0].id).toBe(id);

    // Deactivate via PATCH.
    const patch = await app.inject({
      method: 'PATCH',
      url: `/scim/v2/Users/${id}`,
      headers: scimAuth,
      payload: {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', path: 'active', value: false }],
      },
    });
    expect(patch.json().active).toBe(false);
    const user = (await domain.ctx.storage.users.get(id)) as User;
    expect(user.active).toBe(false);

    // DELETE deprovisions (idempotent-safe deactivation).
    const del = await app.inject({
      method: 'DELETE',
      url: `/scim/v2/Users/${id}`,
      headers: scimAuth,
    });
    expect(del.statusCode).toBe(204);
  });
});

describe('audit log', () => {
  it('records auditable events and serves them to admins only', async () => {
    // The registration above and the SCIM provisioning should have produced events.
    const res = await app.inject({
      method: 'GET',
      url: '/api/audit',
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    const actions = (res.json().events as { action: string }[]).map((e) => e.action);
    expect(actions).toContain('user.register');
    expect(actions).toContain('user.provisioned');

    // A non-admin (freshly provisioned member) cannot read the audit log.
    const member = await domain.auth.provisionMember({ email: 'nobody@acme.com' });
    const session = await domain.auth.createSession(member.id);
    const forbidden = await app.inject({
      method: 'GET',
      url: '/api/audit',
      headers: { cookie: `nl_session=${session.token}` },
    });
    expect(forbidden.statusCode).toBe(403);
  });
});
