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

  it('routes a proposal to a decider, notifies them, and clears on ruling', async () => {
    const decider = await domain.auth.createAgent({ name: 'Decider' });
    const d = await domain.decisions.create(admin.id, {
      teamId: team.id,
      title: 'Route me',
      waitingOnId: decider.id,
    });
    expect(d.waitingOnId).toBe(decider.id);
    // The routed decider got a notification about the decision (not an issue).
    const notes = (await domain.ctx.storage.notifications.all()).filter(
      (n) => n.userId === decider.id && n.decisionId === d.id,
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]!.issueId).toBeNull();

    // Ruling clears the wait.
    const ruled = await domain.decisions.rule(decider.id, d.id);
    expect(ruled.waitingOnId).toBeNull();
  });

  it('notifies the author (the proposer) when their decision is ruled', async () => {
    const arch = await domain.auth.createAgent({ name: 'Arch' });
    const d = await domain.decisions.create(arch.id, { teamId: team.id, title: 'Their proposal' });
    // The PO (admin) rules it — arch is told it's back in their court.
    await domain.decisions.rule(admin.id, d.id, 'Approved with the narrowing.');
    const notes = (await domain.ctx.storage.notifications.all()).filter(
      (n) => n.userId === arch.id && n.decisionId === d.id && n.type === 'decision_ruled',
    );
    expect(notes).toHaveLength(1);
  });

  it('a comment on a decision notifies its author even without an @mention', async () => {
    // The exact NON-56 path: arch proposes, the PO answers in a plain comment.
    const arch = await domain.auth.createAgent({ name: 'Arch' });
    const d = await domain.decisions.create(arch.id, {
      teamId: team.id,
      title: 'Their proposal',
      waitingOnId: admin.id,
    });
    await domain.decisions.comment(admin.id, {
      decisionId: d.id,
      body: 'What about the narrowing? (no @mention)',
    });
    const notes = (await domain.ctx.storage.notifications.all()).filter(
      (n) => n.userId === arch.id && n.decisionId === d.id && n.type === 'issue_commented',
    );
    expect(notes).toHaveLength(1);
  });

  it('@mentions in a decision thread notify the mentioned user', async () => {
    const arch = await domain.auth.createAgent({ name: 'Arch' });
    const d = await domain.decisions.create(admin.id, { teamId: team.id, title: 'Discuss' });
    await domain.decisions.comment(admin.id, {
      decisionId: d.id,
      body: `@${arch.displayName} what's your call?`,
    });
    const notes = (await domain.ctx.storage.notifications.all()).filter(
      (n) => n.userId === arch.id && n.decisionId === d.id && n.type === 'issue_mentioned',
    );
    expect(notes).toHaveLength(1);
  });

  it('read-through: viewing a decision clears its unread notifications', async () => {
    const arch = await domain.auth.createAgent({ name: 'Arch' });
    const d = await domain.decisions.create(arch.id, { teamId: team.id, title: 'Theirs' });
    await domain.decisions.comment(admin.id, { decisionId: d.id, body: 'A plain answer.' });
    const unreadFor = async (uid: string) =>
      (await domain.ctx.storage.notifications.all()).filter(
        (n) => n.userId === uid && n.decisionId === d.id && !n.readAt,
      ).length;
    expect(await unreadFor(arch.id)).toBe(1);

    // arch "views" the decision → its notifications clear; others untouched.
    await domain.notifications.markReadForSubject(arch.id, { decisionId: d.id });
    expect(await unreadFor(arch.id)).toBe(0);
  });

  it('imports a historical decision honestly (true decider, date, no false credit)', async () => {
    const po = await domain.auth.createAgent({ name: 'PO' });
    const importer = await domain.auth.createAgent({ name: 'Importer' });
    // `importer` migrates a February decision the PO actually made.
    const d = await domain.decisions.create(importer.id, {
      teamId: team.id,
      title: 'Historical ruling',
      status: 'ruled',
      ruledById: po.id,
      ruledAt: '2026-02-17T10:00:00.000Z',
      createdAt: '2026-02-10T09:00:00.000Z',
    });
    expect(d.status).toBe('ruled');
    expect(d.ruledById).toBe(po.id); // the true decider, not the importer
    expect(d.ruledAt).toBe('2026-02-17T10:00:00.000Z');
    expect(d.createdAt).toBe('2026-02-10T09:00:00.000Z'); // chronology preserved
    expect(d.waitingOnId).toBeNull();
    // Not poisoning the "what awaits a ruling" query.
    expect(d.status).not.toBe('proposed');

    // Importing settled with an unknown decider is allowed (null, not the caller).
    const d2 = await domain.decisions.create(importer.id, {
      teamId: team.id,
      title: 'Decider not recorded',
      status: 'carried',
    });
    expect(d2.status).toBe('carried');
    expect(d2.ruledById).toBeNull();
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
