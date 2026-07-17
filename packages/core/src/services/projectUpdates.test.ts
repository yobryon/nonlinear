import { beforeEach, describe, expect, it } from 'vitest';
import type { Project, ProjectUpdate, User } from '@nonlinear/shared';
import { createMemoryStorage } from '../memory.js';
import { SyncBus, type Ctx } from '../domain.js';
import type { Storage } from '../storage.js';
import { AuthService } from '../services/auth.js';
import { ProjectService } from '../services/projects.js';
import { newId } from '../util/ids.js';
import { ProjectUpdateService } from './projectUpdates.js';

let storage: Storage;
let ctx: Ctx;
let service: ProjectUpdateService;
let admin: User;
let member: User;
let project: Project;

beforeEach(async () => {
  storage = createMemoryStorage();
  const bus = new SyncBus(storage.syncLog);
  ctx = { storage, bus };
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
      name: 'Bob Member',
    })
  ).user;
  const team = (await storage.teams.all())[0]!;
  const projects = new ProjectService(ctx);
  project = await projects.create({ name: 'Apollo', teamIds: [team.id] });
  service = new ProjectUpdateService(ctx);
});

function seedUpdate(overrides: Partial<ProjectUpdate>): ProjectUpdate {
  return {
    id: newId(),
    projectId: project.id,
    authorId: admin.id,
    health: 'on_track',
    body: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ProjectUpdateService.create + latestHealth', () => {
  it('creates an update with body defaulting to empty and publishes a delta', async () => {
    const before = await storage.syncLog.currentSyncId();
    const update = await service.create(admin.id, {
      projectId: project.id,
      health: 'at_risk',
    });
    expect(update.body).toBe('');
    expect(update.authorId).toBe(admin.id);
    expect(update.health).toBe('at_risk');
    expect(await storage.projectUpdates.get(update.id)).toEqual(update);
    const deltas = await storage.syncLog.since(before);
    expect(deltas).toEqual([
      expect.objectContaining({ model: 'projectUpdate', action: 'create', data: update }),
    ]);
  });

  it('rejects a missing project', async () => {
    await expect(
      service.create(admin.id, { projectId: 'nope', health: 'on_track' }),
    ).rejects.toThrow(/not found/i);
  });

  it('latestHealth returns the health of the most recent update by createdAt', async () => {
    expect(await service.latestHealth(project.id)).toBeNull();
    await storage.projectUpdates.insert(
      seedUpdate({ health: 'off_track', createdAt: '2026-03-01T00:00:00.000Z' }),
    );
    await storage.projectUpdates.insert(
      seedUpdate({ health: 'on_track', createdAt: '2026-01-01T00:00:00.000Z' }),
    );
    await storage.projectUpdates.insert(
      seedUpdate({ health: 'at_risk', createdAt: '2026-02-01T00:00:00.000Z' }),
    );
    expect(await service.latestHealth(project.id)).toBe('off_track');
  });
});

describe('ProjectUpdateService permissions', () => {
  it('only the author can edit an update', async () => {
    const update = await service.create(admin.id, {
      projectId: project.id,
      health: 'on_track',
      body: 'all good',
    });
    await expect(service.update(member.id, update.id, { body: 'hijack' })).rejects.toThrow(/own/i);

    const edited = await service.update(admin.id, update.id, {
      health: 'at_risk',
      body: 'slipping',
    });
    expect(edited.health).toBe('at_risk');
    expect(edited.body).toBe('slipping');
    expect((await storage.projectUpdates.get(update.id))?.body).toBe('slipping');
  });

  it('the author or an admin can remove; other members cannot', async () => {
    const byAdmin = await service.create(admin.id, { projectId: project.id, health: 'on_track' });
    await expect(service.remove(member.id, byAdmin.id)).rejects.toThrow(/own/i);
    await service.remove(admin.id, byAdmin.id);
    expect(await storage.projectUpdates.get(byAdmin.id)).toBeNull();

    const byMember = await service.create(member.id, { projectId: project.id, health: 'at_risk' });
    await service.remove(admin.id, byMember.id);
    expect(await storage.projectUpdates.get(byMember.id)).toBeNull();
  });

  it('404s on unknown updates', async () => {
    await expect(service.update(admin.id, 'nope', { body: 'x' })).rejects.toThrow(/not found/i);
    await expect(service.remove(admin.id, 'nope')).rejects.toThrow(/not found/i);
  });
});

describe('ProjectUpdateService.removeForProject', () => {
  it('deletes all updates for the project, returns deltas, and does not publish', async () => {
    const a = await service.create(admin.id, { projectId: project.id, health: 'on_track' });
    const b = await service.create(member.id, { projectId: project.id, health: 'at_risk' });
    const otherProject = await new ProjectService(ctx).create({
      name: 'Zeus',
      teamIds: [(await storage.teams.all())[0]!.id],
    });
    const other = await service.create(admin.id, {
      projectId: otherProject.id,
      health: 'off_track',
    });

    const before = await storage.syncLog.currentSyncId();
    const deltas = await service.removeForProject(project.id);
    expect(deltas).toHaveLength(2);
    expect(deltas.map((d) => d.action)).toEqual(['delete', 'delete']);
    expect(deltas.map((d) => d.data.id).sort()).toEqual([a.id, b.id].sort());

    // Nothing published — the caller batches these into its own cascade.
    expect(await storage.syncLog.currentSyncId()).toBe(before);

    expect(await storage.projectUpdates.get(a.id)).toBeNull();
    expect(await storage.projectUpdates.get(b.id)).toBeNull();
    expect(await storage.projectUpdates.get(other.id)).toEqual(other);
  });

  it('returns an empty array when the project has no updates', async () => {
    expect(await service.removeForProject(project.id)).toEqual([]);
  });
});
