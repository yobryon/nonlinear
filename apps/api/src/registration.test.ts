import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createDomain, createMemoryStorage } from '@nonlinear/core';
import { buildServer } from './server.js';
import { loadConfig } from './config.js';

let app: FastifyInstance;

async function make(env: Record<string, string> = {}) {
  const domain = createDomain(createMemoryStorage());
  app = await buildServer(domain, loadConfig({ STORAGE: 'memory', ...env } as NodeJS.ProcessEnv));
  return app;
}
function cookieOf(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  return String(Array.isArray(raw) ? raw[0] : raw).split(';')[0]!;
}
const register = (payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/api/auth/register', payload });

afterEach(async () => {
  await app.close();
});

describe('registration gate', () => {
  it('first register succeeds (owner); further open registration is closed by default', async () => {
    await make();
    const first = await register({
      email: 'owner@acme.com',
      password: 'hunter2hunter2',
      name: 'Owner',
      workspaceName: 'Acme',
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().user.role).toBe('admin');

    const second = await register({
      email: 'random@evil.com',
      password: 'hunter2hunter2',
      name: 'Random',
    });
    expect(second.statusCode).toBe(403);
    expect(second.json().error.code).toBe('registration_closed');
  });

  it('an admin invite lets exactly one person register, then is spent', async () => {
    await make();
    const owner = await register({
      email: 'owner@acme.com',
      password: 'hunter2hunter2',
      name: 'Owner',
      workspaceName: 'Acme',
    });
    const cookie = cookieOf(owner);
    const inv = await app.inject({
      method: 'POST',
      url: '/api/invites',
      headers: { cookie },
      payload: { role: 'member' },
    });
    expect(inv.statusCode).toBe(200);
    const url = new URL(inv.json().url);
    const token = url.searchParams.get('invite')!;

    // Public meta validates the invite.
    const meta = await app.inject({ method: 'GET', url: `/api/meta?invite=${token}` });
    expect(meta.json().inviteValid).toBe(true);
    expect(meta.json().allowSignups).toBe(false);

    const joined = await register({
      email: 'invitee@acme.com',
      password: 'hunter2hunter2',
      name: 'Invitee',
      inviteToken: token,
    });
    expect(joined.statusCode).toBe(200);
    expect(joined.json().user.role).toBe('member');

    // The invite is single-use.
    const reused = await register({
      email: 'other@acme.com',
      password: 'hunter2hunter2',
      name: 'Other',
      inviteToken: token,
    });
    expect(reused.statusCode).toBe(403);
  });

  it('ALLOW_SIGNUPS=true reopens self-registration', async () => {
    await make({ ALLOW_SIGNUPS: 'true' });
    await register({
      email: 'owner@acme.com',
      password: 'hunter2hunter2',
      name: 'Owner',
      workspaceName: 'Acme',
    });
    const open = await register({
      email: 'joiner@acme.com',
      password: 'hunter2hunter2',
      name: 'Joiner',
    });
    expect(open.statusCode).toBe(200);
    expect(open.json().user.role).toBe('member');
  });
});
