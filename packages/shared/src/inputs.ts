import type {
  AiProvider,
  CustomerRequestSource,
  EstimateScale,
  FavoriteType,
  Grouping,
  InitiativeStatus,
  IssueRelationType,
  NotificationType,
  Priority,
  ProjectHealth,
  ProjectStatus,
  StateCategory,
  UserRole,
  ViewDisplay,
  WebhookFormat,
} from './enums.js';
import type {
  ApiToken,
  DashboardTile,
  DecisionStatus,
  UserPreferences,
  ViewFilters,
} from './entities.js';

export interface RegisterInput {
  email: string;
  password: string;
  name: string;
  /** Creates the workspace on first-ever register; required then, ignored after. */
  workspaceName?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface CreateTeamInput {
  name: string;
  key: string;
  color?: string;
  icon?: string | null;
  description?: string | null;
  cyclesEnabled?: boolean;
  cycleDurationWeeks?: number;
  /** Accept internal intake from non-members. Defaults to true. */
  internalIntake?: boolean;
}

export interface UpdateTeamInput {
  name?: string;
  key?: string;
  color?: string;
  icon?: string | null;
  description?: string | null;
  private?: boolean;
  timezone?: string;
  cyclesEnabled?: boolean;
  cycleDurationWeeks?: number;
  triageEnabled?: boolean;
  slaUrgentHours?: number | null;
  slaHighHours?: number | null;
  estimateScale?: EstimateScale;
  intakeEnabled?: boolean;
  internalIntake?: boolean;
}

export interface CreateIssueInput {
  teamId: string;
  title: string;
  description?: string;
  stateId?: string;
  priority?: Priority;
  assigneeId?: string | null;
  projectId?: string | null;
  milestoneId?: string | null;
  cycleId?: string | null;
  parentId?: string | null;
  estimate?: number | null;
  dueDate?: string | null;
  labelIds?: string[];
  /** Place relative to siblings; omitted = end of group. */
  sortOrder?: string;
}

export interface UpdateIssueInput {
  title?: string;
  description?: string;
  teamId?: string;
  stateId?: string;
  priority?: Priority;
  assigneeId?: string | null;
  projectId?: string | null;
  milestoneId?: string | null;
  cycleId?: string | null;
  parentId?: string | null;
  estimate?: number | null;
  dueDate?: string | null;
  labelIds?: string[];
  subscriberIds?: string[];
  waitingOnId?: string | null;
  sortOrder?: string;
  archived?: boolean;
}

export interface CreateWorkflowStateInput {
  teamId: string;
  name: string;
  color: string;
  category: StateCategory;
  position?: number;
}

export interface UpdateWorkflowStateInput {
  name?: string;
  color?: string;
  position?: number;
}

export interface CreateLabelInput {
  teamId?: string | null;
  name: string;
  color: string;
}

export interface UpdateLabelInput {
  name?: string;
  color?: string;
}

export interface CreateDecisionInput {
  teamId: string;
  title: string;
  body?: string;
  /** Issues this decision governs. */
  governedIssueIds?: string[];
  /** If set, this decision supersedes another (which is flipped to superseded). */
  supersedesId?: string | null;
  /** Route the proposal to a specific decider. */
  waitingOnId?: string | null;
  /**
   * Import a historical, already-settled decision honestly (migrating a log).
   * `status` other than the default `proposed` records it as decided without a
   * ruling ceremony here; `ruledById`/`ruledAt` capture the *true* decider and
   * date (null decider = "decided, not recorded here"); `authorId`/`createdAt`
   * capture the original proposer and date so the ledger's chronology is real.
   */
  status?: DecisionStatus;
  authorId?: string;
  ruledById?: string | null;
  ruledAt?: string | null;
  createdAt?: string;
}

export interface UpdateDecisionInput {
  title?: string;
  body?: string;
  governedIssueIds?: string[];
  waitingOnId?: string | null;
}

export interface CreateDecisionCommentInput {
  decisionId: string;
  body: string;
}

export interface CreateCommentInput {
  issueId: string;
  body: string;
}

export interface UpdateCommentInput {
  body: string;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  icon?: string | null;
  color?: string;
  status?: ProjectStatus;
  leadId?: string | null;
  initiativeId?: string | null;
  memberIds?: string[];
  teamIds: string[];
  startDate?: string | null;
  targetDate?: string | null;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  icon?: string | null;
  color?: string;
  status?: ProjectStatus;
  leadId?: string | null;
  initiativeId?: string | null;
  memberIds?: string[];
  teamIds?: string[];
  startDate?: string | null;
  targetDate?: string | null;
  sortOrder?: string;
}

export interface CreateInitiativeInput {
  name: string;
  description?: string;
  color?: string;
  status?: InitiativeStatus;
  ownerId?: string | null;
  targetDate?: string | null;
}

export interface UpdateInitiativeInput {
  name?: string;
  description?: string;
  color?: string;
  status?: InitiativeStatus;
  ownerId?: string | null;
  targetDate?: string | null;
  sortOrder?: string;
}

export interface CreateDocumentInput {
  title: string;
  content?: string;
  projectId?: string | null;
}

export interface UpdateDocumentInput {
  title?: string;
  content?: string;
  projectId?: string | null;
}

export interface CreateWebhookInput {
  url: string;
  format?: WebhookFormat;
  /** Scope this webhook to an agent user's assignments and mentions. */
  agentUserId?: string | null;
}

export interface CreateApiTokenInput {
  name: string;
  /** Days until expiry; omitted = never. */
  expiresInDays?: number;
  /** Restrict the token to these teams; omitted/null = all the owner's teams. */
  teamIds?: string[] | null;
  /** A read-only token may not perform mutations. */
  readOnly?: boolean;
}

/** Returned once on creation — carries the plaintext secret. */
export interface CreatedApiToken {
  token: ApiToken;
  /** The full bearer token; shown once, never retrievable again. */
  secret: string;
}

export interface CreateAgentInput {
  name: string;
  /** Handle for @mentions; defaults from name. */
  displayName?: string;
}

export interface CreateCustomViewInput {
  name: string;
  shared?: boolean;
  teamId?: string | null;
  filters: ViewFilters;
  grouping: Grouping;
  display: ViewDisplay;
}

export interface UpdateCustomViewInput {
  name?: string;
  shared?: boolean;
  filters?: ViewFilters;
  grouping?: Grouping;
  display?: ViewDisplay;
  sortOrder?: string;
}

export interface CreateIssueTemplateInput {
  teamId: string;
  name: string;
  titlePrefix?: string;
  description?: string;
  priority?: Priority;
  labelIds?: string[];
  estimate?: number | null;
}

export interface UpdateIssueTemplateInput {
  name?: string;
  titlePrefix?: string;
  description?: string;
  priority?: Priority;
  labelIds?: string[];
  estimate?: number | null;
}

export interface CreateProjectUpdateInput {
  projectId: string;
  health: ProjectHealth;
  body?: string;
}

export interface SetReminderInput {
  issueId: string;
  remindAt: string;
}

export interface CreateCustomerInput {
  name: string;
  tier?: string | null;
  revenue?: number | null;
  domain?: string | null;
}

export interface UpdateCustomerInput {
  name?: string;
  tier?: string | null;
  revenue?: number | null;
  domain?: string | null;
}

export interface CreateCustomerRequestInput {
  customerId: string;
  issueId?: string | null;
  projectId?: string | null;
  body: string;
  source?: CustomerRequestSource;
}

export interface UpdateCustomerRequestInput {
  issueId?: string | null;
  projectId?: string | null;
  body?: string;
}

export interface CreateDocumentCommentInput {
  documentId: string;
  body: string;
  anchorText?: string | null;
}

export interface UpdateDocumentCommentInput {
  body?: string;
  resolved?: boolean;
}

export interface CreateTriageRuleInput {
  teamId: string;
  name: string;
  keywords: string[];
  setPriority?: Priority | null;
  setAssigneeId?: string | null;
  setLabelIds?: string[];
  setProjectId?: string | null;
}

export interface UpdateTriageRuleInput {
  name?: string;
  enabled?: boolean;
  keywords?: string[];
  setPriority?: Priority | null;
  setAssigneeId?: string | null;
  setLabelIds?: string[];
  setProjectId?: string | null;
  position?: number;
}

/** Row outcome of a CSV import. */
export interface ImportResult {
  created: number;
  skipped: number;
  errors: string[];
}

export interface CreateMilestoneInput {
  projectId: string;
  name: string;
  description?: string;
  targetDate?: string | null;
}

export interface UpdateMilestoneInput {
  name?: string;
  description?: string;
  targetDate?: string | null;
  sortOrder?: string;
}

export interface CreateCycleInput {
  teamId: string;
  name?: string | null;
  startsAt: string;
  endsAt: string;
}

export interface UpdateCycleInput {
  name?: string | null;
  startsAt?: string;
  endsAt?: string;
}

export interface CreateRelationInput {
  type: IssueRelationType;
  issueId: string;
  relatedIssueId: string;
}

export interface CreateFavoriteInput {
  type: FavoriteType;
  targetId: string;
}

export interface UpdateProfileInput {
  name?: string;
  displayName?: string;
  avatarColor?: string;
  mutedNotificationTypes?: NotificationType[];
  emailDigest?: boolean;
  /** Partial merge over the user's current preferences. */
  preferences?: Partial<UserPreferences>;
}

export interface CreateReactionInput {
  commentId: string;
  emoji: string;
}

export interface CreateDashboardInput {
  name: string;
  shared?: boolean;
  tiles?: DashboardTile[];
}

export interface UpdateDashboardInput {
  name?: string;
  shared?: boolean;
  tiles?: DashboardTile[];
  sortOrder?: string;
}

export interface CreateInviteInput {
  email?: string;
  role?: UserRole;
}

/** Admin-set workspace AI config. `apiKey` omitted = keep the stored key. */
export interface UpdateAiSettingsInput {
  enabled?: boolean;
  provider?: AiProvider;
  model?: string;
  apiKey?: string;
}
