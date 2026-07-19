import type {
  CreateDashboardInput,
  Dashboard,
  DashboardTile,
  UpdateDashboardInput,
} from '@nonlinear/shared';
import { DomainError, created, deleted, notFound, updated, type Ctx } from '../domain.js';
import { newId } from '../util/ids.js';
import { nowIso } from '../util/time.js';
import { keyAfterAll } from '../util/fractional.js';

/**
 * Custom dashboards: an ordered set of insight tiles, either personal or
 * shared with the workspace. Visibility mirrors CustomView — a dashboard is
 * readable by its creator, or by everyone when `shared`. Tiles are stored
 * inline on the dashboard document; the client renders each by computing from
 * its already-synced entity store, so no server-side metric computation is
 * needed here.
 */
export class DashboardService {
  constructor(private ctx: Ctx) {}

  async create(creatorId: string, input: CreateDashboardInput): Promise<Dashboard> {
    const { storage, bus } = this.ctx;
    const name = input.name.trim();
    if (!name) throw new DomainError('invalid_name', 'Dashboard name is required');
    const existing = await storage.dashboards.all();
    const now = nowIso();
    const dashboard: Dashboard = {
      id: newId(),
      name,
      creatorId,
      shared: input.shared ?? false,
      tiles: (input.tiles ?? []).map(normalizeTile),
      sortOrder: keyAfterAll(existing.map((d) => d.sortOrder)),
      createdAt: now,
      updatedAt: now,
    };
    await storage.dashboards.insert(dashboard);
    await bus.publish([created('dashboard', dashboard)]);
    return dashboard;
  }

  async update(actorId: string, id: string, input: UpdateDashboardInput): Promise<Dashboard> {
    const { storage, bus } = this.ctx;
    const dashboard = await storage.dashboards.get(id);
    if (!dashboard) throw notFound('Dashboard');
    this.assertCanManage(actorId, dashboard);
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new DomainError('invalid_name', 'Dashboard name is required');
      dashboard.name = name;
    }
    if (input.shared !== undefined) dashboard.shared = input.shared;
    if (input.tiles !== undefined) dashboard.tiles = input.tiles.map(normalizeTile);
    if (input.sortOrder !== undefined) dashboard.sortOrder = input.sortOrder;
    dashboard.updatedAt = nowIso();
    await storage.dashboards.update(dashboard);
    await bus.publish([updated('dashboard', dashboard)]);
    return dashboard;
  }

  async remove(actorId: string, id: string): Promise<void> {
    const { storage, bus } = this.ctx;
    const dashboard = await storage.dashboards.get(id);
    if (!dashboard) throw notFound('Dashboard');
    this.assertCanManage(actorId, dashboard);
    await storage.dashboards.delete(id);
    await bus.publish([deleted('dashboard', id)]);
  }

  private assertCanManage(actorId: string, dashboard: Dashboard): void {
    if (dashboard.creatorId !== actorId) {
      throw new DomainError('forbidden', 'Only the dashboard owner can change it', 403);
    }
  }
}

/** Give every tile a stable id and a defined config so the client can key on it. */
function normalizeTile(tile: DashboardTile): DashboardTile {
  return {
    id: tile.id || newId(),
    type: tile.type,
    title: tile.title ?? null,
    config: {
      teamId: tile.config?.teamId ?? null,
      projectId: tile.config?.projectId ?? null,
      metric: tile.config?.metric,
    },
  };
}
