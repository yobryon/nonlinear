# Product vision & principles

This is the north-star document for **nonlinear**. If you read only one thing
before touching the code, read this. It explains what we are building, who it is
for, the founding constraints that shape every decision, and the product pillars
we refuse to compromise on. Everything else in `docs/design/` is downstream of
what is written here.

## What nonlinear is

nonlinear is a **self-hostable clone of [Linear](https://linear.app)** — the
issue tracker and project-management tool loved for its speed, its keyboard-first
UX, and its opinionated model of how software teams actually work. We are not
building "an issue tracker inspired by Linear." We are building Linear's product
surface, faithfully, on infrastructure a team can run itself.

Concretely, `docker compose up --build` gives you the whole product on
`http://localhost:8080`: teams, issues with priorities/labels/estimates/due
dates, per-team workflow states, sub-issues and relations, a triage inbox with
SLAs, projects with milestones, initiatives with a timeline/roadmap, cycles,
markdown documents with inline comments, comments with @mentions and reactions,
file attachments, a notifications inbox, favorites, saved views, full-text
search, insights (throughput/velocity/burn-up), customers and requests, a public
intake form, automated triage rules, CSV import/export, outbound webhooks, a
GitHub PR integration, a command palette with keyboard shortcuts, dark/light
themes, and **real-time delta sync** across every connected client. The scope is
documented in `CLAUDE.md` and tracked against Linear feature-by-feature in
`ROADMAP.md`.

The load-bearing word above is *whole*. nonlinear is not a demo or a subset. The
roadmap's P1 and P2 tiers are shipped; what remains (P3) is platform-and-scale
work — GraphQL, SSO, custom dashboards, an Azure Blob adapter — not core product
gaps. A team can adopt nonlinear today and get the Linear workflow, not a
promissory note.

## What nonlinear is not

Being disciplined about non-goals is how the clone stays a clone instead of
sprawling into a different, worse product. nonlinear is **not**:

- **A hosted SaaS.** We do not run it for you; there is no billing, no
  multi-tenant control plane, no marketplace. One deployment is one workspace's
  worth of teams. (First register creates the workspace + admin + default team;
  later registers join. See "First-run behavior" in `CLAUDE.md`.)
- **A superset of Linear.** We do not add features Linear lacks just because we
  can. New surface area has to earn its place by moving us *toward* parity, not
  away from it. When Linear's behavior and our instinct disagree, Linear wins
  (see "The parity philosophy" below).
- **A platform for arbitrary integrations.** `ROADMAP.md`'s non-goals section is
  explicit: Salesforce/Intercom/Zendesk/Gong connectors, Fivetran/Airbyte
  exports, native iOS/Android apps, and a hosted-agent marketplace are all out.
  These hang off ecosystems a self-hosted clone does not sit inside. We ship the
  seams (webhooks, MCP, REST, public intake) and let deployers wire their own.
- **A heavyweight enterprise install.** No Kubernetes requirement, no message
  broker, no separate search cluster, no Redis. The whole thing is one small API
  process, one Postgres, and a static SPA behind nginx. That is a deliberate
  constraint, covered next.

## Who it is for

The user we design for is a **team that wants to run its own issue tracker**.
Concretely, three overlapping motivations:

1. **Data ownership / sovereignty.** Teams that cannot or will not put their
   roadmap and customer requests in someone else's cloud — regulated
   industries, security-conscious orgs, or anyone who has been bitten by a SaaS
   sunset. Self-hosting is the whole value proposition, so the deploy story is a
   first-class product concern, not an afterthought.
2. **Cost control at small scale.** A five-person team should be able to run
   nonlinear for the price of a burstable VM and a small Postgres. The
   low-cost/low-resource constraint (below) exists so that "self-host" does not
   secretly mean "operate a distributed system."
3. **Agent-native teams.** Teams building with LLM agents want those agents to
   participate in the tracker the way humans do — assigned issues, @mentioned in
   comments, driving state through a real API. nonlinear treats agents as
   first-class from the data model up (see the agents pillar).

The reader we write documentation for — including this doc — is a **new
product/eng teammate** who needs the *why*, not just the *what*. Every design
document in this folder should leave you able to make a decision the way the
original authors would have.

## The founding constraints

`CLAUDE.md` lists six hard constraints "from the project owner." They are not
implementation notes; they are the shape of the product. Everything downstream —
architecture, storage, deploy, even which features we build — is a consequence
of these six. Understand them and most of the codebase's decisions become
obvious.

### 1. Clone Linear as closely as practical

Data model, workflows, and UX feel (speed, keyboard-first, real-time) should
match Linear. This is the constraint that makes nonlinear *nonlinear* and not a
generic tracker. It shows up in concrete, checkable ways: the priority scheme is
Linear's exact `0=None 1=Urgent 2=High 3=Medium 4=Low` (`packages/shared/src/enums.ts`);
workflow-state *categories* are Linear's `triage/backlog/unstarted/started/completed/canceled`;
issue identifiers are `TEAM-123` with atomically reserved numbers
(`team_counters`); the icons in `apps/web/src/icons.tsx` are hand-drawn to mimic
Linear's state/priority glyphs. When we are unsure how something should behave,
the answer is "how does Linear do it," and `ROADMAP.md` exists precisely to keep
score against Linear's marketed product.

The escape hatch is "as closely as **practical**." We are not cloning Linear's
GraphQL API shape or its exact pixel measurements — we clone the *model and the
feel*. Where practicality and fidelity trade off, we note it honestly rather than
pretending.

### 2. Fully containerized

Everything runs on local Docker; no host-installed services. This is why
`docker compose up --build` is the canonical "run the product" command and why
MailHog ships in compose for digest email — a developer should never have to
install Postgres, a mail server, or anything else to see the whole product work.
It also disciplines the dependency list: every runtime dependency has to be
something we are willing to containerize and operate.

### 3. Azure is the eventual deploy target

We prefer Azure managed services *when needed* but keep plain-container
portability. This is a "design for a destination without coupling to it"
constraint. The web tier is built to move to **Azure Static Web Apps** — nginx
in `infra/web/nginx.conf` deliberately mirrors `infra/web/staticwebapp.config.json`
so that the local serving story and the eventual SWA story are the same routing
rules in two dialects. The API is a single container ready for a container
service; Postgres is ready for Flexible Server (burstable). The word *eventual*
matters: none of this Azure-specific code is on the critical path today, but no
decision may foreclose it. Attachments are the clearest example — they live on a
filesystem volume now, but everything goes through the `BlobStore` interface in
`packages/core/src/blob.ts` precisely so an Azure Blob adapter can drop in later
(it is a named P3 item, not yet built).

### 4. Low cost / low resource

One small API process, jsonb-on-Postgres storage, a ~100 KB gzipped SPA, prefer
burstable/consumption tiers. This constraint is why the architecture looks almost
suspiciously simple for the feature count. There is no separate worker process:
the same API container runs the WebSocket hub, a 10-minute due-soon/reminder
scheduler, and an hourly email-digest sender in-process (`apps/api/src/`). There
is no search service: full-text search is Postgres. There is no cache tier and no
message queue: the sync log *is* the event bus. Every time you are tempted to add
a moving part, this constraint is the thing to argue with — and it usually wins.

### 5. Modular storage

All persistence goes through the interfaces in `packages/core/src/storage.ts`;
no package outside `storage-*` may import a database driver; `STORAGE=memory|postgres`
selects the engine at API startup. This is the constraint that keeps the domain
honest. `packages/core` contains *all* business rules and knows *nothing* about
Postgres — it talks to `EntityStore<T>` and friends. The in-memory
implementation (`packages/core/src/memory.ts`) is a real, complete storage
backend used both by the test suite and by `STORAGE=memory` for zero-dependency
dev. The Postgres implementation (`packages/storage-postgres`) satisfies the same
interfaces with one jsonb document per row plus expression indexes. The payoff is
that domain logic is testable without a database, and a future storage engine is
a package, not a rewrite.

### 6. Front-end served like Azure SWA

nginx serves the built SPA and proxies `/api` + `/api/ws`, mirroring
`staticwebapp.config.json`. This is constraint #3 made concrete at the web tier,
and it is why the front-end is a pure static SPA (React + Vite + zustand) with no
server-side rendering: SWA serves static assets and proxies an API, so that is
exactly what we build and exactly what nginx emulates locally. The SPA's job is
to bootstrap over REST and then live on the WebSocket; nginx's job is to route.
Keeping those two the same shape locally and in Azure is the point.

## The product pillars

Constraints say what we must not break. Pillars say what makes the product *good*.
These are the qualities that, if we lost them, would make nonlinear a different
and worse product even if every feature checkbox stayed ticked.

### Speed and keyboard-first

Linear's reputation is built on feeling instant, and that feeling is a design
target, not an accident. Two mechanisms carry it:

- **Optimistic mutation.** The web store (`apps/web/src/store.ts`, `sync.ts`)
  sends mutations over REST and merges the response immediately via `putEntity`;
  the same change also arrives moments later as a sync delta, which is
  idempotent, so the UI never waits for the round-trip to feel done. The user
  sees their edit land at keystroke speed.
- **Keyboard-first interaction.** A command palette (`apps/web/src/CommandPalette.tsx`)
  and global keyboard shortcuts are the primary way to move, not a
  power-user afterthought bolted onto a mouse-driven app. The manual ordering of
  boards and lists uses fractional keys (`keyBetween` in
  `packages/shared/src/fractional.ts`) so reordering is a single-row write, not a
  renumber-everything operation — which is what keeps drag-and-drop and
  keyboard-move snappy even on large lists.

If a change makes the app feel slower or forces a hand to the mouse, it is
fighting this pillar and needs a very good reason.

### Real-time by construction

Every connected client should see the world change under them without a refresh.
This is not a feature we added; it is the *spine* of the system, described in
`CLAUDE.md` as "the load-bearing design." Every mutation appends full-entity
deltas to a monotonic **sync log** (`SyncBus.publish` → `syncLog.append` → live
listeners). Clients bootstrap a full snapshot tagged with a `syncId`, then stay
current over `/api/ws`; on reconnect they send `lastSyncId` and the server either
replays everything newer or tells them to `rebootstrap` (`apps/api/src/hub.ts`).

Two things follow from making real-time structural rather than optional. First,
adding a new synced model is a *checklist*, not an architecture decision (add it
to `SyncModelMap`/`SYNC_MODEL_NAMES` in shared, add a store/table in both storage
impls, publish deltas from the service, map it in the web store's
`MODEL_TO_KEY`). Second, the same event stream that powers the browser powers
everything else — webhooks, agent notifications — because there is exactly one
source of truth for "what changed." We chose full-entity deltas over field-level
patches deliberately: they are trivially idempotent and let a client that missed
messages recover by replay, at the cost of larger messages. For a small-team
tracker that trade is clearly correct.

### The issues → projects → initiatives hierarchy

Linear's conceptual model is a nested hierarchy of work, and we clone it exactly
because it is *the* opinionated core of the product, not a taxonomy detail:

- **Issues** are the atom. They can nest into **sub-issues** via `parentId`
  (`packages/shared/src/entities.ts`), with cycle-prevention enforced in the
  domain so you cannot make an issue its own ancestor.
- **Projects** group issues toward an outcome (`issue.projectId`), carry
  **milestones**, and report **health updates** (On Track / At Risk / Off Track).
- **Initiatives** group projects (`project.initiativeId`; an initiative also
  tracks `projectIds`) into strategic bets, and roll up onto a
  **timeline/roadmap** (`/timeline`).
- **Cycles** are the orthogonal time axis — the sprint-like buckets issues move
  through — generated lazily rather than pre-populated, again to honor the
  low-resource constraint.

This hierarchy is not just data shape; it is why the insights, the roadmap, and
the rollups exist. Sub-issue progress rolls up into parent lists; project health
rolls up into initiative timelines. Getting this model right is getting the
product right.

### Agents as first-class participants

This is where nonlinear makes an explicit bet about where tools like Linear are
going, and it is the pillar most worth understanding. nonlinear does not treat
agents as external scripts poking an API from outside — it treats them as
**teammates**. There are three supported paths, all Bearer-authenticated with
personal API tokens (`domain.tokens.authenticate`):

1. **The MCP server** at `/mcp` (`apps/api/src/mcp.ts`) — a Streamable-HTTP
   Model Context Protocol server exposing name-resolved tools over the same
   `Domain` object the REST API uses. Crucially it is an **in-process module, not
   a separate container** — a direct consequence of the low-resource constraint,
   and a deliberate choice we call out in `CLAUDE.md`.
2. **The REST API directly**, with the same token auth.
3. **Agent users** — teammates with `isAgent` set, created by an admin
   (`POST /api/agents`, tokens minted via `POST /api/agents/:id/tokens` because
   agents cannot log in). You *assign issues to them and @mention them* like any
   human, and an agent-scoped webhook (`WebhookService.involvesAgent`) fires only
   on events where that agent is the assignee or is @mentioned.

The reason this is a pillar and not just a P-tier feature is the claim behind it,
stated plainly in `ROADMAP.md`: this is "the direct answer to *can an agent use
nonlinear the way it uses Linear.*" The assign/@mention → webhook → comment-back
loop is a runnable reference in `examples/agent/`. Note the honest boundary:
what ships is the *substrate* for agents (identity, auth, tools, the event loop).
The intelligence — suggested assignees/labels, duplicate detection, Pulse
summaries — is a bring-your-own-key P3 item, deferred, not built.

## The parity philosophy

The single most important cultural decision on this project is captured in one
phrase from the constraints: **"clone Linear as closely as practical."** We
interpret this as *full alignment* — nonlinear is a clone, and "clone" is a
compliment we are trying to earn, not a hedge we are apologizing for.

In practice this means a specific default: **when in doubt, do what Linear does.**
The priority integers, the state categories, the `TEAM-123` numbering, the
triage inbox semantics, the Intake → Plan → Build → Monitor product frame that
organizes `ROADMAP.md` — all of these are chosen to match Linear rather than to
express our own taste. We survey Linear's marketed product and keep an explicit
scorecard. This has real benefits: it removes a whole category of bikeshedding
(the answer is already decided), it makes the product instantly familiar to
anyone who has used Linear, and it gives us a crisp definition of "done."

The alternative we rejected was building a *Linear-inspired* tool with our own
opinions layered in. That path is tempting — every engineer has ideas about how
priorities or cycles "should" work — but it leads somewhere specific: a product
that is neither Linear nor a coherent alternative, just a pile of local
preferences. By committing to parity we trade creative latitude for coherence and
familiarity, and for a self-hosted clone that is exactly the right trade.

Parity also has a *practical* ceiling we are honest about. We do not clone
implementation choices that would violate the founding constraints — Linear is
GraphQL-first and cloud-hosted; we are REST + MCP and self-hostable, because a
GraphQL layer is unbuilt (P3) and a hosted control plane is a non-goal. Parity is
about the *product*: the model, the workflows, the feel. It is not about
re-deriving Linear's backend.

## What is shipped vs. what is not

Parity is a direction, and `ROADMAP.md` is the odometer. As of this writing:

- **Shipped (at parity):** the entire original core build, plus **P1** (saved
  views, full-text search, issue templates, project health updates, timeline
  roadmap, inbox snooze/reminders, duplicate detection, archive views) and **P2**
  (customers + requests, public intake form + Slack slash command, inline
  document comments, automated triage rules, Slack-format webhooks, CSV
  import/export, notification preferences + email digest, configurable estimate
  scales + velocity/burn-up charts). Agents ship too: tokens, the MCP server (13
  tools), agent users, agent-scoped webhooks, and the reference agent.
- **Not yet (P3 — platform & scale):** GraphQL API, custom dashboards, Pulse
  activity digest, BYO-key AI features, code-review "Diffs", mobile/PWA, the
  Azure Blob storage adapter, SSO (Entra ID) + SCIM, and an admin audit log.
  When asked to "continue toward parity," pick from the top of P3.

A few honest limitations worth internalizing early, all from `CLAUDE.md`'s known
gaps: outbound webhooks are fire-and-forget (5s timeout, no retry queue); the
sync log is never compacted (the `rebootstrap` path covers this but it is not
free); there is no rate limiting and auth is same-origin cookie-based, so
production requires HTTPS in front and `SECURE_COOKIES=true`; and attachments are
still on a filesystem volume pending the Blob adapter. None of these are secrets
— they are the current edges of a deliberately small system, and knowing them is
part of knowing the product.

## How to use this document

When you are weighing a change, walk it against this page in order. Does it break
a founding constraint? Then it is almost certainly wrong, however good it looks.
Does it weaken a pillar — make the app slower, add a moving part, break real-time,
demote agents? Then the bar is very high. Does it move us toward Linear parity as
tracked in `ROADMAP.md`? Then it is probably the right kind of work. And when the
question is "how should this behave," the first answer to reach for is: *how does
Linear do it.* That is the whole philosophy in one sentence.
