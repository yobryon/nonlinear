/** Issue priority, matching Linear's numeric scheme. */
export const Priority = {
  None: 0,
  Urgent: 1,
  High: 2,
  Medium: 3,
  Low: 4,
} as const;
export type Priority = (typeof Priority)[keyof typeof Priority];

export const PRIORITY_LABELS: Record<Priority, string> = {
  0: 'No priority',
  1: 'Urgent',
  2: 'High',
  3: 'Medium',
  4: 'Low',
};

/** Workflow state category. Ordering here is the canonical display order. */
export const STATE_CATEGORIES = [
  'triage',
  'backlog',
  'unstarted',
  'started',
  'completed',
  'canceled',
] as const;
export type StateCategory = (typeof STATE_CATEGORIES)[number];

export const PROJECT_STATUSES = [
  'backlog',
  'planned',
  'started',
  'paused',
  'completed',
  'canceled',
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const ISSUE_RELATION_TYPES = ['blocks', 'related', 'duplicate'] as const;
export type IssueRelationType = (typeof ISSUE_RELATION_TYPES)[number];

export const NOTIFICATION_TYPES = [
  'issue_assigned',
  'issue_unassigned',
  'issue_status_changed',
  'issue_commented',
  'issue_mentioned',
  'issue_due_soon',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const FAVORITE_TYPES = ['issue', 'project', 'cycle', 'label'] as const;
export type FavoriteType = (typeof FAVORITE_TYPES)[number];

export const USER_ROLES = ['admin', 'member', 'guest'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ACTIVITY_TYPES = [
  'created',
  'state_changed',
  'priority_changed',
  'assignee_changed',
  'label_added',
  'label_removed',
  'project_changed',
  'cycle_changed',
  'estimate_changed',
  'due_date_changed',
  'title_changed',
  'description_changed',
  'parent_changed',
  'relation_added',
  'relation_removed',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
