import type { CreateCustomViewInput, CustomView, UpdateCustomViewInput } from '@nonlinear/shared';
import { DomainError, created, deleted, notFound, updated, type Ctx } from '../domain.js';
import { newId } from '../util/ids.js';
import { nowIso } from '../util/time.js';
import { keyAfterAll } from '../util/fractional.js';

export class CustomViewService {
  constructor(private ctx: Ctx) {}

  async create(creatorId: string, input: CreateCustomViewInput): Promise<CustomView> {
    const { storage, bus } = this.ctx;
    const name = input.name.trim();
    if (!name) throw new DomainError('invalid_name', 'View name is required');
    if (input.teamId && !(await storage.teams.get(input.teamId))) throw notFound('Team');
    const existing = await storage.customViews.all();
    const now = nowIso();
    const view: CustomView = {
      id: newId(),
      name,
      creatorId,
      shared: input.shared ?? false,
      teamId: input.teamId ?? null,
      filters: input.filters,
      grouping: input.grouping,
      display: input.display,
      sortOrder: keyAfterAll(existing.map((v) => v.sortOrder)),
      createdAt: now,
      updatedAt: now,
    };
    await storage.customViews.insert(view);
    await bus.publish([created('customView', view)]);
    return view;
  }

  async update(actorId: string, viewId: string, input: UpdateCustomViewInput): Promise<CustomView> {
    const { storage, bus } = this.ctx;
    const view = await storage.customViews.get(viewId);
    if (!view) throw notFound('View');
    await this.assertCanManage(actorId, view);
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new DomainError('invalid_name', 'View name is required');
      view.name = name;
    }
    if (input.shared !== undefined) view.shared = input.shared;
    if (input.filters !== undefined) view.filters = input.filters;
    if (input.grouping !== undefined) view.grouping = input.grouping;
    if (input.display !== undefined) view.display = input.display;
    if (input.sortOrder !== undefined) view.sortOrder = input.sortOrder;
    view.updatedAt = nowIso();
    await storage.customViews.update(view);
    await bus.publish([updated('customView', view)]);
    return view;
  }

  async remove(actorId: string, viewId: string): Promise<void> {
    const { storage, bus } = this.ctx;
    const view = await storage.customViews.get(viewId);
    if (!view) throw notFound('View');
    await this.assertCanManage(actorId, view);
    await storage.customViews.delete(viewId);
    await bus.publish([deleted('customView', viewId)]);
  }

  /** Only the creator or a workspace admin may modify a view. */
  private async assertCanManage(actorId: string, view: CustomView): Promise<void> {
    if (actorId === view.creatorId) return;
    const actor = await this.ctx.storage.users.get(actorId);
    if (actor?.role === 'admin') return;
    throw new DomainError('forbidden', 'Only the creator or an admin can modify this view', 403);
  }
}
