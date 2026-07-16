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
  Team,
  TeamMembership,
  User,
  Webhook,
  Workspace,
  WorkflowState,
} from './entities.js';

/**
 * Delta sync: every mutation to a synced model is assigned a monotonically
 * increasing syncId. Clients bootstrap a full snapshot (tagged with the
 * current syncId), then stay current over WebSocket. On reconnect they send
 * their last seen syncId and the server replays anything newer from its
 * sync log, or tells them to re-bootstrap if the log has been compacted.
 */

export interface SyncModelMap {
  workspace: Workspace;
  user: User;
  team: Team;
  teamMembership: TeamMembership;
  workflowState: WorkflowState;
  issue: Issue;
  label: Label;
  comment: Comment;
  reaction: Reaction;
  project: Project;
  projectMilestone: ProjectMilestone;
  cycle: Cycle;
  issueRelation: IssueRelation;
  notification: Notification;
  favorite: Favorite;
  issueActivity: IssueActivity;
  attachment: Attachment;
  initiative: Initiative;
  document: Document;
  webhook: Webhook;
}

export type SyncModelName = keyof SyncModelMap;

export const SYNC_MODEL_NAMES = [
  'workspace',
  'user',
  'team',
  'teamMembership',
  'workflowState',
  'issue',
  'label',
  'comment',
  'reaction',
  'project',
  'projectMilestone',
  'cycle',
  'issueRelation',
  'notification',
  'favorite',
  'issueActivity',
  'attachment',
  'initiative',
  'document',
  'webhook',
] as const satisfies readonly SyncModelName[];

export type SyncAction = 'create' | 'update' | 'delete';

export interface SyncDelta<M extends SyncModelName = SyncModelName> {
  syncId: number;
  model: M;
  action: SyncAction;
  /** Full entity for create/update; `{ id }` only for delete. */
  data: SyncModelMap[M] | { id: string };
}

/** Client -> server messages over the sync socket. */
export type ClientSyncMessage = { type: 'hello'; lastSyncId: number } | { type: 'ping' };

/** Server -> client messages over the sync socket. */
export type ServerSyncMessage =
  | { type: 'deltas'; deltas: SyncDelta[] }
  | { type: 'caught_up'; syncId: number }
  | { type: 'rebootstrap' }
  | { type: 'pong' };

/** Full snapshot returned by GET /api/bootstrap. */
export interface BootstrapPayload {
  syncId: number;
  userId: string;
  workspace: Workspace;
  users: User[];
  teams: Team[];
  teamMemberships: TeamMembership[];
  workflowStates: WorkflowState[];
  issues: Issue[];
  labels: Label[];
  comments: Comment[];
  reactions: Reaction[];
  projects: Project[];
  projectMilestones: ProjectMilestone[];
  cycles: Cycle[];
  issueRelations: IssueRelation[];
  notifications: Notification[];
  favorites: Favorite[];
  attachments: Attachment[];
  initiatives: Initiative[];
  documents: Document[];
  webhooks: Webhook[];
}
