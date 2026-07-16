import type {
  BootstrapPayload,
  Comment,
  CreateCommentInput,
  CreateCycleInput,
  CreateFavoriteInput,
  CreateIssueInput,
  CreateLabelInput,
  CreateMilestoneInput,
  CreateProjectInput,
  CreateReactionInput,
  CreateRelationInput,
  CreateTeamInput,
  CreateWorkflowStateInput,
  Cycle,
  Favorite,
  Issue,
  IssueActivity,
  IssueRelation,
  Label,
  Project,
  ProjectMilestone,
  Reaction,
  SessionResponse,
  Team,
  TeamMembership,
  UpdateProfileInput,
  User,
  Workspace,
  WorkflowState,
} from '@nonlinear/shared';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (!res.ok) {
    let code = 'unknown';
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      code = data?.error?.code ?? code;
      message = data?.error?.message ?? message;
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, code, message);
  }
  return res.json() as Promise<T>;
}

export const api = {
  meta: () => req<{ setupRequired: boolean; workspaceName: string | null }>('GET', '/api/meta'),
  register: (input: { email: string; password: string; name: string; workspaceName?: string }) =>
    req<SessionResponse>('POST', '/api/auth/register', input),
  login: (input: { email: string; password: string }) =>
    req<SessionResponse>('POST', '/api/auth/login', input),
  logout: () => req<{ ok: true }>('POST', '/api/auth/logout'),
  me: () => req<SessionResponse>('GET', '/api/auth/me'),
  bootstrap: () => req<BootstrapPayload>('GET', '/api/bootstrap'),

  createIssue: (input: CreateIssueInput) => req<Issue>('POST', '/api/issues', input),
  updateIssue: (id: string, input: Record<string, unknown>) =>
    req<Issue>('PATCH', `/api/issues/${id}`, input),
  deleteIssue: (id: string) => req<{ ok: true }>('DELETE', `/api/issues/${id}`),
  issueActivities: (id: string) => req<IssueActivity[]>('GET', `/api/issues/${id}/activities`),

  createComment: (input: CreateCommentInput) => req<Comment>('POST', '/api/comments', input),
  updateComment: (id: string, body: string) =>
    req<Comment>('PATCH', `/api/comments/${id}`, { body }),
  deleteComment: (id: string) => req<{ ok: true }>('DELETE', `/api/comments/${id}`),
  addReaction: (input: CreateReactionInput) => req<Reaction>('POST', '/api/reactions', input),
  removeReaction: (id: string) => req<{ ok: true }>('DELETE', `/api/reactions/${id}`),

  createTeam: (input: CreateTeamInput) => req<Team>('POST', '/api/teams', input),
  updateTeam: (id: string, input: Record<string, unknown>) =>
    req<Team>('PATCH', `/api/teams/${id}`, input),
  deleteTeam: (id: string) => req<{ ok: true }>('DELETE', `/api/teams/${id}`),
  addTeamMember: (teamId: string, userId: string) =>
    req<TeamMembership>('POST', `/api/teams/${teamId}/members`, { userId }),
  removeTeamMember: (teamId: string, userId: string) =>
    req<{ ok: true }>('DELETE', `/api/teams/${teamId}/members/${userId}`),

  createState: (input: CreateWorkflowStateInput) =>
    req<WorkflowState>('POST', '/api/states', input),
  updateState: (id: string, input: Record<string, unknown>) =>
    req<WorkflowState>('PATCH', `/api/states/${id}`, input),
  deleteState: (id: string) => req<{ ok: true }>('DELETE', `/api/states/${id}`),

  createLabel: (input: CreateLabelInput) => req<Label>('POST', '/api/labels', input),
  updateLabel: (id: string, input: Record<string, unknown>) =>
    req<Label>('PATCH', `/api/labels/${id}`, input),
  deleteLabel: (id: string) => req<{ ok: true }>('DELETE', `/api/labels/${id}`),

  createProject: (input: CreateProjectInput) => req<Project>('POST', '/api/projects', input),
  updateProject: (id: string, input: Record<string, unknown>) =>
    req<Project>('PATCH', `/api/projects/${id}`, input),
  deleteProject: (id: string) => req<{ ok: true }>('DELETE', `/api/projects/${id}`),
  createMilestone: (input: CreateMilestoneInput) =>
    req<ProjectMilestone>('POST', '/api/milestones', input),
  updateMilestone: (id: string, input: Record<string, unknown>) =>
    req<ProjectMilestone>('PATCH', `/api/milestones/${id}`, input),
  deleteMilestone: (id: string) => req<{ ok: true }>('DELETE', `/api/milestones/${id}`),

  createCycle: (input: CreateCycleInput) => req<Cycle>('POST', '/api/cycles', input),
  updateCycle: (id: string, input: Record<string, unknown>) =>
    req<Cycle>('PATCH', `/api/cycles/${id}`, input),
  deleteCycle: (id: string) => req<{ ok: true }>('DELETE', `/api/cycles/${id}`),

  createRelation: (input: CreateRelationInput) =>
    req<IssueRelation>('POST', '/api/relations', input),
  deleteRelation: (id: string) => req<{ ok: true }>('DELETE', `/api/relations/${id}`),

  addFavorite: (input: CreateFavoriteInput) => req<Favorite>('POST', '/api/favorites', input),
  removeFavorite: (id: string) => req<{ ok: true }>('DELETE', `/api/favorites/${id}`),

  markNotification: (id: string, read: boolean) =>
    req<{ ok: true }>('PATCH', `/api/notifications/${id}`, { read }),
  markAllNotificationsRead: () => req<{ ok: true }>('POST', '/api/notifications/read-all'),
  deleteNotification: (id: string) => req<{ ok: true }>('DELETE', `/api/notifications/${id}`),

  updateProfile: (input: UpdateProfileInput) => req<User>('PATCH', '/api/profile', input),
  adminUpdateUser: (id: string, input: { role?: string; active?: boolean }) =>
    req<User>('PATCH', `/api/users/${id}`, input),
  updateWorkspace: (name: string) => req<Workspace>('PATCH', '/api/workspace', { name }),
};
