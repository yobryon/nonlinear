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
  'issue_reminder',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const PROJECT_HEALTHS = ['on_track', 'at_risk', 'off_track'] as const;
export type ProjectHealth = (typeof PROJECT_HEALTHS)[number];

export const ESTIMATE_SCALES = ['exponential', 'fibonacci', 'linear', 'tshirt'] as const;
export type EstimateScale = (typeof ESTIMATE_SCALES)[number];

/** Estimate options per scale; labels shown for tshirt. */
export const ESTIMATE_SCALE_VALUES: Record<
  EstimateScale,
  Array<{ value: number; label: string }>
> = {
  exponential: [1, 2, 4, 8, 16].map((v) => ({ value: v, label: String(v) })),
  fibonacci: [1, 2, 3, 5, 8, 13].map((v) => ({ value: v, label: String(v) })),
  linear: [1, 2, 3, 4, 5, 6, 7].map((v) => ({ value: v, label: String(v) })),
  tshirt: [
    { value: 1, label: 'XS' },
    { value: 2, label: 'S' },
    { value: 3, label: 'M' },
    { value: 5, label: 'L' },
    { value: 8, label: 'XL' },
  ],
};

export const VIEW_DISPLAYS = ['list', 'board'] as const;
export type ViewDisplay = (typeof VIEW_DISPLAYS)[number];

export const GROUPINGS = ['state', 'priority', 'assignee'] as const;
export type Grouping = (typeof GROUPINGS)[number];

export const WEBHOOK_FORMATS = ['json', 'slack'] as const;
export type WebhookFormat = (typeof WEBHOOK_FORMATS)[number];

export const CUSTOMER_REQUEST_SOURCES = ['manual', 'intake'] as const;
export type CustomerRequestSource = (typeof CUSTOMER_REQUEST_SOURCES)[number];

export const THEMES = ['system', 'dark', 'light'] as const;
export type ThemePreference = (typeof THEMES)[number];

export const FONT_SIZES = ['small', 'default', 'large'] as const;
export type FontSize = (typeof FONT_SIZES)[number];

/** Where the app lands on load. */
export const HOME_VIEWS = ['inbox', 'my-issues', 'active-team'] as const;
export type HomeView = (typeof HOME_VIEWS)[number];

export const DISPLAY_NAME_FORMATS = ['full', 'display'] as const;
export type DisplayNameFormat = (typeof DISPLAY_NAME_FORMATS)[number];

export const FIRST_DAYS = ['sunday', 'monday'] as const;
export type FirstDayOfWeek = (typeof FIRST_DAYS)[number];

export const FAVORITE_TYPES = ['issue', 'project', 'cycle', 'label'] as const;
export type FavoriteType = (typeof FAVORITE_TYPES)[number];

export const USER_ROLES = ['admin', 'member', 'guest'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const INITIATIVE_STATUSES = ['planned', 'active', 'completed'] as const;
export type InitiativeStatus = (typeof INITIATIVE_STATUSES)[number];

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
