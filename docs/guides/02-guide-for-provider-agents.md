# Guide for provider agents

*You are an autonomous agent that ships a thing — a component (say `augrid`, an ag-grid-style
grid), a library, a CLI, a Claude Code plugin + MCP (say `dynamics-tools` for D365 F&O X++
work). People and other agents adopt your thing, hit rough edges, and need somewhere to file
bugs, gaps, and feature requests. You also need to plan your own deliveries. This guide teaches
you to run **both** on nonlinear: your team is your product's home, and your inbound support
flows through the same issue tracker you use to plan releases.*

Related guides:
- `docs/guides/01-guide-for-humans.md` — the human operator who stands up the instance and
  provisions you. Read it (or point your operator at it) for install, first-run, and admin UI.
- `docs/guides/03-guide-for-consumer-agents.md` — the agents that *consume* your thing and file
  against you. Hand them that one.
- `docs/configuration.md` — every env var (storage, SSO, SCIM, SMTP, AI, blob backend).

Before anything else, internalize the **one trust-domain reality** in
[§0](#0-the-trust-domain-reality-read-this-first). It changes how you onboard consumers.

---

## 0. The trust-domain reality (read this first)

nonlinear today is a **single trust domain**. Every authenticated principal — human member,
guest, *or* agent token — receives the **entire workspace** on bootstrap (`/api/bootstrap`) and
over live sync: all teams, all issues, all projects, all comments, all documents, all customers.

- The `private` team flag only controls auto-join-on-registration. It does **not** hide a
  team's data from reads. Team membership and the `guest` role are cosmetic for reads.
- There is **no per-team or per-token read scoping** anywhere.
- Therefore: anyone you hand an account or token to can read everything.

This dictates how you onboard consumers. Three deployment patterns:

- **Pattern A — one instance, one trust domain (recommended default).** You and all your own
  products/agents live in one instance as separate teams. Everyone with a credential is trusted.
  Best when an owner runs several of their *own* tools/components/agents.
- **Pattern B — one instance per product.** If your consumers are mutually-distrusting third
  parties who must not see each other (or your roadmap), run a **separate nonlinear per
  product**. It's cheap — burstable Postgres, one small API process.
- **Pattern C — untrusted consumers use public intake only.** Third parties you don't want
  reading the workspace get **no account and no token** — they file through the unauthenticated,
  write-only intake form (§4). Only trusted teammates/agents get credentials.

The roadmap to close this gap is dogfooded in the **"Provider ↔ Consumer readiness"** project in
team `NON` (issues NON-27 team-scoped isolation, NON-28 scoped tokens, NON-30 consumer read-back,
NON-31 real guest role). Until those land, treat every credential as full read access.

---

## 1. Your identity

**In nonlinear, you are an *agent user*, and your Bearer token *is* you.** Every call carrying
`Authorization: Bearer <token>` authenticates as exactly the one user that token was minted for.
There is no runtime "act as" selector — the token *is* the identity.

An agent user is a non-human teammate (`isAgent: true`, role `member`) that:
- can be **assigned** issues and **@mentioned** in comments,
- **cannot log in** (no password) and **cannot use SSO**,
- acts *only* through its token.

### How an admin provisions you

A human admin does this once (see guide 01 for the UI walkthrough):

```bash
# 1. Create the agent user (admin-only)
curl -X POST http://localhost:8080/api/agents \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "content-type: application/json" \
  -d '{"name":"augrid-bot"}'
# → { "id": "<agent-user-id>", ... }

# 2. Mint THE agent's token (admin-only) — THIS is the credential that is "you".
#    A "name" is required (it labels the token).
curl -X POST http://localhost:8080/api/agents/<agent-user-id>/tokens \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "content-type: application/json" \
  -d '{"name":"augrid-bot ci token"}'
# → { "token": { "id": "...", "prefix": "nl_...", ... }, "secret": "nl_..." }
#   The raw secret is returned ONCE, under `.secret` — put THAT in your .mcp.json / client.
```

### ⚠️ The token gotcha (NON-29)

The Members → Agents help text tells you to "mint one in **Profile → API tokens**." **Do not.**
That mints a *personal* token bound to the human admin — a client using it acts as the *human*,
not as you. There is currently **no UI button** to mint an agent token; the admin **must** call
`POST /api/agents/:id/tokens` (e.g. with curl, as above). The secret it returns is what goes in
your client. Tracked as **NON-29**.

### Confirm who you are

Before doing anything, verify the token resolves to *you* (the agent), not a human:

```
whoami                          # MCP tool
```
```bash
curl -H "Authorization: Bearer nl_..." http://localhost:8080/api/auth/me
```

`whoami` returns your `name`, `displayName`, `isAgent`, `role`, and the workspace name. **Check
`isAgent: true`.** If it's `false`, you were handed a personal token (the NON-29 trap) — stop and
ask the admin to re-mint via `POST /api/agents/:id/tokens`.

### What you can't do

You're role `member`, not `admin`. You **cannot**: create teams, create other agents, create
webhooks, manage members, read the audit log, change AI settings, or touch SCIM. You also can't
log in to the web UI or use SSO. Anything admin-gated has to go through a human admin — the
provisioning in §1, the webhook in §6, and team/label/SLA setup in §3 are all admin actions.
Plan to ask your operator (guide 01) for those.

---

## 2. Connect

### MCP (preferred)

The MCP server is mounted at `<host>/mcp` (Streamable HTTP, `@modelcontextprotocol/sdk`), one
Bearer per request. Config block:

```jsonc
{
  "mcpServers": {
    "nonlinear": {
      "type": "http",
      "url": "http://localhost:8080/mcp",
      "headers": { "Authorization": "Bearer nl_your_agent_token" }
    }
  }
}
```

For Claude Code specifically: `claude mcp add --transport http nonlinear http://localhost:8080/mcp
--header "Authorization: Bearer nl_your_agent_token"`.

### The 13 tools

Names are **resolved for you** — teams by key (`AUGRID`), states/labels by name (`In Progress`,
`type: bug`), assignees by email / `@handle` / display name. You never juggle UUIDs through MCP.

**Read (9):**

| Tool | What it does |
|---|---|
| `whoami` | Authenticated user + workspace. Verify `isAgent`. |
| `list_teams` | All teams with keys. |
| `list_users` | Members + agents (name, handle, isAgent). |
| `list_projects` | Projects (id, name, status). |
| `list_workflow_states` | A team's states in order — `{ teamKey }`. |
| `list_labels` | Labels, optionally `{ teamKey }`. |
| `search_issues` | Text + filters `{ query?, teamKey?, assignee?, state?, priority?, limit? }`. |
| `get_issue` | One issue **with its comments** — `{ identifier }` e.g. `AUGRID-42`. |
| `list_my_issues` | Issues assigned to *your* token's user. Your work queue. |

**Write (4):**

| Tool | Params |
|---|---|
| `create_issue` | `{ teamKey, title, description?, priority?, assignee?, state?, labels? }` |
| `update_issue` | `{ identifier, title?, description?, state?, priority?, assignee? }` |
| `add_comment` | `{ identifier, body }` — markdown + `@handle` mentions |
| `create_project` | `{ name, description?, teamKeys[] }` |

`priority` is `none/urgent/high/medium/low` **or** `0–4` (0 None, 1 Urgent, 2 High, 3 Medium,
4 Low). All reads are workspace-global — even `search_issues` without a `teamKey` spans every team.

### When to drop to REST

MCP covers the common loop, but has gaps. Reach for REST (same Bearer, `/api/*`) when:

- **You need to set an issue's `projectId`, `milestone`, labels-on-update, due date, estimate,
  or subscribers** — `create_issue`/`update_issue` don't expose these. Use raw REST with UUIDs.
- **You need to delete** — there is no delete tool. `DELETE /api/issues/:id`.

REST write surface:

```bash
# Create with a project (raw teamId + projectId UUIDs; get them from /api/bootstrap or list_*)
curl -X POST http://localhost:8080/api/issues \
  -H "Authorization: Bearer nl_..." -H "content-type: application/json" \
  -d '{"teamId":"<uuid>","title":"…","description":"…","priority":2,
       "assigneeId":"<uuid>","stateId":"<uuid>","labelIds":["<uuid>"],"projectId":"<uuid>"}'

curl -X PATCH http://localhost:8080/api/issues/<id> \
  -H "Authorization: Bearer nl_..." -H "content-type: application/json" \
  -d '{"projectId":"<uuid>","dueDate":"2026-08-01"}'

curl -X POST http://localhost:8080/api/comments \
  -H "Authorization: Bearer nl_..." -H "content-type: application/json" \
  -d '{"issueId":"<uuid>","body":"…"}'
```

### Polling / reading back

**There is no `GET /api/issues/:id`.** To read one issue's current state + comments, use MCP
`get_issue` (cleanest — identifier-based). For a full snapshot use `GET /api/bootstrap`; for
GraphQL use `POST /api/graphql`; for live updates use `GET /api/ws` (or the webhook in §6, which
is the better trigger). A typical agent: **webhook triggers, `get_issue` reads context, MCP/REST
writes back.**

---

## 3. Set up your team as a product home

**Your team = your product.** Pick a key that is your product's identifier — `AUGRID`,
`DYNTOOLS` — so every issue reads `AUGRID-123`. (An admin creates teams; you can't. Ask your
operator — guide 01.) Configure it as the home for both inbound support and your own planning.

### Workflow states

Each team owns its workflow states, grouped by **category**: `triage`, `backlog`, `unstarted`,
`started`, `completed`, `canceled`. A product-support-friendly set:

- **Triage** (category `triage`) — everything inbound lands here first.
- **Backlog**, **Todo** (`backlog`/`unstarted`) — accepted, not started.
- **In Progress** (`started`) — you're working it.
- **Needs Info** (`started`) — waiting on the reporter.
- **Fixed / Released** (`completed`), **Won't Fix / Duplicate** (`canceled`).

Check them with `list_workflow_states({ teamKey: "AUGRID" })` and transition with
`update_issue({ identifier, state: "In Progress" })`.

### Label taxonomy for incoming reports

Labels are how you route and report. Establish two axes up front (admin creates labels):

- **Type**: `type: bug`, `type: feature`, `type: question`, `type: docs`.
- **Area**: your product's surfaces — for `augrid`: `area: rendering`, `area: sorting`,
  `area: virtualization`, `area: api`; for `dynamics-tools`: `area: xpp-lint`,
  `area: metadata`, `area: deploy`.

Apply on create: `create_issue({ teamKey: "AUGRID", title: "…", labels: ["type: bug",
"area: sorting"] })`. `list_labels({ teamKey })` to see what exists.

### Issue templates

Templates pre-fill a body so reporters give you repro steps, versions, and expected/actual up
front. Create a **Bug report** and a **Feature request** template per team (admin, via the team
settings UI — guide 01). They dramatically raise the quality of what lands in triage.

### SLAs

Per-team SLA settings attach due dates to issues automatically. Set an SLA so inbound bugs get a
target resolution date and surface as due-soon in your notifications. Good for signaling
responsiveness to consumers.

### Cycles (iterations)

Cycles are time-boxed iterations (Linear-style sprints). Turn them on for your team to batch work
into a rhythm; issues you accept get pulled into the current cycle, and Insights (§7) gives you
throughput/velocity/burn-up per cycle.

### Projects, roadmap, milestones — your planned delivery

A **project** spans one or more teams and carries **milestones**, **health updates**, and a
**roadmap/timeline** position. Model each planned release or major capability as a project:

```
create_project({ name: "augrid v2 — column virtualization",
                 description: "…", teamKeys: ["AUGRID"] })
```

Then set issues into it (REST `projectId` — §2) and add milestones (e.g. *alpha*, *beta*, *GA*).
This is where you separate **reactive support** (triaged issues) from **planned delivery**
(project + milestones + roadmap).

### Initiatives — if you ship multiple products

**Initiatives** group projects across teams. If you own several products (`augrid` +
`dynamics-tools`), an initiative like "2026 tooling roadmap" rolls their projects into one
timeline. Otherwise skip it.

---

## 4. Open your intake

Consumers who don't (and shouldn't) have accounts file through **public intake** — an
unauthenticated, **write-only** channel per team.

### Enable and use it

An admin flips `intakeEnabled` on your team. Endpoints:

- `GET /api/public/intake/:teamKey/meta` → `{ teamName, enabled }`. The only anonymous read; it
  exposes **no issue data**.
- `POST /api/public/intake/:teamKey` → creates an issue. Body `{ title, description?, email? }`,
  or a Slack slash-command form payload (`command=…&text=…`).

```bash
curl -X POST http://localhost:8080/api/public/intake/AUGRID \
  -H "content-type: application/json" \
  -d '{"title":"Sorting breaks on 100k rows","description":"…","email":"dev@acme.com"}'
# → { "ok": true, "identifier": "AUGRID-123" }
```

### The facts that matter

- **Write-only.** The POST returns only `{ ok: true, identifier: "AUGRID-123" }` (or Slack
  ephemeral text). **There is no anonymous way to read status back** afterward (tracked NON-30).
  So the reporter gets an identifier but can't poll it — you must reach them out-of-band, or they
  need their own token (below).
- **Rate limit:** anonymous is **10 requests / 60s per IP** (in-process).
- **Optional `intakeToken`** (a team setting) supplied via `?token=`, header `X-Intake-Token`, or
  body `token` marks a request **trusted** and **skips rate limiting**. It's a rate-limit bypass
  for a trusted caller (e.g. your docs site's contact form), **not** a requirement to file.
- **Attribution:** intake issues are authored by the workspace's **oldest active admin** — there
  is no per-submitter identity. If the `email`'s **domain** matches a registered **Customer**
  (name/tier/revenue/`domain`), a **CustomerRequest** with `source: 'intake'` is auto-linked — so
  you know which consumer org asked. Register your key consumers as Customers to get this.
- **Slack option:** wire a Slack slash command at `POST /api/public/intake/:teamKey`; the form
  payload path files an issue and replies ephemerally.

### Intake vs. a consumer's own token — how to decide

| Situation | Give them |
|---|---|
| Untrusted / anonymous third party; must NOT read your workspace | **Public intake** (§4) |
| Trusted consumer/agent who needs to **track** their issues, comment, get read-back | **Their own agent token** (they become an agent user in your instance — but remember §0: they'll see the whole workspace) |
| Mutually-distrusting consumers who each need real tracking | **Pattern B** — a separate instance per product |

Point consumers at guide 03 either way.

---

## 5. Triage the inbound

Reports reach you four ways:

1. **Triage inbox** — the team's holding queue (category `triage`). Intake issues and anything
   filed into a triage state land here.
2. **Intake** (§4) — anonymous submissions, authored by the oldest admin.
3. **Assigned to you** — someone assigns an issue to your agent user → `list_my_issues`, and your
   webhook fires (§6).
4. **@mentions** — someone `@your-handle`s you in a comment → webhook fires.

### Triage automation rules

Per-team **triage automation rules** apply on `IssueService.create` — they can auto-label,
auto-prioritize, or route new issues by matching content. Set rules so, e.g., an intake title
containing "crash" gets `type: bug` + Urgent. This means much of your first-pass triage happens
before you even look.

### Turning a raw report into a well-formed issue

For each inbound item:

1. `get_issue({ identifier })` — read title, description, comments, current state.
2. Classify: `update_issue({ identifier, priority: "high" })` and add type/area labels. (Labels
   on update need REST `labelIds`; see §2.)
3. If it's a **duplicate** or related, link it — set a relation / mark duplicate (REST; the issue
   relation surface). Comment the canonical identifier so the reporter can follow it.
4. **Tie it to a CustomerRequest** so you know which consumer asked. If the reporter's email
   domain matched a Customer, intake already linked one; otherwise create the CustomerRequest
   (`source: 'manual'`) linking the Customer to this issue. This is how you later answer "which
   customers are blocked on AUGRID-123?"
5. Move it out of triage: `update_issue({ identifier, state: "Backlog" })` (accepted) or
   `state: "Won't Fix"` (declined) — and **comment why** (§8).

---

## 6. The support round-trip (the core loop)

This is the heartbeat: **a consumer or teammate assigns an issue to you (or @mentions your
handle) → your agent-scoped webhook fires → you fetch context and act back with your token →
your writes generate new deltas → repeat.**

### Webhook registration (admin does this)

You can't create webhooks (member role). Ask your admin to register one (`POST /api/webhooks`)
**scoped to your agent user**:

```bash
curl -X POST http://localhost:8080/api/webhooks \
  -H "Authorization: Bearer <ADMIN_TOKEN>" -H "content-type: application/json" \
  -d '{"url":"http://your-agent-host:7000/webhook",
       "format":"json",
       "agentUserId":"<your-agent-user-id>"}'
# → { "id": "...", "url": "...", "secret": "<server-generated>", "agentUserId": "...", ... }
```

The body accepts only `url`, `format`, and `agentUserId` — **the secret is generated by the
server** and returned in the response. Read it from there and give it to your agent to verify
incoming calls; you don't (and can't) supply your own.

Facts:
- **`agentUserId` scoping (`involvesAgent`):** with `agentUserId` set, the webhook fires **only**
  on deltas that *involve you* — an issue whose `assigneeId` is you (or where you're a
  subscriber), or a **comment whose body `@mentions` your handle**. Without it, you'd get a
  **firehose** of every issue/comment/project delta. Always scope it.
- **Secret:** each webhook's server-generated secret is sent on every call as header
  **`x-nonlinear-secret`**. Verify it.
- **Delivery is fire-and-forget:** **5s timeout, no retry queue.** So **ack fast** (return 200
  immediately), then process asynchronously. If your endpoint is down, that delta is gone — fall
  back to polling `list_my_issues` on startup to catch anything missed.
- Forwarded models: `issue`, `comment`, `project`. Payload is `{ type: "sync.deltas", deltas:
  [...] }`; each delta has `model`, `action`, `data`.

### The runnable skeleton

`examples/agent/agent.mjs` is a complete reference: a tiny Node webhook server that acks within
the timeout, then for each delta where `data.assigneeId === agentId` (or a comment body includes
`@handle`) fetches `/api/bootstrap` for context and posts a comment back via REST. Swap its
`handle()` body for your real model call; the rest is the teammate plumbing. Run it:

```bash
NONLINEAR_URL=http://localhost:8080 NONLINEAR_TOKEN=nl_agent_token \
AGENT_HANDLE=augrid.bot PORT=7000 node examples/agent/agent.mjs
```

### A minimal worked example

A consumer files `AUGRID-142` ("sort() drops rows past 100k") and assigns it to you.

```
# 1. Webhook fires (issue delta, assigneeId = you). Ack 200, then:
get_issue({ identifier: "AUGRID-142" })
     → read repro steps + comments

# 2. Acknowledge immediately so the reporter isn't left silent
add_comment({ identifier: "AUGRID-142",
              body: "Investigating — reproduced on 120k rows. Looks like the virtualization
                     window drops the tail. — augrid.bot" })
update_issue({ identifier: "AUGRID-142", state: "In Progress" })

# 3. You ship the fix (in your product's repo), cut a release, then close the loop
add_comment({ identifier: "AUGRID-142",
              body: "Fixed in **augrid v1.8.2** — off-by-one in the virtual row window.
                     `npm i augrid@1.8.2`. Thanks for the precise repro!" })
update_issue({ identifier: "AUGRID-142", state: "Fixed" })
```

Every state change carries a comment. The reporter (if they have a token / read-back) sees a
coherent story; if they filed via anonymous intake, reach them via the `email` they left.

---

## 7. Plan your delivery

Support is half the job — you also run your own roadmap, all through MCP/REST:

- **Projects** (`create_project`) = releases / big capabilities. Keep accepted feature issues
  filed into them (REST `projectId`).
- **Milestones** inside a project = *alpha / beta / GA* or version cuts. Drive scope by which
  issues carry which milestone.
- **Roadmap / timeline** — each project has a timeline position; sequence your projects there so
  the roadmap view tells consumers what's coming.
- **Cycles** — pull accepted work into the current iteration; let velocity data set realistic
  scope.
- **Health updates** — post a periodic project health update (on-track / at-risk / off-track +
  a note). This is your public signal of delivery status; keep it current.

**Read your own status** without a human: **Insights** (throughput / velocity / burn-up per
team/cycle) and **Pulse** (`GET /api/pulse` — a cross-workspace activity digest computed on
demand from stored entities). Poll Pulse to summarize "what moved this week" for a status comment
or health update.

---

## 8. Etiquette & good practice

You're a teammate, not a script. Behave like one:

- **Use states consumers understand**, and **always comment on a transition.** Moving to
  *Needs Info*? Say what you need. Closing as *Won't Fix*? Say why. A silent state change is a
  dropped ball.
- **Acknowledge fast.** When an issue is assigned/@mentioned, post an "investigating" comment
  quickly (the webhook loop makes this automatic — do it). Silence reads as "ignored."
- **Close with a resolution and the fixed version.** "Fixed in `augrid@1.8.2`" beats "done."
  Give the consumer something actionable — a version, a workaround, a link.
- **Don't leave issues silently.** If you can't act, say so and set *Backlog* or *Needs Info*.
- **Respect the trust domain (§0).** Anyone with a token in this instance reads *everything* —
  every issue body, comment, and document. **Never put secrets** (API keys, customer PII,
  credentials, internal URLs) in issue titles, descriptions, or comments. If a consumer pastes a
  secret into an intake report, redact it. When in doubt, assume the whole workspace is readable
  by every credential holder — because it is.
- **Attribute your comments.** Sign with your handle so humans reading the thread know a bot
  responded (the examples do this: `— augrid.bot`).

---

## 9. Quickstart (zero → consumers can file and you can respond)

Steps 1–4 are **admin** (your human operator, guide 01); 5–8 are **you**.

```bash
# 1. (admin) Create your product's team — key = your product, e.g. AUGRID.
#    Web UI: Settings → Teams → New team. Add workflow states, type:/area: labels,
#    a Bug-report template, and an SLA.

# 2. (admin) Provision you as an agent user
curl -X POST http://localhost:8080/api/agents \
  -H "Authorization: Bearer <ADMIN_TOKEN>" -H "content-type: application/json" \
  -d '{"name":"augrid-bot"}'                    # → { "id": "<AGENT_ID>" }

# 3. (admin) Mint YOUR token — NOT via Profile→API tokens (NON-29)
curl -X POST http://localhost:8080/api/agents/<AGENT_ID>/tokens \
  -H "Authorization: Bearer <ADMIN_TOKEN>" -H "content-type: application/json" \
  -d '{"name":"augrid-bot token"}'
# → { "token": {...}, "secret": "nl_..." }  ← the `.secret` is you; copy it now (shown once)

# 4. (admin) Enable public intake on the team + register your scoped webhook
#    intakeEnabled=true in team settings, then (the secret comes back in the response):
curl -X POST http://localhost:8080/api/webhooks \
  -H "Authorization: Bearer <ADMIN_TOKEN>" -H "content-type: application/json" \
  -d '{"url":"http://your-host:7000/webhook","format":"json",
       "agentUserId":"<AGENT_ID>"}'           # → { ..., "secret": "<use as x-nonlinear-secret>" }

# 5. (you) Wire the MCP token into your client
claude mcp add --transport http nonlinear http://localhost:8080/mcp \
  --header "Authorization: Bearer nl_..."

# 6. (you) Confirm identity — expect isAgent: true
#    MCP: whoami   |   REST:
curl -H "Authorization: Bearer nl_..." http://localhost:8080/api/auth/me

# 7. (you) Stand up the round-trip listener
NONLINEAR_URL=http://localhost:8080 NONLINEAR_TOKEN=nl_... \
AGENT_HANDLE=augrid.bot PORT=7000 node examples/agent/agent.mjs

# 8. (you) Seed your plan, then hand guide 03 to consumers
#    MCP: create_project({ name: "augrid v2", teamKeys: ["AUGRID"] })
#    Test intake:
curl -X POST http://localhost:8080/api/public/intake/AUGRID \
  -H "content-type: application/json" \
  -d '{"title":"smoke test","email":"you@example.com"}'   # → { ok, identifier: "AUGRID-1" }
```

You now have: a product home (team + states + labels + templates + SLA), an identity (agent token
that's *you*), an open write-only intake for untrusted consumers, a scoped webhook that pings you
only when an issue involves you, and a project to plan against. Consumers file; you triage, act,
comment back, close, and ship — all through MCP/REST, no human in the loop.

Hand your consumers **`docs/guides/03-guide-for-consumer-agents.md`**.
