import type {
  ActivityType,
  AiProvider,
  AuditAction,
  CustomerRequestSource,
  DashboardTileType,
  StatMetric,
  DisplayNameFormat,
  EstimateScale,
  FavoriteType,
  FirstDayOfWeek,
  FontSize,
  Grouping,
  HomeView,
  InitiativeStatus,
  IssueRelationType,
  NotificationType,
  Priority,
  ProjectHealth,
  ProjectStatus,
  StateCategory,
  ThemePreference,
  UserRole,
  ViewDisplay,
  WebhookFormat,
} from './enums.js';

/** Per-user interface preferences (synced across devices). */
export interface UserPreferences {
  theme: ThemePreference;
  fontSize: FontSize;
  /** Which screen the app opens to. */
  home: HomeView;
  /** Show full names or @handles in lists and pickers. */
  displayNames: DisplayNameFormat;
  firstDayOfWeek: FirstDayOfWeek;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  theme: 'system',
  fontSize: 'default',
  home: 'my-issues',
  displayNames: 'full',
  firstDayOfWeek: 'monday',
};

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
  /** Agent users are non-human teammates driven by an API token; they can be
   *  assigned issues and @mentioned like anyone else. */
  isAgent: boolean;
  /** Notification types this user has muted (in-app and digest). */
  mutedNotificationTypes: NotificationType[];
  /** Opt-in daily email digest of unread notifications (needs SMTP on the server). */
  emailDigest: boolean;
  /** Server-managed: when the last digest email was sent. */
  digestLastSentAt: string | null;
  preferences: UserPreferences;
  createdAt: string;
  updatedAt: string;
}

/**
 * A workspace-level security/admin event. Not synced to clients (it can grow
 * large and is admin-only); read through the paged `GET /api/audit` endpoint.
 * `actorId` is null for system/IdP-initiated events (e.g. SCIM provisioning).
 */
export interface AuditEvent {
  id: string;
  action: AuditAction;
  actorId: string | null;
  /** Human-readable actor label captured at event time (survives user deletion). */
  actorLabel: string;
  /** What the event acted on, e.g. 'user', 'team', 'token'. */
  targetType: string | null;
  targetId: string | null;
  /** Short human-readable description of the target, captured at event time. */
  targetLabel: string | null;
  /** Free-form structured context (old/new role, ip, provider, etc.). */
  metadata: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
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
  /** Which estimate options the team uses. */
  estimateScale: EstimateScale;
  /** Public intake form + inbound Slack/webhook issue creation. */
  intakeEnabled: boolean;
  /** Shared secret for inbound intake posts; regenerated on enable. */
  intakeToken: string | null;
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
  /** Hidden from the inbox until this time. */
  snoozedUntil: string | null;
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
  /** 'json' posts sync deltas; 'slack' posts Slack-compatible message payloads. */
  format: WebhookFormat;
  /** When set, this webhook only receives events where the agent user is the
   *  assignee or is @mentioned — the trigger half of the agent-teammate loop. */
  agentUserId: string | null;
  enabled: boolean;
  creatorId: string;
  createdAt: string;
}

/**
 * Personal API token for programmatic access (REST + MCP). Never synced — a
 * bearer credential, like sessions. The secret is shown once on creation and
 * only its hash is stored.
 */
export interface ApiToken {
  id: string;
  userId: string;
  name: string;
  /** First chars of the token for display ("nl_abc…"). */
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

/** Saved issue view: a named filter/group/display configuration. */
export interface ViewFilters {
  priorities: Priority[];
  assigneeIds: Array<string | null>;
  labelIds: string[];
  stateIds: string[];
  projectIds: string[];
}

export interface CustomView {
  id: string;
  name: string;
  creatorId: string;
  /** Shared views appear for everyone; private ones only for the creator. */
  shared: boolean;
  /** Scope to a team, or null for all teams. */
  teamId: string | null;
  filters: ViewFilters;
  grouping: Grouping;
  display: ViewDisplay;
  sortOrder: string;
  createdAt: string;
  updatedAt: string;
}

export interface IssueTemplate {
  id: string;
  teamId: string;
  name: string;
  titlePrefix: string;
  description: string;
  priority: Priority;
  labelIds: string[];
  estimate: number | null;
  createdAt: string;
  updatedAt: string;
}

/** Health/status post on a project ("On track", ...). Latest one wins. */
export interface ProjectUpdate {
  id: string;
  projectId: string;
  authorId: string;
  health: ProjectHealth;
  /** Markdown. */
  body: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * A composable insight tile on a dashboard. `config` is interpreted per `type`;
 * a stat tile reads `metric`, the chart tiles read `teamId`/`projectId` scope.
 */
export interface DashboardTile {
  id: string;
  type: DashboardTileType;
  /** Optional override for the tile's heading; a sensible default is derived. */
  title: string | null;
  config: {
    teamId?: string | null;
    projectId?: string | null;
    metric?: StatMetric;
  };
}

/**
 * Workspace AI configuration for the optional BYO-key features. Stored
 * server-side only (holds the API key) and never synced to clients — the
 * browser sees the `AiSettingsPublic` projection instead.
 */
export interface AiSettings {
  enabled: boolean;
  provider: AiProvider;
  model: string;
  apiKey: string;
}

/** A custom dashboard: an ordered set of insight tiles, shared or personal. */
export interface Dashboard {
  id: string;
  name: string;
  creatorId: string;
  /** Visible to the whole workspace when true, else only its creator. */
  shared: boolean;
  tiles: DashboardTile[];
  sortOrder: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * An admin-issued invitation to register. The raw token is delivered once as a
 * link and stored only as a hash (like sessions/API tokens); this public shape
 * omits it. Consumed on the invitee's register; not synced.
 */
export interface Invite {
  id: string;
  /** Optional email to bind the invite to (informational; not enforced hard). */
  email: string | null;
  role: UserRole;
  createdById: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
}

/** Personal "remind me about this issue" at a time. Deleted once fired. */
export interface IssueReminder {
  id: string;
  issueId: string;
  userId: string;
  remindAt: string;
  createdAt: string;
}

export interface Customer {
  id: string;
  name: string;
  /** Free-form tier, e.g. "Enterprise". */
  tier: string | null;
  /** Annual revenue attributed to this customer, for prioritization. */
  revenue: number | null;
  /** Email domain used to auto-link intake submissions. */
  domain: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerRequest {
  id: string;
  customerId: string;
  issueId: string | null;
  projectId: string | null;
  body: string;
  source: CustomerRequestSource;
  createdAt: string;
  updatedAt: string;
}

/** Comment on a document, optionally anchored to quoted text. */
export interface DocumentComment {
  id: string;
  documentId: string;
  authorId: string;
  /** Markdown. */
  body: string;
  /** Quoted text this comment anchors to (highlighted in the doc). */
  anchorText: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Automation applied to new issues in a team (keyword match -> set fields). */
export interface TriageRule {
  id: string;
  teamId: string;
  name: string;
  enabled: boolean;
  /** Case-insensitive; rule matches if ANY keyword appears in title/description. */
  keywords: string[];
  setPriority: Priority | null;
  setAssigneeId: string | null;
  setLabelIds: string[];
  setProjectId: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
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
