import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import {
  applyScope,
  canIntakeTeam,
  canReadIssue,
  colorFor,
  seesTeam,
  visibilityFor,
  type Domain,
  type Visibility,
} from '@nonlinear/core';
import type { Decision, Issue, Priority, StateCategory, TokenScope, User } from '@nonlinear/shared';
import { PRIORITY_LABELS, STATE_CATEGORIES } from '@nonlinear/shared';

/**
 * HTTP MCP server, mounted in-process at /mcp (Streamable HTTP). It is a
 * protocol adapter over the same Domain the REST routes use — an agent that
 * connects here can drive nonlinear the way agents drive Linear's hosted MCP.
 *
 * Auth: `Authorization: Bearer <personal API token>` on every request; the
 * session is bound to that token's user. Stateless (a fresh server + transport
 * per request) so no session bookkeeping is needed.
 */

/**
 * The setup/use guides, loaded from disk once and exposed as MCP resources so a
 * connecting agent can read them. In the container they're copied to
 * `<cwd>/guides`; in dev they live at `docs/guides`.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const GUIDE_DIRS = [
  process.env.GUIDES_DIR,
  join(process.cwd(), 'guides'),
  join(process.cwd(), 'docs', 'guides'),
  join(HERE, '..', '..', '..', '..', 'docs', 'guides'),
].filter((d): d is string => Boolean(d));

interface GuideResource {
  uri: string;
  file: string;
  title: string;
  description: string;
}
const GUIDES: GuideResource[] = [
  {
    uri: 'nonlinear://guides/readme',
    file: 'README.md',
    title: 'Guides overview',
    description: 'Index of the guides and the team-scoped access model — start here.',
  },
  {
    uri: 'nonlinear://guides/for-consumer-agents',
    file: '03-guide-for-consumer-agents.md',
    title: 'Guide for consumer agents',
    description:
      'For an agent that USES a tool/library another team provides: how to file and track bugs, gaps, and feature requests.',
  },
  {
    uri: 'nonlinear://guides/for-provider-agents',
    file: '02-guide-for-provider-agents.md',
    title: 'Guide for provider agents',
    description:
      'For an agent that OWNS a tool/component: run its project and service the issues consumers file against it.',
  },
  {
    uri: 'nonlinear://guides/for-humans',
    file: '01-guide-for-humans.md',
    title: 'Guide for humans',
    description: 'For the operator standing up and configuring nonlinear.',
  },
];

function loadGuide(file: string): string | null {
  for (const dir of GUIDE_DIRS) {
    const path = join(dir, file);
    if (existsSync(path)) {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        // fall through to the next candidate
      }
    }
  }
  return null;
}
// Read once at module load; keep only the guides actually present on disk.
const GUIDE_TEXT = new Map<string, { meta: GuideResource; text: string }>();
for (const g of GUIDES) {
  const text = loadGuide(g.file);
  if (text) GUIDE_TEXT.set(g.uri, { meta: g, text });
}

const MCP_INSTRUCTIONS = `You are connected to nonlinear (a self-hostable Linear clone) over MCP, authenticated as one specific user. Call the \`whoami\` tool FIRST — it returns who you are (name, isAgent, role), your workspace, your member \`teams\`, your \`intakeTeams\` (teams you can file into but aren't a member of), and your token's scope (read-only? which teams?). Every write is attributed to you — unless your session presents an \`X-Agent-ID\` header, in which case work is credited to a **persona** under you (e.g. \`arch\` acting under \`vantage-agent\`), so several sessions sharing one token stay individually attributed and separately assignable. \`whoami\` shows your persona when one is active; it never changes what you can access. You see your member teams in full; for an intake team you can file issues and track the ones you filed (via \`my_work\`), but not see the team's other work. \`list_teams\` marks each team member vs intake.

If this is your first time, read the guide resources (list them with resources/list, then resources/read):
- nonlinear://guides/for-consumer-agents — you USE a tool another team provides and want to file & track bugs/requests.
- nonlinear://guides/for-provider-agents — you OWN a tool/component and run its project + support its users here.
- nonlinear://guides/readme — overview and the team-scoped access model.

Quick loop: whoami → list_teams → search_issues (always search before filing to avoid duplicates) → create_issue / add_comment / update_issue. In-flow shortcuts: \`find_issue\` fuzzy-resolves a description to an issue so you needn't look up a number; \`comment_and_state\` comments and moves state in one call; \`update_issues\` batches state moves (the reconcile pass as one motion). Use \`my_work\` to see what's assigned to you or @mentions you. Names are resolved for you: team by key (e.g. ENG), state/label/project by name, assignee by email/@handle/name. Priority is 0 none, 1 urgent, 2 high, 3 medium, 4 low — set it honestly. A read-only or team-scoped token limits what you can do (whoami shows this).`;

const PRIORITY_BY_NAME: Record<string, Priority> = {
  none: 0,
  'no priority': 0,
  urgent: 1,
  high: 2,
  medium: 3,
  low: 4,
};

function parsePriority(value: string | number | undefined): Priority | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number') return Math.max(0, Math.min(4, value)) as Priority;
  const byName = PRIORITY_BY_NAME[value.trim().toLowerCase()];
  if (byName !== undefined) return byName;
  const n = Number(value);
  return Number.isNaN(n) ? undefined : (Math.max(0, Math.min(4, n)) as Priority);
}

async function resolveTeam(
  domain: Domain,
  teamKey: string,
  vis: Visibility,
  opts: { requireMember?: boolean } = {},
) {
  const team = (await domain.ctx.storage.teams.all()).find(
    (t) => t.key.toUpperCase() === teamKey.toUpperCase(),
  );
  // A team the credential can't see (or can't file to) is reported as unknown.
  const ok = team && (opts.requireMember ? seesTeam(vis, team.id) : canIntakeTeam(vis, team.id));
  if (!team || !ok) throw new Error(`Unknown team "${teamKey}"`);
  return team;
}

async function resolveIssue(domain: Domain, identifier: string, vis: Visibility): Promise<Issue> {
  const dash = identifier.lastIndexOf('-');
  if (dash < 1) throw new Error(`Bad issue identifier "${identifier}" (expected e.g. ENG-42)`);
  const key = identifier.slice(0, dash).toUpperCase();
  const number = Number(identifier.slice(dash + 1));
  const team = (await domain.ctx.storage.teams.all()).find((t) => t.key.toUpperCase() === key);
  if (!team || !canIntakeTeam(vis, team.id)) throw new Error(`Issue ${identifier} not found`);
  const issue = (await domain.ctx.storage.issues.byTeam(team.id)).find((i) => i.number === number);
  // In an intake team you can only resolve issues you filed.
  if (!issue || !canReadIssue(vis, issue)) throw new Error(`Issue ${identifier} not found`);
  return issue;
}

async function resolveAssignee(domain: Domain, value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const users = await domain.ctx.storage.users.all();
  const v = value.trim().toLowerCase();
  const match = users.find(
    (u) =>
      u.email.toLowerCase() === v ||
      u.displayName.toLowerCase() === v ||
      u.name.toLowerCase() === v,
  );
  if (!match) throw new Error(`Unknown assignee "${value}"`);
  return match.id;
}

async function resolveState(domain: Domain, teamId: string, stateName: string | undefined) {
  if (!stateName) return undefined;
  const state = (await domain.ctx.storage.workflowStates.all()).find(
    (s) => s.teamId === teamId && s.name.toLowerCase() === stateName.trim().toLowerCase(),
  );
  if (!state) throw new Error(`Unknown state "${stateName}" for this team`);
  return state.id;
}

async function resolveLabels(domain: Domain, teamId: string, names: string[] | undefined) {
  if (!names || names.length === 0) return undefined;
  const labels = await domain.ctx.storage.labels.all();
  return names.map((name) => {
    const l = labels.find(
      (x) =>
        (x.teamId === null || x.teamId === teamId) &&
        x.name.toLowerCase() === name.trim().toLowerCase(),
    );
    if (!l) throw new Error(`Unknown label "${name}"`);
    return l.id;
  });
}

async function resolveProject(
  domain: Domain,
  name: string | undefined,
  vis: Visibility,
): Promise<string | undefined> {
  if (name === undefined) return undefined;
  const v = name.trim().toLowerCase();
  const match = (await domain.ctx.storage.projects.all()).find(
    (p) => p.name.toLowerCase() === v && (vis.seesAll || p.teamIds.some((t) => vis.teamIds.has(t))),
  );
  if (!match) throw new Error(`Unknown project "${name}"`);
  return match.id;
}

/**
 * Present an issue in an agent-friendly shape (names, not ids). `summary` omits
 * the description — used for list/search results so a scan stays lean; call
 * get_issue for the full body + comments.
 */
async function serializeIssue(domain: Domain, issue: Issue, opts: { summary?: boolean } = {}) {
  const s = domain.ctx.storage;
  const [team, state, assignee, waitingOn, labels] = await Promise.all([
    s.teams.get(issue.teamId),
    s.workflowStates.get(issue.stateId),
    issue.assigneeId ? s.users.get(issue.assigneeId) : Promise.resolve(null),
    issue.waitingOnId ? s.users.get(issue.waitingOnId) : Promise.resolve(null),
    s.labels.all(),
  ]);
  const identifier = team ? `${team.key}-${issue.number}` : issue.id;
  const base = {
    identifier,
    title: issue.title,
    state: state?.name ?? null,
    priority: PRIORITY_LABELS[issue.priority],
    assignee: assignee?.displayName ?? null,
    waitingOn: waitingOn?.displayName ?? null,
    labels: issue.labelIds.map((id) => labels.find((l) => l.id === id)?.name).filter(Boolean),
    project: issue.projectId,
    dueDate: issue.dueDate,
    estimate: issue.estimate,
    url: `/issue/${identifier}`,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
  };
  return opts.summary ? base : { ...base, description: issue.description };
}

/** Resolve a `KEY-D#` decision identifier for a member (decisions are member-only). */
async function resolveDecision(
  domain: Domain,
  identifier: string,
  vis: Visibility,
): Promise<Decision> {
  const m = identifier.match(/^(.+)-D(\d+)$/i);
  if (!m) throw new Error(`Bad decision identifier "${identifier}" (expected e.g. VAN-D12)`);
  const key = m[1]!.toUpperCase();
  const number = Number(m[2]);
  const team = (await domain.ctx.storage.teams.all()).find((t) => t.key.toUpperCase() === key);
  if (!team || !seesTeam(vis, team.id)) throw new Error(`Decision ${identifier} not found`);
  const decision = (await domain.ctx.storage.decisions.all()).find(
    (d) => d.teamId === team.id && d.number === number,
  );
  if (!decision) throw new Error(`Decision ${identifier} not found`);
  return decision;
}

async function serializeDecision(
  domain: Domain,
  decision: Decision,
  opts: { summary?: boolean } = {},
) {
  const s = domain.ctx.storage;
  const [team, users, decisions, issues] = await Promise.all([
    s.teams.get(decision.teamId),
    s.users.all(),
    s.decisions.all(),
    s.issues.all(),
  ]);
  const key = team?.key ?? '?';
  const identifier = `${key}-D${decision.number}`;
  const name = (id: string | null) =>
    id ? (users.find((u) => u.id === id)?.displayName ?? null) : null;
  const supersededBy = decisions.find((d) => d.supersedesId === decision.id);
  const decIdent = (id: string) => `${key}-D${decisions.find((d) => d.id === id)?.number ?? '?'}`;
  const base = {
    identifier,
    title: decision.title,
    status: decision.status,
    author: name(decision.authorId),
    ruledBy: name(decision.ruledById),
    ruledAt: decision.ruledAt,
    waitingOn: name(decision.waitingOnId),
    supersedes: decision.supersedesId ? decIdent(decision.supersedesId) : null,
    supersededBy: supersededBy ? `${key}-D${supersededBy.number}` : null,
    governs: decision.governedIssueIds.map((id) => {
      const i = issues.find((x) => x.id === id);
      return i ? `${key}-${i.number}` : id;
    }),
    url: `/decision/${decision.id}`,
    updatedAt: decision.updatedAt,
  };
  return opts.summary ? base : { ...base, body: decision.body };
}

const ok = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});
const fail = (message: string) => ({
  content: [{ type: 'text' as const, text: message }],
  isError: true,
});

/** Build a per-request MCP server whose tools act as `user`. */
function buildServer(
  domain: Domain,
  user: User,
  vis: Visibility,
  scope: TokenScope,
  // Attribution identity: equals `user`, or a persona under it when the request
  // carried an X-Agent-ID header. Authored content + "my work" use `actor`;
  // visibility/scope stay bound to `user`.
  actor: User,
): McpServer {
  const server = new McpServer(
    { name: 'nonlinear', version: '1.0.0' },
    { instructions: MCP_INSTRUCTIONS },
  );
  const s = domain.ctx.storage;

  // Expose the guides as readable resources so an agent can get up to speed.
  for (const { meta, text } of GUIDE_TEXT.values()) {
    server.registerResource(
      meta.file,
      meta.uri,
      { title: meta.title, description: meta.description, mimeType: 'text/markdown' },
      async (uri) => ({
        contents: [{ uri: uri.href, mimeType: 'text/markdown', text }],
      }),
    );
  }
  const guardWrite = () => {
    if (scope.readOnly) throw new Error('This API token is read-only');
  };
  const projectVisible = (teamIds: string[]) =>
    vis.seesAll || teamIds.some((t) => seesTeam(vis, t));

  server.registerTool(
    'whoami',
    {
      description:
        'Return the authenticated user, the teams you can see, and your token scope. Call this first.',
      inputSchema: {},
    },
    async () => {
      const workspace = (await s.workspaces.all())[0];
      const allTeams = await s.teams.all();
      const keyOf = (id: string) => allTeams.find((t) => t.id === id)?.key;
      const visibleKeys = vis.seesAll
        ? allTeams.map((t) => t.key)
        : [...vis.teamIds].map(keyOf).filter((k): k is string => Boolean(k));
      const intakeKeys = [...vis.intakeTeamIds].map(keyOf).filter((k): k is string => Boolean(k));
      const tokenTeams =
        scope.teamIds === null
          ? 'all'
          : scope.teamIds.map(keyOf).filter((k): k is string => Boolean(k));
      const parent = actor.parentAgentId ? await s.users.get(actor.parentAgentId) : null;
      return ok({
        user: {
          name: actor.name,
          displayName: actor.displayName,
          isAgent: actor.isAgent,
          role: actor.role,
        },
        // Present when acting as a persona: work is attributed to this named
        // sub-actor under the parent agent, set via the X-Agent-ID header.
        persona: parent
          ? { key: actor.agentPersonaKey, handle: actor.displayName, parent: parent.displayName }
          : undefined,
        workspace: workspace?.name,
        // Teams you're a member of — full read/write. Admins see every team.
        teams: visibleKeys,
        // Teams you can file intake into (not a member): create issues + track
        // the ones you filed, but you don't see their other work.
        intakeTeams: intakeKeys,
        // What the presenting credential is allowed to do.
        token: { readOnly: scope.readOnly, teams: tokenTeams },
      });
    },
  );

  server.registerTool(
    'list_teams',
    {
      description:
        'List teams you can act in. access="member" (full) or "intake" (you can file issues and track the ones you filed, but not see the team\'s other work).',
      inputSchema: {},
    },
    async () =>
      ok(
        (await s.teams.all())
          .filter((t) => canIntakeTeam(vis, t.id))
          .map((t) => ({
            key: t.key,
            name: t.name,
            access: seesTeam(vis, t.id) ? 'member' : 'intake',
          })),
      ),
  );

  server.registerTool(
    'list_users',
    { description: 'List workspace members and agents.', inputSchema: {} },
    async () =>
      ok(
        (await s.users.all())
          .filter((u) => u.active)
          .map((u) => ({ name: u.name, handle: u.displayName, isAgent: u.isAgent })),
      ),
  );

  server.registerTool(
    'list_projects',
    { description: 'List projects.', inputSchema: {} },
    async () =>
      ok(
        (await s.projects.all())
          .filter((p) => projectVisible(p.teamIds))
          .map((p) => ({ id: p.id, name: p.name, status: p.status })),
      ),
  );

  server.registerTool(
    'list_workflow_states',
    {
      description: "List a team's workflow states in order.",
      inputSchema: { teamKey: z.string().describe('Team key, e.g. ENG') },
    },
    async ({ teamKey }) => {
      const team = await resolveTeam(domain, teamKey, vis);
      const states = (await s.workflowStates.all())
        .filter((x) => x.teamId === team.id)
        .sort((a, b) => a.position - b.position);
      return ok(states.map((x) => ({ name: x.name, category: x.category })));
    },
  );

  server.registerTool(
    'list_labels',
    {
      description: 'List labels, optionally scoped to a team.',
      inputSchema: { teamKey: z.string().optional() },
    },
    async ({ teamKey }) => {
      const team = teamKey ? await resolveTeam(domain, teamKey, vis) : null;
      const labels = (await s.labels.all()).filter(
        (l) =>
          (l.teamId === null || seesTeam(vis, l.teamId)) &&
          (!team || l.teamId === null || l.teamId === team.id),
      );
      return ok(labels.map((l) => l.name));
    },
  );

  server.registerTool(
    'search_issues',
    {
      description:
        'Search issues by text (title/description) and optional filters. Returns up to `limit` matches.',
      inputSchema: {
        query: z.string().optional().describe('Free text; also matches identifiers like ENG-42'),
        teamKey: z.string().optional(),
        assignee: z.string().optional().describe('email, @handle, or name'),
        state: z.string().optional().describe('workflow state name'),
        priority: z.string().optional().describe('none/urgent/high/medium/low or 0-4'),
        limit: z.number().optional(),
      },
    },
    async ({ query, teamKey, assignee, state, priority, limit }) => {
      let issues = (await s.issues.all()).filter((i) => !i.archivedAt && canReadIssue(vis, i));
      if (teamKey) {
        const team = await resolveTeam(domain, teamKey, vis);
        issues = issues.filter((i) => i.teamId === team.id);
      }
      if (assignee) {
        const id = await resolveAssignee(domain, assignee);
        issues = issues.filter((i) => i.assigneeId === id);
      }
      const pr = parsePriority(priority);
      if (pr !== undefined) issues = issues.filter((i) => i.priority === pr);
      if (state) {
        const wanted = state.trim().toLowerCase();
        const stateIds = new Set(
          (await s.workflowStates.all())
            .filter((x) => x.name.toLowerCase() === wanted)
            .map((x) => x.id),
        );
        issues = issues.filter((i) => stateIds.has(i.stateId));
      }
      if (query) {
        const teams = await s.teams.all();
        const q = query.trim().toLowerCase();
        issues = issues.filter((i) => {
          const team = teams.find((t) => t.id === i.teamId);
          const ident = team ? `${team.key}-${i.number}`.toLowerCase() : '';
          return (
            ident.includes(q) ||
            i.title.toLowerCase().includes(q) ||
            i.description.toLowerCase().includes(q)
          );
        });
      }
      issues = issues
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, Math.min(limit ?? 25, 100));
      return ok(await Promise.all(issues.map((i) => serializeIssue(domain, i, { summary: true }))));
    },
  );

  server.registerTool(
    'get_issue',
    {
      description: 'Get one issue by identifier (e.g. ENG-42), with its comments.',
      inputSchema: { identifier: z.string() },
    },
    async ({ identifier }) => {
      const issue = await resolveIssue(domain, identifier, vis);
      const comments = (await s.comments.all())
        .filter((c) => c.issueId === issue.id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const users = await s.users.all();
      return ok({
        ...(await serializeIssue(domain, issue)),
        comments: comments.map((c) => ({
          author: users.find((u) => u.id === c.userId)?.displayName ?? 'unknown',
          body: c.body,
          createdAt: c.createdAt,
        })),
      });
    },
  );

  server.registerTool(
    'list_my_issues',
    { description: 'List issues assigned to the authenticated user.', inputSchema: {} },
    async () => {
      const mine = (await s.issues.all())
        .filter((i) => i.assigneeId === actor.id && !i.archivedAt && canReadIssue(vis, i))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return ok(await Promise.all(mine.map((i) => serializeIssue(domain, i, { summary: true }))));
    },
  );

  server.registerTool(
    'my_work',
    {
      description:
        'What needs your attention: issues assigned to you, where a comment @mentions you, that you filed (incl. via intake — to track responses), and that are waiting_on you (blocked pending your move). A pull-based alternative to a webhook.',
      inputSchema: {},
    },
    async () => {
      const visible = (await s.issues.all()).filter((i) => !i.archivedAt && canReadIssue(vis, i));
      const byUpdated = (a: Issue, b: Issue) => b.updatedAt.localeCompare(a.updatedAt);
      const assigned = visible.filter((i) => i.assigneeId === actor.id).sort(byUpdated);

      const handle = actor.displayName.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const mentionRe = new RegExp(`(^|[^\\w])@${handle}(?![\\w.-])`);
      const mentionedIds = new Set(
        (await s.comments.all())
          .filter((c) => mentionRe.test((c.body ?? '').toLowerCase()))
          .map((c) => c.issueId),
      );
      const mentioned = visible
        .filter((i) => mentionedIds.has(i.id) && i.assigneeId !== actor.id)
        .sort(byUpdated);
      const filed = visible
        .filter((i) => i.creatorId === actor.id && i.assigneeId !== actor.id)
        .sort(byUpdated);
      const waitingOnMe = visible.filter((i) => i.waitingOnId === actor.id).sort(byUpdated);

      const summarize = (arr: Issue[]) =>
        Promise.all(arr.map((i) => serializeIssue(domain, i, { summary: true })));
      return ok({
        assigned: await summarize(assigned),
        mentioned: await summarize(mentioned),
        filed: await summarize(filed),
        waiting_on_me: await summarize(waitingOnMe),
      });
    },
  );

  server.registerTool(
    'awaiting_me',
    {
      description:
        'What is blocked on YOU — the pull surface a decider or teammate opens: decisions to rule (proposed and routed to you, or proposals not yet routed to anyone) and issues explicitly waiting_on you. One call to see everything others expect from you.',
      inputSchema: {},
    },
    async () => {
      const [allDecisions, allIssues, teams] = await Promise.all([
        s.decisions.all(),
        s.issues.all(),
        s.teams.all(),
      ]);
      const keyOf = (teamId: string) => teams.find((t) => t.id === teamId)?.key ?? '?';
      const decisionsToRule = allDecisions
        .filter(
          (d) =>
            d.status === 'proposed' &&
            seesTeam(vis, d.teamId) &&
            (d.waitingOnId === actor.id || d.waitingOnId == null),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((d) => ({
          identifier: `${keyOf(d.teamId)}-D${d.number}`,
          title: d.title,
          routedToYou: d.waitingOnId === actor.id,
          url: `/decision/${d.id}`,
        }));
      const waitingOnMe = allIssues
        .filter((i) => i.waitingOnId === actor.id && !i.archivedAt && canReadIssue(vis, i))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return ok({
        decisions_to_rule: decisionsToRule,
        waiting_on_me: await Promise.all(
          waitingOnMe.map((i) => serializeIssue(domain, i, { summary: true })),
        ),
      });
    },
  );

  server.registerTool(
    'create_issue',
    {
      description:
        'Create an issue. Names (team key, state, assignee, labels) are resolved for you.',
      inputSchema: {
        teamKey: z.string(),
        title: z.string(),
        description: z.string().optional(),
        priority: z.string().optional(),
        assignee: z.string().optional(),
        state: z.string().optional(),
        labels: z.array(z.string()).optional(),
        project: z.string().optional().describe('Project name to file the issue into'),
      },
    },
    async ({ teamKey, title, description, priority, assignee, state, labels, project }) => {
      try {
        guardWrite();
        const team = await resolveTeam(domain, teamKey, vis);
        const issue = await domain.issues.create(actor.id, {
          teamId: team.id,
          title,
          description,
          priority: parsePriority(priority),
          assigneeId: await resolveAssignee(domain, assignee),
          stateId: await resolveState(domain, team.id, state),
          labelIds: await resolveLabels(domain, team.id, labels),
          projectId: await resolveProject(domain, project, vis),
        });
        return ok(await serializeIssue(domain, issue));
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    'update_issue',
    {
      description: 'Update an issue by identifier. Only provided fields change.',
      inputSchema: {
        identifier: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        state: z.string().optional(),
        priority: z.string().optional(),
        assignee: z.string().nullable().optional(),
        waiting_on: z
          .string()
          .nullable()
          .optional()
          .describe('Person/agent this issue is blocked on (email/@handle/name); null to clear'),
        project: z.string().optional().describe('Project name to move the issue into'),
      },
    },
    async ({ identifier, title, description, state, priority, assignee, waiting_on, project }) => {
      try {
        guardWrite();
        const issue = await resolveIssue(domain, identifier, vis);
        // Intake access is view-and-comment on your own filed issues, not edit.
        if (!seesTeam(vis, issue.teamId)) {
          throw new Error(
            `You can view ${identifier} but not edit it (intake access, not a member)`,
          );
        }
        const updated = await domain.issues.update(actor.id, issue.id, {
          title,
          description,
          stateId: await resolveState(domain, issue.teamId, state),
          priority: parsePriority(priority),
          assigneeId: await resolveAssignee(domain, assignee),
          waitingOnId: await resolveAssignee(domain, waiting_on),
          projectId: await resolveProject(domain, project, vis),
        });
        return ok(await serializeIssue(domain, updated));
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    'add_comment',
    {
      description: 'Add a comment to an issue. Supports markdown and @handle mentions.',
      inputSchema: { identifier: z.string(), body: z.string() },
    },
    async ({ identifier, body }) => {
      try {
        guardWrite();
        const issue = await resolveIssue(domain, identifier, vis);
        const comment = await domain.comments.create(actor.id, { issueId: issue.id, body });
        return ok({ ok: true, commentId: comment.id });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  // ---- ergonomic tools: resolve, and write in one motion ----

  server.registerTool(
    'find_issue',
    {
      description:
        'Fuzzy-resolve a description to matching issues — "the overlay clipping thing" → ranked hits — so you never leave the thread to look up a number. Ranks identifier/title over description.',
      inputSchema: {
        query: z.string().describe('Free text, or an identifier fragment like ENG-4'),
        limit: z.number().optional().describe('Max matches (default 5)'),
      },
    },
    async ({ query, limit }) => {
      const q = query.trim().toLowerCase();
      if (!q) return ok([]);
      const teams = await s.teams.all();
      const scored = (await s.issues.all())
        .filter((i) => !i.archivedAt && canReadIssue(vis, i))
        .map((i) => {
          const team = teams.find((t) => t.id === i.teamId);
          const ident = team ? `${team.key}-${i.number}`.toLowerCase() : '';
          const title = i.title.toLowerCase();
          // Rank: exact identifier > identifier prefix > title match > body match.
          let score = 0;
          if (ident === q) score = 100;
          else if (ident.startsWith(q)) score = 80;
          else if (title === q) score = 70;
          else if (title.includes(q)) score = 50 - Math.min(20, title.indexOf(q));
          else if (i.description.toLowerCase().includes(q)) score = 20;
          return { i, score };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || b.i.updatedAt.localeCompare(a.i.updatedAt))
        .slice(0, Math.min(limit ?? 5, 25));
      return ok(
        await Promise.all(scored.map((x) => serializeIssue(domain, x.i, { summary: true }))),
      );
    },
  );

  server.registerTool(
    'comment_and_state',
    {
      description:
        'The commonest update as one motion: comment on an issue and/or move its state, without a second lookup. Any field omitted is left unchanged.',
      inputSchema: {
        identifier: z.string(),
        body: z.string().optional().describe('A comment to add (markdown, @mentions)'),
        state: z.string().optional().describe('Workflow state name to move to'),
        waiting_on: z
          .string()
          .nullable()
          .optional()
          .describe('Set who it is blocked on (email/@handle/name); null to clear'),
      },
    },
    async ({ identifier, body, state, waiting_on }) => {
      try {
        guardWrite();
        const issue = await resolveIssue(domain, identifier, vis);
        const wantsEdit = state !== undefined || waiting_on !== undefined;
        if (!seesTeam(vis, issue.teamId) && wantsEdit) {
          throw new Error(`You can view ${identifier} but not edit it (intake access)`);
        }
        let commentId: string | undefined;
        if (body && body.trim()) {
          commentId = (await domain.comments.create(actor.id, { issueId: issue.id, body })).id;
        }
        let updated = issue;
        if (wantsEdit) {
          updated = await domain.issues.update(actor.id, issue.id, {
            stateId: await resolveState(domain, issue.teamId, state),
            waitingOnId: await resolveAssignee(domain, waiting_on),
          });
        }
        return ok({ ...(await serializeIssue(domain, updated, { summary: true })), commentId });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    'update_issues',
    {
      description:
        'Apply a state (and/or assignee) change to many issues in one call — the reconcile pass as a single motion. Each item is applied independently; failures are reported per-item.',
      inputSchema: {
        updates: z
          .array(
            z.object({
              identifier: z.string(),
              state: z.string().optional(),
              assignee: z.string().nullable().optional(),
              waiting_on: z.string().nullable().optional(),
            }),
          )
          .describe('One entry per issue to change'),
      },
    },
    async ({ updates }) => {
      guardWrite();
      const results = await Promise.all(
        updates.map(async (u) => {
          try {
            const issue = await resolveIssue(domain, u.identifier, vis);
            if (!seesTeam(vis, issue.teamId)) throw new Error('not a member of its team');
            await domain.issues.update(actor.id, issue.id, {
              stateId: await resolveState(domain, issue.teamId, u.state),
              assigneeId: await resolveAssignee(domain, u.assignee),
              waitingOnId: await resolveAssignee(domain, u.waiting_on),
            });
            return { identifier: u.identifier, ok: true };
          } catch (err) {
            return {
              identifier: u.identifier,
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        }),
      );
      return ok({ applied: results.filter((r) => r.ok).length, results });
    },
  );

  // ---- decisions: judgments as first-class records (member teams only) ----

  server.registerTool(
    'create_decision',
    {
      description:
        'Record a decision — a judgment, not a work item. Its body is the argument; it starts as `proposed`. Use for architecture rulings, tradeoffs, policy. Numbered per team as VAN-D12.',
      inputSchema: {
        teamKey: z.string(),
        title: z.string(),
        body: z.string().optional().describe('The argument (markdown, prose-first)'),
        governedIssues: z
          .array(z.string())
          .optional()
          .describe('Issue identifiers this decision governs (e.g. VAN-4)'),
        supersedes: z
          .string()
          .optional()
          .describe('A decision identifier this one replaces (e.g. VAN-D5)'),
        waiting_on: z
          .string()
          .optional()
          .describe('Route the proposal to a specific decider (email/@handle/name)'),
      },
    },
    async ({ teamKey, title, body, governedIssues, supersedes, waiting_on }) => {
      try {
        guardWrite();
        const team = await resolveTeam(domain, teamKey, vis, { requireMember: true });
        const governedIssueIds = await Promise.all(
          (governedIssues ?? []).map(async (id) => (await resolveIssue(domain, id, vis)).id),
        );
        const supersedesId = supersedes
          ? (await resolveDecision(domain, supersedes, vis)).id
          : undefined;
        const decision = await domain.decisions.create(actor.id, {
          teamId: team.id,
          title,
          body,
          governedIssueIds,
          supersedesId,
          waitingOnId: await resolveAssignee(domain, waiting_on),
        });
        return ok(await serializeDecision(domain, decision));
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    'list_decisions',
    {
      description: 'List a team’s decisions (optionally by status), newest first.',
      inputSchema: {
        teamKey: z.string(),
        status: z
          .enum(['proposed', 'ruled', 'superseded', 'carried'])
          .optional()
          .describe('Filter by lifecycle status'),
      },
    },
    async ({ teamKey, status }) => {
      try {
        const team = await resolveTeam(domain, teamKey, vis, { requireMember: true });
        const rows = (await domain.ctx.storage.decisions.all())
          .filter((d) => d.teamId === team.id && (!status || d.status === status))
          .sort((a, b) => b.number - a.number);
        return ok(
          await Promise.all(rows.map((d) => serializeDecision(domain, d, { summary: true }))),
        );
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    'get_decision',
    {
      description: 'Get one decision by identifier (e.g. VAN-D12), with its full argument.',
      inputSchema: { identifier: z.string() },
    },
    async ({ identifier }) => {
      try {
        const decision = await resolveDecision(domain, identifier, vis);
        const comments = (await domain.ctx.storage.decisionComments.all())
          .filter((c) => c.decisionId === decision.id)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        const users = await domain.ctx.storage.users.all();
        return ok({
          ...(await serializeDecision(domain, decision)),
          comments: comments.map((c) => ({
            author: users.find((u) => u.id === c.userId)?.displayName ?? null,
            body: c.body,
            createdAt: c.createdAt,
          })),
        });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    'rule_decision',
    {
      description:
        'Rule on a proposed decision — mark it decided, credited to you, optionally with a note that lands as a comment. This is how a decider answers a proposal.',
      inputSchema: { identifier: z.string(), note: z.string().optional() },
    },
    async ({ identifier, note }) => {
      try {
        guardWrite();
        const decision = await resolveDecision(domain, identifier, vis);
        const ruled = await domain.decisions.rule(actor.id, decision.id, note);
        return ok(await serializeDecision(domain, ruled));
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    'supersede_decision',
    {
      description:
        'Record that one decision replaces another: `identifier` supersedes `supersedes` (which is flipped to superseded). Supersession is a first-class edge — never leave it implicit.',
      inputSchema: {
        identifier: z.string().describe('The newer decision (e.g. VAN-D20)'),
        supersedes: z.string().describe('The decision it replaces (e.g. VAN-D5)'),
      },
    },
    async ({ identifier, supersedes }) => {
      try {
        guardWrite();
        const decision = await resolveDecision(domain, identifier, vis);
        const target = await resolveDecision(domain, supersedes, vis);
        const updated = await domain.decisions.setSupersedes(actor.id, decision.id, target.id);
        return ok(await serializeDecision(domain, updated));
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    'comment_decision',
    {
      description: 'Comment on a decision — e.g. to answer a proposal or add context.',
      inputSchema: { identifier: z.string(), body: z.string() },
    },
    async ({ identifier, body }) => {
      try {
        guardWrite();
        const decision = await resolveDecision(domain, identifier, vis);
        const comment = await domain.decisions.comment(actor.id, {
          decisionId: decision.id,
          body,
        });
        return ok({ ok: true, commentId: comment.id });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    'sync_commits',
    {
      description:
        'Reconcile a batch of git commits against issues in one call — the update rides the commit. Parses each message for `Closes/Fixes/Refs TEAM-N`: a reference adds a comment linking the commit; a close is PROPOSED (a comment, not a state change — "a state means someone judged it done"), returned in `proposedCloses` for you to confirm with update_issues. Idempotent per (issue, commit).',
      inputSchema: {
        commits: z
          .array(
            z.object({
              sha: z.string(),
              message: z.string(),
              date: z.string().optional(),
            }),
          )
          .describe('The commits to reconcile (sha, message, optional ISO date)'),
        repoUrl: z
          .string()
          .optional()
          .describe('Base repo URL for commit links, e.g. https://github.com/org/repo'),
      },
    },
    async ({ commits, repoUrl }) => {
      try {
        guardWrite();
        const commented: string[] = [];
        const proposedCloses = new Set<string>();
        const skipped: string[] = [];
        const existing = await domain.ctx.storage.comments.all();

        for (const commit of commits) {
          const shortSha = commit.sha.slice(0, 10);
          const subject = commit.message.split('\n')[0]!.trim();
          const link = repoUrl
            ? ` ([\`${shortSha}\`](${repoUrl.replace(/\/$/, '')}/commit/${commit.sha}))`
            : ` \`${shortSha}\``;
          // Identifiers preceded by a closing keyword vs. bare references.
          const closeIds = new Set(
            [
              ...commit.message.matchAll(
                /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#?([a-z]+-\d+)\b/gi,
              ),
            ].map((m) => m[1]!.toUpperCase()),
          );
          const allIds = new Set(
            [...commit.message.matchAll(/#?([a-z]+-\d+)\b/gi)].map((m) => m[1]!.toUpperCase()),
          );
          for (const ident of allIds) {
            let issue;
            try {
              issue = await resolveIssue(domain, ident, vis);
            } catch {
              continue; // unknown or not visible — skip quietly
            }
            if (!seesTeam(vis, issue.teamId)) continue; // member-write only
            // Idempotent: skip if we've already noted this commit on this issue.
            if (existing.some((c) => c.issueId === issue.id && c.body.includes(shortSha))) {
              skipped.push(`${ident}@${shortSha}`);
              continue;
            }
            const closing = closeIds.has(ident);
            const body = closing
              ? `Commit${link} proposes closing this — ${subject}`
              : `Referenced in commit${link} — ${subject}`;
            await domain.comments.create(actor.id, { issueId: issue.id, body });
            commented.push(`${ident}@${shortSha}`);
            if (closing) proposedCloses.add(ident);
          }
        }
        return ok({
          commented: commented.length,
          proposedCloses: [...proposedCloses],
          skipped: skipped.length,
          hint: proposedCloses.size
            ? 'Confirm the closes with update_issues (set state), or leave them if not actually done.'
            : undefined,
        });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    'reconcile_summary',
    {
      description:
        'A board-truth summary for a team — a pull diagnostic, not an alarm: how many issues are open, how many are stale (untouched N+ days by any activity), and how many are in progress waiting on nobody (the board-review finding, mechanized). Drops into a status report.',
      inputSchema: {
        teamKey: z.string(),
        staleDays: z.number().optional().describe('Staleness threshold in days (default 5)'),
      },
    },
    async ({ teamKey, staleDays }) => {
      try {
        const team = await resolveTeam(domain, teamKey, vis, { requireMember: true });
        const [issues, states, comments] = await Promise.all([
          domain.ctx.storage.issues.byTeam(team.id),
          domain.ctx.storage.workflowStates.all(),
          domain.ctx.storage.comments.all(),
        ]);
        const catOf = (stateId: string) => states.find((s) => s.id === stateId)?.category;
        const open = issues.filter((i) => {
          if (i.archivedAt) return false;
          const c = catOf(i.stateId);
          return c !== 'completed' && c !== 'canceled';
        });
        const threshold = (staleDays ?? 5) * 86400000;
        const now = Date.now();
        const lastActivity = (issueId: string, updatedAt: string) => {
          let latest = Date.parse(updatedAt);
          for (const c of comments) {
            if (c.issueId === issueId) latest = Math.max(latest, Date.parse(c.createdAt));
          }
          return latest;
        };
        const stale = open.filter((i) => now - lastActivity(i.id, i.updatedAt) > threshold);
        const waitingNobody = open.filter((i) => !i.waitingOnId && catOf(i.stateId) === 'started');
        const days = staleDays ?? 5;
        return ok({
          team: team.key,
          open: open.length,
          untouched: stale.length,
          untouchedDays: days,
          waitingNobody: waitingNobody.length,
          summary: `${open.length} open · ${stale.length} untouched ${days}+ days · ${waitingNobody.length} in progress waiting on nobody`,
          stalest: stale
            .sort((a, b) => lastActivity(a.id, a.updatedAt) - lastActivity(b.id, b.updatedAt))
            .slice(0, 10)
            .map((i) => `${team.key}-${i.number}`),
        });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    'create_project',
    {
      description: 'Create a project spanning one or more teams (by key).',
      inputSchema: {
        name: z.string(),
        description: z.string().optional(),
        teamKeys: z.array(z.string()).min(1),
      },
    },
    async ({ name, description, teamKeys }) => {
      try {
        guardWrite();
        const teamIds = [];
        for (const key of teamKeys) {
          teamIds.push((await resolveTeam(domain, key, vis, { requireMember: true })).id);
        }
        const project = await domain.projects.create({ name, description, teamIds });
        return ok({ id: project.id, name: project.name });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  // ---- team configuration (members of the team may shape its workflow) ----

  server.registerTool(
    'create_label',
    {
      description: 'Create a label on a team you belong to (e.g. "area: rendering", "type: bug").',
      inputSchema: {
        teamKey: z.string(),
        name: z.string(),
        color: z
          .string()
          .optional()
          .describe('Hex like #4c9. Defaults to one derived from the name.'),
      },
    },
    async ({ teamKey, name, color }) => {
      try {
        guardWrite();
        const team = await resolveTeam(domain, teamKey, vis, { requireMember: true });
        const label = await domain.labels.create({
          teamId: team.id,
          name,
          color: color ?? colorFor(name),
        });
        return ok({ id: label.id, name: label.name, color: label.color });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    'create_workflow_state',
    {
      description:
        'Add a workflow state to a team you belong to. category is one of: ' +
        STATE_CATEGORIES.join(', ') +
        ' (e.g. category "triage" for a state where consumer-filed issues land).',
      inputSchema: {
        teamKey: z.string(),
        name: z.string(),
        category: z.string(),
        color: z.string().optional(),
      },
    },
    async ({ teamKey, name, category, color }) => {
      try {
        guardWrite();
        if (!STATE_CATEGORIES.includes(category as StateCategory)) {
          throw new Error(`category must be one of: ${STATE_CATEGORIES.join(', ')}`);
        }
        const team = await resolveTeam(domain, teamKey, vis, { requireMember: true });
        const state = await domain.teams.createState({
          teamId: team.id,
          name,
          color: color ?? colorFor(name),
          category: category as StateCategory,
        });
        return ok({ id: state.id, name: state.name, category: state.category });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    'create_issue_template',
    {
      description:
        'Create an issue template on a team you belong to — a reusable skeleton (e.g. a bug-report form) that pre-fills new issues.',
      inputSchema: {
        teamKey: z.string(),
        name: z.string(),
        description: z.string().optional().describe('Markdown body the template pre-fills.'),
        titlePrefix: z.string().optional(),
        priority: z.string().optional(),
        labels: z.array(z.string()).optional(),
      },
    },
    async ({ teamKey, name, description, titlePrefix, priority, labels }) => {
      try {
        guardWrite();
        const team = await resolveTeam(domain, teamKey, vis, { requireMember: true });
        const template = await domain.templates.create({
          teamId: team.id,
          name,
          description,
          titlePrefix,
          priority: parsePriority(priority),
          labelIds: await resolveLabels(domain, team.id, labels),
        });
        return ok({ id: template.id, name: template.name });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  return server;
}

export function registerMcp(
  app: FastifyInstance,
  domain: Domain,
  authenticate: (bearer: string) => Promise<{ user: User; scope: TokenScope } | null>,
): void {
  const handle = async (
    req: import('fastify').FastifyRequest,
    reply: import('fastify').FastifyReply,
  ) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      reply.header('WWW-Authenticate', 'Bearer');
      return reply.status(401).send({
        error: {
          code: 'unauthorized',
          message: 'Provide a personal API token as a Bearer credential',
        },
      });
    }
    const resolved = await authenticate(auth.slice(7).trim());
    if (!resolved) {
      return reply
        .status(401)
        .send({ error: { code: 'unauthorized', message: 'Invalid API token' } });
    }
    const vis = applyScope(
      await visibilityFor(domain.ctx, resolved.user.id),
      resolved.scope.teamIds,
    );

    // An agent presenting X-Agent-ID acts as a named persona under itself, so
    // authored work is attributed to that name. Authorization stays on the token.
    const rawAgentId = req.headers['x-agent-id'];
    const agentId = Array.isArray(rawAgentId) ? rawAgentId[0] : rawAgentId;
    const actor =
      agentId && resolved.user.isAgent
        ? await domain.auth.findOrProvisionAgentPersona(resolved.user, agentId)
        : resolved.user;

    // Stateless: one server + transport per request, torn down on close.
    const server = buildServer(domain, resolved.user, vis, resolved.scope, actor);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    reply.raw.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    reply.hijack();
    await transport.handleRequest(req.raw, reply.raw, req.body);
  };

  app.post('/mcp', handle);
  // GET/DELETE are part of the Streamable HTTP spec (SSE stream / session end).
  app.get('/mcp', handle);
  app.delete('/mcp', handle);
}
