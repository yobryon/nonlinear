import type { CreateProjectUpdateInput, ProjectHealth, ProjectUpdate } from '@nonlinear/shared';
import {
  DomainError,
  created,
  deleted,
  notFound,
  updated,
  type Ctx,
  type DeltaInput,
} from '../domain.js';
import { newId } from '../util/ids.js';
import { nowIso } from '../util/time.js';

export interface UpdateProjectUpdateInput {
  health?: ProjectHealth;
  body?: string;
}

export class ProjectUpdateService {
  constructor(private ctx: Ctx) {}

  async create(authorId: string, input: CreateProjectUpdateInput): Promise<ProjectUpdate> {
    const { storage, bus } = this.ctx;
    if (!(await storage.projects.get(input.projectId))) throw notFound('Project');
    const now = nowIso();
    const update: ProjectUpdate = {
      id: newId(),
      projectId: input.projectId,
      authorId,
      health: input.health,
      body: input.body ?? '',
      createdAt: now,
      updatedAt: now,
    };
    await storage.projectUpdates.insert(update);
    await bus.publish([created('projectUpdate', update)]);
    return update;
  }

  async update(
    actorId: string,
    updateId: string,
    input: UpdateProjectUpdateInput,
  ): Promise<ProjectUpdate> {
    const { storage, bus } = this.ctx;
    const update = await storage.projectUpdates.get(updateId);
    if (!update) throw notFound('Project update');
    if (update.authorId !== actorId) {
      throw new DomainError('forbidden', 'You can only edit your own project updates', 403);
    }
    if (input.health !== undefined) update.health = input.health;
    if (input.body !== undefined) update.body = input.body;
    update.updatedAt = nowIso();
    await storage.projectUpdates.update(update);
    await bus.publish([updated('projectUpdate', update)]);
    return update;
  }

  async remove(actorId: string, updateId: string): Promise<void> {
    const { storage, bus } = this.ctx;
    const update = await storage.projectUpdates.get(updateId);
    if (!update) throw notFound('Project update');
    const actor = await storage.users.get(actorId);
    if (update.authorId !== actorId && actor?.role !== 'admin') {
      throw new DomainError('forbidden', 'You can only delete your own project updates', 403);
    }
    await storage.projectUpdates.delete(updateId);
    await bus.publish([deleted('projectUpdate', updateId)]);
  }

  /**
   * Delete every update for a project and return the deltas without
   * publishing — the project-deletion cascade publishes them as one batch.
   */
  async removeForProject(projectId: string): Promise<DeltaInput[]> {
    const { storage } = this.ctx;
    const deltas: DeltaInput[] = [];
    for (const update of await storage.projectUpdates.all()) {
      if (update.projectId === projectId) {
        await storage.projectUpdates.delete(update.id);
        deltas.push(deleted('projectUpdate', update.id));
      }
    }
    return deltas;
  }

  /** Health of the most recent update for the project, or null if none. */
  async latestHealth(projectId: string): Promise<ProjectHealth | null> {
    const updates = (await this.ctx.storage.projectUpdates.all()).filter(
      (u) => u.projectId === projectId,
    );
    if (updates.length === 0) return null;
    let latest = updates[0]!;
    for (const update of updates) {
      if (update.createdAt > latest.createdAt) latest = update;
    }
    return latest.health;
  }
}
