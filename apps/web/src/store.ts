import { create } from 'zustand';
import type {
  Attachment,
  BootstrapPayload,
  Comment,
  Customer,
  CustomerRequest,
  CustomView,
  Dashboard,
  Cycle,
  Document,
  DocumentComment,
  Favorite,
  Initiative,
  Issue,
  IssueRelation,
  IssueReminder,
  IssueTemplate,
  Label,
  Notification,
  Project,
  ProjectMilestone,
  ProjectUpdate,
  Reaction,
  SyncDelta,
  SyncModelMap,
  SyncModelName,
  Team,
  TeamMembership,
  TriageRule,
  User,
  Webhook,
  Workspace,
  WorkflowState,
} from '@nonlinear/shared';

export type ById<T> = Record<string, T>;

export type ConnectionStatus = 'connecting' | 'online' | 'offline';

export interface AppState {
  phase: 'loading' | 'anonymous' | 'ready';
  userId: string | null;
  syncId: number;
  connection: ConnectionStatus;
  workspace: Workspace | null;
  users: ById<User>;
  teams: ById<Team>;
  teamMemberships: ById<TeamMembership>;
  workflowStates: ById<WorkflowState>;
  issues: ById<Issue>;
  labels: ById<Label>;
  comments: ById<Comment>;
  reactions: ById<Reaction>;
  projects: ById<Project>;
  projectMilestones: ById<ProjectMilestone>;
  cycles: ById<Cycle>;
  issueRelations: ById<IssueRelation>;
  notifications: ById<Notification>;
  favorites: ById<Favorite>;
  attachments: ById<Attachment>;
  initiatives: ById<Initiative>;
  documents: ById<Document>;
  webhooks: ById<Webhook>;
  customViews: ById<CustomView>;
  issueTemplates: ById<IssueTemplate>;
  projectUpdates: ById<ProjectUpdate>;
  issueReminders: ById<IssueReminder>;
  customers: ById<Customer>;
  customerRequests: ById<CustomerRequest>;
  documentComments: ById<DocumentComment>;
  triageRules: ById<TriageRule>;
  dashboards: ById<Dashboard>;

  setPhase: (phase: AppState['phase']) => void;
  setConnection: (status: ConnectionStatus) => void;
  applyBootstrap: (payload: BootstrapPayload) => void;
  applyDeltas: (deltas: SyncDelta[]) => void;
  /** Optimistically merge one entity (e.g. a REST response). */
  putEntity: <M extends SyncModelName>(model: M, entity: SyncModelMap[M]) => void;
  reset: () => void;
}

const MODEL_TO_KEY = {
  user: 'users',
  team: 'teams',
  teamMembership: 'teamMemberships',
  workflowState: 'workflowStates',
  issue: 'issues',
  label: 'labels',
  comment: 'comments',
  reaction: 'reactions',
  project: 'projects',
  projectMilestone: 'projectMilestones',
  cycle: 'cycles',
  issueRelation: 'issueRelations',
  notification: 'notifications',
  favorite: 'favorites',
  attachment: 'attachments',
  initiative: 'initiatives',
  document: 'documents',
  webhook: 'webhooks',
  customView: 'customViews',
  issueTemplate: 'issueTemplates',
  projectUpdate: 'projectUpdates',
  issueReminder: 'issueReminders',
  customer: 'customers',
  customerRequest: 'customerRequests',
  documentComment: 'documentComments',
  triageRule: 'triageRules',
  dashboard: 'dashboards',
} as const;

type CollectionKey = (typeof MODEL_TO_KEY)[keyof typeof MODEL_TO_KEY];

function indexById<T extends { id: string }>(rows: T[]): ById<T> {
  const map: ById<T> = {};
  for (const row of rows) map[row.id] = row;
  return map;
}

const emptyCollections = {
  workspace: null as Workspace | null,
  users: {},
  teams: {},
  teamMemberships: {},
  workflowStates: {},
  issues: {},
  labels: {},
  comments: {},
  reactions: {},
  projects: {},
  projectMilestones: {},
  cycles: {},
  issueRelations: {},
  notifications: {},
  favorites: {},
  attachments: {},
  initiatives: {},
  documents: {},
  webhooks: {},
  customViews: {},
  issueTemplates: {},
  projectUpdates: {},
  issueReminders: {},
  customers: {},
  customerRequests: {},
  documentComments: {},
  triageRules: {},
  dashboards: {},
};

export const useStore = create<AppState>((set) => ({
  phase: 'loading',
  userId: null,
  syncId: 0,
  connection: 'connecting',
  ...emptyCollections,

  setPhase: (phase) => set({ phase }),
  setConnection: (connection) => set({ connection }),

  applyBootstrap: (p) =>
    set({
      phase: 'ready',
      userId: p.userId,
      syncId: p.syncId,
      workspace: p.workspace,
      users: indexById(p.users),
      teams: indexById(p.teams),
      teamMemberships: indexById(p.teamMemberships),
      workflowStates: indexById(p.workflowStates),
      issues: indexById(p.issues),
      labels: indexById(p.labels),
      comments: indexById(p.comments),
      reactions: indexById(p.reactions),
      projects: indexById(p.projects),
      projectMilestones: indexById(p.projectMilestones),
      cycles: indexById(p.cycles),
      issueRelations: indexById(p.issueRelations),
      notifications: indexById(p.notifications),
      favorites: indexById(p.favorites),
      attachments: indexById(p.attachments),
      initiatives: indexById(p.initiatives),
      documents: indexById(p.documents),
      webhooks: indexById(p.webhooks),
      customViews: indexById(p.customViews),
      issueTemplates: indexById(p.issueTemplates),
      projectUpdates: indexById(p.projectUpdates),
      issueReminders: indexById(p.issueReminders),
      customers: indexById(p.customers),
      customerRequests: indexById(p.customerRequests),
      documentComments: indexById(p.documentComments),
      triageRules: indexById(p.triageRules),
      dashboards: indexById(p.dashboards),
    }),

  applyDeltas: (deltas) =>
    set((state) => {
      const patch: Record<string, unknown> = {};
      let syncId = state.syncId;
      for (const delta of deltas) {
        syncId = Math.max(syncId, delta.syncId);
        if (delta.model === 'workspace') {
          if (delta.action !== 'delete') patch.workspace = delta.data as Workspace;
          continue;
        }
        if (delta.model === 'issueActivity') continue; // fetched on demand
        const key = MODEL_TO_KEY[delta.model as keyof typeof MODEL_TO_KEY] as
          CollectionKey | undefined;
        if (!key) continue;
        const current = (patch[key] ?? state[key]) as ById<{ id: string }>;
        const next = { ...current };
        if (delta.action === 'delete') {
          delete next[delta.data.id];
        } else {
          next[delta.data.id] = delta.data as { id: string };
        }
        patch[key] = next;
      }
      patch.syncId = syncId;
      return patch as unknown as Partial<AppState>;
    }),

  putEntity: (model, entity) =>
    set((state) => {
      if (model === 'workspace') return { workspace: entity as Workspace };
      const key = MODEL_TO_KEY[model as keyof typeof MODEL_TO_KEY] as CollectionKey | undefined;
      if (!key) return {};
      const row = entity as { id: string };
      return {
        [key]: { ...state[key], [row.id]: row },
      } as unknown as Partial<AppState>;
    }),

  reset: () =>
    set({
      phase: 'anonymous',
      userId: null,
      syncId: 0,
      connection: 'connecting',
      ...emptyCollections,
    }),
}));

/* ---------- selectors & helpers ---------- */

export function issueKey(issue: Issue, teams: ById<Team>): string {
  const team = teams[issue.teamId];
  return `${team?.key ?? '???'}-${issue.number}`;
}

export function userInitials(user: User): string {
  const parts = user.name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

export function sortedStates(states: WorkflowState[], teamId: string): WorkflowState[] {
  const order = ['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled'];
  return states
    .filter((s) => s.teamId === teamId)
    .sort(
      (a, b) => order.indexOf(a.category) - order.indexOf(b.category) || a.position - b.position,
    );
}

export function currentCycle(cycles: Cycle[], teamId: string): Cycle | null {
  const now = new Date().toISOString();
  return cycles.find((c) => c.teamId === teamId && c.startsAt <= now && c.endsAt > now) ?? null;
}

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(months / 12)}y`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
