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
  admin = (
    await domain.auth.register({
      email: 'admin@example.com',
      password: 'hunter2hunter2',
      name: 'Ada Admin',
      workspaceName: 'Acme',
    })
  ).user;
  teamA = (await domain.ctx.storage.teams.all())[0]!;
});

const register = (email: string, role: 'member' | 'guest') =>
  domain.auth
    .register(
      { email, password: 'hunter2hunter2', name: email, workspaceName: 'ignored' },
      { role },
    )
    .then((r) => r.user);

describe('team-scoped read isolation', () => {
  it('a member sees own teams fully and internal-intake teams as shells', async () => {
    const issueA = await domain.issues.create(admin.id, { teamId: teamA.id, title: 'A work' });
    const member = await register('bob@example.com', 'member'); // joins teamA
    // Created after the member joins → they're not a member; default internal
    // intake makes it an intake shell for them.
    const teamB = await domain.teams.create(admin.id, { name: 'Beta', key: 'BETA' });
    const issueB = await domain.issues.create(admin.id, { teamId: teamB.id, title: 'B work' });

    const view = await domain.bootstrap.payload(member.id);
    // Both team shells are visible…
    expect(view.teams.map((t) => t.id).sort()).toEqual([teamA.id, teamB.id].sort());
    // …including team B's workflow states (so a filer can read status)…
    expect(view.workflowStates.some((s) => s.teamId === teamB.id)).toBe(true);
    // …but only team A's issues, never team B's (the member filed none there).
    expect(view.issues.map((i) => i.id)).toContain(issueA.id);
    expect(view.issues.map((i) => i.id)).not.toContain(issueB.id);
  });

  it('a member can file into an intake team and then track only their own', async () => {
    const member = await register('carol@example.com', 'member');
    const teamB = await domain.teams.create(admin.id, { name: 'Beta', key: 'BETA' });
    const mine = await domain.issues.create(member.id, { teamId: teamB.id, title: 'my request' });
    const theirs = await domain.issues.create(admin.id, { teamId: teamB.id, title: 'B internal' });
    const theirComment = await domain.comments.create(admin.id, {
      issueId: theirs.id,
      body: 'internal note',
    });

    const view = await domain.bootstrap.payload(member.id);
    expect(view.issues.map((i) => i.id)).toContain(mine.id); // sees what they filed
    expect(view.issues.map((i) => i.id)).not.toContain(theirs.id); // not the team's other work
    expect(view.comments.map((c) => c.id)).not.toContain(theirComment.id);
    // Intake users don't see the team's projects/cycles/templates.
    expect(view.projects.every((p) => !p.teamIds.includes(teamB.id))).toBe(true);
  });

  it('a team with internal intake OFF is invisible to non-members', async () => {
    const member = await register('dave@example.com', 'member');
    const sealed = await domain.teams.create(admin.id, {
      name: 'Sealed',
      key: 'SEAL',
      internalIntake: false,
    });
    await domain.issues.create(admin.id, { teamId: sealed.id, title: 'secret' });

    const view = await domain.bootstrap.payload(member.id);
    expect(view.teams.map((t) => t.id)).not.toContain(sealed.id);
    expect(view.workflowStates.some((s) => s.teamId === sealed.id)).toBe(false);
  });

  it('a guest sees intake shells but no issues until they file', async () => {
    await domain.issues.create(admin.id, { teamId: teamA.id, title: 'team A work' });
    const guest = await register('gus@example.com', 'guest'); // joins nothing

    let view = await domain.bootstrap.payload(guest.id);
    expect(view.teams.map((t) => t.id)).toContain(teamA.id); // intake shell (teamA accepts intake)
    expect(view.issues).toEqual([]); // but no issues — none filed, not a member

    const filed = await domain.issues.create(guest.id, {
      teamId: teamA.id,
      title: 'guest request',
    });
    view = await domain.bootstrap.payload(guest.id);
    expect(view.issues.map((i) => i.id)).toEqual([filed.id]);
  });

  it('a scoped token narrows even an admin to its teams', async () => {
    await domain.issues.create(admin.id, { teamId: teamA.id, title: 'A work' });
    const teamB = await domain.teams.create(admin.id, { name: 'Beta', key: 'BETA' });
    await domain.issues.create(admin.id, { teamId: teamB.id, title: 'B work' });

    const full = await domain.bootstrap.payload(admin.id);
    expect(full.teams.length).toBe(2);

    const scoped = await domain.bootstrap.payload(admin.id, [teamA.id]);
    expect(scoped.teams.map((t) => t.id)).toEqual([teamA.id]);
    expect(scoped.issues.every((i) => i.teamId === teamA.id)).toBe(true);
  });

  it('webhooks are never sent to non-admins', async () => {
    await domain.webhooks.create(admin.id, 'https://example.com/hook');
    const member = await register('erin@example.com', 'member');
    expect((await domain.bootstrap.payload(member.id)).webhooks).toEqual([]);
    expect((await domain.bootstrap.payload(admin.id)).webhooks.length).toBe(1);
  });
});
