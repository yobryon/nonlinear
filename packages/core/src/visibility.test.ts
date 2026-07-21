import { beforeEach, describe, expect, it } from 'vitest';
import { createDomain, type Domain } from './index.js';
import { createMemoryStorage } from './memory.js';
import { createMemoryBlobStore } from './blob.js';
import type { Team, User } from '@nonlinear/shared';

let domain: Domain;
let admin: User;
let teamA: Team;

beforeEach(async () => {
  domain = createDomain(createMemoryStorage(), { blobs: createMemoryBlobStore() });
  const result = await domain.auth.register({
    email: 'admin@example.com',
    password: 'hunter2hunter2',
    name: 'Ada Admin',
    workspaceName: 'Acme',
  });
  admin = result.user;
  teamA = (await domain.ctx.storage.teams.all())[0]!;
});

describe('team-scoped read isolation', () => {
  it('a member sees only the teams they belong to', async () => {
    const issueA = await domain.issues.create(admin.id, { teamId: teamA.id, title: 'A work' });

    // A member registers → auto-joins existing non-private teams (team A).
    const member = (
      await domain.auth.register(
        {
          email: 'bob@example.com',
          password: 'hunter2hunter2',
          name: 'Bob Member',
          workspaceName: 'ignored',
        },
        { role: 'member' },
      )
    ).user;

    // Team B is created afterward → the member is NOT retroactively added.
    const teamB = await domain.teams.create(admin.id, { name: 'Beta', key: 'BETA' });
    const issueB = await domain.issues.create(admin.id, { teamId: teamB.id, title: 'B work' });

    const memberView = await domain.bootstrap.payload(member.id);
    expect(memberView.teams.map((t) => t.id)).toEqual([teamA.id]);
    expect(memberView.issues.map((i) => i.id)).toContain(issueA.id);
    expect(memberView.issues.map((i) => i.id)).not.toContain(issueB.id);

    // The admin sees everything.
    const adminView = await domain.bootstrap.payload(admin.id);
    expect(adminView.teams.map((t) => t.id).sort()).toEqual([teamA.id, teamB.id].sort());
    expect(adminView.issues.map((i) => i.id)).toEqual(
      expect.arrayContaining([issueA.id, issueB.id]),
    );
  });

  it('comments and children of an unseen team are withheld', async () => {
    const member = (
      await domain.auth.register(
        {
          email: 'carol@example.com',
          password: 'hunter2hunter2',
          name: 'Carol Member',
          workspaceName: 'ignored',
        },
        { role: 'member' },
      )
    ).user;
    const teamB = await domain.teams.create(admin.id, { name: 'Beta', key: 'BETA' });
    const issueB = await domain.issues.create(admin.id, { teamId: teamB.id, title: 'B work' });
    const commentB = await domain.comments.create(admin.id, {
      issueId: issueB.id,
      body: 'secret',
    });

    const view = await domain.bootstrap.payload(member.id);
    expect(view.comments.map((c) => c.id)).not.toContain(commentB.id);
    expect(view.workflowStates.some((s) => s.teamId === teamB.id)).toBe(false);
  });

  it('a guest joins nothing and sees no team data until added', async () => {
    await domain.issues.create(admin.id, { teamId: teamA.id, title: 'A work' });
    const guest = (
      await domain.auth.register(
        {
          email: 'guest@example.com',
          password: 'hunter2hunter2',
          name: 'Gus Guest',
          workspaceName: 'ignored',
        },
        { role: 'guest' },
      )
    ).user;

    let view = await domain.bootstrap.payload(guest.id);
    expect(view.teams).toEqual([]);
    expect(view.issues).toEqual([]);

    // Once an admin adds the guest to team A, they see exactly that team.
    await domain.teams.addMember(teamA.id, guest.id);
    view = await domain.bootstrap.payload(guest.id);
    expect(view.teams.map((t) => t.id)).toEqual([teamA.id]);
    expect(view.issues.length).toBe(1);
  });

  it('a scoped token narrows even an admin to its teams', async () => {
    await domain.issues.create(admin.id, { teamId: teamA.id, title: 'A work' });
    const teamB = await domain.teams.create(admin.id, { name: 'Beta', key: 'BETA' });
    await domain.issues.create(admin.id, { teamId: teamB.id, title: 'B work' });

    // Unscoped: the admin sees both teams.
    const full = await domain.bootstrap.payload(admin.id);
    expect(full.teams.length).toBe(2);

    // A token scoped to team A collapses the admin's view to just team A.
    const scoped = await domain.bootstrap.payload(admin.id, [teamA.id]);
    expect(scoped.teams.map((t) => t.id)).toEqual([teamA.id]);
    expect(scoped.issues.every((i) => i.teamId === teamA.id)).toBe(true);
  });

  it('webhooks are never sent to non-admins', async () => {
    await domain.webhooks.create(admin.id, 'https://example.com/hook');
    const member = (
      await domain.auth.register(
        {
          email: 'dave@example.com',
          password: 'hunter2hunter2',
          name: 'Dave Member',
          workspaceName: 'ignored',
        },
        { role: 'member' },
      )
    ).user;
    const memberView = await domain.bootstrap.payload(member.id);
    expect(memberView.webhooks).toEqual([]);
    const adminView = await domain.bootstrap.payload(admin.id);
    expect(adminView.webhooks.length).toBe(1);
  });
});
