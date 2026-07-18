# Design decision log

This is the institutional-memory doc for **nonlinear**, the self-hostable Linear
clone. It records the load-bearing decisions — the ones that shaped the code and
would be expensive to reverse — with enough context that a new teammate can
understand not just *what* we built but *why*, and what we gave up.

Each entry follows the same shape: **Decision / Context / Alternatives
considered / Why / Consequences**. Entries are grouped by theme rather than
chronologically; the project was built as one coherent push against Linear's
marketed feature set (see `ROADMAP.md`), so "theme" is the more useful axis.

Where a decision has an honest limitation, it is called out under Consequences
rather than buried. When something is not built, this doc says "not yet" and
points at the roadmap instead of implying it exists.

---

## 1. TypeScript monorepo with a shared contract

**Decision.** One pnpm workspace, TypeScript ESM end-to-end, with a
dependency-free `packages/shared` package that both the API and the web app
import as the single source of truth for entity types, enums, input DTOs, and
the sync protocol.

**Context.** The product is a client/server app where the client holds a
normalized replica of server state and mutates it optimistically. The two sides
must agree, byte-for-byte, on what an `Issue` is, what `Priority` values mean,
and what a sync delta looks like. Any drift between them shows up as
runtime-only bugs.

**Alternatives considered.** (a) Separate repos with a hand-maintained API doc
or an OpenAPI/GraphQL schema generating client types. (b) A polyglot stack
(e.g. a Go or Python API with a TypeScript front end) sharing types via codegen.

**Why.** Sharing *the actual TypeScript types* — not a generated approximation —
means a change to an entity is a compile error on every side that hasn't caught
up, caught by `pnpm typecheck` before it ships. `packages/shared` deliberately
has no runtime dependencies and no database driver, so it is safe for the
browser bundle to import wholesale. Linear's own priority scheme
(`0=None 1=Urgent…4=Low`) and state categories live here as enums
(`packages/shared/src/enums.ts`) so the ordering logic is identical on both ends.

**Consequences.** Everything is TypeScript, which constrains hiring and rules
out a faster runtime for the hot path — an acceptable trade for a low-traffic
self-hosted tool. One subtlety bites newcomers: tests resolve workspace
siblings from *source* via vitest aliases, but `tsc` and Docker resolve them
from each package's built `dist/`. If types look stale, rebuild the upstream
package (documented in `CLAUDE.md`). ESM `.js` import specifiers are required
everywhere except `apps/web`, which uses bundler resolution.

---

## 2. jsonb-document storage behind narrow interfaces

**Decision.** Persist each entity as **one jsonb document per row** in Postgres,
with expression indexes on the fields we actually query. Reach it only through
the storage interfaces in `packages/core/src/storage.ts`; no package outside
`storage-*` may import a database driver. `STORAGE=memory|postgres` picks the
engine at API startup.

**Context.** A hard constraint from the project owner is low cost / low
resource: one small API process, Postgres, a ~100 KB gzipped SPA, all in
containers, with Azure Flexible Server (burstable tier) as the eventual target.
The data model is wide — ~28 synced entity types (`SyncModelMap` in
`packages/shared/src/sync.ts`) — and still evolving as we chase parity.

**Alternatives considered.** (a) A fully normalized relational schema with a
table and typed columns per entity, plus join tables for every relation.
(b) A document database (Mongo-style) as the primary store. (c) An ORM
(Prisma/TypeORM) over a relational schema.

**Why.** The document-per-row shape means adding a field is a code change, not a
migration, which matters when the schema is still moving. It keeps the storage
interface tiny — `EntityStore<T>` is five methods: `get / all / insert /
update / delete`, where `update` is a full-row replace (`storage.ts` lines
40–47). Postgres (not Mongo) keeps us on one boring, Azure-managed engine and
lets us drop to real relational tables exactly where semantics demand it:
`sessions`, `team_counters` for atomic issue numbers, and the ordered
`sync_log`. Expression indexes on the jsonb give us query performance without
giving up the document flexibility. We skipped an ORM because the interface is
already the abstraction, and an ORM would pull a driver dependency into places
that must stay driver-free.

**Consequences.** The `EntityStore` interface is deliberately dumb: no partial
updates, no server-side filtering beyond a few purpose-built methods
(`IssueStore.byTeam`, `ActivityStore.byIssue`). Complex queries either add an
expression index + a bespoke store method or are done in the domain layer over
`all()`. That is fine at self-host scale and would need revisiting at large
scale. The upside is enormous test leverage: `packages/core/src/memory.ts` is a
complete in-memory implementation of the same interfaces, so the entire domain
and every test can run with `STORAGE=memory` and zero external dependencies.

---

## 3. Full-entity delta sync over a monotonic log

**Decision.** Real-time sync is a **monotonic append-only log of full-entity
deltas**. Every mutation appends `{ syncId, model, action, data }` records
(`SyncDelta` in `packages/shared/src/sync.ts`); `data` is the *entire* entity
for create/update and just `{ id }` for delete. Clients bootstrap a full
snapshot tagged with the current `syncId`, then stream newer deltas over
`/api/ws`. On reconnect a client sends `hello { lastSyncId }` and the server
replays everything newer, or answers `rebootstrap` if the log no longer covers
that point.

**Context.** Linear's signature feel is instant, real-time, keyboard-first. We
need every connected client to converge on server state within a frame or two of
a mutation, and to recover cleanly from disconnects, without a heavyweight sync
engine.

**Alternatives considered.** (a) **CRDTs** (e.g. Yjs/Automerge) for
conflict-free multi-writer convergence. (b) **Event sourcing** — persist
domain events as the source of truth and fold them into state. (c) Field-level
/ patch deltas instead of whole entities. (d) Polling.

**Why.** The server is the single writer of record; there is no offline
multi-master editing to reconcile, so a CRDT's core benefit is cost we do not
need — and its complexity (per-field metadata, garbage collection, opaque
merge semantics) is real. Event sourcing was rejected for the same reason: our
source of truth is *current entity state* in jsonb, and we did not want to carry
a separate event store and projection layer. Shipping **full entities** in each
delta (rather than field patches) makes the client merge trivially idempotent —
applying the same delta twice, or applying it out of order relative to an
optimistic REST response, always lands on the same value via the store's
`putEntity`. That last-write-wins-by-syncId model is exactly right for a
server-authoritative app. The log is the one place we accept real relational
machinery: `SyncLogStore.append` (`storage.ts` lines 106–118) assigns
consecutive `syncId`s atomically, and the WS hub (`apps/api/src/hub.ts`) buffers
live deltas while replaying history so a reconnecting client never misses or
reorders an update. Notification and favorite deltas are filtered to their owner
at the hub, since those are per-user.

**Consequences.** Full-entity deltas are more bytes on the wire than field
patches — cheap at our entity sizes, and worth it for idempotency. The log is
**never compacted** today; it grows unbounded. The `rebootstrap` escape hatch
exists and is exercised (a client whose `lastSyncId` predates the retained log
just re-snapshots), so compaction can be added later without a protocol change —
but until then, disk grows with mutation count (noted in `CLAUDE.md` known
gaps). Adding a new synced model is a documented checklist: register it in
`SyncModelMap` / `SYNC_MODEL_NAMES`, add a store + jsonb table in both storage
impls, publish deltas from the service, and map it in the web store's
`MODEL_TO_KEY`.

---

## 4. Domain-as-core with thin transport adapters

**Decision.** All business rules live in `packages/core`. Transports — the
Fastify REST API, the WebSocket hub, and the MCP server — are thin adapters that
authenticate a request, translate it, and delegate to a domain service.
`createDomain` in `packages/core/src/index.ts` is the single composition root.

**Context.** The same operations must be reachable from three surfaces: a
browser over REST, an agent over MCP, and scripts over REST with a bearer token.
If issue-creation rules (numbering, SLA due dates, triage-rule application,
notification fan-out) lived in the REST handler, the MCP path would either
duplicate them or silently diverge.

**Alternatives considered.** (a) Fat controllers — business logic in the Fastify
routes, with MCP re-implementing or calling into the HTTP layer. (b) A
framework with the domain coupled to HTTP request/response objects.

**Why.** A domain service takes plain arguments and a `Ctx` (storage + the sync
bus), never a `Request`. `createDomain(storage, options)` wires every service
once and returns a `Domain` object (`index.ts` lines 104–145); cross-service
cascades that would otherwise create import cycles — issue delete →
reminders/customer-requests cleanup — are injected as *optional* dependencies
(`new IssueService(ctx, attachments, { reminders, customerRequests })`). The
payoff is that `apps/api/src/mcp.ts` is genuinely just a protocol adapter over
"the same Domain the REST routes use" (its own header comment), and the whole
domain is testable without a server — `packages/core` tests construct a `Domain`
over memory storage and exercise the real rules.

**Consequences.** The composition root is a real object with wiring order that
matters (services that others depend on are constructed first). New services
must register there and be exported from `index.ts`. The optional-dependency
pattern for cascades is slightly indirect, but it is the price of keeping the
services in one package without circular imports. The discipline is enforced
socially and by the storage boundary, not by a module system — a determined
route handler *could* embed logic; code review is the guardrail.

---

## 5. Fractional indexing for manual ordering

**Decision.** Manual ordering on boards and lists uses **fractional index keys**
— base-36 fraction strings where lexicographic order equals the intended visual
order. Inserting between two items computes a key strictly between their keys
(`keyBetween` in `packages/shared/src/fractional.ts`); no neighboring rows are
touched.

**Context.** Drag-and-drop reordering must be O(1) to persist and must sync as a
delta like any other field change. If reordering rewrote every row's position,
each drag would emit a storm of deltas and fight optimistic updates.

**Alternatives considered.** (a) Integer `position` columns, renumbered on every
insert (or with gap strategies like 10/20/30 that eventually collide and force a
renumber). (b) A linked-list `afterId` pointer per item. (c) A float position,
which runs out of precision after enough midpoint insertions.

**Why.** A fractional key means a move writes exactly one field on one entity and
produces exactly one delta — perfectly aligned with the full-entity delta sync
model. Keys never end in `"0"` so string comparison is a faithful stand-in for
numeric comparison (`fractional.ts` header), and `keyBetween(null, x)` /
`keyBetween(x, null)` handle the ends of a sequence. `keyAfterAll` appends past
everything. This is the same technique Linear-class tools use, and it composes
cleanly with our sync: reorders are just updates.

**Consequences.** Keys grow by roughly one character per adversarial "always
insert in the same gap" sequence; in practice human reordering keeps them short,
and there is no global renumber event to coordinate across clients. Two clients
that drop into the *exact* same gap concurrently can produce equal keys; the
server-authoritative last-write-by-syncId model resolves the tie deterministically
(one entity's key wins), so at worst a user re-drags. The util lives in `shared`
so client and server compute keys identically.

---

## 6. Pointer-events drag & drop, not HTML5 DnD

**Decision.** Every drag surface uses a hand-rolled pointer-event engine
(`apps/web/src/dragdrop.ts`, `beginPointerDrag`) rather than the native HTML5
drag-and-drop API.

**Context.** Board columns, list rows, and several pickers all need drag
reordering that feels instant and looks like the rest of the design system.

**Alternatives considered.** (a) Native HTML5 DnD (`draggable`, `dragstart`,
`dragover`, `drop`). (b) A drag library (react-dnd, dnd-kit).

**Why.** The file's own header records the reason bluntly: HTML5 DnD "proved
unreliable — Chrome aborts native drags when the DOM changes near dragstart,
ghosts are uncustomizable, events are flaky." Because our lists re-render
optimistically the instant an item moves, the DOM *does* change near dragstart,
which is exactly what breaks native drags. Pointer events give us full control:
a travel threshold (default 5px) so a click stays a click, a custom floating
ghost pill, hit-testing via `document.elementFromPoint`, edge auto-scroll, and
Escape to cancel. We avoided a library to keep the ~100 KB bundle budget and to
avoid coupling our design system to a third party's DOM assumptions.

**Consequences.** We own accessibility and edge cases ourselves — this is
mouse/touch pointer interaction, not keyboard-accessible reordering, so
keyboard-driven move is a separate concern handled through the command palette /
shortcuts rather than through drag. `elementFromPoint` hit-testing means drop
targets must be real, hittable DOM elements. The engine is small and dependency-
free, which was the goal.

---

## 7. MCP server in-process, not a separate container

**Decision.** The MCP server is mounted **in the API process** at `/mcp`
(Streamable HTTP, `@modelcontextprotocol/sdk`), constructed as a protocol
adapter over the same in-process `Domain` (`apps/api/src/mcp.ts`). It is
deliberately *not* a separate container or a separate service.

**Context.** Agents should be able to drive nonlinear the way they drive Linear's
hosted MCP — create issues, comment, reassign — with the same rules as the REST
API. A hard constraint is low resource use: one small API process.

**Alternatives considered.** (a) A standalone MCP service in its own container,
talking to the API over HTTP. (b) A sidecar process sharing the database
directly.

**Why.** A separate container would either re-implement the domain (drift) or
call the REST API over the network (a hop, plus re-serialization, plus a second
auth surface) — all to reach a `Domain` object that already exists in the same
process. In-process, the MCP tools call domain services directly with the same
business rules, and there is one fewer container to run, secure, and deploy. The
transport is **stateless**: a fresh `McpServer` + transport per request, so
there is no session bookkeeping; each request authenticates independently via
its bearer token (`mcp.ts` header). The tool layer name-resolves human-friendly
identifiers (team keys, `ENG-42` issue identifiers, priority words like
"urgent") into ids so an agent doesn't need to know internal UUIDs.

**Consequences.** MCP shares the API process's fate — resource limits, restarts,
scaling — which is the point at self-host scale but means MCP can't be scaled
independently. There are 13 tools today (per `ROADMAP.md`); breadth is bounded
by what we choose to expose, not by the transport.

---

## 8. Personal API tokens: sha256, non-synced, bearer

**Decision.** Programmatic access uses **personal API tokens** minted in Profile
→ API tokens. The raw secret (`nl_…`, high-entropy) is shown once and never
stored; only its **sha256 hash** is persisted (`TokenService`,
`packages/core/src/services/tokens.ts`). Tokens are **not** part of the sync
model — they are per-user bearer secrets, like sessions.

**Context.** Scripts, the MCP server, and agent users all need to authenticate
without a browser session cookie. Secrets must be safe at rest and revocable.

**Alternatives considered.** (a) Long-lived session cookies for scripts.
(b) Storing tokens as regular synced entities. (c) A heavier scheme like
signed JWTs or OAuth client credentials. (d) bcrypt/scrypt hashing of the token.

**Why.** Tokens are high-entropy random strings, so a fast one-way hash is the
right tool — unlike passwords, there is no low-entropy input to brute-force, so
sha256 gives single-hash O(1) lookup by `getByHash` while remaining
unrecoverable if the database leaks (`tokens.ts` lines 26–30). Lookup still does
a `timingSafeEqual` confirm, checks expiry, and requires an `active` user
(`authenticate`, lines 70–84). Keeping tokens **out of the sync log** is a
deliberate security boundary: bearer secrets must never ride the real-time
delta stream to every connected client. A stored `prefix` (first few chars)
lets the UI show *which* token without revealing it, and `lastUsedAt` is touched
on each use for auditing. JWTs were overkill for a self-hosted tool and would
make server-side revocation harder.

**Consequences.** A token, once shown, is unrecoverable — lose it and you mint a
new one. Because they are non-synced, token management is a REST-only surface
(list/create/revoke), not something that appears in the live client store. Note
this is distinct from Linear-style *public API tokens* / OAuth apps, which are
**not yet** built — the roadmap lists a public API + GraphQL under P3.

---

## 9. Dual authentication at the transport edge

**Decision.** Every authenticated request resolves a user one of two ways: the
browser **session cookie** (`nl_session`, scrypt-hashed) *or* an
`Authorization: Bearer <token>` header. A single `resolveUser` helper in
`apps/api/src/server.ts` (lines 58–66) tries the bearer token first, then falls
back to the cookie.

**Context.** The same routes serve the browser (cookie) and machines (token).
We did not want two parallel route trees or a separate "API" surface with
divergent behavior.

**Alternatives considered.** (a) A separate authenticated API namespace for
programmatic clients. (b) Cookie-only, forcing scripts to fake a login.
(c) Token-only, forcing the browser to manage bearer tokens in JS (and exposing
them to XSS).

**Why.** Browsers get the security properties of a same-origin, HttpOnly session
cookie (no token sitting in JS reach of XSS); machines get a stateless bearer
header. One `preHandler` (`requireUser`) guards every route including the
WebSocket upgrade (`server.ts` line 132), so REST, WS, and MCP all share exactly
one authorization model and one user-resolution path. Passwords use scrypt (slow,
salted — right for low-entropy secrets); tokens use sha256 (see §8) — the two
credential types are hashed appropriately for what they are.

**Consequences.** Auth is same-origin cookie based, so production **must** put
HTTPS in front and set `SECURE_COOKIES=true` (called out in `CLAUDE.md` known
gaps). There is no rate limiting on auth today. The dual path is a small branch
in one function, which is the whole appeal — the cost is that both credential
types must be kept working together in every transport.

---

## 10. Agent-as-teammate via scoped webhooks

**Decision.** Agents are modeled as **first-class users** (`isAgent`) that you
assign issues to and `@mention`, created by an admin (`POST /api/agents`) and
given a minted token (agents can't log in). A webhook with `agentUserId` set
fires **only** on events where that agent is the assignee or is `@mentioned`
(`WebhookService`, `packages/core/src/services/webhooks.ts`).

**Context.** Linear's 2025–26 direction is assignable agents that behave like
teammates. We wanted the self-hosted analog: an agent you interact with using
the *same* primitives as a human — assignment, mention, comment — not a bolt-on
bot API.

**Alternatives considered.** (a) A dedicated bot/automation API distinct from
users. (b) Firing every webhook and making the agent filter events itself.
(c) A polling agent that scans for its assignments.

**Why.** Making the agent a user means assignment, mentions, notifications, and
activity records all work with zero special-casing in the issue/comment
services — the agent shows up in pickers and @mention autocomplete like anyone.
The **scoping** is what makes it efficient and safe: `scopeDeltas` drops any
delta that doesn't `involveAgent`, and `involvesAgent` (lines 82–97) checks the
concrete signal — for an issue delta, is the agent the `assigneeId` or a
subscriber; for a comment, does the body match a word-boundary `@handle` regex
against the agent's `displayName`. So an agent's endpoint only ever receives the
events meant for it, cutting both noise and the blast radius of a compromised
endpoint. `examples/agent/` is a runnable reference of the full assign/mention →
webhook → comment-back loop.

**Consequences.** Mention detection is a regex over comment text keyed on
`displayName`, so an agent's display handle effectively becomes its mention
identity — renaming an agent changes what it responds to. Webhooks are
**fire-and-forget** (5s timeout, no retry queue — `CLAUDE.md` known gaps), so a
briefly-down agent endpoint misses events rather than getting them redelivered.
That is an accepted simplification for now; a durable delivery queue is future
work.

---

## 11. User preferences on the synced User, not localStorage

**Decision.** User preferences (theme, font size, first day of week, display-name
style, notification settings) live on the **User entity** and sync across
devices like any other field. The web app mirrors only theme/font to
`localStorage`, purely to avoid a flash before bootstrap
(`apps/web/src/preferences.ts`).

**Context.** A user logging in on a second device should see their workspace the
way they set it up, including dark/light theme and density.

**Alternatives considered.** (a) `localStorage` as the source of truth (simplest,
zero server work). (b) A separate per-device settings store.

**Why.** Preferences-on-the-user means they follow the person, not the browser —
change your theme on your laptop and your phone agrees, because it arrives as an
ordinary sync delta on the `user` model. The `localStorage` copy is a
first-paint optimization only: `applyStoredPreferences` reads the last-known
theme/font *before* bootstrap completes so the first frame isn't wrong, then
`applyPreferences` takes over from the synced value (`preferences.ts` lines
25–58). `personName` and `firstDayOfWeek` read straight from the synced
preferences, so name-display and calendar behavior are consistent everywhere.

**Consequences.** Preferences are workspace-account-wide, not per-device — you
can't have dark on the laptop and light on the phone. That is the intended
Linear-like behavior. The `localStorage` mirror is best-effort and wrapped in
try/catch for private-mode browsers where it throws; if it's unavailable you
get a one-frame flash and nothing worse.

---

## 12. Mobile via responsive CSS + drawer, not a separate app

**Decision.** Mobile support is a **responsive pass over the existing SPA**: a
single `@media (max-width: 820px)` block in `apps/web/src/styles.css` turns the
sidebar into an off-canvas drawer (`.app.nav-open .sidebar`, a `.nav-backdrop`),
stacks issue/document detail panels vertically, and collapses settings nav. There
is no separate mobile codebase and no native app.

**Context.** People do open issue trackers on their phones, but a self-hosted
clone can't justify a second front-end, and native iOS/Android is an explicit
non-goal (`ROADMAP.md`).

**Alternatives considered.** (a) A separate mobile web app or React Native app.
(b) A distinct mobile route tree/components. (c) Desktop-only, punting mobile
entirely.

**Why.** One responsive layout over the same components means every feature works
on mobile for free the day it ships on desktop — no parity gap between a "real"
app and a lesser mobile one. The drawer pattern (fixed, translate-off-canvas,
backdrop to dismiss) is the standard way to reclaim horizontal space on a phone
without hiding navigation. It costs a bounded amount of CSS and no new bundle.

**Consequences.** This is a responsive *web* experience, not an installable app:
a **PWA manifest and offline support are not yet built** — they sit under P3 in
`ROADMAP.md` ("ship a PWA manifest + responsive layout pass first"). Pointer-
event drag (§6) works with touch pointers, so reordering functions on mobile,
but the experience is tuned for desktop-first keyboard-driven use. Native apps
remain a declared non-goal.

---

## 13. Parity strategy: P1/P2 shipped, P3 deferred

**Decision.** Sequence the build against Linear's marketed product using Linear's
own **Intake → Plan → Build → Monitor** frame (`ROADMAP.md`), shipping the core
build plus **P1 and P2** in full, and deliberately **deferring P3** (platform &
scale) until asked.

**Context.** "Clone Linear as closely as practical" is unbounded — Linear is a
large, moving product. We needed a defensible cut line between what a
self-hosted clone must have to feel like Linear and what is either large-scope
or ecosystem-dependent.

**Alternatives considered.** (a) Chase every marketed feature breadth-first.
(b) Ship a minimal core and stop. (c) Prioritize by our own guess rather than
Linear's product framing.

**Why.** Organizing the roadmap by Linear's own product frame keeps the target
legible and makes "are we at parity?" answerable area by area. P1 (saved views,
search, templates, health updates, timeline, snooze/reminders, duplicate
detection, archive) and P2 (customers + requests, public intake + Slack,
inline doc comments, triage rules, Slack webhooks, CSV import/export,
notification prefs + email digest, configurable estimates + velocity/burn-up)
are the features that make the tool *feel* like Linear in daily use, so they
shipped. P3 items are either genuinely large (GraphQL API, SSO/SCIM, Diffs/code
review) or hang off ecosystems a self-hosted install doesn't sit in — those are
explicitly deferred, and the marketplace/CRM connectors are declared non-goals
"for now."

**Consequences.** Some real gaps are known and *chosen*: no public API tokens or
GraphQL yet (REST + personal tokens only), no custom dashboards, no Pulse
activity digest, no BYO-key AI features, PWA/mobile-native, Azure Blob adapter
(the `BlobStore` interface in `packages/core/src/blob.ts` is the seam; fs volume
is today's attachment store), SSO, and audit log. "Continue toward parity" has a
defined meaning: pick from the top of P3. This keeps scope honest — the doc set
never claims a feature the code doesn't have.

---

## How to extend this log

When you make a decision that would be expensive to reverse — a new storage
engine, a change to the sync protocol, a new auth surface, a departure from any
choice above — add an entry here in the same five-part shape. The value of this
doc is entirely in recording the *alternatives you rejected and why*, because
that is the context a future teammate (or a future you) cannot reconstruct from
the code alone. Keep entries tight; depth on the load-bearing calls beats
breadth across trivia.
