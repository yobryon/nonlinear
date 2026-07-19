# The agent platform

This document explains how software agents use nonlinear, and why the platform
is shaped the way it is. The one-line pitch: **an agent should be able to use
nonlinear the same way it uses Linear.** That is the design goal that drove
every decision here, so it is worth stating what "the same way" actually means
before we get into mechanics.

## Why agents at all, and what we copied from Linear

When we surveyed how people actually wire agents into Linear (the same July-2026
survey that produced `ROADMAP.md`), two patterns dominated:

1. **MCP is the default connection.** Linear ships a hosted MCP server, and the
   overwhelmingly common way to give an agent Linear access is to point an MCP
   client (Claude Code, Cursor, VS Code, a custom loop) at that server with a
   token. The agent then has a tool per operation — search issues, create an
   issue, comment — and the model decides when to call them. MCP won because it
   turns "integrate with Linear" into "add one server to a config file."

2. **Agents are becoming teammates, not just scripts.** Linear's 2025–26
   direction is _assignable agents_: an agent is a member of the workspace you
   can assign an issue to or @mention, and Linear surfaces an "agent session"
   around that interaction. The agent isn't a background cron job you poll — it
   is addressed the way you address a human coworker, and the assignment/mention
   is the trigger that wakes it up.

nonlinear deliberately mirrors both. Rather than invent a bespoke agent API, we
reproduced Linear's **three surfaces** so that an agent built against Linear
needs the smallest possible diff to work here:

- **The MCP server** (`/mcp`) — the tool layer, for any MCP client.
- **The REST API + personal tokens** — the same operations for custom code.
- **Agent-as-teammate** — agent _users_ you assign and @mention, plus a scoped
  webhook that is the trigger half of the loop.

All three share one authentication mechanism (personal API tokens) and one
domain (the same `Domain` the web app drives). The rest of this document walks
each surface and the reasoning behind its construction, then closes with the
honest limitations.

`ROADMAP.md` lists all of this under **Agents (shipped)**; it is the direct
answer to "can an agent use nonlinear the way it uses Linear." A runnable
reference lives in `examples/agent/`.

---

## Surface 1 — the HTTP MCP server at `/mcp`

`apps/api/src/mcp.ts` implements a Model Context Protocol server over
**Streamable HTTP**, using `@modelcontextprotocol/sdk`. An MCP client adds it in
one line:

```bash
claude mcp add --transport http nonlinear http://localhost:8080/mcp \
  --header "Authorization: Bearer nl_your_token"
```

### The tools are name-resolving, not id-passing

There are **13 tools**, registered in `buildServer()`: `whoami`, `list_teams`,
`list_users`, `list_projects`, `list_workflow_states`, `list_labels`,
`search_issues`, `get_issue`, `list_my_issues`, `create_issue`, `update_issue`,
`add_comment`, and `create_project`.

The single most important design choice in this file is that **tools speak in
human names, never internal ids.** A model calling `create_issue` passes
`teamKey: "ENG"`, `assignee: "@ada"`, `state: "Todo"`, `labels: ["bug"]` —
strings a human would type — and the server resolves each to an id internally.
The `resolveTeam`, `resolveIssue`, `resolveAssignee`, `resolveState`, and
`resolveLabels` helpers do this lookup, and they are forgiving: `resolveAssignee`
matches on email, `displayName`, or `name`, case-insensitively;
`parsePriority` accepts `"urgent"` or `"high"` or the raw `0-4` integer; issues
are addressed by their `ENG-42` identifier, which `resolveIssue` splits on the
last dash.

Why this way? Because the alternative — exposing UUIDs — is a bad fit for a
language model. A model reasons fluently about "the ENG team" and "assign it to
Ada" but has no way to know an opaque id without a prior lookup call, and every
extra round trip is latency and a chance to hallucinate. By resolving names at
the boundary we let the model call `create_issue` in a single shot from natural
context, and we return an equally name-shaped result: `serializeIssue` presents
`identifier`, `state` name, `priority` label, `assignee` display name, and label
names — never the ids the storage layer actually holds. The cost is that
ambiguous names throw (`Unknown assignee "…"`), which we accept as an explicit,
recoverable error rather than silent misbehavior; tool wrappers like
`create_issue`/`update_issue` catch these and return them via the `fail()`
helper as `isError` content so the model sees the message and can retry.

The tool set is deliberately a **curated subset** of the full domain, not a
mechanical mirror of every REST route. It covers the operations an agent
realistically needs — read the board, find and read an issue, file one, move it,
comment — and stops there. We would rather ship a tight, well-described toolbox
than 60 auto-generated tools that bloat the model's context and invite misuse.

### The architectural decision: mount MCP in-process, not as its own container

This is the decision worth dwelling on, because it went against the obvious
"microservice" instinct. The MCP server is **not** a separate container or
process. `registerMcp(app, domain, authenticate)` (bottom of `mcp.ts`) mounts
three routes — `POST/GET/DELETE /mcp` — directly onto the same Fastify instance
that serves REST, and it is wired up in `apps/api/src/server.ts` with a single
line:

```ts
registerMcp(app, domain, (bearer) => domain.tokens.authenticate(bearer));
```

The MCP server is, in the words of the file header, _"a protocol adapter over
the same `Domain` the REST routes use."_ Its tools call `domain.issues.create`,
`domain.comments.create`, `domain.projects.create` — the identical service
methods the REST handlers call. `docker-compose.yml` therefore has exactly three
services: `postgres`, `api`, `web`. There is no `mcp` service.

**The alternatives we rejected:**

- _A standalone MCP server talking to the API over HTTP._ This is how you would
  build it if MCP were a third-party integration. But it would mean a second
  deployable, a second network hop on every tool call, a second place to
  configure auth and secrets, and — most corrosively — a second implementation
  of business rules or a thin proxy that re-serializes everything the REST layer
  already serializes. Every domain invariant (issue numbering, triage-rule
  application, notification fan-out, cascade deletes) would either be duplicated
  or reached only through HTTP, adding failure modes for no benefit.

- _A stdio MCP server bundled with the agent._ Fine for a single-user desktop
  tool, but nonlinear is a self-hosted _server_. The agent may run anywhere; the
  natural boundary is a URL, not a subprocess on the API host.

Mounting in-process makes MCP a **thin protocol adapter** in exactly the sense
the codebase already uses that word: the REST routes are adapters over the
domain, the WebSocket hub is an adapter over the sync bus, and now MCP is an
adapter over the domain too. All three share one composition root
(`createDomain`), one storage layer, one set of business rules. This is the
same reasoning that keeps `packages/core` free of any HTTP or database driver:
put the rules in one place, and let each surface be a skin over them. It also
honors the project's hard constraints — _one small API process_, _low cost /
low resource_ (CLAUDE.md §4): a whole agent surface that costs zero additional
containers.

The one genuine cost is coupling: the MCP server can only run where the API
runs, and it shares the API's process and memory. For a self-hosted product
optimized for a single small deploy, that is precisely the trade we want.

### Stateless by design

Each request builds a fresh `McpServer` and `StreamableHTTPServerTransport`
(with `sessionIdGenerator: undefined`) and tears both down on connection close.
There is no server-side session bookkeeping — the Bearer token _is_ the session,
resolved to a `User` on every request, and every tool closes over that user so
its actions are correctly attributed. This keeps the server trivially
horizontally-safe and matches the stateless nature of the underlying auth. The
comment in the code is blunt about it: _"Stateless: one server + transport per
request, torn down on close."_

---

## Surface 2 — REST + personal API tokens

Not every agent speaks MCP. A shell script, a CI job, a webhook handler, or a
model framework without MCP support should be able to drive nonlinear too, and
for those the REST API is available under the **same credential**.

### Dual authentication

`apps/api/src/server.ts` authenticates a request one of two ways, in
`resolveUser`:

```ts
async function resolveUser(req): Promise<User | null> {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    return domain.tokens.authenticate(auth.slice(7).trim());
  }
  const cookie = req.cookies[SESSION_COOKIE];
  return cookie ? domain.auth.authenticate(cookie) : null;
}
```

`requireUser` (the `preHandler` behind the `authed` route option, and the guard
on `/api/ws`) calls this and attaches `req.user`. The key property is that
**every REST route is agent-reachable for free**: the browser and the agent hit
the identical handlers with the identical permissions, differing only in how
they present identity — a `nl_session` cookie versus an `Authorization: Bearer`
header. We did not build a parallel "API surface"; we widened the existing one's
front door. That is why the reference agent in `examples/agent/agent.mjs` can
`POST /api/comments` and `PATCH /api/issues/:id` with nothing but its token.

### How tokens work

`packages/core/src/services/tokens.ts` (`TokenService`) implements personal API
tokens, and the design mirrors how sessions are stored:

- A token is a high-entropy random string prefixed `nl_` (`create`). The **raw
  value is returned exactly once** at creation and never again — only its
  `sha256` hash is persisted (`hashToken`). Lookup is therefore a single hash
  comparison, and a database leak does not expose usable tokens.
- `authenticate(raw)` fast-rejects anything without the `nl_` prefix, hashes the
  input, fetches by hash (`getByHash`), does an explicit `timingSafeEqual`
  confirm, rejects expired tokens (`expiresAt`) and inactive users, then
  `touchLastUsed` for an audit trail — returning the `User` or `null`.
- Tokens are **non-synced bearer secrets** (like sessions): they never travel
  over the delta-sync bus to clients. A `prefix` (`nl_` + 6 chars) is stored for
  display so a user can tell tokens apart in the UI without ever seeing the full
  secret again.

Humans mint their own tokens in **Profile → API tokens** (`POST /api/tokens`).
The interesting case is agents, who _cannot_ mint their own — which is exactly
what the third surface is about.

---

## Surface 3 — agent-as-teammate

The first two surfaces let an agent _act_. This surface lets you _address_ an
agent — assign it work, @mention it — and have it _wake up_. It is what turns a
script into a teammate, and it is the closest analog to Linear's assignable
agents.

### Agent users

`AuthService.createAgent` (`packages/core/src/services/auth.ts`) creates a
`User` with `isAgent: true`. An agent user differs from a human in three
deliberate ways:

- **No password hash.** It is inserted without one, so `domain.auth.authenticate`
  (cookie login) can never succeed for it. _"Insert without a password hash so
  login is impossible."_ An agent exists only to be assigned and mentioned; it
  should never hold a browser session.
- **A synthetic, non-login email** in a reserved domain
  (`<handle>@agents.nonlinear.local`), so it can't collide with or impersonate a
  real address.
- Otherwise it is an ordinary member: `role: 'member'`, it joins every
  non-private team (via `TeamService.addMember`), and it shows up in
  `list_users` / member pickers with an `isAgent` flag so humans can tell it
  apart. Because it is a real `User`, _everything that works for people works for
  agents_ — it can be an assignee, a subscriber, a comment author, an @mention
  target — with no special-casing in the issue or comment services.

The `isAgent` field is a first-class part of the entity contract
(`packages/shared/src/entities.ts`), and migration `004_api_tokens_agents.sql`
backfills existing users to `isAgent: false`.

### Admin-minted tokens

Since an agent can't log in, it also can't visit Profile → API tokens to mint
its own credential. So an **admin mints it on the agent's behalf.** The two
routes in `server.ts` are both admin-gated:

- `POST /api/agents` → `domain.auth.createAgent` (403 unless `req.user.role ===
'admin'`).
- `POST /api/agents/:id/tokens` → verifies the target `isAgent` and calls
  `domain.tokens.create(agentId, …)`, returning the raw secret once.

This keeps a clean privilege boundary: creating a non-human identity and issuing
it a credential is an administrative act, not something any member can do. The
admin hands the resulting `nl_…` secret to the agent process, and from then on
the agent authenticates like any other token holder.

### Agent-scoped webhooks: the trigger

A webhook (`packages/core/src/services/webhooks.ts`) is nonlinear's outbound
event mechanism — it subscribes to the sync bus and forwards `issue`, `comment`,
and `project` deltas (`FORWARDED_MODELS`) to a URL. What makes it an _agent_
trigger is the optional `agentUserId` field on the `Webhook` entity.

A plain webhook (`agentUserId: null`) forwards **every** issue/comment/project
event — the classic "notify my integration of all changes" firehose. But a
webhook created with an `agentUserId` is **scoped**: it fires _only_ on events
that are about that agent. `scopeDeltas` filters each batch through the private
predicate `involvesAgent`, which encodes exactly the two ways you address a
teammate:

```ts
// issue delta: assigned to the agent (or the agent is a subscriber)
return issue.assigneeId === agentId || (issue.subscriberIds ?? []).includes(agentId);

// comment delta: the body @mentions the agent's handle
return new RegExp(`(^|[^\\w])@${handle}(?![\\w.-])`).test(body);
```

That is the whole trigger contract: **assignment (or subscription) and
@mention.** A scoped agent never sees the firehose — it is woken only when
someone points work at it, which is both a huge noise reduction and a natural
security boundary (the agent's endpoint learns about issues it's involved in,
not the entire workspace). The `@handle` regex is careful about word boundaries
so `@fixer.bot` matches but `@fixer.bottom` does not.

### The assign/mention → webhook → act loop

Putting the pieces together, here is the full lifecycle, which is the heart of
the platform:

1. A human (or another agent) **assigns an issue to the agent user** or
   **@mentions its handle** in a comment.
2. That mutation appends a delta to the sync log and publishes it on the bus —
   the same delta the web app receives for real-time sync. Nothing agent-specific
   happens at write time.
3. The webhook dispatcher (`startDispatcher`, subscribed to the bus) sees the
   delta, and for each enabled webhook calls `scopeDeltas`. The agent-scoped
   webhook keeps the delta only if `involvesAgent` is true; all others drop it.
4. It `POST`s `{ type: 'sync.deltas', deltas: [...] }` to the agent's URL with an
   `x-nonlinear-secret` header for verification.
5. The agent process **acts back through surface 1 or 2** — MCP tools or the
   REST API — using its personal token: it comments, moves the issue, whatever
   its model decides.

`examples/agent/agent.mjs` is a runnable, end-to-end reference of exactly this.
It stands up a tiny HTTP server, verifies the secret, **acknowledges within the
5-second webhook timeout and then processes asynchronously** (important — see
limitations), re-derives whether each delta is an assignment or a mention
(mirroring `involvesAgent` on the client side as a belt-and-suspenders check),
and calls `POST /api/comments` to reply. Its `handle()` body is a canned
"On it — I picked this up automatically"; the README's whole point is _"Swap the
`handle()` body for a real model call — the rest is just the teammate
plumbing."_ That plumbing — token auth, scoped webhook, ack-then-work — is the
reusable substrate; the intelligence is yours to drop in.

Note the loop is intentionally symmetric with Linear's agent-session model:
address the agent like a coworker, it wakes, it works in the same issue thread.
We did not build a separate "agent session" object; the issue and its comment
thread _are_ the session, which keeps the data model small and means agent work
is visible in exactly the same place as human work.

---

## Honest limitations

The agent platform is real and shipped, but it is deliberately minimal in a few
places. A new teammate should know where the edges are:

- **No OAuth / Dynamic Client Registration for MCP.** Auth is a static personal
  API token in the `Authorization` header. This is fine for self-hosting (you
  mint a token and paste it into your MCP client) but it is _not_ the
  browser-based OAuth-with-DCR flow that hosted MCP providers use to onboard
  third-party clients without a pre-shared secret. If nonlinear ever became a
  multi-tenant hosted service, this is the gap to close first. The 401 response
  already sets `WWW-Authenticate: Bearer`, which is the seam an OAuth flow would
  extend.

- **No GraphQL.** Linear's public API is GraphQL, so an agent written against
  Linear's _API_ (rather than its MCP server) will not port without rewriting
  its queries against our REST routes. REST + personal tokens are shipped;
  GraphQL sits at the top of **P3** in `ROADMAP.md` and would be added if demand
  warrants. In practice the MCP surface absorbs most of this, since MCP-based
  agents don't touch the raw API shape.

- **Webhooks are fire-and-forget.** `dispatch` POSTs with a 5-second
  `AbortController` timeout, logs failures, and moves on — _there is no retry
  queue and no delivery guarantee_ (CLAUDE.md "Known gaps"). If the agent's
  endpoint is down or slow when an issue is assigned, that trigger is simply
  lost. This is why the reference agent acks the HTTP request _before_ doing any
  work: a slow model call must not blow the timeout. For a low-cost self-hosted
  clone this is an acceptable trade, but a production agent should treat missed
  triggers as possible and reconcile — e.g. periodically poll `list_my_issues` —
  rather than assume every assignment produced a webhook.

- **No rate limiting on the token-authed surface.** Same as the rest of the API
  (CLAUDE.md §"Known gaps"): put HTTPS and a proxy in front for production.

None of these are architectural dead-ends — each has an identified seam
(`WWW-Authenticate` for OAuth, the REST-over-domain pattern for a future
GraphQL adapter, the bus subscription for a retrying dispatcher). They are
scope choices consistent with the project's north star: clone Linear's _agent
experience_ as closely as practical, at the cost and footprint of a single small
self-hosted process.
