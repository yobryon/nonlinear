import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createDomain, createMemoryStorage, type Domain } from '@nonlinear/core';
import { buildServer } from './server.js';
import { loadConfig } from './config.js';

let app: FastifyInstance;
let domain: Domain;
let cookie: string;
let teamId: string;

function sessionCookie(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  const header = Array.isArray(raw) ? raw[0] : raw;
  return String(header).split(';')[0]!;
}

async function gql(query: string, variables?: Record<string, unknown>) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/graphql',
    headers: { cookie },
    payload: { query, variables },
  });
  return res.json() as { data?: Record<string, unknown>; errors?: { message: string }[] };
}

beforeAll(async () => {
  domain = createDomain(createMemoryStorage());
  app = await buildServer(domain, loadConfig({ STORAGE: 'memory' } as NodeJS.ProcessEnv));
  const reg = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      email: 'ada@acme.com',
      password: 'hunter2hunter2',
      name: 'Ada',
      workspaceName: 'Acme',
    },
  });
  cookie = sessionCookie(reg);
  teamId = (await domain.ctx.storage.teams.all())[0]!.id;
  await domain.issues.create((await domain.ctx.storage.users.all())[0]!.id, {
    teamId,
    title: 'Seed issue',
    priority: 1,
  });
});

afterAll(async () => {
  await app.close();
});

describe('graphql', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/graphql',
      payload: { query: '{ viewer { id } }' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('resolves viewer, teams, and nested issue fields', async () => {
    const { data, errors } = await gql(`{
      viewer { email role }
      teams { key name issues { identifier title priorityLabel state { category } creator { name } } }
    }`);
    expect(errors).toBeUndefined();
    expect((data!.viewer as { email: string }).email).toBe('ada@acme.com');
    const team = (data!.teams as { key: string; issues: unknown[] }[])[0]!;
    const issue = team.issues[0] as {
      identifier: string;
      priorityLabel: string;
      state: { category: string };
      creator: { name: string };
    };
    expect(issue.identifier).toMatch(/^[A-Z]+-\d+$/);
    expect(issue.priorityLabel).toBe('Urgent');
    expect(issue.creator.name).toBe('Ada');
    expect(typeof issue.state.category).toBe('string');
  });

  it('creates an issue through a mutation and reads it back', async () => {
    const { data, errors } = await gql(
      `mutation($input: CreateIssueInput!) {
        createIssue(input: $input) { identifier title priority team { key } }
      }`,
      { input: { teamId, title: 'Via GraphQL', priority: 2 } },
    );
    expect(errors).toBeUndefined();
    const created = data!.createIssue as { identifier: string; title: string; priority: number };
    expect(created.title).toBe('Via GraphQL');
    expect(created.priority).toBe(2);

    const found = await gql(`query($id: String!){ issue(identifier: $id){ title } }`, {
      id: created.identifier,
    });
    expect((found.data!.issue as { title: string }).title).toBe('Via GraphQL');
  });

  it('surfaces domain validation errors in the errors array', async () => {
    const { errors } = await gql(
      `mutation($input: CreateIssueInput!){ createIssue(input:$input){ id } }`,
      { input: { teamId, title: '' } },
    );
    expect(errors?.[0]?.message).toMatch(/title/i);
  });
});
