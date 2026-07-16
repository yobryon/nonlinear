import type {
  FavoriteType,
  IssueRelationType,
  Priority,
  ProjectStatus,
  StateCategory,
} from './enums.js';

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
  memberIds?: string[];
  teamIds?: string[];
  startDate?: string | null;
  targetDate?: string | null;
  sortOrder?: string;
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
}

export interface CreateReactionInput {
  commentId: string;
  emoji: string;
}
