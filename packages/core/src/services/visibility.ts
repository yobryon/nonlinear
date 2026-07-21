import type {
  Attachment,
  BootstrapPayload,
  Comment,
  Document,
  DocumentComment,
  Issue,
  IssueRelation,
  Project,
  ProjectMilestone,
  ProjectUpdate,
  Reaction,
  SyncDelta,
} from '@nonlinear/shared';
import type { Ctx } from '../domain.js';

/**
 * Team-scoped read visibility. A workspace is no longer a single trust domain:
 * a non-admin sees only the teams they are a member of, and the entities that
 * hang off those teams. Admins see everything.
 *
 * This is the single source of truth for "what can this user read", used by
 * both the bootstrap snapshot (filterPayload) and the live sync hub (which
 * mirrors these rules over incrementally-maintained indexes).
 */
export interface Visibility {
  /** Admins see the whole workspace. */
  seesAll: boolean;
  teamIds: Set<string>;
}

export async function visibilityFor(ctx: Ctx, userId: string): Promise<Visibility> {
  const user = await ctx.storage.users.get(userId);
  if (user?.role === 'admin') return { seesAll: true, teamIds: new Set() };
  const memberships = await ctx.storage.teamMemberships.all();
  const teamIds = new Set<string>();
  for (const m of memberships) if (m.userId === userId) teamIds.add(m.teamId);
  return { seesAll: false, teamIds };
}

export function seesTeam(vis: Visibility, teamId: string | null | undefined): boolean {
  if (vis.seesAll) return true;
  return teamId != null && vis.teamIds.has(teamId);
}

/**
 * Narrow a visibility by a token's team scope. A scoped credential can never
 * widen access — it intersects with what the user could already see (an admin's
 * `seesAll` collapses to exactly the scoped teams). `null` = no team scope.
 */
export function applyScope(vis: Visibility, scopeTeamIds: string[] | null | undefined): Visibility {
  if (!scopeTeamIds) return vis;
  const scope = new Set(scopeTeamIds);
  if (vis.seesAll) return { seesAll: false, teamIds: scope };
  return { seesAll: false, teamIds: new Set([...vis.teamIds].filter((t) => scope.has(t))) };
}

export function projectVisible(vis: Visibility, project: Project | undefined | null): boolean {
  if (vis.seesAll) return true;
  if (!project) return false;
  return project.teamIds.some((t) => vis.teamIds.has(t));
}

/**
 * Filter a fully-assembled bootstrap payload down to what `vis` may read.
 * Team-scoped models are filtered by membership; personal models
 * (notifications/favorites/views/reminders/dashboards) are already filtered by
 * the caller and are passed through untouched.
 */
export function filterPayload(payload: BootstrapPayload, vis: Visibility): BootstrapPayload {
  if (vis.seesAll) return payload;

  const issueById = new Map(payload.issues.map((i) => [i.id, i]));
  const projectById = new Map(payload.projects.map((p) => [p.id, p]));
  const commentById = new Map(payload.comments.map((c) => [c.id, c]));
  const documentById = new Map(payload.documents.map((d) => [d.id, d]));

  const issueOk = (issueId: string) => seesTeam(vis, issueById.get(issueId)?.teamId);
  const projectOk = (projectId: string | null) =>
    projectId != null && projectVisible(vis, projectById.get(projectId));
  const documentOk = (doc: Document) =>
    doc.projectId == null ? true : projectVisible(vis, projectById.get(doc.projectId));

  const projects = payload.projects.filter((p) => projectVisible(vis, p));
  const visibleProjectIds = new Set(projects.map((p) => p.id));
  const issues = payload.issues.filter((i) => vis.teamIds.has(i.teamId));
  const documents = payload.documents.filter(documentOk);
  const visibleDocumentIds = new Set(documents.map((d) => d.id));

  return {
    ...payload,
    teams: payload.teams.filter((t) => vis.teamIds.has(t.id)),
    teamMemberships: payload.teamMemberships.filter(
      (m) => vis.teamIds.has(m.teamId) || m.userId === payload.userId,
    ),
    workflowStates: payload.workflowStates.filter((s) => vis.teamIds.has(s.teamId)),
    issues,
    labels: payload.labels.filter((l) => l.teamId == null || vis.teamIds.has(l.teamId)),
    comments: payload.comments.filter((c: Comment) => issueOk(c.issueId)),
    reactions: payload.reactions.filter((r: Reaction) => {
      const c = commentById.get(r.commentId);
      return c ? issueOk(c.issueId) : false;
    }),
    projects,
    projectMilestones: payload.projectMilestones.filter((m: ProjectMilestone) =>
      visibleProjectIds.has(m.projectId),
    ),
    cycles: payload.cycles.filter((c) => vis.teamIds.has(c.teamId)),
    issueRelations: payload.issueRelations.filter((r: IssueRelation) => issueOk(r.issueId)),
    attachments: payload.attachments.filter((a: Attachment) => issueOk(a.issueId)),
    documents,
    documentComments: payload.documentComments.filter((dc: DocumentComment) =>
      visibleDocumentIds.has(dc.documentId),
    ),
    // Webhooks carry a secret and are an admin-only surface.
    webhooks: [],
    issueTemplates: payload.issueTemplates.filter((t) => vis.teamIds.has(t.teamId)),
    projectUpdates: payload.projectUpdates.filter((u: ProjectUpdate) => projectOk(u.projectId)),
    triageRules: payload.triageRules.filter((r) => vis.teamIds.has(r.teamId)),
    // Initiatives (project groupings) and customers are workspace-level and not
    // team-scoped; the projects/issues they reference are still filtered above.
  };
}

/**
 * Resolve the team a delta belongs to, given lookups. Returns undefined for
 * models that are not team-scoped (always visible) and null when the parent
 * can't be resolved (treat as not-visible). Used by the hub, which supplies
 * synchronous lookups from incrementally-maintained indexes.
 */
export interface DeltaResolvers {
  issueTeam: (issueId: string) => string | undefined;
  commentIssue: (commentId: string) => string | undefined;
  projectTeams: (projectId: string) => string[] | undefined;
  documentProject: (documentId: string) => string | null | undefined;
}
