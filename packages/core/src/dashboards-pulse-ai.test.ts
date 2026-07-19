import { beforeEach, describe, expect, it } from 'vitest';
import { createDomain, type Domain } from './index.js';
import { createMemoryStorage } from './memory.js';
import type { Team, User } from '@nonlinear/shared';

let domain: Domain;
let admin: User;
let member: User;
let team: Team;

beforeEach(async () => {
  domain = createDomain(createMemoryStorage());
  admin = (
    await domain.auth.register({
      email: 'ada@acme.com',
      password: 'hunter2hunter2',
      name: 'Ada',
      workspaceName: 'Acme',
    })
  ).user;
  member = await domain.auth.provisionMember({ email: 'lin@acme.com', name: 'Lin' });
  team = (await domain.ctx.storage.teams.all())[0]!;
});

describe('dashboards', () => {
  it('creates, updates tiles, and enforces owner-only management', async () => {
    const dash = await domain.dashboards.create(admin.id, {
      name: 'Team health',
      tiles: [{ id: '', type: 'stat', title: null, config: { metric: 'open', teamId: team.id } }],
    });
    expect(dash.tiles).toHaveLength(1);
    expect(dash.tiles[0]!.id).not.toBe(''); // normalized

    const updated = await domain.dashboards.update(admin.id, dash.id, {
      tiles: [...dash.tiles, { id: '', type: 'throughput', title: null, config: {} }],
    });
    expect(updated.tiles).toHaveLength(2);

    await expect(
      domain.dashboards.update(member.id, dash.id, { name: 'hijack' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('bootstrap shows shared dashboards to everyone, private only to the owner', async () => {
    const priv = await domain.dashboards.create(admin.id, { name: 'Mine', shared: false });
    const shared = await domain.dashboards.create(admin.id, { name: 'Ours', shared: true });

    const memberBoot = await domain.bootstrap.payload(member.id);
    const ids = memberBoot.dashboards.map((d) => d.id);
    expect(ids).toContain(shared.id);
    expect(ids).not.toContain(priv.id);

    const adminBoot = await domain.bootstrap.payload(admin.id);
    expect(adminBoot.dashboards.map((d) => d.id)).toEqual(
      expect.arrayContaining([priv.id, shared.id]),
    );
  });
});

describe('pulse feed', () => {
  it('aggregates recent project updates and completed issues, newest first', async () => {
    const project = await domain.projects.create({
      name: 'Launch',
      teamIds: [team.id],
      leadId: admin.id,
    });
    await domain.projectUpdates.create(admin.id, {
      projectId: project.id,
      health: 'at_risk',
      body: 'Slipping a bit on the API work.',
    });
    const issue = await domain.issues.create(admin.id, { teamId: team.id, title: 'Ship it' });
    const done = (await domain.ctx.storage.workflowStates.all()).find(
      (s) => s.teamId === team.id && s.category === 'completed',
    )!;
    await domain.issues.update(admin.id, issue.id, { stateId: done.id });

    const feed = await domain.pulse.feed(7);
    const types = feed.items.map((i) => i.type);
    expect(types).toContain('project_update');
    expect(types).toContain('project_created');
    expect(types).toContain('issues_completed');
    // Sorted descending by time.
    for (let i = 1; i < feed.items.length; i++) {
      expect(feed.items[i - 1]!.at >= feed.items[i]!.at).toBe(true);
    }
  });

  it('excludes events older than the window', async () => {
    const feed = await domain.pulse.feed(7);
    expect(feed.sinceDays).toBe(7);
    expect(feed.items).toEqual([]);
  });
});

describe('ai settings', () => {
  it('stores config, projects a key-free public view, and retains the key on omit', async () => {
    await domain.ai.update({ enabled: true, provider: 'anthropic', apiKey: 'sk-secret' });
    const pub = await domain.ai.getPublic();
    expect(pub).toMatchObject({ enabled: true, provider: 'anthropic', hasKey: true });
    expect((pub as Record<string, unknown>).apiKey).toBeUndefined();
    expect(await domain.ai.isReady()).toBe(true);

    // Toggling without an apiKey keeps the stored secret.
    await domain.ai.update({ enabled: false });
    const settings = await domain.ai.getSettings();
    expect(settings?.apiKey).toBe('sk-secret');
    expect(settings?.enabled).toBe(false);

    // Switching provider without a model resets to that provider's default.
    await domain.ai.update({ provider: 'openai' });
    expect((await domain.ai.getSettings())?.model).toBe('gpt-4o-mini');
  });
});
