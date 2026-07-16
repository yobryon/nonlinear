import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDomain, type Domain } from '@nonlinear/core';
import type { Storage } from '@nonlinear/core';
import { createPostgresStorage } from './index.js';

/**
 * Integration tests — run only when POSTGRES_TEST_URL points at a disposable
 * database, e.g.:
 *   POSTGRES_TEST_URL=postgres://nonlinear:nonlinear@localhost:5432/nonlinear_test pnpm test
 */
const url = process.env.POSTGRES_TEST_URL;

describe.skipIf(!url)('postgres storage', () => {
  let storage: Storage;
  let domain: Domain;

  beforeAll(async () => {
    storage = await createPostgresStorage({ connectionString: url! });
    domain = createDomain(storage);
  });

  afterAll(async () => {
    await storage?.close();
  });

  it('runs the full register → issue → sync flow against postgres', async () => {
    const email = `t${Date.now()}@example.com`;
    const { user } = await domain.auth.register({
      email,
      password: 'password123',
      name: 'PG Tester',
      workspaceName: 'PG Test WS',
    });
    expect(await storage.users.getByEmail(email)).not.toBeNull();

    const teams = await storage.teams.all();
    const team = teams[0]!;
    const before = await storage.syncLog.currentSyncId();

    const a = await domain.issues.create(user.id, { teamId: team.id, title: 'pg issue A' });
    const b = await domain.issues.create(user.id, { teamId: team.id, title: 'pg issue B' });
    expect(b.number).toBe(a.number + 1);

    const fetched = await storage.issues.get(a.id);
    expect(fetched?.title).toBe('pg issue A');
    expect(fetched?.labelIds).toEqual([]);

    const deltas = await storage.syncLog.since(before);
    expect(deltas).not.toBeNull();
    expect(deltas!.filter((d) => d.model === 'issue' && d.action === 'create')).toHaveLength(2);

    const { session } = await domain.auth.login({ email, password: 'password123' });
    expect(await domain.auth.authenticate(session.token)).toMatchObject({ id: user.id });
  });

  it('hands out issue numbers atomically under concurrency', async () => {
    const teams = await storage.teams.all();
    const team = teams[0]!;
    const numbers = await Promise.all(
      Array.from({ length: 20 }, () => storage.teams.nextIssueNumber(team.id)),
    );
    expect(new Set(numbers).size).toBe(20);
  });
});
