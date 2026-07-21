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
> before you invite anyone or hand out a token.** nonlinear is a single trust domain today:
> every account and every token sees the entire workspace. That one fact decides how you
> deploy.

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
- **Member** — the normal teammate.
- **Guest** — **be aware: `guest` is not enforced anywhere today.** A guest reads and
  writes exactly what a member does. The role is selectable but decorative for now. Do not
  rely on it to restrict anyone. (Tracked as **NON-31**.)

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

**Every authenticated principal — human member, guest, or agent token — receives the
entire workspace.** On bootstrap (`/api/bootstrap`) and via live sync, they get all teams,
all issues, all projects, all comments, all documents, all customers. There is no per-team
or per-token read scoping anywhere.

- The `private` team flag only controls **auto-join on registration**. It does **not** hide
  a team's data from reads.
- Team membership and the `guest` role are **cosmetic for reads** today.

**Therefore nonlinear today is a single trust domain.** Anyone you give an account or token
to can see everything in the workspace.

### The three deployment patterns

Pick the one that matches *who you're letting in*:

- **Pattern A — one instance, one trust domain (recommended default).** You and all your
  own agents/products live in a single instance as teams. Everyone with a credential is
  trusted. This is the right fit for an owner running several of their **own**
  tools/components/agents.
- **Pattern B — one instance per product.** If your consumers are mutually-distrusting
  third parties who must not see each other (or your roadmap), run a **separate nonlinear
  per product**. It's cheap — burstable Postgres, one small API process.
- **Pattern C — untrusted consumers use public intake only.** Third parties you don't want
  reading the workspace never get an account or token; they file through the unauthenticated,
  write-only **public intake** form ([§6a](#6a-public-intake-the-unauthenticated-write-channel)).
  Only trusted teammates and agents get credentials.

Closing this gap is the point of the dogfooded backlog — issues **NON-27** (team-scoped
isolation), **NON-28** (scoped tokens), **NON-30** (consumer read-back), **NON-31** (real
guest role), in the "Provider ↔ Consumer readiness" project in team **NON**. See
[§10](#10-where-things-are-going).

---

## 6. Letting others file issues

### 6a. Public intake (the unauthenticated write channel)

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
        "email": "dana@acme.com" }'
# → { "ok": true, "identifier": "AUGRID-317" }
```

Key properties:

- **Write-only.** The response is just `{ ok, identifier }` (or Slack ephemeral text).
  There is **no anonymous way to read status back** afterward. (Tracked as **NON-30**.)
- **Attribution.** Intake issues are authored by the workspace's oldest active admin —
  there's no per-submitter identity. If the submitted `email`'s domain matches a registered
  **Customer**'s `domain`, a **CustomerRequest** (`source: 'intake'`) is auto-linked, so you
  can see which customer asked.
- **Rate limit.** Anonymous submissions are capped at **10 requests / 60s per IP**.
- **Optional intake token.** Set a team `intakeToken` and supply it via `?token=`, header
  `X-Intake-Token`, or a body `token` field to mark a request *trusted* and skip rate
  limiting. It's a rate-limit **bypass, not a requirement** — the endpoint works without it.
- **Slack slash-command.** The same endpoint accepts a Slack slash-command form payload
  (`command=…&text=…`), so `/filebug something broke` posts an issue and replies
  ephemerally.

### 6b. Inviting trusted humans

Settings → Members → **Invite people** → pick `member` or `guest` → share the single-use,
14-day link. Remember: both roles see the whole workspace today ([§5](#5-the-trust-domain-model-read-this-before-you-invite-anyone)),
so only invite people you'd trust with all of it — or run a separate instance (Pattern B).

### 6c. Agents (brief — see guides 02 / 03)

An **agent user** is a non-human teammate (`isAgent: true`, role `member`) you can assign
issues to and @mention. It can't log in (no password, no SSO); it acts entirely through a
token.

**Mint its token the right way — this trips everyone up:**

```bash
# 1. Admin creates the agent (or use Settings → Members → Agents → "Add agent")
curl -X POST http://localhost:8080/api/agents \
  -H 'Authorization: Bearer <YOUR_ADMIN_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{ "name": "augrid-bot" }'
# → { "id": "<AGENT_ID>", ... }

# 2. Mint the token that authenticates AS the agent — ADMIN ONLY, this exact endpoint.
#    A "name" is required (it labels the token in the agent's token list).
curl -X POST http://localhost:8080/api/agents/<AGENT_ID>/tokens \
  -H 'Authorization: Bearer <YOUR_ADMIN_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{ "name": "mcp" }'
# → { "token": {...}, "secret": "nl_..." }   ← put the SECRET in the agent client / .mcp.json
```

> **The token IS the identity — there is no "act as" selector.** A token is minted for
> exactly one user and every call authenticates as that user.
>
> **Gotcha (tracked as NON-29):** the Members → Agents help text says to "mint one in
> Profile → API tokens." **Don't.** That mints a *personal* token bound to *you* the admin,
> so the client acts as the human, not the agent. There is currently no UI button to mint an
> agent token — you must call `POST /api/agents/:id/tokens` (e.g. with curl, above). Verify
> what a token resolves to with the MCP `whoami` tool or `GET /api/auth/me`.

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
5. Invite trusted teammates as `member` (Settings → Members → Invite people) — remember
   everyone sees everything, which is fine for one trust domain (**Pattern A**).

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
   or auto-label. Note the **write-only** caveat — submitters can't read status back
   ([NON-30](#10-where-things-are-going)); close the loop over email or your own channel.

### Recipe (iii): provider + consumers (the marquee)

*You own a component; other humans and agents file and track issues against it.* Because
everyone with a credential sees the whole workspace, this is **Pattern A** — use it when all
consumers are trusted (your own teams/agents, or partners you trust with the full
workspace). If they're mutually distrusting third parties, use **Pattern B** (one instance
each) or keep untrusted consumers on intake-only (**Pattern C**).

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
3. **Consumers file issues.** Trusted human consumers get `member` invites and file in the
   normal UI; consumer **agents** get their own tokens and file over MCP or REST. To route
   work to the provider, they assign the issue to `@augrid-bot` or @mention it in a comment.
4. **The round-trip.** Assign/@mention → the agent-scoped webhook fires → `augrid-bot` acts
   back with **its** token (comments, changes state) → those writes generate new deltas that
   the consumer sees live. `examples/agent/` is a runnable reference; depth is in guides
   02 / 03.
5. **Reading status.** Anyone with a credential polls via MCP `get_issue` (identifier-based,
   includes comments), `GET /api/bootstrap`, or GraphQL — there is no `GET /api/issues/:id`.

> **Isolation caveat:** every token here reads the entire workspace. Only run this pattern
> when all consumers are inside one trust domain. Otherwise split by instance (Pattern B).

### Recipe (iv): several of your own products in one instance (Pattern A)

Running multiple components you own — say `AUGRID`, `PULSAR`, `NOVA` — in one nonlinear:

1. Create **one team per product** (`AUGRID`, `PULSAR`, `NOVA`), each with its own states,
   labels, cycles, and intake toggle.
2. Give each product its own agent (`augrid-bot`, `pulsar-bot`, …) and agent-scoped webhook,
   as in recipe (iii).
3. Use **projects** and **initiatives** to plan across teams, and the roadmap for the
   portfolio view.
4. This is **Pattern A** by definition: it's all your stuff, one trust domain, and the fact
   that every credential sees every team is a feature, not a leak. If any product needs to be
   invisible to the others' users, that's your signal to split it onto its own instance
   (Pattern B) — the `private` flag won't do it ([§5](#5-the-trust-domain-model-read-this-before-you-invite-anyone)).

---

## 10. Where things are going

The isolation gaps in this guide aren't hidden — they're a dogfooded backlog. Team **NON**
holds the **"Provider ↔ Consumer readiness"** project, issues **NON-27 … NON-34**:

- **NON-27** — enforce team-scoped isolation (stop shipping the whole workspace to everyone).
- **NON-28** — scoped tokens (a token that only sees its team/component).
- **NON-29** — a real UI button to mint agent tokens (kill the Profile-token gotcha).
- **NON-30** — consumer read-back (let intake submitters check status).
- **NON-31** — enforce the `guest` role.

Until those land, treat the model in [§5](#5-the-trust-domain-model-read-this-before-you-invite-anyone)
as the truth: **one instance is one trust domain.** The reasoning behind the major design
choices — with alternatives and honestly-accepted trade-offs — lives in
**[docs/design](../design/README.md)**.
