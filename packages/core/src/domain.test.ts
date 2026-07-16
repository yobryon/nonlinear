import { beforeEach, describe, expect, it } from 'vitest';
import { createDomain, type Domain } from './index.js';
import { createMemoryStorage } from './memory.js';
import type { User } from '@nonlinear/shared';

let domain: Domain;
let admin: User;

beforeEach(async () => {
  domain = createDomain(createMemoryStorage());
  const result = await domain.auth.register({
    email: 'ada@example.com',
    password: 'hunter2hunter2',
    name: 'Ada Lovelace',
    workspaceName: 'Acme',
  });
  admin = result.user;
});

describe('registration', () => {
  it('creates workspace, admin user, and a default team with states', async () => {
    const teams = await domain.ctx.storage.teams.all();
    expect(teams).toHaveLength(1);
    expect(teams[0]!.key).toBe('ACM');
    expect(admin.role).toBe('admin');
    const states = await domain.ctx.storage.workflowStates.all();
    expect(states.length).toBeGreaterThanOrEqual(5);
    const memberships = await domain.ctx.storage.teamMemberships.all();
    expect(memberships.some((m) => m.userId === admin.id)).toBe(true);
  });

  it('rejects duplicate emails and joins later users as members', async () => {
    await expect(
      domain.auth.register({ email: 'ada@example.com', password: 'xxxxxxxx', name: 'Dup' }),
    ).rejects.toThrow(/already exists/);
    const { user: second } = await domain.auth.register({
      email: 'grace@example.com',
      password: 'hopperhopper',
      name: 'Grace Hopper',
    });
    expect(second.role).toBe('member');
    const memberships = await domain.ctx.storage.teamMemberships.all();
    expect(memberships.some((m) => m.userId === second.id)).toBe(true);
  });

  it('login works with correct password only', async () => {
    await expect(
      domain.auth.login({ email: 'ada@example.com', password: 'wrong-password' }),
    ).rejects.toThrow(/Invalid email or password/);
    const { session } = await domain.auth.login({
      email: 'ada@example.com',
      password: 'hunter2hunter2',
    });
    const authed = await domain.auth.authenticate(session.token);
    expect(authed?.id).toBe(admin.id);
  });
});

describe('issues', () => {
  it('assigns sequential identifiers per team', async () => {
    const [team] = await domain.ctx.storage.teams.all();
    const first = await domain.issues.create(admin.id, { teamId: team!.id, title: 'First' });
    const second = await domain.issues.create(admin.id, { teamId: team!.id, title: 'Second' });
    expect(first.number).toBe(1);
    expect(second.number).toBe(2);
  });

  it('sets category timestamps on state transitions and records activity', async () => {
    const [team] = await domain.ctx.storage.teams.all();
    const states = await domain.ctx.storage.workflowStates.all();
    const started = states.find((s) => s.category === 'started')!;
    const completed = states.find((s) => s.category === 'completed')!;

    const issue = await domain.issues.create(admin.id, { teamId: team!.id, title: 'Ship it' });
    expect(issue.startedAt).toBeNull();

    const moved = await domain.issues.update(admin.id, issue.id, { stateId: started.id });
    expect(moved.startedAt).not.toBeNull();
    expect(moved.completedAt).toBeNull();

    const done = await domain.issues.update(admin.id, issue.id, { stateId: completed.id });
    expect(done.completedAt).not.toBeNull();

    const activities = await domain.ctx.storage.activities.byIssue(issue.id);
    const types = activities.map((a) => a.type);
    expect(types).toContain('created');
    expect(types.filter((t) => t === 'state_changed')).toHaveLength(2);
  });

  it('notifies the assignee and subscribes them', async () => {
    const { user: grace } = await domain.auth.register({
      email: 'grace@example.com',
      password: 'hopperhopper',
      name: 'Grace Hopper',
    });
    const [team] = await domain.ctx.storage.teams.all();
    const issue = await domain.issues.create(admin.id, {
      teamId: team!.id,
      title: 'Assigned work',
      assigneeId: grace.id,
    });
    expect(issue.subscriberIds).toContain(grace.id);
    const notifications = await domain.ctx.storage.notifications.all();
    expect(
      notifications.some((n) => n.userId === grace.id && n.type === 'issue_assigned'),
    ).toBe(true);
  });

  it('rejects sub-issue cycles', async () => {
    const [team] = await domain.ctx.storage.teams.all();
    const a = await domain.issues.create(admin.id, { teamId: team!.id, title: 'A' });
    const b = await domain.issues.create(admin.id, {
      teamId: team!.id,
      title: 'B',
      parentId: a.id,
    });
    await expect(
      domain.issues.update(admin.id, a.id, { parentId: b.id }),
    ).rejects.toThrow(/cycle/i);
  });

  it('cascades deletes to comments, relations, and children', async () => {
    const [team] = await domain.ctx.storage.teams.all();
    const a = await domain.issues.create(admin.id, { teamId: team!.id, title: 'A' });
    const b = await domain.issues.create(admin.id, { teamId: team!.id, title: 'B' });
    const child = await domain.issues.create(admin.id, {
      teamId: team!.id,
      title: 'Child',
      parentId: a.id,
    });
    await domain.comments.create(admin.id, { issueId: a.id, body: 'note' });
    await domain.relations.create({ type: 'blocks', issueId: a.id, relatedIssueId: b.id });

    await domain.issues.remove(a.id);

    expect(await domain.ctx.storage.issues.get(a.id)).toBeNull();
    expect(await domain.ctx.storage.comments.all()).toHaveLength(0);
    expect(await domain.ctx.storage.issueRelations.all()).toHaveLength(0);
    const orphan = await domain.ctx.storage.issues.get(child.id);
    expect(orphan?.parentId).toBeNull();
  });
});

describe('sync log', () => {
  it('replays deltas after a given syncId', async () => {
    const [team] = await domain.ctx.storage.teams.all();
    const before = await domain.ctx.storage.syncLog.currentSyncId();
    await domain.issues.create(admin.id, { teamId: team!.id, title: 'Tracked' });
    const deltas = await domain.ctx.storage.syncLog.since(before);
    expect(deltas).not.toBeNull();
    expect(deltas!.some((d) => d.model === 'issue' && d.action === 'create')).toBe(true);
    for (let i = 1; i < deltas!.length; i++) {
      expect(deltas![i]!.syncId).toBeGreaterThan(deltas![i - 1]!.syncId);
    }
  });

  it('fans live deltas out to bus subscribers', async () => {
    const [team] = await domain.ctx.storage.teams.all();
    const seen: string[] = [];
    const unsubscribe = domain.bus.subscribe((deltas) => {
      seen.push(...deltas.map((d) => `${d.action}:${d.model}`));
    });
    await domain.issues.create(admin.id, { teamId: team!.id, title: 'Live' });
    unsubscribe();
    expect(seen).toContain('create:issue');
  });
});

describe('comments and mentions', () => {
  it('notifies mentioned users and subscribers', async () => {
    const { user: grace } = await domain.auth.register({
      email: 'grace@example.com',
      password: 'hopperhopper',
      name: 'Grace Hopper',
    });
    const [team] = await domain.ctx.storage.teams.all();
    const issue = await domain.issues.create(admin.id, { teamId: team!.id, title: 'Discuss' });
    await domain.comments.create(admin.id, {
      issueId: issue.id,
      body: `ping @${grace.displayName} please look`,
    });
    const notifications = await domain.ctx.storage.notifications.all();
    expect(
      notifications.some((n) => n.userId === grace.id && n.type === 'issue_mentioned'),
    ).toBe(true);
  });
});

describe('labels', () => {
  it('removes deleted labels from issues', async () => {
    const [team] = await domain.ctx.storage.teams.all();
    const label = await domain.labels.create({ name: 'Bug', color: '#eb5757' });
    const issue = await domain.issues.create(admin.id, {
      teamId: team!.id,
      title: 'Labeled',
      labelIds: [label.id],
    });
    await domain.labels.remove(label.id);
    const updated = await domain.ctx.storage.issues.get(issue.id);
    expect(updated?.labelIds).toHaveLength(0);
  });
});

describe('cycles', () => {
  it('ensures a current cycle when enabled', async () => {
    const [team] = await domain.ctx.storage.teams.all();
    await domain.teams.update(team!.id, { cyclesEnabled: true, cycleDurationWeeks: 2 });
    const created = await domain.cycles.ensureCurrentCycles(team!.id);
    expect(created.length).toBeGreaterThanOrEqual(1);
    const cycles = await domain.ctx.storage.cycles.all();
    const now = new Date().toISOString();
    expect(cycles.some((c) => c.startsAt <= now && c.endsAt > now)).toBe(true);
  });
});
