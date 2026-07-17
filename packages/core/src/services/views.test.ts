import { beforeEach, describe, expect, it } from 'vitest';
import type { Team, User, ViewFilters } from '@nonlinear/shared';
import { createMemoryStorage } from '../memory.js';
import { SyncBus, type Ctx } from '../domain.js';
import { AuthService } from './auth.js';
import { CustomViewService } from './views.js';

const emptyFilters: ViewFilters = {
  priorities: [],
  assigneeIds: [],
  labelIds: [],
  stateIds: [],
  projectIds: [],
};

let ctx: Ctx;
let views: CustomViewService;
let admin: User;
let member: User;
let team: Team;

beforeEach(async () => {
  const storage = createMemoryStorage();
  const bus = new SyncBus(storage.syncLog);
  ctx = { storage, bus };
  views = new CustomViewService(ctx);
  const auth = new AuthService(ctx);
  admin = (
    await auth.register({
      email: 'ada@example.com',
      password: 'hunter2hunter2',
      name: 'Ada Lovelace',
      workspaceName: 'Acme',
    })
  ).user;
  member = (
    await auth.register({
      email: 'bob@example.com',
      password: 'hunter2hunter2',
      name: 'Bob Builder',
    })
  ).user;
  team = (await storage.teams.all())[0]!;
});

describe('CustomViewService.create', () => {
  it('creates a team-scoped view with defaults and ordering', async () => {
    const view = await views.create(member.id, {
      name: 'My board',
      teamId: team.id,
      filters: emptyFilters,
      grouping: 'state',
      display: 'board',
    });
    expect(view.teamId).toBe(team.id);
    expect(view.creatorId).toBe(member.id);
    expect(view.shared).toBe(false);
    expect(view.sortOrder).toBeTruthy();
    expect(await ctx.storage.customViews.get(view.id)).toEqual(view);

    const second = await views.create(member.id, {
      name: 'Later',
      filters: emptyFilters,
      grouping: 'priority',
      display: 'list',
    });
    expect(second.sortOrder > view.sortOrder).toBe(true);
    expect(second.teamId).toBeNull();
  });

  it('rejects an empty name and an unknown team', async () => {
    await expect(
      views.create(member.id, {
        name: '   ',
        filters: emptyFilters,
        grouping: 'state',
        display: 'list',
      }),
    ).rejects.toThrow(/name/i);
    await expect(
      views.create(member.id, {
        name: 'Ghost',
        teamId: 'nope',
        filters: emptyFilters,
        grouping: 'state',
        display: 'list',
      }),
    ).rejects.toThrow(/not found/i);
  });
});

describe('CustomViewService permissions', () => {
  it('rejects updates and removal by a non-creator member, allows an admin', async () => {
    const view = await views.create(member.id, {
      name: 'Mine',
      filters: emptyFilters,
      grouping: 'state',
      display: 'list',
    });
    const other = (
      await new AuthService(ctx).register({
        email: 'eve@example.com',
        password: 'hunter2hunter2',
        name: 'Eve Stranger',
      })
    ).user;

    await expect(views.update(other.id, view.id, { name: 'Stolen' })).rejects.toMatchObject({
      code: 'forbidden',
      status: 403,
    });
    await expect(views.remove(other.id, view.id)).rejects.toMatchObject({ code: 'forbidden' });

    const renamed = await views.update(admin.id, view.id, { name: 'Curated' });
    expect(renamed.name).toBe('Curated');

    await views.remove(admin.id, view.id);
    expect(await ctx.storage.customViews.get(view.id)).toBeNull();
  });
});

describe('CustomViewService.update', () => {
  it('round-trips every updatable field', async () => {
    const view = await views.create(member.id, {
      name: 'Draft',
      filters: emptyFilters,
      grouping: 'state',
      display: 'list',
    });
    const filters: ViewFilters = { ...emptyFilters, priorities: [1, 2], labelIds: ['l1'] };
    const updatedView = await views.update(member.id, view.id, {
      name: 'Final',
      shared: true,
      filters,
      grouping: 'assignee',
      display: 'board',
      sortOrder: 'zz',
    });
    expect(updatedView).toMatchObject({
      name: 'Final',
      shared: true,
      filters,
      grouping: 'assignee',
      display: 'board',
      sortOrder: 'zz',
    });
    expect(await ctx.storage.customViews.get(view.id)).toEqual(updatedView);
    await expect(views.update(member.id, 'missing', { name: 'X' })).rejects.toThrow(/not found/i);
  });
});
