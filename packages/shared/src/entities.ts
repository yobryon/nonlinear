import type {
  ActivityType,
  FavoriteType,
  InitiativeStatus,
  IssueRelationType,
  NotificationType,
  Priority,
  ProjectStatus,
  StateCategory,
  UserRole,
} from './enums.js';

/** All timestamps are ISO 8601 strings. All ids are opaque strings. */

export interface Workspace {
  id: string;
  name: string;
  urlKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  /** Short handle shown in mentions and avatars, unique per workspace. */
  displayName: string;
  avatarColor: string;
  role: UserRole;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Team {
  id: string;
  name: string;
  /** Uppercase issue prefix, e.g. "ENG". Unique per workspace. */
  key: string;
  description: string | null;
  icon: string | null;
  color: string;
  private: boolean;
  timezone: string;
  cyclesEnabled: boolean;
  /** Cycle length in weeks. */
  cycleDurationWeeks: number;
  /** When enabled, new issues land in the Triage state for review. */
  triageEnabled: boolean;
  /** SLA: auto-set due dates this many hours out for urgent/high issues. Null = off. */
  slaUrgentHours: number | null;
  slaHighHours: number | null;
  /** Next issue number to hand out (server-side concern, synced for display only). */
  issueCounter: number;
  createdAt: string;
  updatedAt: string;
}

export interface TeamMembership {
  id: string;
  teamId: string;
  userId: string;
  createdAt: string;
}

export interface WorkflowState {
  id: string;
  teamId: string;
  name: string;
  color: string;
  category: StateCategory;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface Issue {
  id: string;
  teamId: string;
  /** Sequential number within the team; identifier is `${team.key}-${number}`. */
  number: number;
  title: string;
  /** Markdown. */
  description: string;
  stateId: string;
  priority: Priority;
  assigneeId: string | null;
  creatorId: string;
  projectId: string | null;
  milestoneId: string | null;
  cycleId: string | null;
  parentId: string | null;
  estimate: number | null;
  dueDate: string | null;
  labelIds: string[];
  subscriberIds: string[];
  /** Fractional index for manual ordering within a board column / list group. */
  sortOrder: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  canceledAt: string | null;
  archivedAt: string | null;
}

export interface Label {
  id: string;
  /** Null teamId = workspace-level label. */
  teamId: string | null;
  name: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface Comment {
  id: string;
  issueId: string;
  userId: string;
  /** Markdown. */
  body: string;
  createdAt: string;
  updatedAt: string;
  editedAt: string | null;
}

export interface Reaction {
  id: string;
  commentId: string;
  userId: string;
  emoji: string;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  icon: string | null;
  color: string;
  status: ProjectStatus;
  leadId: string | null;
  initiativeId: string | null;
  memberIds: string[];
  teamIds: string[];
  startDate: string | null;
  targetDate: string | null;
  sortOrder: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  canceledAt: string | null;
}

export interface ProjectMilestone {
  id: string;
  projectId: string;
  name: string;
  description: string;
  targetDate: string | null;
  sortOrder: string;
  createdAt: string;
  updatedAt: string;
}

export interface Cycle {
  id: string;
  teamId: string;
  number: number;
  name: string | null;
  startsAt: string;
  endsAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface IssueRelation {
  id: string;
  type: IssueRelationType;
  issueId: string;
  relatedIssueId: string;
  createdAt: string;
}

export interface Notification {
  id: string;
  userId: string;
  actorId: string | null;
  type: NotificationType;
  issueId: string;
  commentId: string | null;
  createdAt: string;
  readAt: string | null;
}

export interface Favorite {
  id: string;
  userId: string;
  type: FavoriteType;
  targetId: string;
  sortOrder: string;
  createdAt: string;
}

export interface Attachment {
  id: string;
  issueId: string;
  uploaderId: string;
  filename: string;
  contentType: string;
  /** Bytes. */
  size: number;
  createdAt: string;
}

/** Roadmap grouping of projects. */
export interface Initiative {
  id: string;
  name: string;
  description: string;
  color: string;
  status: InitiativeStatus;
  ownerId: string | null;
  targetDate: string | null;
  sortOrder: string;
  createdAt: string;
  updatedAt: string;
}

export interface Document {
  id: string;
  title: string;
  /** Markdown. */
  content: string;
  /** Null = workspace-level document. */
  projectId: string | null;
  creatorId: string;
  createdAt: string;
  updatedAt: string;
}

/** Outbound webhook: issue events are POSTed to the url as JSON. */
export interface Webhook {
  id: string;
  url: string;
  /** Sent as X-Nonlinear-Secret so receivers can verify origin. */
  secret: string;
  enabled: boolean;
  creatorId: string;
  createdAt: string;
}

export interface IssueActivity {
  id: string;
  issueId: string;
  actorId: string;
  type: ActivityType;
  /** Human-relevant change payload, shape depends on type (e.g. { from, to }). */
  data: Record<string, unknown>;
  createdAt: string;
}
