import { beforeEach, describe, expect, it } from 'vitest';
import { createDomain, type Domain } from './index.js';
import { createMemoryStorage } from './memory.js';
import { visibilityFor, canReadDecision } from './services/visibility.js';
import type { Team, User } from '@nonlinear/shared';

let domain: Domain;
let admin: User;
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
  team = (await domain.ctx.storage.teams.all())[0]!;
});

describe('decisions', () => {
  it('numbers per team and starts proposed, then rules', async () => {
    const d1 = await domain.decisions.create(admin.id, { teamId: team.id, title: 'Use jsonb' });
    const d2 = await domain.decisions.create(admin.id, { teamId: team.id, title: 'DAX gen' });
    expect(d1.number).toBe(1);
    expect(d2.number).toBe(2);
    expect(d1.status).toBe('proposed');

    const ruled = await domain.decisions.rule(admin.id, d1.id, 'Approved for perf');
    expect(ruled.status).toBe('ruled');
    expect(ruled.ruledById).toBe(admin.id);
    // The ruling note landed as a comment.
    const comments = (await domain.ctx.storage.decisionComments.all()).filter(
      (c) => c.decisionId === d1.id,
    );
    expect(comments).toHaveLength(1);
    expect(comments[0]!.body).toContain('Approved');
  });

  it('supersession is a first-class edge that flips the target', async () => {
    const old = await domain.decisions.create(admin.id, { teamId: team.id, title: 'v1' });
    const next = await domain.decisions.create(admin.id, {
      teamId: team.id,
      title: 'v2',
      supersedesId: old.id,
    });
    expect(next.supersedesId).toBe(old.id);
    expect((await domain.ctx.storage.decisions.get(old.id))!.status).toBe('superseded');
  });

  it('is member-only (invisible to a non-member)', async () => {
    // A private team the admin creates; make it private BEFORE the outsider is
    // created, since new members auto-join every non-private team.
    const priv = await domain.teams.create(admin.id, { name: 'Secret', key: 'SEC' });
    await domain.teams.update(priv.id, { private: true });
    const decision = await domain.decisions.create(admin.id, { teamId: priv.id, title: 'hush' });
    const outsider = await domain.auth.createAgent({ name: 'Outsider' });
    const vis = await visibilityFor(domain.ctx, outsider.id);
    expect(canReadDecision(vis, decision)).toBe(false);
  });
});
