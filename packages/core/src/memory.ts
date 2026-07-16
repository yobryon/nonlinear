import type {
  Comment,
  Cycle,
  Favorite,
  Issue,
  IssueActivity,
  IssueRelation,
  Label,
  Notification,
  Project,
  ProjectMilestone,
  Reaction,
  SyncDelta,
  Team,
  TeamMembership,
  User,
  Workspace,
  WorkflowState,
} from '@nonlinear/shared';
import type {
  ActivityStore,
  EntityStore,
  IssueStore,
  Session,
  SessionStore,
  Storage,
  SyncLogStore,
  TeamStore,
  UserStore,
} from './storage.js';

/**
 * Reference storage implementation. Used by tests and as the zero-dependency
 * dev backend (STORAGE=memory). Data lives for the process lifetime only.
 */

function clone<T>(value: T): T {
  return structuredClone(value);
}

class MemoryEntityStore<T extends { id: string }> implements EntityStore<T> {
  protected rows = new Map<string, T>();

  async get(id: string): Promise<T | null> {
    const row = this.rows.get(id);
    return row ? clone(row) : null;
  }

  async all(): Promise<T[]> {
    return [...this.rows.values()].map(clone);
  }

  async insert(entity: T): Promise<void> {
    this.rows.set(entity.id, clone(entity));
  }

  async update(entity: T): Promise<void> {
    this.rows.set(entity.id, clone(entity));
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }
}

class MemoryUserStore extends MemoryEntityStore<User> implements UserStore {
  private passwords = new Map<string, string>();

  async getByEmail(email: string): Promise<User | null> {
    for (const user of this.rows.values()) {
      if (user.email === email) return clone(user);
    }
    return null;
  }

  async insertWithPassword(user: User, passwordHash: string): Promise<void> {
    await this.insert(user);
    this.passwords.set(user.id, passwordHash);
  }

  async getPasswordHash(userId: string): Promise<string | null> {
    return this.passwords.get(userId) ?? null;
  }

  async setPasswordHash(userId: string, passwordHash: string): Promise<void> {
    this.passwords.set(userId, passwordHash);
  }

  async count(): Promise<number> {
    return this.rows.size;
  }
}

class MemoryTeamStore extends MemoryEntityStore<Team> implements TeamStore {
  private counters = new Map<string, number>();

  async nextIssueNumber(teamId: string): Promise<number> {
    const team = this.rows.get(teamId);
    if (!team) throw new Error('team not found');
    const current = this.counters.get(teamId) ?? team.issueCounter;
    const next = current + 1;
    this.counters.set(teamId, next);
    return next;
  }
}

class MemoryIssueStore extends MemoryEntityStore<Issue> implements IssueStore {
  async byTeam(teamId: string): Promise<Issue[]> {
    return [...this.rows.values()].filter((i) => i.teamId === teamId).map(clone);
  }
}

class MemoryActivityStore extends MemoryEntityStore<IssueActivity> implements ActivityStore {
  async byIssue(issueId: string): Promise<IssueActivity[]> {
    return [...this.rows.values()]
      .filter((a) => a.issueId === issueId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(clone);
  }
}

class MemorySessionStore implements SessionStore {
  private sessions = new Map<string, Session>();

  async create(session: Session): Promise<void> {
    this.sessions.set(session.token, clone(session));
  }

  async get(token: string): Promise<Session | null> {
    const session = this.sessions.get(token);
    return session ? clone(session) : null;
  }

  async delete(token: string): Promise<void> {
    this.sessions.delete(token);
  }

  async deleteForUser(userId: string): Promise<void> {
    for (const [token, session] of this.sessions) {
      if (session.userId === userId) this.sessions.delete(token);
    }
  }
}

class MemorySyncLog implements SyncLogStore {
  private log: SyncDelta[] = [];
  private nextId = 1;

  async append(deltas: Omit<SyncDelta, 'syncId'>[]): Promise<SyncDelta[]> {
    const stamped = deltas.map((d) => ({ ...clone(d), syncId: this.nextId++ }) as SyncDelta);
    this.log.push(...stamped);
    return clone(stamped);
  }

  async since(syncId: number): Promise<SyncDelta[] | null> {
    const first = this.log[0];
    if (first && syncId < first.syncId - 1) return null;
    return this.log.filter((d) => d.syncId > syncId).map(clone);
  }

  async currentSyncId(): Promise<number> {
    return this.nextId - 1;
  }
}

export function createMemoryStorage(): Storage {
  return {
    workspaces: new MemoryEntityStore<Workspace>(),
    users: new MemoryUserStore(),
    teams: new MemoryTeamStore(),
    teamMemberships: new MemoryEntityStore<TeamMembership>(),
    workflowStates: new MemoryEntityStore<WorkflowState>(),
    issues: new MemoryIssueStore(),
    labels: new MemoryEntityStore<Label>(),
    comments: new MemoryEntityStore<Comment>(),
    reactions: new MemoryEntityStore<Reaction>(),
    projects: new MemoryEntityStore<Project>(),
    projectMilestones: new MemoryEntityStore<ProjectMilestone>(),
    cycles: new MemoryEntityStore<Cycle>(),
    issueRelations: new MemoryEntityStore<IssueRelation>(),
    notifications: new MemoryEntityStore<Notification>(),
    favorites: new MemoryEntityStore<Favorite>(),
    activities: new MemoryActivityStore(),
    sessions: new MemorySessionStore(),
    syncLog: new MemorySyncLog(),
    close: async () => {},
  };
}
