import type {
  Attachment,
  BootstrapPayload,
  Comment,
  Decision,
  DecisionComment,
  Document,
  DocumentComment,
  Issue,
  IssueRelation,
  Project,
  ProjectMilestone,
  ProjectUpdate,
  Reaction,
  Team,
} from '@nonlinear/shared';
import type { Ctx } from '../domain.js';

/**
 * Team-scoped read visibility, in three tiers:
 *   - member teams (`teamIds`)  — full read of the team.
 *   - intake teams (`intakeTeamIds`) — you are NOT a member, but the team accepts
 *     internal intake, so you see the team's shell (metadata, roster, workflow
 *     states, labels) and only the issues YOU filed there — enough to file and
 *     follow up, nothing of the team's other work.
 *   - everything else — invisible.
 * Admins (`seesAll`) see the whole workspace. This is the single source of truth
 * for "what can this user read", used by the bootstrap snapshot and mirrored by
 * the live sync hub.
 */
export interface Visibility {
  seesAll: boolean;
  teamIds: Set<string>;
  intakeTeamIds: Set<string>;
  userId: string;
}

/** A team accepts internal intake when internal is on (missing = on, for legacy
 *  rows) or public intake is on (public is a superset of internal). */
export function effectiveInternalIntake(team: Team): boolean {
  return team.intakeEnabled || team.internalIntake !== false;
}

export async function visibilityFor(ctx: Ctx, userId: string): Promise<Visibility> {
  const user = await ctx.storage.users.get(userId);
  if (user?.role === 'admin') {
    return { seesAll: true, teamIds: new Set(), intakeTeamIds: new Set(), userId };
  }
  const [memberships, teams] = await Promise.all([
    ctx.storage.teamMemberships.all(),
    ctx.storage.teams.all(),
  ]);
  const teamIds = new Set<string>();
  for (const m of memberships) if (m.userId === userId) teamIds.add(m.teamId);
  const intakeTeamIds = new Set<string>();
  for (const t of teams) {
    if (!teamIds.has(t.id) && effectiveInternalIntake(t)) intakeTeamIds.add(t.id);
  }
  return { seesAll: false, teamIds, intakeTeamIds, userId };
}

/** Full member read of a team (or admin). */
export function seesTeam(vis: Visibility, teamId: string | null | undefined): boolean {
  if (vis.seesAll) return true;
  return teamId != null && vis.teamIds.has(teamId);
}

/** May file into / partially see a team: member OR intake access. */
export function canIntakeTeam(vis: Visibility, teamId: string | null | undefined): boolean {
  return seesTeam(vis, teamId) || (teamId != null && vis.intakeTeamIds.has(teamId));
}

/** May read a specific issue: any issue of a member team, or one you filed in an
 *  intake team. */
export function canReadIssue(vis: Visibility, issue: Issue | undefined | null): boolean {
  if (vis.seesAll) return true;
  if (!issue) return false;
  if (vis.teamIds.has(issue.teamId)) return true;
  return vis.intakeTeamIds.has(issue.teamId) && issue.creatorId === vis.userId;
}

/** Decisions are a team's private reasoning — member-only, never shown to the
 *  intake tier. */
export function canReadDecision(vis: Visibility, decision: Decision | undefined | null): boolean {
  if (vis.seesAll) return true;
  if (!decision) return false;
  return vis.teamIds.has(decision.teamId);
}

/** Projects are member-only (intake users don't see a team's projects). */
export function projectVisible(vis: Visibility, project: Project | undefined | null): boolean {
  if (vis.seesAll) return true;
  if (!project) return false;
  return project.teamIds.some((t) => vis.teamIds.has(t));
}

/**
 * Narrow a visibility by a token's team scope. A scoped credential can never
 * widen access — it intersects both member and intake teams with the scope (an
 * admin's `seesAll` collapses to exactly the scoped member teams). `null` = no
 * team scope.
 */
export function applyScope(vis: Visibility, scopeTeamIds: string[] | null | undefined): Visibility {
  if (!scopeTeamIds) return vis;
  const scope = new Set(scopeTeamIds);
  if (vis.seesAll) {
    return { seesAll: false, teamIds: scope, intakeTeamIds: new Set(), userId: vis.userId };
  }
  return {
    seesAll: false,
    teamIds: new Set([...vis.teamIds].filter((t) => scope.has(t))),
    intakeTeamIds: new Set([...vis.intakeTeamIds].filter((t) => scope.has(t))),
    userId: vis.userId,
  };
}

/**
 * Filter a fully-assembled bootstrap payload down to what `vis` may read.
 * Personal models (notifications/favorites/views/reminders/dashboards) are
 * already filtered by the caller and pass through untouched.
 */
export function filterPayload(payload: BootstrapPayload, vis: Visibility): BootstrapPayload {
  if (vis.seesAll) return payload;
  const { teamIds, intakeTeamIds, userId } = vis;
  const shellTeam = (id: string) => teamIds.has(id) || intakeTeamIds.has(id);

  const issueById = new Map(payload.issues.map((i) => [i.id, i]));
  const projectById = new Map(payload.projects.map((p) => [p.id, p]));
  const commentById = new Map(payload.comments.map((c) => [c.id, c]));
  const documentById = new Map(payload.documents.map((d) => [d.id, d]));

  const issueOk = (issueId: string) => canReadIssue(vis, issueById.get(issueId));
  const documentOk = (doc: Document) =>
    doc.projectId == null ? true : projectVisible(vis, projectById.get(doc.projectId));

  const projects = payload.projects.filter((p) => projectVisible(vis, p));
  const visibleProjectIds = new Set(projects.map((p) => p.id));
  const issues = payload.issues.filter((i) => canReadIssue(vis, i));
  const documents = payload.documents.filter(documentOk);
  const visibleDocumentIds = new Set(documents.map((d) => d.id));

  return {
    ...payload,
    // Team shells (metadata + roster + states/labels) for member AND intake teams.
    teams: payload.teams.filter((t) => shellTeam(t.id)),
    teamMemberships: payload.teamMemberships.filter(
      (m) => shellTeam(m.teamId) || m.userId === userId,
    ),
    workflowStates: payload.workflowStates.filter((s) => shellTeam(s.teamId)),
    labels: payload.labels.filter((l) => l.teamId == null || shellTeam(l.teamId)),
    // Issues: all of a member team, only your own in an intake team.
    issues,
    comments: payload.comments.filter((c: Comment) => issueOk(c.issueId)),
    reactions: payload.reactions.filter((r: Reaction) => {
      const c = commentById.get(r.commentId);
      return c ? issueOk(c.issueId) : false;
    }),
    issueRelations: payload.issueRelations.filter((r: IssueRelation) => issueOk(r.issueId)),
    attachments: payload.attachments.filter((a: Attachment) => issueOk(a.issueId)),
    // Member-only surfaces (intake users don't see a team's plan/docs/rules).
    projects,
    projectMilestones: payload.projectMilestones.filter((m: ProjectMilestone) =>
      visibleProjectIds.has(m.projectId),
    ),
    projectUpdates: payload.projectUpdates.filter(
      (u: ProjectUpdate) => u.projectId != null && visibleProjectIds.has(u.projectId),
    ),
    cycles: payload.cycles.filter((c) => teamIds.has(c.teamId)),
    documents,
    documentComments: payload.documentComments.filter((dc: DocumentComment) =>
      visibleDocumentIds.has(dc.documentId),
    ),
    issueTemplates: payload.issueTemplates.filter((t) => teamIds.has(t.teamId)),
    triageRules: payload.triageRules.filter((r) => teamIds.has(r.teamId)),
    // Decisions are member-only reasoning; their comments follow the decision.
    decisions: payload.decisions.filter((d) => teamIds.has(d.teamId)),
    decisionComments: (() => {
      const visibleDecisionIds = new Set(
        payload.decisions.filter((d) => teamIds.has(d.teamId)).map((d) => d.id),
      );
      return payload.decisionComments.filter((c: DecisionComment) =>
        visibleDecisionIds.has(c.decisionId),
      );
    })(),
    // Webhooks carry a secret — admin-only.
    webhooks: [],
    // Initiatives and customers are workspace-level; the projects/issues they
    // reference are still filtered above.
  };
}
