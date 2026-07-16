import type {
  BootstrapPayload,
  CreateFavoriteInput,
  CreateRelationInput,
  Favorite,
  IssueRelation,
  UpdateProfileInput,
  User,
  Workspace,
} from '@nonlinear/shared';
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
import { keyAfterAll } from '../util/fractional.js';

export class RelationService {
  constructor(private ctx: Ctx) {}

  async create(input: CreateRelationInput): Promise<IssueRelation> {
    const { storage, bus } = this.ctx;
    if (input.issueId === input.relatedIssueId) {
      throw new DomainError('self_relation', 'An issue cannot relate to itself');
    }
    if (!(await storage.issues.get(input.issueId))) throw notFound('Issue');
    if (!(await storage.issues.get(input.relatedIssueId))) throw notFound('Issue');
    for (const existing of await storage.issueRelations.all()) {
      const samePair =
        (existing.issueId === input.issueId && existing.relatedIssueId === input.relatedIssueId) ||
        (existing.issueId === input.relatedIssueId && existing.relatedIssueId === input.issueId);
      if (samePair && existing.type === input.type) return existing;
    }
    const relation: IssueRelation = {
      id: newId(),
      type: input.type,
      issueId: input.issueId,
      relatedIssueId: input.relatedIssueId,
      createdAt: nowIso(),
    };
    await storage.issueRelations.insert(relation);
    await bus.publish([created('issueRelation', relation)]);
    return relation;
  }

  async remove(relationId: string): Promise<void> {
    const { storage, bus } = this.ctx;
    const relation = await storage.issueRelations.get(relationId);
    if (!relation) return;
    await storage.issueRelations.delete(relationId);
    await bus.publish([deleted('issueRelation', relationId)]);
  }
}

export class FavoriteService {
  constructor(private ctx: Ctx) {}

  async add(userId: string, input: CreateFavoriteInput): Promise<Favorite> {
    const { storage, bus } = this.ctx;
    const mine = (await storage.favorites.all()).filter((f) => f.userId === userId);
    const existing = mine.find((f) => f.type === input.type && f.targetId === input.targetId);
    if (existing) return existing;
    const favorite: Favorite = {
      id: newId(),
      userId,
      type: input.type,
      targetId: input.targetId,
      sortOrder: keyAfterAll(mine.map((f) => f.sortOrder)),
      createdAt: nowIso(),
    };
    await storage.favorites.insert(favorite);
    await bus.publish([created('favorite', favorite)]);
    return favorite;
  }

  async remove(userId: string, favoriteId: string): Promise<void> {
    const { storage, bus } = this.ctx;
    const favorite = await storage.favorites.get(favoriteId);
    if (!favorite) return;
    if (favorite.userId !== userId) {
      throw new DomainError('forbidden', 'Not your favorite', 403);
    }
    await storage.favorites.delete(favoriteId);
    await bus.publish([deleted('favorite', favoriteId)]);
  }
}

export class NotificationService {
  constructor(private ctx: Ctx) {}

  async markRead(userId: string, notificationId: string, read: boolean): Promise<void> {
    const { storage, bus } = this.ctx;
    const notification = await storage.notifications.get(notificationId);
    if (!notification || notification.userId !== userId) throw notFound('Notification');
    notification.readAt = read ? nowIso() : null;
    await storage.notifications.update(notification);
    await bus.publish([updated('notification', notification)]);
  }

  async markAllRead(userId: string): Promise<void> {
    const { storage, bus } = this.ctx;
    const deltas: DeltaInput[] = [];
    const now = nowIso();
    for (const notification of await storage.notifications.all()) {
      if (notification.userId === userId && !notification.readAt) {
        notification.readAt = now;
        await storage.notifications.update(notification);
        deltas.push(updated('notification', notification));
      }
    }
    await bus.publish(deltas);
  }

  async remove(userId: string, notificationId: string): Promise<void> {
    const { storage, bus } = this.ctx;
    const notification = await storage.notifications.get(notificationId);
    if (!notification || notification.userId !== userId) return;
    await storage.notifications.delete(notificationId);
    await bus.publish([deleted('notification', notificationId)]);
  }
}

export class UserService {
  constructor(private ctx: Ctx) {}

  async updateProfile(userId: string, input: UpdateProfileInput): Promise<User> {
    const { storage, bus } = this.ctx;
    const user = await storage.users.get(userId);
    if (!user) throw notFound('User');
    if (input.name !== undefined) user.name = input.name.trim() || user.name;
    if (input.displayName !== undefined) {
      const handle = input.displayName.trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9._-]*$/.test(handle)) {
        throw new DomainError('invalid_handle', 'Display name must be alphanumeric');
      }
      for (const other of await storage.users.all()) {
        if (other.id !== userId && other.displayName === handle) {
          throw new DomainError('handle_taken', 'Display name already taken', 409);
        }
      }
      user.displayName = handle;
    }
    if (input.avatarColor !== undefined) user.avatarColor = input.avatarColor;
    user.updatedAt = nowIso();
    await storage.users.update(user);
    await bus.publish([updated('user', user)]);
    return user;
  }

  /** Admin-only: change role or deactivate a member. */
  async adminUpdate(
    actorId: string,
    userId: string,
    input: { role?: 'admin' | 'member' | 'guest'; active?: boolean },
  ): Promise<User> {
    const { storage, bus } = this.ctx;
    const actor = await storage.users.get(actorId);
    if (actor?.role !== 'admin') {
      throw new DomainError('forbidden', 'Only admins can manage members', 403);
    }
    const user = await storage.users.get(userId);
    if (!user) throw notFound('User');
    if (input.role !== undefined) user.role = input.role;
    if (input.active !== undefined) {
      user.active = input.active;
      if (!input.active) await storage.sessions.deleteForUser(userId);
    }
    const admins = (await storage.users.all()).filter((u) => u.role === 'admin' && u.active);
    if (!admins.some((u) => u.id !== userId) && (user.role !== 'admin' || !user.active)) {
      throw new DomainError('last_admin', 'The workspace needs at least one active admin', 409);
    }
    user.updatedAt = nowIso();
    await storage.users.update(user);
    await bus.publish([updated('user', user)]);
    return user;
  }

  async updateWorkspace(name: string): Promise<Workspace> {
    const { storage, bus } = this.ctx;
    const workspace = (await storage.workspaces.all())[0];
    if (!workspace) throw notFound('Workspace');
    workspace.name = name.trim() || workspace.name;
    workspace.updatedAt = nowIso();
    await storage.workspaces.update(workspace);
    await bus.publish([updated('workspace', workspace)]);
    return workspace;
  }
}

export class BootstrapService {
  constructor(private ctx: Ctx) {}

  async payload(userId: string): Promise<BootstrapPayload> {
    const s = this.ctx.storage;
    const workspace = (await s.workspaces.all())[0];
    if (!workspace) throw notFound('Workspace');
    const [
      users,
      teams,
      teamMemberships,
      workflowStates,
      issues,
      labels,
      comments,
      reactions,
      projects,
      projectMilestones,
      cycles,
      issueRelations,
      notifications,
      favorites,
      attachments,
      initiatives,
      documents,
      webhooks,
      syncId,
    ] = await Promise.all([
      s.users.all(),
      s.teams.all(),
      s.teamMemberships.all(),
      s.workflowStates.all(),
      s.issues.all(),
      s.labels.all(),
      s.comments.all(),
      s.reactions.all(),
      s.projects.all(),
      s.projectMilestones.all(),
      s.cycles.all(),
      s.issueRelations.all(),
      s.notifications.all(),
      s.favorites.all(),
      s.attachments.all(),
      s.initiatives.all(),
      s.documents.all(),
      s.webhooks.all(),
      s.syncLog.currentSyncId(),
    ]);
    return {
      syncId,
      userId,
      workspace,
      users,
      teams,
      teamMemberships,
      workflowStates,
      issues,
      labels,
      comments,
      reactions,
      projects,
      projectMilestones,
      cycles,
      issueRelations,
      notifications: notifications.filter((n) => n.userId === userId),
      favorites: favorites.filter((f) => f.userId === userId),
      attachments,
      initiatives,
      documents,
      webhooks,
    };
  }
}
