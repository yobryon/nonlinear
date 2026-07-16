import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createDomain, createMemoryStorage } from '@nonlinear/core';
import type { BootstrapPayload, Issue, User } from '@nonlinear/shared';
import { buildServer } from './server.js';
import { loadConfig } from './config.js';

let app: FastifyInstance;
let cookie: string;

function sessionCookie(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  const header = Array.isArray(raw) ? raw[0] : raw;
  return String(header).split(';')[0]!;
}

beforeAll(async () => {
  const domain = createDomain(createMemoryStorage());
  app = await buildServer(domain, loadConfig({ STORAGE: 'memory' } as NodeJS.ProcessEnv));
});

afterAll(async () => {
  await app.close();
});

describe('api', () => {
  it('reports setupRequired before first register', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/meta' });
    expect(res.json()).toMatchObject({ setupRequired: true });
  });

  it('registers the first user and sets a session cookie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'ada@example.com',
        password: 'hunter2hunter2',
        name: 'Ada Lovelace',
        workspaceName: 'Acme',
      },
    });
    expect(res.statusCode).toBe(200);
    cookie = sessionCookie(res);
    expect(cookie).toContain('nl_session=');
    const user = res.json().user as User;
    expect(user.role).toBe('admin');
  });

  it('rejects unauthenticated bootstrap', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/bootstrap' });
    expect(res.statusCode).toBe(401);
  });

  it('bootstraps with the session cookie', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/bootstrap',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const payload = res.json() as BootstrapPayload;
    expect(payload.teams).toHaveLength(1);
    expect(payload.workflowStates.length).toBeGreaterThan(0);
    expect(payload.workspace.name).toBe('Acme');
  });

  it('creates and updates an issue over HTTP', async () => {
    const boot = (
      await app.inject({ method: 'GET', url: '/api/bootstrap', headers: { cookie } })
    ).json() as BootstrapPayload;
    const team = boot.teams[0]!;

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/issues',
      headers: { cookie },
      payload: { teamId: team.id, title: 'From HTTP', priority: 2 },
    });
    expect(createRes.statusCode).toBe(200);
    const issue = createRes.json() as Issue;
    expect(issue.number).toBe(1);
    expect(issue.priority).toBe(2);

    const done = boot.workflowStates.find((s) => s.category === 'completed')!;
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/issues/${issue.id}`,
      headers: { cookie },
      payload: { stateId: done.id },
    });
    expect(patchRes.statusCode).toBe(200);
    expect((patchRes.json() as Issue).completedAt).not.toBeNull();
  });

  it('maps domain errors to structured responses', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/issues',
      headers: { cookie },
      payload: { teamId: 'nope', title: 'x' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
  });

  it('logs out and invalidates the session', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ada@example.com', password: 'hunter2hunter2' },
    });
    const tempCookie = sessionCookie(login);
    await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: tempCookie },
    });
    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: tempCookie },
    });
    expect(me.statusCode).toBe(401);
  });
});
