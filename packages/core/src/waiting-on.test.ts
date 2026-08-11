import { beforeEach, describe, expect, it } from 'vitest';
import { createDomain, type Domain } from './index.js';
import { createMemoryStorage } from './memory.js';
import type { Team, User } from '@nonlinear/shared';

let domain: Domain;
let admin: User;
let other: User;
let team: Team;

beforeEach(async () => {
  domain = createDomain(createMemoryStorage());
  admin = (
    await domain.auth.register({
      email: 'ada@example.com',
      password: 'hunter2hunter2',
      name: 'Ada',
      workspaceName: 'Acme',
    })
  ).user;
  other = await domain.auth.createAgent({ name: 'Btravo' });
  team = (await domain.ctx.storage.teams.all())[0]!;
});

describe('waiting_on', () => {
  it('defaults to nobody and can be set and cleared', async () => {
    const issue = await domain.issues.create(admin.id, { teamId: team.id, title: 'X' });
    expect(issue.waitingOnId).toBeNull();

    const set = await domain.issues.update(admin.id, issue.id, { waitingOnId: other.id });
    expect(set.waitingOnId).toBe(other.id);

    const cleared = await domain.issues.update(admin.id, issue.id, { waitingOnId: null });
    expect(cleared.waitingOnId).toBeNull();
  });

  it('clears waiting_on when the awaited person comments (their next action)', async () => {
    const issue = await domain.issues.create(admin.id, { teamId: team.id, title: 'Y' });
    await domain.issues.update(admin.id, issue.id, { waitingOnId: other.id });

    // Someone else commenting does NOT clear it — still waiting on `other`.
    await domain.comments.create(admin.id, { issueId: issue.id, body: 'ping @bravo' });
    expect((await domain.ctx.storage.issues.get(issue.id))!.waitingOnId).toBe(other.id);

    // The awaited person responding clears the wait.
    await domain.comments.create(other.id, { issueId: issue.id, body: 'on it' });
    expect((await domain.ctx.storage.issues.get(issue.id))!.waitingOnId).toBeNull();
  });
});
