import {
  GraphQLBoolean,
  GraphQLEnumType,
  GraphQLID,
  GraphQLInputObjectType,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
} from 'graphql';
import {
  applyScope,
  canIntakeTeam,
  canReadIssue,
  visibilityFor,
  type Domain,
  type Visibility,
} from '@nonlinear/core';
import type {
  Comment,
  Cycle,
  Issue,
  Label,
  Project,
  ProjectUpdate,
  Team,
  TokenScope,
  User,
  WorkflowState,
} from '@nonlinear/shared';
import { PRIORITY_LABELS, type Priority } from '@nonlinear/shared';

/**
 * A GraphQL API over the same `Domain`, mounted at POST /api/graphql — the
 * shape Linear's own API takes. It is a thin transport adapter like REST/MCP:
 * queries read from a per-request snapshot of the store (all entities loaded
 * into id-maps once, so nested field resolution is lazy Map lookups with no
 * N+1), and mutations delegate to domain services. Auth is the same
 * cookie/Bearer identity as REST; the resolved user is the GraphQL context's
 * `viewer`.
 */

export interface GraphqlContext {
  domain: Domain;
  viewer: User;
  /** Attribution identity (viewer, or a persona under it via X-Agent-ID). */
  actor: User;
  vis: Visibility;
  teams: Map<string, Team>;
  states: Map<string, WorkflowState>;
  users: Map<string, User>;
  labels: Map<string, Label>;
  projects: Map<string, Project>;
  issues: Map<string, Issue>;
  comments: Comment[];
  cycles: Map<string, Cycle>;
  updates: ProjectUpdate[];
}

const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]));

/** Build a read snapshot + service handle for one GraphQL request. */
export async function graphqlContext(
  domain: Domain,
  viewer: User,
  scope: TokenScope,
  actor: User = viewer,
): Promise<GraphqlContext> {
  const s = domain.ctx.storage;
  const [teams, states, users, labels, projects, issues, comments, cycles, updates, baseVis] =
    await Promise.all([
      s.teams.all(),
      s.workflowStates.all(),
      s.users.all(),
      s.labels.all(),
      s.projects.all(),
      s.issues.all(),
      s.comments.all(),
      s.cycles.all(),
      s.projectUpdates.all(),
      visibilityFor(domain.ctx, viewer.id),
    ]);
  return {
    domain,
    viewer,
    actor,
    vis: applyScope(baseVis, scope.teamIds),
    teams: byId(teams),
    states: byId(states),
    users: byId(users),
    labels: byId(labels),
    projects: byId(projects),
    issues: byId(issues),
    comments,
    cycles: byId(cycles),
    updates,
  };
}

type Ctx = GraphqlContext;

const StateCategory = new GraphQLEnumType({
  name: 'StateCategory',
  values: {
    triage: {},
    backlog: {},
    unstarted: {},
    started: {},
    completed: {},
    canceled: {},
  },
});

const UserType = new GraphQLObjectType<User, Ctx>({
  name: 'User',
  fields: () => ({
    id: { type: new GraphQLNonNull(GraphQLID) },
    email: { type: new GraphQLNonNull(GraphQLString) },
    name: { type: new GraphQLNonNull(GraphQLString) },
    displayName: { type: new GraphQLNonNull(GraphQLString) },
    role: { type: new GraphQLNonNull(GraphQLString) },
    active: { type: new GraphQLNonNull(GraphQLBoolean) },
    isAgent: { type: new GraphQLNonNull(GraphQLBoolean) },
  }),
});

const WorkflowStateType = new GraphQLObjectType<WorkflowState, Ctx>({
  name: 'WorkflowState',
  fields: () => ({
    id: { type: new GraphQLNonNull(GraphQLID) },
    name: { type: new GraphQLNonNull(GraphQLString) },
    category: { type: new GraphQLNonNull(StateCategory) },
    color: { type: new GraphQLNonNull(GraphQLString) },
    position: { type: GraphQLInt },
  }),
});

const LabelType = new GraphQLObjectType<Label, Ctx>({
  name: 'Label',
  fields: () => ({
    id: { type: new GraphQLNonNull(GraphQLID) },
    name: { type: new GraphQLNonNull(GraphQLString) },
    color: { type: new GraphQLNonNull(GraphQLString) },
  }),
});

const CycleType = new GraphQLObjectType<Cycle, Ctx>({
  name: 'Cycle',
  fields: () => ({
    id: { type: new GraphQLNonNull(GraphQLID) },
    number: { type: new GraphQLNonNull(GraphQLInt) },
    name: { type: GraphQLString },
    startsAt: { type: new GraphQLNonNull(GraphQLString) },
    endsAt: { type: new GraphQLNonNull(GraphQLString) },
  }),
});

const CommentType: GraphQLObjectType = new GraphQLObjectType<Comment, Ctx>({
  name: 'Comment',
  fields: () => ({
    id: { type: new GraphQLNonNull(GraphQLID) },
    body: { type: new GraphQLNonNull(GraphQLString) },
    author: { type: UserType, resolve: (c, _a, ctx) => ctx.users.get(c.userId) ?? null },
    createdAt: { type: new GraphQLNonNull(GraphQLString) },
  }),
});

const TeamType: GraphQLObjectType = new GraphQLObjectType<Team, Ctx>({
  name: 'Team',
  fields: () => ({
    id: { type: new GraphQLNonNull(GraphQLID) },
    key: { type: new GraphQLNonNull(GraphQLString) },
    name: { type: new GraphQLNonNull(GraphQLString) },
    description: { type: GraphQLString },
    color: { type: new GraphQLNonNull(GraphQLString) },
    private: { type: new GraphQLNonNull(GraphQLBoolean) },
    states: {
      type: new GraphQLList(new GraphQLNonNull(WorkflowStateType)),
      resolve: (t, _a, ctx) =>
        [...ctx.states.values()]
          .filter((s) => s.teamId === t.id)
          .sort((a, b) => a.position - b.position),
    },
    issues: {
      type: new GraphQLList(new GraphQLNonNull(IssueType)),
      resolve: (t, _a, ctx) =>
        [...ctx.issues.values()].filter((i) => i.teamId === t.id && !i.archivedAt),
    },
  }),
});

const ProjectType: GraphQLObjectType = new GraphQLObjectType<Project, Ctx>({
  name: 'Project',
  fields: () => ({
    id: { type: new GraphQLNonNull(GraphQLID) },
    name: { type: new GraphQLNonNull(GraphQLString) },
    description: { type: new GraphQLNonNull(GraphQLString) },
    status: { type: new GraphQLNonNull(GraphQLString) },
    lead: {
      type: UserType,
      resolve: (p, _a, ctx) => (p.leadId ? (ctx.users.get(p.leadId) ?? null) : null),
    },
    teams: {
      type: new GraphQLList(new GraphQLNonNull(TeamType)),
      resolve: (p, _a, ctx) => p.teamIds.map((id) => ctx.teams.get(id)).filter(Boolean),
    },
    startDate: { type: GraphQLString },
    targetDate: { type: GraphQLString },
    health: {
      type: GraphQLString,
      resolve: (p, _a, ctx) => {
        const latest = ctx.updates
          .filter((u) => u.projectId === p.id)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        return latest?.health ?? null;
      },
    },
    issues: {
      type: new GraphQLList(new GraphQLNonNull(IssueType)),
      resolve: (p, _a, ctx) => [...ctx.issues.values()].filter((i) => i.projectId === p.id),
    },
  }),
});

const IssueType: GraphQLObjectType = new GraphQLObjectType<Issue, Ctx>({
  name: 'Issue',
  fields: () => ({
    id: { type: new GraphQLNonNull(GraphQLID) },
    number: { type: new GraphQLNonNull(GraphQLInt) },
    identifier: {
      type: new GraphQLNonNull(GraphQLString),
      resolve: (i, _a, ctx) => `${ctx.teams.get(i.teamId)?.key ?? '???'}-${i.number}`,
    },
    title: { type: new GraphQLNonNull(GraphQLString) },
    description: { type: GraphQLString },
    priority: { type: new GraphQLNonNull(GraphQLInt) },
    priorityLabel: {
      type: new GraphQLNonNull(GraphQLString),
      resolve: (i) => PRIORITY_LABELS[i.priority as Priority],
    },
    estimate: { type: GraphQLInt },
    dueDate: { type: GraphQLString },
    createdAt: { type: new GraphQLNonNull(GraphQLString) },
    updatedAt: { type: new GraphQLNonNull(GraphQLString) },
    completedAt: { type: GraphQLString },
    team: { type: TeamType, resolve: (i, _a, ctx) => ctx.teams.get(i.teamId) ?? null },
    state: { type: WorkflowStateType, resolve: (i, _a, ctx) => ctx.states.get(i.stateId) ?? null },
    assignee: {
      type: UserType,
      resolve: (i, _a, ctx) => (i.assigneeId ? (ctx.users.get(i.assigneeId) ?? null) : null),
    },
    creator: { type: UserType, resolve: (i, _a, ctx) => ctx.users.get(i.creatorId) ?? null },
    labels: {
      type: new GraphQLList(new GraphQLNonNull(LabelType)),
      resolve: (i, _a, ctx) => i.labelIds.map((id) => ctx.labels.get(id)).filter(Boolean),
    },
    project: {
      type: ProjectType,
      resolve: (i, _a, ctx) => (i.projectId ? (ctx.projects.get(i.projectId) ?? null) : null),
    },
    cycle: {
      type: CycleType,
      resolve: (i, _a, ctx) => (i.cycleId ? (ctx.cycles.get(i.cycleId) ?? null) : null),
    },
    parent: {
      type: IssueType,
      resolve: (i, _a, ctx) => (i.parentId ? (ctx.issues.get(i.parentId) ?? null) : null),
    },
    children: {
      type: new GraphQLList(new GraphQLNonNull(IssueType)),
      resolve: (i, _a, ctx) => [...ctx.issues.values()].filter((c) => c.parentId === i.id),
    },
    comments: {
      type: new GraphQLList(new GraphQLNonNull(CommentType)),
      resolve: (i, _a, ctx) =>
        ctx.comments
          .filter((c) => c.issueId === i.id)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    },
  }),
});

const teamByKey = (ctx: Ctx, key: string) =>
  [...ctx.teams.values()].find((t) => t.key.toUpperCase() === key.toUpperCase()) ?? null;

const QueryType = new GraphQLObjectType<unknown, Ctx>({
  name: 'Query',
  fields: () => ({
    viewer: { type: new GraphQLNonNull(UserType), resolve: (_s, _a, ctx) => ctx.viewer },
    users: {
      type: new GraphQLList(new GraphQLNonNull(UserType)),
      resolve: (_s, _a, ctx) => [...ctx.users.values()],
    },
    teams: {
      type: new GraphQLList(new GraphQLNonNull(TeamType)),
      resolve: (_s, _a, ctx) => [...ctx.teams.values()],
    },
    team: {
      type: TeamType,
      args: { key: { type: new GraphQLNonNull(GraphQLString) } },
      resolve: (_s, { key }: { key: string }, ctx) => teamByKey(ctx, key),
    },
    projects: {
      type: new GraphQLList(new GraphQLNonNull(ProjectType)),
      resolve: (_s, _a, ctx) => [...ctx.projects.values()],
    },
    project: {
      type: ProjectType,
      args: { id: { type: new GraphQLNonNull(GraphQLID) } },
      resolve: (_s, { id }: { id: string }, ctx) => ctx.projects.get(id) ?? null,
    },
    issue: {
      type: IssueType,
      args: { id: { type: GraphQLID }, identifier: { type: GraphQLString } },
      resolve: (_s, { id, identifier }: { id?: string; identifier?: string }, ctx) => {
        if (id) return ctx.issues.get(id) ?? null;
        if (identifier) {
          const dash = identifier.lastIndexOf('-');
          const team = teamByKey(ctx, identifier.slice(0, dash));
          const number = Number(identifier.slice(dash + 1));
          return (
            [...ctx.issues.values()].find((i) => i.teamId === team?.id && i.number === number) ??
            null
          );
        }
        return null;
      },
    },
    issues: {
      type: new GraphQLList(new GraphQLNonNull(IssueType)),
      args: {
        teamKey: { type: GraphQLString },
        stateCategory: { type: StateCategory },
        first: { type: GraphQLInt },
      },
      resolve: (_s, a: { teamKey?: string; stateCategory?: string; first?: number }, ctx) => {
        const team = a.teamKey ? teamByKey(ctx, a.teamKey) : null;
        let rows = [...ctx.issues.values()].filter((i) => !i.archivedAt);
        if (a.teamKey) rows = rows.filter((i) => i.teamId === team?.id);
        if (a.stateCategory)
          rows = rows.filter((i) => ctx.states.get(i.stateId)?.category === a.stateCategory);
        rows.sort((x, y) => y.createdAt.localeCompare(x.createdAt));
        return a.first ? rows.slice(0, a.first) : rows;
      },
    },
  }),
});

const IssueInput = new GraphQLInputObjectType({
  name: 'CreateIssueInput',
  fields: {
    teamId: { type: new GraphQLNonNull(GraphQLID) },
    title: { type: new GraphQLNonNull(GraphQLString) },
    description: { type: GraphQLString },
    priority: { type: GraphQLInt },
    assigneeId: { type: GraphQLID },
    stateId: { type: GraphQLID },
    projectId: { type: GraphQLID },
    labelIds: { type: new GraphQLList(new GraphQLNonNull(GraphQLID)) },
  },
});

const IssueUpdateInput = new GraphQLInputObjectType({
  name: 'UpdateIssueInput',
  fields: {
    title: { type: GraphQLString },
    description: { type: GraphQLString },
    priority: { type: GraphQLInt },
    assigneeId: { type: GraphQLID },
    stateId: { type: GraphQLID },
    projectId: { type: GraphQLID },
    labelIds: { type: new GraphQLList(new GraphQLNonNull(GraphQLID)) },
  },
});

const MutationType = new GraphQLObjectType<unknown, Ctx>({
  name: 'Mutation',
  fields: () => ({
    createIssue: {
      type: new GraphQLNonNull(IssueType),
      args: { input: { type: new GraphQLNonNull(IssueInput) } },
      resolve: (_s, { input }: { input: Record<string, unknown> }, ctx) => {
        if (!canIntakeTeam(ctx.vis, input.teamId as string)) {
          throw new Error('You cannot file into that team');
        }
        return ctx.domain.issues.create(ctx.actor.id, input as never);
      },
    },
    updateIssue: {
      type: new GraphQLNonNull(IssueType),
      args: {
        id: { type: new GraphQLNonNull(GraphQLID) },
        input: { type: new GraphQLNonNull(IssueUpdateInput) },
      },
      resolve: (_s, { id, input }: { id: string; input: Record<string, unknown> }, ctx) =>
        ctx.domain.issues.update(ctx.actor.id, id, input as never),
    },
    deleteIssue: {
      type: new GraphQLNonNull(GraphQLBoolean),
      args: { id: { type: new GraphQLNonNull(GraphQLID) } },
      resolve: async (_s, { id }: { id: string }, ctx) => {
        await ctx.domain.issues.remove(id);
        return true;
      },
    },
    createComment: {
      type: new GraphQLNonNull(CommentType),
      args: {
        issueId: { type: new GraphQLNonNull(GraphQLID) },
        body: { type: new GraphQLNonNull(GraphQLString) },
      },
      resolve: (_s, { issueId, body }: { issueId: string; body: string }, ctx) => {
        const issue = ctx.issues.get(issueId);
        if (issue && !canReadIssue(ctx.vis, issue)) {
          throw new Error('You cannot comment on that issue');
        }
        return ctx.domain.comments.create(ctx.actor.id, { issueId, body });
      },
    },
  }),
});

export const graphqlSchema = new GraphQLSchema({ query: QueryType, mutation: MutationType });
