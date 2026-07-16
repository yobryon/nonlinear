import type {
  Attachment,
  Comment,
  Cycle,
  Document,
  Favorite,
  Initiative,
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
  Webhook,
  Workspace,
  WorkflowState,
} from '@nonlinear/shared';

/**
 * The storage boundary. Everything the app persists goes through these
 * interfaces; implementations live in sibling `storage-*` packages and are
 * chosen at composition time. No package outside `storage-*` may import a
 * database driver.
 */

export interface EntityStore<T extends { id: string }> {
  get(id: string): Promise<T | null>;
  all(): Promise<T[]>;
  insert(entity: T): Promise<void>;
  /** Full-row replace by id. */
  update(entity: T): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface UserStore extends EntityStore<User> {
  getByEmail(email: string): Promise<User | null>;
  /** Auth secrets are stored alongside but never leave the storage layer elsewhere. */
  insertWithPassword(user: User, passwordHash: string): Promise<void>;
  getPasswordHash(userId: string): Promise<string | null>;
  setPasswordHash(userId: string, passwordHash: string): Promise<void>;
  count(): Promise<number>;
}

export interface TeamStore extends EntityStore<Team> {
  /** Atomically reserve and return the next issue number for a team. */
  nextIssueNumber(teamId: string): Promise<number>;
}

export interface IssueStore extends EntityStore<Issue> {
  byTeam(teamId: string): Promise<Issue[]>;
}

export interface ActivityStore extends EntityStore<IssueActivity> {
  byIssue(issueId: string): Promise<IssueActivity[]>;
}

export interface Session {
  token: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}

export interface SessionStore {
  create(session: Session): Promise<void>;
  get(token: string): Promise<Session | null>;
  delete(token: string): Promise<void>;
  deleteForUser(userId: string): Promise<void>;
}

export interface SyncLogStore {
  /**
   * Append deltas, assigning consecutive syncIds atomically.
   * Returns the deltas with syncIds filled in.
   */
  append(deltas: Omit<SyncDelta, 'syncId'>[]): Promise<SyncDelta[]>;
  /**
   * Deltas with syncId > since, oldest first, or null if `since` predates
   * the retained log (client must re-bootstrap).
   */
  since(syncId: number): Promise<SyncDelta[] | null>;
  currentSyncId(): Promise<number>;
}

export interface Storage {
  workspaces: EntityStore<Workspace>;
  users: UserStore;
  teams: TeamStore;
  teamMemberships: EntityStore<TeamMembership>;
  workflowStates: EntityStore<WorkflowState>;
  issues: IssueStore;
  labels: EntityStore<Label>;
  comments: EntityStore<Comment>;
  reactions: EntityStore<Reaction>;
  projects: EntityStore<Project>;
  projectMilestones: EntityStore<ProjectMilestone>;
  cycles: EntityStore<Cycle>;
  issueRelations: EntityStore<IssueRelation>;
  notifications: EntityStore<Notification>;
  favorites: EntityStore<Favorite>;
  attachments: EntityStore<Attachment>;
  initiatives: EntityStore<Initiative>;
  documents: EntityStore<Document>;
  webhooks: EntityStore<Webhook>;
  activities: ActivityStore;
  sessions: SessionStore;
  syncLog: SyncLogStore;
  /** Close pools/handles. */
  close(): Promise<void>;
}
