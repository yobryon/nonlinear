# nonlinear — a guide for humans

**nonlinear** is a self-hostable clone of [Linear](https://linear.app): teams, issues,
workflow states, projects, cycles, triage, initiatives, docs, insights, real-time sync —
running entirely in your own containers. This guide is for the person standing it up: a
developer or team lead who wants to run their own work in it, and optionally let other
people, teams, and agents file and track issues against tools they provide.

If you're wiring up an **agent** rather than driving the product yourself, read the
companion guides instead — they go deep on the token/webhook loops this guide only
sketches:

- **[02 — Guide for provider agents](./02-guide-for-provider-agents.md)** — an agent that
  owns a component and services issues filed against it.
- **[03 — Guide for consumer agents](./03-guide-for-consumer-agents.md)** — an agent that
  files and tracks issues against someone else's component.

> **Read [§5, The trust-domain model](#5-the-trust-domain-model-read-this-before-you-invite-anyone)
> before you invite anyone or hand out a token.** nonlinear enforces **team-scoped
> isolation**: a member or guest sees only the teams they belong to, and tokens can be
> scoped to specific teams and/or made read-only. Admins still see everything. That is what
> lets you host trusted and untrusted people in one instance — and it decides how you deploy.

---

## 1. What you get

Everything Linear markets, self-hosted: issues with sub-issues/relations/estimates/SLAs,
workflow states, priorities, labels, projects + milestones + roadmap, initiatives, cycles,
a triage inbox, templates, saved views, full-text search, customers + requests, a public
intake form (and Slack slash-command), triage automation rules, CSV import/export,
insights + custom dashboards, a Pulse activity digest, optional bring-your-own-key AI, a
notifications inbox with email digests, favorites, outbound webhooks (JSON + Slack), a
GitHub PR integration, SSO/SCIM + audit log, a GraphQL API, an installable offline PWA, a
command palette + keyboard shortcuts, and real-time delta sync. One small API process,
Postgres for storage, a ~100 KB SPA.

---

## 2. Run it

### Docker (the whole product)

```bash
docker compose up --build
```

That brings up web + api + postgres. Open **http://localhost:8080**. A MailHog inbox for
digest email lands at **http://localhost:8025**. Nothing else is required — every
integration is off until you configure it.

### Dev (hot reload)

```bash
pnpm install
pnpm dev        # api on :3000 (needs a postgres, or set STORAGE=memory), web on :5173
```

Zero-dependency, in-memory API (great for a throwaway poke — data is ephemeral):

```bash
STORAGE=memory pnpm --filter @nonlinear/api dev
```

### Configuration

Everything an operator sets lives in **environment variables** on the API container —
there is no config file and no in-app server-settings screen. Storage engine, blob
backend, SSO, SCIM, SMTP, registration policy, and more are all env-driven. The full
reference, with per-provider walkthroughs, is **[docs/configuration.md](../configuration.md)**.

For production: put HTTPS in front, set `SECURE_COOKIES=true`, and decide your
registration policy (next section). There is no built-in rate limiting.

---

## 3. First run & accounts

### The first register owns the workspace

The **first** person to register creates the workspace, becomes its **admin** (the
"owner"), and gets a default team seeded with Linear's default workflow states. This
always works — it's how you bootstrap a fresh instance.

### Registration is then CLOSED by default

After that first account, `POST /api/auth/register` returns `403 registration_closed`.
Reaching the server is **not** enough to get an account. New people join one of three ways:

1. **An admin invite** — Settings → Members → **Invite people** generates a single-use
   link, valid 14 days, that you share out of band. Invite role may be `member` or
   `guest` (not `admin`).
2. **SSO** — if OIDC is configured, signing in provisions or links an account ([§7](#7-enterprise-sso--scim--audit)).
3. **SCIM** — your IdP pushes users in ([§7](#7-enterprise-sso--scim--audit)).

The login page reads `GET /api/meta` to learn whether setup is needed, whether signups are
open, and whether a given `?invite=` token is valid.

**Escape hatch:** `ALLOW_SIGNUPS=true` reopens open self-registration — anyone who can
reach the server may create an account. Only do this behind a trusted network boundary
(VPN / private network). Default is `false`.

### Roles

Roles are `admin | member | guest`.

- **Admin** — everything, including create teams/agents/webhooks, manage members, view the
  audit log, set AI config, run SCIM. Admin-only actions are enforced.
- **Member** — the normal teammate. Sees only the teams they belong to (non-private teams
  are auto-joined on registration; private teams must be added explicitly).
- **Guest** — a **real, enforced** restricted role. A guest does **not** auto-join any team;
  an admin adds them to specific teams (Settings → Members, or `POST /api/teams/:id/members`),
  and team-scoped isolation confines them to exactly those teams. Use it to give an outside
  collaborator access to one team without exposing the rest of the workspace.

---

## 4. The core objects (fast tour)

- **Team** — has a `key` like `AUGRID`, so its issues get identifiers like `AUGRID-123`.
  Each team owns its own workflow states, labels, cycles, triage inbox, intake toggle +
  optional intake token, SLA settings, triage automation rules, and templates.
- **Workflow states** — each belongs to a **category**: `triage`, `backlog`, `unstarted`,
  `started`, `completed`, `canceled`. Categories drive board columns and completion logic.
- **Issue** — title, markdown description, state, **priority** (`0` None, `1` Urgent,
  `2` High, `3` Medium, `4` Low), assignee, labels, estimate, due date, project, sub-issues,
  relations, subscribers.
- **Project** — spans one or more teams; has milestones, health updates, and a
  roadmap/timeline position. **Initiatives** group projects for portfolio-level planning.
- **Cycles** — time-boxed sprints per team.
- **Labels** — per-team tags.
- **Triage inbox** — where un-triaged issues (including intake submissions) land for a team
  before they enter the normal workflow; triage automation rules can route them.
- **Templates** — reusable issue skeletons per team.
- **Customers + requests** — model *who outside your org asked for this*. A **Customer** has
  a name/tier/revenue and an email **`domain`**; a **CustomerRequest** links a customer to
  an issue and/or project with a `source` of `manual` or `intake`.

Plus the usual: comments with reactions and @mentions, attachments, saved views, full-text
search, favorites, a notifications inbox, a command palette, and keyboard shortcuts.

---

## 5. The trust-domain model (READ THIS BEFORE YOU INVITE ANYONE)

This is the single most important thing to understand before handing out access.

### The isolation reality

**Reads are scoped to team membership.** On bootstrap (`/api/bootstrap`) and over live sync,
a non-admin principal — human member, guest, *or* agent token — receives **only the teams
they belong to**: their issues, projects, comments, documents, and customers. Admins still
receive the entire workspace.

- The `private` team flag now genuinely **gates reads** (and still controls auto-join on
  registration): non-members can't see a team's data at all.
- Team membership and the `guest` role are **enforced**, not cosmetic.
- **Webhooks carry a secret and are admin-only.**

Isolation is at the **team boundary**, not per-issue: a member or guest of a team sees that
whole team's data. Admins see everything — treat admin as your workspace-wide trust level.

### Scoped and read-only tokens

An API or agent token can **narrow** its bearer's authority (never widen it):

- **`teamIds`** — restrict the token to specific teams. Reads intersect the owner's team
  visibility with the scope, so even an *admin's* scoped token sees only those teams.
- **`readOnly`** — any mutation is refused (`403` at REST; the MCP enforces the same, plus
  per-team scope, on every tool).

Set them in the create-token body:

```bash
curl -X POST http://localhost:8080/api/tokens \
  -H 'Authorization: Bearer <ADMIN_TOKEN>' -H 'Content-Type: application/json' \
  -d '{ "name": "augrid consumer", "teamIds": ["<TEAM_UUID>"], "readOnly": true }'
```

The same fields work on `POST /api/agents/:id/tokens`. A scoped token is the recommended
way to give a consumer agent access to just your team. (Honest caveat: the **Mint-token UI
mints full-access only** for now — set `teamIds`/`readOnly` via the API.)

### The deployment patterns

Pick the one that matches *who you're letting in*:

- **Pattern A — one shared instance (recommended default).** Host trusted teammates *and*
  mutually-distrusting consumers in a single instance. Give each consumer a **guest account
  added only to your team**, or a **scoped token** limited to your team — they see only that
  team, not your other teams/roadmap or other consumers' data. This now covers most needs.
- **Pattern B — one instance per product (maximum isolation).** Only needed for the
  strictest separation — e.g. you don't even want consumers to know other teams *exist*, or
  regulatory separation. Then run a **separate nonlinear per product**. It's cheap —
  burstable Postgres, one small API process.
- **Pattern C — untrusted anonymous consumers use public intake.** Third parties who get no
  account or token file through the unauthenticated **public intake** form
  ([§6a](#6a-public-intake-the-unauthenticated-write-channel)). Intake now returns a signed
  status link, so they can track their submission without an account.

How this model was built — team-scoped isolation, scoped tokens, the real guest role,
intake read-back — is dogfooded in the "Provider ↔ Consumer readiness" project in team
**NON** (now shipped). See [§10](#10-where-things-are-going).

---

## 6. Letting others file issues

### 6a. Public intake (the unauthenticated intake channel)

Enable it **per team** (team setting `intakeEnabled`). Once on, anyone can file an issue
into that team's triage inbox with no account:

```bash
# What's exposed anonymously — team name + whether intake is on. No issue data.
curl http://localhost:8080/api/public/intake/AUGRID/meta
# → { "teamName": "Augrid", "enabled": true }

# File an issue
curl -X POST http://localhost:8080/api/public/intake/AUGRID \
  -H 'Content-Type: application/json' \
  -d '{ "title": "Export button 500s on large boards",
        "description": "Repro: 2k issues, click Export CSV.",
        "labels": ["type: bug"], "type": "bug",
        "reporter": "Dana Ochoa", "email": "dana@acme.com" }'
# → { "ok": true, "identifier": "AUGRID-317", "statusUrl": "/api/public/intake/status/<id>/<sig>" }
```

Key properties:

- **Read-back via a signed status link.** The response now includes a `statusUrl`;
  `GET /api/public/intake/status/:id/:sig` returns the **submitter-facing** status —
  identifier, title, state, category, `updatedAt` — with no internal comments. Submitters can
  track progress without an account.
- **Richer submissions.** Beyond `title`/`description`/`email`, intake accepts optional
  `labels[]`, a `type`, and a `reporter` field; who reported each issue is recorded.
- **Attribution.** Intake issues are authored by the workspace's oldest active admin (with
  the `reporter` recorded). If the submitted `email`'s domain matches a registered
  **Customer**'s `domain`, a **CustomerRequest** (`source: 'intake'`) is auto-linked, so you
  can see which customer asked.
- **Abuse controls.** A honeypot field and a **per-team daily quota**, on top of the
  **10 requests / 60s per IP** anonymous rate limit.
- **Optional intake token.** Set a team `intakeToken` and supply it via `?token=`, header
  `X-Intake-Token`, or a body `token` field to mark a request *trusted* and skip rate
  limiting. It's a rate-limit **bypass, not a requirement** — the endpoint works without it.
- **Slack slash-command.** The same endpoint accepts a Slack slash-command form payload
  (`command=…&text=…`), so `/filebug something broke` posts an issue and replies
  ephemerally.

### 6b. Inviting trusted humans

Settings → Members → **Invite people** → pick `member` or `guest` → share the single-use,
14-day link. A **member** sees the teams they belong to; a **guest** sees only the teams an
admin explicitly adds them to ([§5](#5-the-trust-domain-model-read-this-before-you-invite-anyone)).
So to let an outside collaborator into just one team, invite them as a **guest** and add them
to that team — no separate instance needed.

### 6c. Agents (brief — see guides 02 / 03)

An **agent user** is a non-human teammate (`isAgent: true`, role `member`) you can assign
issues to and @mention. It can't log in (no password, no SSO); it acts entirely through a
token.

**Mint its token — the UI or the API:**

Settings → Members → Agents now has a per-agent **"Mint token"** button (reveal-once). That
mints a full-access agent token in a click. Use the API instead when you want to **scope**
the token to specific teams or make it **read-only** — those options aren't in the UI yet:

```bash
# 1. Admin creates the agent (or use Settings → Members → Agents → "Add agent")
curl -X POST http://localhost:8080/api/agents \
  -H 'Authorization: Bearer <YOUR_ADMIN_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{ "name": "augrid-bot" }'
# → { "id": "<AGENT_ID>", ... }

# 2. Mint the token that authenticates AS the agent — ADMIN ONLY, this exact endpoint.
#    A "name" is required; add teamIds/readOnly to scope it (recommended for consumers).
curl -X POST http://localhost:8080/api/agents/<AGENT_ID>/tokens \
  -H 'Authorization: Bearer <YOUR_ADMIN_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{ "name": "mcp", "teamIds": ["<TEAM_UUID>"], "readOnly": false }'
# → { "token": {...}, "secret": "nl_..." }   ← put the SECRET in the agent client / .mcp.json
```

> **The token IS the identity — there is no "act as" selector.** A token is minted for
> exactly one user and every call authenticates as that user.
>
> **Mint agent tokens from Members → Agents, or `POST /api/agents/:id/tokens`** — **not**
> from Profile → API tokens, which mints a *personal* token bound to *you* the admin (the
> client would then act as the human, not the agent). Verify what a token resolves to with
> the MCP `whoami` tool or `GET /api/auth/me`. (Scope/read-only are set via the API only.)

The full assign/@mention → webhook → comment-back loop is in **[guide 02](./02-guide-for-provider-agents.md)**
and **[guide 03](./03-guide-for-consumer-agents.md)**; `examples/agent/` is a runnable
reference.

---

## 7. Enterprise: SSO / SCIM / audit

All three are **configured in the environment, not in the app** — nothing security-
sensitive is editable through the UI. They're no-ops until you set the vars. Full
per-provider walkthroughs (Entra ID, Okta, Google Workspace, Keycloak/Auth0) are in
**[docs/configuration.md](../configuration.md)**.

- **SSO (OIDC).** Set `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` (plus optional
  `OIDC_LABEL`, `OIDC_ALLOWED_DOMAINS`, `OIDC_AUTO_PROVISION`) and restart. The login page
  then shows a "Continue with …" button. The **redirect/callback URI to register with your
  IdP** is:

  ```
  <APP_URL>/api/auth/sso/callback
  ```

  It must match exactly (e.g. `https://issues.acme.com/api/auth/sso/callback`). Sign-in
  resolves an account by stable subject → link by email → JIT-provision a member.
- **SCIM 2.0.** Set `SCIM_TOKEN` and point your IdP's connector at `<APP_URL>/scim/v2/Users`
  with `Authorization: Bearer <SCIM_TOKEN>`. Covers Users (create / list / filter /
  deactivate), not Groups — team membership stays a product concern.
- **Audit log.** A workspace audit log (admin-only, `GET /api/audit`) records logins,
  provisioning, role/active changes, and token/agent/webhook/team events.

---

## 8. Integrations overview

- **MCP server** — a Streamable-HTTP MCP server at `<host>/mcp`, Bearer-authenticated, with
  13 name-resolving tools (team by key, state/label by name, assignee by email/@handle). The
  cleanest surface for agents. See [§9 recipe (iii)](#recipe-iii-provider--consumers-the-marquee)
  and guides 02/03.
- **REST** — thin `/api/*` routes behind the same cookie/Bearer auth; write with
  `POST /api/issues`, `PATCH /api/issues/:id`, `POST /api/comments`. Note there is **no
  `GET /api/issues/:id`** — read via MCP `get_issue`, `GET /api/bootstrap`, or GraphQL.
- **GraphQL** — a code-first schema at `POST /api/graphql` (GET for exploration), same auth,
  with lazy nested resolution and `createIssue`/`updateIssue`/`deleteIssue`/`createComment`
  mutations. Linear's own API is GraphQL; this mirrors that shape.
- **Webhooks** — admin-created outbound webhooks (`json` or `slack`), optionally scoped to a
  single agent, each with a secret sent as `x-nonlinear-secret`. Fire-and-forget, 5s timeout,
  no retry. Forwards issue/comment/project deltas. See [§9 recipe (iii)](#recipe-iii-provider--consumers-the-marquee).
- **GitHub PR integration** — set `GITHUB_WEBHOOK_SECRET` and point a repo webhook at
  `<APP_URL>/api/integrations/github` to link PRs to issues.

---

## 9. Use-case recipes

### Recipe (i): plan your own work (solo / small team)

1. Register the first account — you're the admin, with a default team.
2. Rename the team and set its `key` (Settings → Teams), e.g. `AUGRID`.
3. Create a couple of projects; drop issues in with `C` (command palette / new issue).
   Priorities `1`–`4`, assign to yourself.
4. Live in the board or list views; use cycles if you sprint. Turn on the email digest with
   `SMTP_URL` if you want due-soon nudges (MailHog is already wired in compose).
5. Invite trusted teammates as `member` (Settings → Members → Invite people) — they'll see
   the teams they belong to. Add outside collaborators as `guest` to just the team they need.

### Recipe (ii): ship a product with a public bug-intake form

1. Create the product's team, e.g. key `AUGRID`.
2. Enable intake for it (team setting `intakeEnabled`).
3. Publish the intake endpoint or embed a form that POSTs to it:

   ```bash
   curl -X POST https://issues.acme.com/api/public/intake/AUGRID \
     -H 'Content-Type: application/json' \
     -d '{ "title": "Crash on import", "email": "user@customer.com" }'
   ```

4. Optionally register **Customers** for your key accounts (with their email `domain`) so
   intake submissions auto-link a **CustomerRequest** and you can see who's asking.
5. Optionally set the team's `intakeToken` and put it in your trusted form's backend to skip
   the anonymous rate limit. Optionally wire the Slack slash-command to the same endpoint.
6. Work submissions out of the team's **triage inbox**; use triage automation rules to route
   or auto-label. Submitters can track their own issue via the signed `statusUrl` returned on
   submission (state/category, no internal comments); still close the loop over email or your
   own channel for anything the status view doesn't convey.

### Recipe (iii): provider + consumers (the marquee)

*You own a component; other humans and agents file and track issues against it.* This is
**Pattern A** — a single instance. Team-scoped isolation keeps consumers apart: each
consumer gets a **guest account** or a **scoped token** limited to your provider team, so
they see only that team, not your roadmap, other teams, or each other. Reach for **Pattern
B** (one instance each) only when consumers must not even know other teams exist.

1. **Create the provider team** and its agent. Say the component is Augrid; team key
   `AUGRID`, agent `augrid-bot`. Mint the agent token via `POST /api/agents/:id/tokens`
   ([§6c](#6c-agents-brief--see-guides-02--03)) and give it to your provider agent.
2. **Wire an agent-scoped webhook** so the provider agent only wakes for work that concerns
   it:

   ```bash
   curl -X POST http://localhost:8080/api/webhooks \
     -H 'Authorization: Bearer <ADMIN_TOKEN>' \
     -H 'Content-Type: application/json' \
     -d '{ "url": "https://augrid-bot.internal/hook",
           "format": "json",
           "agentUserId": "<AUGRID_BOT_AGENT_ID>" }'
   ```

   With `agentUserId` set, the webhook fires **only** on deltas that involve that agent — an
   issue assigned to it (or where it's a subscriber), or a comment that @mentions its handle.
   Without it, you'd get a firehose of every issue/comment/project delta.
3. **Consumers file issues.** Human consumers get **guest** invites added only to the
   provider team and file in the normal UI; consumer **agents** get their own **team-scoped**
   tokens and file over MCP or REST. Either way they see just this team. To route work to the
   provider, they assign the issue to `@augrid-bot` or @mention it in a comment.
4. **The round-trip.** Assign/@mention → the agent-scoped webhook fires → `augrid-bot` acts
   back with **its** token (comments, changes state) → those writes generate new deltas that
   the consumer sees live. `examples/agent/` is a runnable reference; depth is in guides
   02 / 03.
5. **Reading status.** A consumer polls via MCP `get_issue` (identifier-based, includes
   comments), `GET /api/bootstrap`, or GraphQL — there is no `GET /api/issues/:id`. Their
   reads are confined to the teams their guest account or scoped token can see.

> **Isolation note:** consumers see the whole of the team(s) they're in, but nothing else —
> not your other teams, roadmap, or another consumer's issues. Isolation is at the team
> boundary, not per-issue. Admins still see everything.

### Recipe (iv): several of your own products in one instance (Pattern A)

Running multiple components you own — say `AUGRID`, `PULSAR`, `NOVA` — in one nonlinear:

1. Create **one team per product** (`AUGRID`, `PULSAR`, `NOVA`), each with its own states,
   labels, cycles, and intake toggle.
2. Give each product its own agent (`augrid-bot`, `pulsar-bot`, …) and agent-scoped webhook,
   as in recipe (iii).
3. Use **projects** and **initiatives** to plan across teams, and the roadmap for the
   portfolio view.
4. This is **Pattern A**: it's all your stuff in one instance. As admin you see every team;
   members and guests you add see only the teams they belong to. If a whole product must be
   invisible even to the *existence* of the others, split it onto its own instance
   (Pattern B) — otherwise team-scoped isolation and the `private` flag already keep each
   product's data to its own team ([§5](#5-the-trust-domain-model-read-this-before-you-invite-anyone)).

---

## 10. How the model evolved

The isolation model in this guide was built in the open — a dogfooded backlog in team
**NON**, the **"Provider ↔ Consumer readiness"** project, now shipped:

- **NON-27** — team-scoped isolation (a non-admin gets only their teams, in bootstrap and
  live sync). **Done.**
- **NON-28** — scoped tokens (`teamIds` / `readOnly`, narrow-only). **Done.**
- **NON-29** — a real UI button to mint agent tokens. **Done** (scope/read-only still API-only).
- **NON-30** — consumer read-back (signed intake status link). **Done.**
- **NON-31** — the enforced `guest` role. **Done.**
- **NON-32 … NON-35** — intake `reporter`/`type`/`labels`, honeypot + per-team quota, and
  these guides readable in-app (user menu → **Help & docs**). **Done.**

The model to trust is the one in [§5](#5-the-trust-domain-model-read-this-before-you-invite-anyone):
**team-scoped isolation, with admins seeing the whole workspace.** The reasoning behind the
major design choices — with alternatives and honestly-accepted trade-offs — lives in
**[docs/design](../design/README.md)**.
