import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { applyScope, seesTeam, visibilityFor, type Domain, type Visibility } from '@nonlinear/core';
import type { Issue, Priority, TokenScope, User } from '@nonlinear/shared';
import { PRIORITY_LABELS } from '@nonlinear/shared';

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

const MCP_INSTRUCTIONS = `You are connected to nonlinear (a self-hostable Linear clone) over MCP, authenticated as one specific user. Call the \`whoami\` tool FIRST to confirm who you are (name, isAgent, role) and your workspace — every write is attributed to you, and you only see the teams you belong to.

If this is your first time, read the guide resources (list them with resources/list, then resources/read):
- nonlinear://guides/for-consumer-agents — you USE a tool another team provides and want to file & track bugs/requests.
- nonlinear://guides/for-provider-agents — you OWN a tool/component and run its project + support its users here.
- nonlinear://guides/readme — overview and the team-scoped access model.

Quick loop: whoami → list_teams → search_issues (always search before filing to avoid duplicates) → create_issue / add_comment / update_issue. Names are resolved for you: team by key (e.g. ENG), state/label by name, assignee by email/@handle/name. Priority is 0 none, 1 urgent, 2 high, 3 medium, 4 low — set it honestly. A read-only or team-scoped token limits what you can do; tools will tell you.`;

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

async function resolveTeam(domain: Domain, teamKey: string, vis: Visibility) {
  const team = (await domain.ctx.storage.teams.all()).find(
    (t) => t.key.toUpperCase() === teamKey.toUpperCase(),
  );
  // A team the credential can't see is reported as unknown (don't leak existence).
  if (!team || !seesTeam(vis, team.id)) throw new Error(`Unknown team "${teamKey}"`);
  return team;
}

async function resolveIssue(domain: Domain, identifier: string, vis: Visibility): Promise<Issue> {
  const dash = identifier.lastIndexOf('-');
  if (dash < 1) throw new Error(`Bad issue identifier "${identifier}" (expected e.g. ENG-42)`);
  const key = identifier.slice(0, dash).toUpperCase();
  const number = Number(identifier.slice(dash + 1));
  const team = (await domain.ctx.storage.teams.all()).find((t) => t.key.toUpperCase() === key);
  if (!team || !seesTeam(vis, team.id)) throw new Error(`Issue ${identifier} not found`);
  const issue = (await domain.ctx.storage.issues.byTeam(team.id)).find((i) => i.number === number);
  if (!issue) throw new Error(`Issue ${identifier} not found`);
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

/** Present an issue in an agent-friendly shape (names, not ids). */
async function serializeIssue(domain: Domain, issue: Issue) {
  const s = domain.ctx.storage;
  const [team, state, assignee, labels] = await Promise.all([
    s.teams.get(issue.teamId),
    s.workflowStates.get(issue.stateId),
    issue.assigneeId ? s.users.get(issue.assigneeId) : Promise.resolve(null),
    s.labels.all(),
  ]);
  return {
    identifier: team ? `${team.key}-${issue.number}` : issue.id,
    title: issue.title,
    description: issue.description,
    state: state?.name ?? null,
    priority: PRIORITY_LABELS[issue.priority],
    assignee: assignee?.displayName ?? null,
    labels: issue.labelIds.map((id) => labels.find((l) => l.id === id)?.name).filter(Boolean),
    project: issue.projectId,
    dueDate: issue.dueDate,
    estimate: issue.estimate,
    url: `/issue/${team ? `${team.key}-${issue.number}` : issue.id}`,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
  };
}

const ok = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});
const fail = (message: string) => ({
  content: [{ type: 'text' as const, text: message }],
  isError: true,
});

/** Build a per-request MCP server whose tools act as `user`. */
function buildServer(domain: Domain, user: User, vis: Visibility, readOnly: boolean): McpServer {
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
    if (readOnly) throw new Error('This API token is read-only');
  };
  const projectVisible = (teamIds: string[]) => vis.seesAll || teamIds.some((t) => seesTeam(vis, t));

  server.registerTool(
    'whoami',
    { description: 'Return the authenticated user and workspace.', inputSchema: {} },
    async () => {
      const workspace = (await s.workspaces.all())[0];
      return ok({
        user: {
          name: user.name,
          displayName: user.displayName,
          isAgent: user.isAgent,
          role: user.role,
        },
        workspace: workspace?.name,
      });
    },
  );

  server.registerTool(
    'list_teams',
    { description: 'List all teams with their keys.', inputSchema: {} },
    async () =>
      ok(
        (await s.teams.all())
          .filter((t) => seesTeam(vis, t.id))
          .map((t) => ({ key: t.key, name: t.name })),
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
      let issues = (await s.issues.all()).filter((i) => !i.archivedAt && seesTeam(vis, i.teamId));
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
      return ok(await Promise.all(issues.map((i) => serializeIssue(domain, i))));
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
        .filter((i) => i.assigneeId === user.id && !i.archivedAt && seesTeam(vis, i.teamId))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return ok(await Promise.all(mine.map((i) => serializeIssue(domain, i))));
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
      },
    },
    async ({ teamKey, title, description, priority, assignee, state, labels }) => {
      try {
        guardWrite();
        const team = await resolveTeam(domain, teamKey, vis);
        const issue = await domain.issues.create(user.id, {
          teamId: team.id,
          title,
          description,
          priority: parsePriority(priority),
          assigneeId: await resolveAssignee(domain, assignee),
          stateId: await resolveState(domain, team.id, state),
          labelIds: await resolveLabels(domain, team.id, labels),
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
      },
    },
    async ({ identifier, title, description, state, priority, assignee }) => {
      try {
        guardWrite();
        const issue = await resolveIssue(domain, identifier, vis);
        const updated = await domain.issues.update(user.id, issue.id, {
          title,
          description,
          stateId: await resolveState(domain, issue.teamId, state),
          priority: parsePriority(priority),
          assigneeId: await resolveAssignee(domain, assignee),
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
        const comment = await domain.comments.create(user.id, { issueId: issue.id, body });
        return ok({ ok: true, commentId: comment.id });
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
        for (const key of teamKeys) teamIds.push((await resolveTeam(domain, key, vis)).id);
        const project = await domain.projects.create({ name, description, teamIds });
        return ok({ id: project.id, name: project.name });
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

    // Stateless: one server + transport per request, torn down on close.
    const server = buildServer(domain, resolved.user, vis, resolved.scope.readOnly);
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
