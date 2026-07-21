import type {
  AiSettingsPublic,
  Attachment,
  AuditEvent,
  CreateDashboardInput,
  CreatedInvite,
  Dashboard,
  Invite,
  LabelSuggestion,
  PulseFeed,
  UpdateAiSettingsInput,
  UpdateDashboardInput,
  BootstrapPayload,
  Comment,
  CreateCommentInput,
  CreateCustomerInput,
  CreateCustomerRequestInput,
  CreateCustomViewInput,
  CreateDocumentCommentInput,
  CreateDocumentInput,
  CreateInitiativeInput,
  CreateIssueTemplateInput,
  CreateProjectUpdateInput,
  CreateTriageRuleInput,
  ApiToken,
  CreatedApiToken,
  Customer,
  CustomerRequest,
  CustomView,
  Document,
  DocumentComment,
  ImportResult,
  Initiative,
  IssueReminder,
  IssueTemplate,
  ProjectUpdate,
  TriageRule,
  Webhook,
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
  meta: (invite?: string) =>
    req<{
      setupRequired: boolean;
      workspaceName: string | null;
      allowSignups: boolean;
      inviteValid: boolean;
      sso: { enabled: boolean; label: string } | null;
    }>('GET', `/api/meta${invite ? `?invite=${encodeURIComponent(invite)}` : ''}`),
  audit: (cursor?: string | null) =>
    req<{ events: AuditEvent[]; nextCursor: string | null }>(
      'GET',
      `/api/audit${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
    ),
  register: (input: {
    email: string;
    password: string;
    name: string;
    workspaceName?: string;
    inviteToken?: string;
  }) => req<SessionResponse>('POST', '/api/auth/register', input),
  invites: () => req<Invite[]>('GET', '/api/invites'),
  createInvite: (input: { email?: string; role?: 'member' | 'guest' }) =>
    req<CreatedInvite>('POST', '/api/invites', input),
  revokeInvite: (id: string) => req<{ ok: true }>('DELETE', `/api/invites/${id}`),
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
  reorderFavorite: (id: string, sortOrder: string) =>
    req<Favorite>('PATCH', `/api/favorites/${id}`, { sortOrder }),

  markNotification: (id: string, read: boolean) =>
    req<{ ok: true }>('PATCH', `/api/notifications/${id}`, { read }),
  markAllNotificationsRead: () => req<{ ok: true }>('POST', '/api/notifications/read-all'),
  deleteNotification: (id: string) => req<{ ok: true }>('DELETE', `/api/notifications/${id}`),

  uploadAttachment: async (issueId: string, file: File): Promise<Attachment> => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`/api/issues/${issueId}/attachments`, {
      method: 'POST',
      body: form,
      credentials: 'same-origin',
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new ApiError(
        res.status,
        data?.error?.code ?? 'upload_failed',
        data?.error?.message ?? 'Upload failed',
      );
    }
    return res.json() as Promise<Attachment>;
  },
  deleteAttachment: (id: string) => req<{ ok: true }>('DELETE', `/api/attachments/${id}`),

  createInitiative: (input: CreateInitiativeInput) =>
    req<Initiative>('POST', '/api/initiatives', input),
  updateInitiative: (id: string, input: Record<string, unknown>) =>
    req<Initiative>('PATCH', `/api/initiatives/${id}`, input),
  deleteInitiative: (id: string) => req<{ ok: true }>('DELETE', `/api/initiatives/${id}`),

  createDocument: (input: CreateDocumentInput) => req<Document>('POST', '/api/documents', input),
  updateDocument: (id: string, input: Record<string, unknown>) =>
    req<Document>('PATCH', `/api/documents/${id}`, input),
  deleteDocument: (id: string) => req<{ ok: true }>('DELETE', `/api/documents/${id}`),

  listTokens: () => req<ApiToken[]>('GET', '/api/tokens'),
  createToken: (name: string, expiresInDays?: number) =>
    req<CreatedApiToken>('POST', '/api/tokens', { name, expiresInDays }),
  deleteToken: (id: string) => req<{ ok: true }>('DELETE', `/api/tokens/${id}`),
  createAgent: (name: string, displayName?: string) =>
    req<User>('POST', '/api/agents', { name, displayName }),
  createAgentToken: (agentId: string, name: string) =>
    req<CreatedApiToken>('POST', `/api/agents/${agentId}/tokens`, { name }),
  listAgentTokens: (agentId: string) =>
    req<ApiToken[]>('GET', `/api/agents/${agentId}/tokens`),
  revokeAgentToken: (agentId: string, tokenId: string) =>
    req<{ ok: true }>('DELETE', `/api/agents/${agentId}/tokens/${tokenId}`),

  createWebhook: (url: string, format?: 'json' | 'slack', agentUserId?: string | null) =>
    req<Webhook>('POST', '/api/webhooks', { url, format, agentUserId }),
  setWebhookEnabled: (id: string, enabled: boolean) =>
    req<Webhook>('PATCH', `/api/webhooks/${id}`, { enabled }),
  deleteWebhook: (id: string) => req<{ ok: true }>('DELETE', `/api/webhooks/${id}`),

  createView: (input: CreateCustomViewInput) => req<CustomView>('POST', '/api/views', input),
  updateView: (id: string, input: Record<string, unknown>) =>
    req<CustomView>('PATCH', `/api/views/${id}`, input),
  deleteView: (id: string) => req<{ ok: true }>('DELETE', `/api/views/${id}`),

  createDashboard: (input: CreateDashboardInput) =>
    req<Dashboard>('POST', '/api/dashboards', input),
  updateDashboard: (id: string, input: UpdateDashboardInput) =>
    req<Dashboard>('PATCH', `/api/dashboards/${id}`, input),
  deleteDashboard: (id: string) => req<{ ok: true }>('DELETE', `/api/dashboards/${id}`),

  // Pulse + AI
  pulse: (days = 7) => req<PulseFeed>('GET', `/api/pulse?days=${days}`),
  pulseSummary: (days = 7) => req<{ summary: string }>('POST', '/api/pulse/summary', { days }),
  aiSettings: () => req<AiSettingsPublic>('GET', '/api/ai/settings'),
  updateAiSettings: (input: UpdateAiSettingsInput) =>
    req<AiSettingsPublic>('PUT', '/api/ai/settings', input),
  suggestLabels: (issueId: string) =>
    req<{ suggestions: LabelSuggestion[] }>('POST', `/api/issues/${issueId}/ai/suggest-labels`),

  createTemplate: (input: CreateIssueTemplateInput) =>
    req<IssueTemplate>('POST', '/api/templates', input),
  updateTemplate: (id: string, input: Record<string, unknown>) =>
    req<IssueTemplate>('PATCH', `/api/templates/${id}`, input),
  deleteTemplate: (id: string) => req<{ ok: true }>('DELETE', `/api/templates/${id}`),

  createProjectUpdate: (input: CreateProjectUpdateInput) =>
    req<ProjectUpdate>('POST', '/api/project-updates', input),
  deleteProjectUpdate: (id: string) => req<{ ok: true }>('DELETE', `/api/project-updates/${id}`),

  setReminder: (issueId: string, remindAt: string) =>
    req<IssueReminder>('POST', '/api/reminders', { issueId, remindAt }),
  clearReminder: (id: string) => req<{ ok: true }>('DELETE', `/api/reminders/${id}`),
  snoozeNotification: (id: string, snoozedUntil: string | null) =>
    req<{ ok: true }>('PATCH', `/api/notifications/${id}/snooze`, { snoozedUntil }),

  createCustomer: (input: CreateCustomerInput) => req<Customer>('POST', '/api/customers', input),
  updateCustomer: (id: string, input: Record<string, unknown>) =>
    req<Customer>('PATCH', `/api/customers/${id}`, input),
  deleteCustomer: (id: string) => req<{ ok: true }>('DELETE', `/api/customers/${id}`),
  createCustomerRequest: (input: CreateCustomerRequestInput) =>
    req<CustomerRequest>('POST', '/api/customer-requests', input),
  updateCustomerRequest: (id: string, input: Record<string, unknown>) =>
    req<CustomerRequest>('PATCH', `/api/customer-requests/${id}`, input),
  deleteCustomerRequest: (id: string) =>
    req<{ ok: true }>('DELETE', `/api/customer-requests/${id}`),

  createDocumentComment: (input: CreateDocumentCommentInput) =>
    req<DocumentComment>('POST', '/api/document-comments', input),
  updateDocumentComment: (id: string, input: Record<string, unknown>) =>
    req<DocumentComment>('PATCH', `/api/document-comments/${id}`, input),
  deleteDocumentComment: (id: string) =>
    req<{ ok: true }>('DELETE', `/api/document-comments/${id}`),

  createTriageRule: (input: CreateTriageRuleInput) =>
    req<TriageRule>('POST', '/api/triage-rules', input),
  updateTriageRule: (id: string, input: Record<string, unknown>) =>
    req<TriageRule>('PATCH', `/api/triage-rules/${id}`, input),
  deleteTriageRule: (id: string) => req<{ ok: true }>('DELETE', `/api/triage-rules/${id}`),

  importCsv: async (teamId: string, file: File): Promise<ImportResult> => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`/api/teams/${teamId}/import`, {
      method: 'POST',
      body: form,
      credentials: 'same-origin',
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new ApiError(
        res.status,
        data?.error?.code ?? 'import_failed',
        data?.error?.message ?? 'Import failed',
      );
    }
    return res.json() as Promise<ImportResult>;
  },

  updateProfile: (input: UpdateProfileInput) => req<User>('PATCH', '/api/profile', input),
  adminUpdateUser: (id: string, input: { role?: string; active?: boolean }) =>
    req<User>('PATCH', `/api/users/${id}`, input),
  updateWorkspace: (name: string) => req<Workspace>('PATCH', '/api/workspace', { name }),
};
