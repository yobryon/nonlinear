# Design decision log

This is the institutional-memory doc for **nonlinear**, the self-hostable Linear
clone. It records the load-bearing decisions — the ones that shaped the code and
would be expensive to reverse — with enough context that a new teammate can
understand not just _what_ we built but _why_, and what we gave up.

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

**Why.** Sharing _the actual TypeScript types_ — not a generated approximation —
means a change to an entity is a compile error on every side that hasn't caught
up, caught by `pnpm typecheck` before it ships. `packages/shared` deliberately
has no runtime dependencies and no database driver, so it is safe for the
browser bundle to import wholesale. Linear's own priority scheme
(`0=None 1=Urgent…4=Low`) and state categories live here as enums
(`packages/shared/src/enums.ts`) so the ordering logic is identical on both ends.

**Consequences.** Everything is TypeScript, which constrains hiring and rules
out a faster runtime for the hot path — an acceptable trade for a low-traffic
self-hosted tool. One subtlety bites newcomers: tests resolve workspace
siblings from _source_ via vitest aliases, but `tsc` and Docker resolve them
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
(`SyncDelta` in `packages/shared/src/sync.ts`); `data` is the _entire_ entity
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
source of truth is _current entity state_ in jsonb, and we did not want to carry
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
reminders/customer-requests cleanup — are injected as _optional_ dependencies
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
route handler _could_ embed logic; code review is the guardrail.

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
that drop into the _exact_ same gap concurrently can produce equal keys; the
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
optimistically the instant an item moves, the DOM _does_ change near dragstart,
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

> **Superseded by [entry 18](#18-sortablejs-over-the-hand-rolled-drag-engine).**
> The hand-rolled engine lacked touch support: on a phone, once a list
> overflowed, a drag fought the page scroll. We replaced it with SortableJS.

---

## 7. MCP server in-process, not a separate container

**Decision.** The MCP server is mounted **in the API process** at `/mcp`
(Streamable HTTP, `@modelcontextprotocol/sdk`), constructed as a protocol
adapter over the same in-process `Domain` (`apps/api/src/mcp.ts`). It is
deliberately _not_ a separate container or a separate service.

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
lets the UI show _which_ token without revealing it, and `lastUsedAt` is touched
on each use for auditing. JWTs were overkill for a self-hosted tool and would
make server-side revocation harder.

**Consequences.** A token, once shown, is unrecoverable — lose it and you mint a
new one. Because they are non-synced, token management is a REST-only surface
(list/create/revoke), not something that appears in the live client store. Note
this is distinct from Linear-style _public API tokens_ / OAuth apps, which are
**not yet** built — the roadmap lists a public API + GraphQL under P3.

---

## 9. Dual authentication at the transport edge

**Decision.** Every authenticated request resolves a user one of two ways: the
browser **session cookie** (`nl_session`, scrypt-hashed) _or_ an
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
the _same_ primitives as a human — assignment, mention, comment — not a bolt-on
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
theme/font _before_ bootstrap completes so the first frame isn't wrong, then
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

**Consequences.** This is a responsive _web_ experience, not an installable app:
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
are the features that make the tool _feel_ like Linear in daily use, so they
shipped. P3 items are either genuinely large (GraphQL API, SSO/SCIM, Diffs/code
review) or hang off ecosystems a self-hosted install doesn't sit in — those are
explicitly deferred, and the marketplace/CRM connectors are declared non-goals
"for now."

**Consequences.** Some real gaps are known and _chosen_: no GraphQL API yet
(REST + personal Bearer tokens only), no custom dashboards, no Pulse activity
digest, no BYO-key AI features, PWA/mobile-native, and the Azure Blob adapter
(the `BlobStore` interface in `packages/core/src/blob.ts` is the seam; fs volume
is today's attachment store). SSO, SCIM, and the audit log have since shipped
(see entry 14). "Continue toward parity" has a defined meaning: pick from the top
of P3. This keeps scope honest — the doc set never claims a feature the code
doesn't have.

---

## 14. Enterprise auth as config-gated transport adapters

**Decision.** Add OIDC single sign-on, SCIM 2.0 user provisioning, and a
workspace audit log — but keep every piece a thin adapter over the existing
`Domain`, gated by configuration, so a small self-hosted install pays nothing
for capabilities it doesn't use. SSO (`apps/api/src/sso.ts`) and SCIM
(`apps/api/src/scim.ts`) sit beside `github.ts` and `mcp.ts`; the domain gains
only `AuthService.findOrProvisionSso`, `AuthService.provisionMember`,
`UserService.setActive`, and an `AuditService`. The OIDC subject↔user link is
stored in the auth layer (`sso_identities`), never on the synced `User`.

**Context.** SSO/SCIM/audit are the checklist items that gate adoption by any
organization with an IdP, and they were the top of P3's platform tier. But they
are also the classic place a clone bloats: an always-on identity subsystem, a
new session model, IdP-specific branches. The founding constraints (low
cost/resource, containerized, modular) argue against any of that being
mandatory.

**Alternatives considered.** (a) A dedicated auth service/container (Keycloak,
Ory) fronting the app — heavy, a second moving part, against the
single-small-process constraint. (b) A generic auth library abstracting many
providers — more surface than "verify one OIDC provider" needs. (c) Put the
OIDC HTTP handshake inside `packages/core` — but discovery, token exchange, and
JWKS are transport I/O; core stays pure domain, so the handshake belongs in an
API adapter that hands _normalized claims_ to the domain. (d) Model the SSO
subject as a field on `User` — but `User` syncs to every client, and the IdP
subject is a security identifier that shouldn't cross the sync boundary. (e)
Record audit events inside each service — but actor and IP live at the transport
edge, and threading them through every domain call is invasive; the audit write
is a cross-cutting concern recorded at the route/adapter layer.

**Why.** OIDC verification is security-sensitive, so we use `jose` (zero-
dependency, well-audited) for JWKS + ID-token verification rather than hand-
rolling JWT crypto — the one place "write it ourselves" would be reckless. The
account-resolution policy (match by stable subject → link an existing account by
email → JIT-provision a member if allowed) lives in the domain and is unit-
tested independently of the HTTP flow, so the risky wire protocol and the risky
business logic are separable and separately verifiable. Audit events are
**not** synced: they are admin-only and can grow without bound, so they are read
through a paged `GET /api/audit` with a stable `(createdAt, id)` cursor — a plain
`createdAt` cursor would silently drop or duplicate rows when a bulk operation
(e.g. SCIM syncing hundreds of users) writes many same-millisecond events.

**Consequences.** With `OIDC_ISSUER`/`SCIM_TOKEN` unset, none of this registers —
the login page shows only the password form and `/scim/*` 404s, so the default
install is unchanged. SCIM covers Users, not Groups: team membership in
nonlinear is a product decision, not an IdP-driven one. Deactivation (SCIM
DELETE/PATCH `active:false`, or an admin) revokes sessions and is guarded so the
last active admin can't be locked out. Verified end-to-end in Docker against a
mock OIDC provider (discovery → PKCE → code exchange → ID-token verification →
JIT provision → session), plus the SCIM lifecycle over HTTP and the audit log in
the UI. The seam means a future SAML or LDAP provider is another adapter, not a
rewrite.

---

## 15. Azure Blob adapter in the API layer, not core

**Decision.** Implement the `BlobStore` seam against Azure Blob Storage as
`createAzureBlobStore` in `apps/api/src/blob-azure.ts` — the API composition
layer — rather than in `packages/core`, and select it at boot when
`AZURE_BLOB_CONNECTION_STRING` is set. Content type is stored natively on the
blob (no `.meta` sidecar the fs store needs).

**Context.** Attachments on a local fs volume don't survive a stateless
container — the exact gap between "runs on my Docker" and the founding
constraint that "a person or organization could self-host on Azure." The
`BlobStore` interface was designed for a third implementation from the start
(entry 2 and doc 04); this fills it. The only real question was _where the Azure
SDK lives_.

**Alternatives considered.** (a) Add `createAzureBlobStore` to
`packages/core/src/blob.ts` beside the memory/fs stores — but then every
consumer of `core` (including the pure-domain unit tests and `STORAGE=memory`
runs) pulls in `@azure/storage-blob` and its transitive deps for a backend most
never use. (b) A new `packages/storage-azure-blob` package — correct isolation,
but ceremony out of proportion to one ~50-line factory. (c) Put it in the API
layer, which already owns infra selection (it imports `createPostgresStorage`,
wires nodemailer, chooses the fs vs memory blob store) — the SDK stays off
`core`'s dependency graph with no new package.

**Why.** (c). The blob backend is an infrastructure choice, and the API's
`index.ts` is already the one place infrastructure is chosen; the Azure SDK
belongs where the Postgres driver's analogue already is by spirit —
_not in core_. `core` keeps exporting only the `BlobStore` _interface_ and its
memory/fs reference stores, so its "no infra drivers" property holds. Selection
is a three-way branch (Azure if configured, else fs for Postgres, else memory),
identical in shape to the storage-engine selection.

**Consequences.** A real Azure deploy points `AZURE_BLOB_CONNECTION_STRING` at a
Storage account and attachments become durable and stateless-container-safe;
the default self-host path is unchanged (fs volume). Verified end-to-end against
the Azurite emulator: an attachment uploaded through the app is PUT to Azure
Blob and read back byte-identical, with `docker-compose.azuretest.yml` as a
reproducible harness and an env-gated integration test
(`AZURE_BLOB_TEST_CONNECTION_STRING`, skipped otherwise, like the Postgres
tests). The same seam now has three implementations, so a future S3 or GCS
adapter is the same exercise. This closes the last infrastructure gap to Azure
portability; what remains for a real deploy is the IaC to stand up the services,
not application code.

---

## 16. Dashboards, Pulse, and BYO-key AI — compute-on-read, key-off-the-wire

**Decision.** Ship three Monitor/Build-tier features as a set: **custom
dashboards** as a synced `Dashboard` entity whose tiles render client-side from
the already-normalized store; **Pulse** as a cross-workspace digest computed on
demand from existing entities with no new storage; and **BYO-key AI** as an
optional, admin-configured LLM integration whose key is stored server-side and
never synced. AI powers a Pulse summary and issue label suggestions.

**Context.** Linear's Monitor surface (dashboards, Pulse) and its 2025–26 AI
direction (suggested labels, activity summaries) were the last big product-tier
gaps. The self-host constraints shape all three: low resource (don't add compute
or storage we don't need), modular, and — for AI — no mandatory cloud dependency
or key handling that could leak.

**Alternatives considered.** (a) _Dashboards:_ store precomputed tile data, or
compute metrics server-side. Rejected — the client already holds every issue,
project, and cycle in its normalized store, so a tile is a pure function of
state the browser has; server-side metric endpoints would duplicate the Insights
math and add round-trips. Tiles live inline on the dashboard document (one jsonb
row) rather than as their own entity, because a tile has no identity outside its
dashboard. (b) _Pulse:_ a materialized activity table fed by every mutation.
Rejected — the audit log already exists for security events, and a _product_
activity digest is a read-time projection of project updates + completions +
cycles the store already has; computing it on read (bounded by a time window)
avoids a second event pipeline and keeps writes cheap. (c) _AI:_ a hosted
inference dependency, or per-user keys. Rejected — a self-hosted tool shouldn't
require our cloud, and a workspace-level admin key matches how a team actually
buys LLM access. The provider HTTP call is a transport adapter (`llm.ts`), like
sso/scim/digest, so the domain owns only _settings_.

**Why.** Compute-on-read keeps dashboards and Pulse free of new write paths and
storage growth — the load a self-host install can least afford. The AI key is
the sensitive bit: it lives in a non-synced `ai_settings` singleton, the sync
boundary never carries it, and the client only ever receives `AiSettingsPublic`
(`{enabled, provider, model, hasKey}`). Every AI feature is gated on
`domain.ai.isReady()`, so with nothing configured the buttons never render and
`/api/ai/*` refuses — the default install has no AI surface at all. The LLM wire
format (Anthropic Messages, OpenAI Chat) is unit-tested against a mocked fetch,
and label-suggestion parsing is tested independently of any live key.

**Consequences.** Dashboards recompute on every render from the store; at
self-host scale that is trivial and always fresh, but a workspace with very many
issues would eventually want memoization or windowed queries. Pulse is a
point-in-time read with no history table, so it cannot show activity older than
what the entities themselves retain. AI is best-effort: a provider outage or a
bad key surfaces as an `LlmError` toast, never a broken page, and suggestions are
advisory (the user clicks to apply a label). Verified in Docker: dashboards
render live tiles, Pulse groups real activity by day, and the AI gating shows
the summarize/suggest affordances only when a key is configured.

---

## 17. GraphQL as another adapter; PWA hand-rolled, not Workbox

**Decision.** Add a **GraphQL API** at `POST /api/graphql` as a code-first
schema over the existing `Domain`, and make the web app an installable **PWA**
with a hand-written service worker — no PWA framework, no Workbox.

**Context.** Linear's public API is GraphQL, so a clone that wants API parity
needs a GraphQL surface; and "PWA/mobile" was the last Monitor-adjacent P3 item,
the cheap path to install + offline without a native app. Both had to fit the
established seams (transport adapters over one in-process domain) and the
low-dependency, ~100 KB-SPA constraints.

**Alternatives considered.** (a) _GraphQL server:_ Mercurius (Fastify-native) or
Apollo Server. Rejected as more framework than needed — the reference `graphql`
package plus a Fastify route is a thinner adapter that reuses the exact
cookie/Bearer auth REST already has. (b) _Schema-first (`buildSchema` + SDL):_
concise, but it can't attach field resolvers, so nested reads (issue → team,
assignee, labels) would need eager pre-resolution. Code-first
(`GraphQLObjectType` with `resolve`) gives proper lazy resolution. (c) _N+1
avoidance:_ DataLoader per request. Rejected as overkill at self-host scale —
instead each request loads the whole (small) store into id-maps once
(`graphqlContext`), so every field resolver is a `Map.get`. (d) _PWA:_ the
`vite-plugin-pwa`/Workbox stack. Rejected — it pulls a build-time dependency and
a large generated worker for what is, here, ~60 lines: network-first
navigations with an offline-shell fallback, cache-first for Vite's already-hashed
`/assets/`, and never caching API traffic.

**Why.** GraphQL is _another view of the same domain_, not a second backend —
the schema resolvers call the same `IssueService`/`CommentService` as REST and
MCP, so business rules can't diverge. The per-request store snapshot is the same
trick the bootstrap already uses (load-all is cheap when the dataset is a
self-host workspace), and it keeps resolvers trivial and N+1-free. For the PWA,
hashed assets are immutable by construction, so cache-first can never go stale;
navigations stay network-first so a new `index.html` ships immediately but the
app still opens offline. Hand-rolling the worker keeps the dependency budget and
the behavior fully legible.

**Consequences.** The GraphQL surface is deliberately a useful subset (viewer,
teams, issues/projects with nested fields; create/update/delete issue,
create comment), not a full mirror of REST — it demonstrates the pattern and
extends field-by-field. Its load-all-per-request context is fine at self-host
scale but is the first thing to revisit under large datasets (add DataLoader or
scoped queries). The PWA offline story is an _app-shell_ one: the shell and
static assets work offline, but data needs the API — there is no offline
mutation queue, which suits a real-time server-authoritative tool. Verified in
Docker: GraphQL query + mutation over HTTP against Postgres, and the service
worker active with the shell cached (installable, opens offline). Icons are
generated at build-authoring time by a small Node PNG encoder (no image
dependency in the tree).

---

## 18. SortableJS over the hand-rolled drag engine

**Decision.** Replace the custom pointer-drag engine (entry 6, `dragdrop.ts` +
`useDragReorder`) with **SortableJS**, wrapped in one small React component
(`apps/web/src/sortable.tsx`). Every drag surface — the issue board and grouped
list, plus favorites/workflow-states/milestones reordering — now goes through it.

**Context.** The hand-rolled engine worked on desktop but had no real touch
story: with `touch-action` untamed, a drag on a phone competed with page scroll,
and once a list overflowed the viewport, scrolling won — dragging was effectively
broken on mobile. It also had no autoscroll, so you couldn't drag an item past
the visible edge of a long list. These are exactly the wheels a DnD library has
already invented, and re-inventing them (a mobile long-press recognizer, an
autoscroll loop, touch-action management) is real, bug-prone work.

**Alternatives considered.** (a) _Extend the hand-rolled engine_ with a touch
long-press recognizer + autoscroll — the "keep owning it" path, but it's the
fiddly part of DnD and the reason to reach for a library. (b) _dnd-kit_ — modern
and accessible, but ~18 KB gzipped and its API leans toward you re-implementing
sortable semantics; our fractional-order + cross-group logic would need
significant glue. (c) _SortableJS_ — ~12–13 KB gzipped, framework-agnostic, with
the two things we were missing **built in**: touch activation via
`delay` + `delayOnTouchOnly` (a short press starts a drag, so a plain touch still
scrolls) and autoscroll while dragging near an edge.

**Why.** SortableJS solves the actual bug (mobile scroll-vs-drag) out of the box
and is a smaller, better-fitted dependency than dnd-kit for a codebase that
already computes its own order. It moves the DOM itself, which conflicts with
React owning render — so the wrapper reads the intended neighbors from the
post-drop DOM, then **reverts** SortableJS's mutation so the DOM matches React's
last render, and hands a logical `{id, toGroup, beforeId, afterId}` to the
caller. The caller computes the fractional `keyBetween` from the neighbors'
`sortOrder` and (for cross-group drops) the grouped-field patch — the same
ordering logic as before, now behind a stable seam. The owner explicitly asked
to stop hand-rolling DnD; this honors that.

**Consequences.** The SPA grows ~+20 KB gzipped (to ~146 KB) — over the original
~100 KB target, but that budget was already exceeded by feature growth, and the
owner chose the trade for robust cross-platform DnD we don't maintain. Drag is
now genuinely usable on touch: verified in a real browser that a quick touch
scrolls while a long-press starts a drag, that reorders persist, and that
cross-status drags reassign the grouped field. Keyboard-accessible reordering is
still out of scope (as in entry 6). `dragdrop.ts` and `useDragReorder` are
deleted; the drop indicator is now SortableJS's ghost placeholder styled in
`styles.css`, not the old custom insertion line.

---

## 19. Single trust domain, documented — not silently implied

**Decision.** State plainly, in the guides and here, that a nonlinear instance is
**one trust domain**: every authenticated principal — human member, `guest`, or
agent token — receives the *entire* workspace on bootstrap (`extras.ts` `payload`)
and over live sync (`hub.ts` `visibleTo`). The `private` team flag, team
membership, and the `guest` role exist as data but are **not** enforced as read
boundaries. Rather than ship a half-isolation that reads as security, we document
the boundary, give three deployment patterns, and file the closing work as a
dogfooded backlog (the "Provider ↔ Consumer readiness" project in team `NON`,
issues NON-27…NON-34).

**Context.** The owner's use case is a shared hub where provider teams (a
component like `augrid`, a toolset like `dynamics-tools`, nonlinear itself) run
their delivery *and* let consumers — humans and agents — file and track bugs and
requests. A red-team of the access model found the isolation primitives are
cosmetic for reads: bootstrap returns `s.*.all()` unfiltered; the hub's per-owner
filter only covers notifications/favorites/views/reminders/dashboards. A `private`
team is only "don't auto-join on registration," and `guest` branches nowhere.

**Alternatives considered.** (a) _Quietly add team-scoped filtering now_ — the
"just fix it" path, but real isolation touches bootstrap, the sync hub replay,
every MCP/REST read, and token scoping (NON-28); done hastily it invites partial
leaks that *look* safe, which is worse than a documented single domain. (b) _Leave
it undocumented_ — the status quo, which had already produced a live footgun: an
open "create account" that let anyone see everything (fixed in the registration
work), and a `private` flag that implies isolation it doesn't provide. (c)
_Document the boundary, pattern around it, and backlog the fix_ — chosen.

**Why.** The honest boundary is itself useful: for the owner's actual situation —
their own products and their own agents — one instance is *one trust domain by
construction*, and everything works (teams-as-products, intake, agent tokens, the
assign/@mention → webhook → comment-back loop, roadmaps). The gap only bites when
a *mutually-distrusting third party* needs a credential, and for that the guides
prescribe Pattern B (one instance per product — cheap on burstable tiers) or
Pattern C (untrusted consumers use write-only public intake). Naming the boundary
lets an operator choose correctly; a silent half-measure would not.

**Consequences.** Three audience guides live in `docs/guides/` (humans, provider
agents, consumer agents), each opening with the trust-domain reality; the README
and `docs/guides/README.md` index them. The identity model is stated where it
trips people: **the token is the identity** — an agent's credential must be minted
via `POST /api/agents/:id/tokens`, not the personal Profile → API tokens flow
(whose misdirecting UI copy is NON-29). The closing work is real, prioritized, and
visible in-product: NON-27 (enforce team-scoped isolation), NON-28 (scoped
tokens), NON-30 (consumer read-back for intake), NON-31 (make `guest` real). Until
those land, "one instance = one trust domain" is the load-bearing rule.

---

## 20. Team-scoped isolation and scoped tokens — the trust boundary, enforced

**Decision.** Turn entry 19's *documented* boundary into an *enforced* one. A
non-admin now reads only the teams they are a member of; admins still see the
whole workspace. Team membership and the `private` flag gate reads (they were
cosmetic). The `guest` role is real (guests auto-join nothing; an admin grants
teams one by one). API tokens carry a scope — a subset of the owner's teams
and/or read-only — that can only *narrow* authority. Filtering lives in one
place (`packages/core/src/services/visibility.ts`) and is applied by both the
bootstrap snapshot and the live sync hub.

**Context.** Entry 19 named nonlinear a single trust domain and chose to
document + backlog rather than ship a half-isolation. The owner then asked to
close the backlog (issues NON-27, NON-28, NON-31). The load-bearing risk was the
sync system: bootstrap returned `.all()` and the hub broadcast every delta, so
any change had to cover the full snapshot, live deltas, replay-on-reconnect, and
membership changes — without reordering deltas or breaking the client.

**Alternatives considered.** (a) _Per-delta async membership lookups in the hub_
— correct but adds a DB round-trip per delta per connection and makes the
broadcast async, risking reordering. (b) _Row-level filtering pushed into
storage queries_ — spreads the visibility rules across every store method and
both storage engines. (c) _One visibility module + synchronous hub indexes_ —
chosen: `visibilityFor` resolves a user's team set once; `filterPayload` narrows
the snapshot with in-memory maps; the hub keeps small indexes (issue→team,
comment→issue, project→teams, doc→project, membership) fed from the delta stream,
so filtering stays synchronous and ordered. A connection resolves its visible
teams *before* joining the broadcast; a membership change to a connected user
triggers a clean rebootstrap.

**Why.** The visibility rules are subtle (comments resolve through their issue,
milestones through their project, labels may be workspace-global) and must be
identical on the snapshot and the stream — one module keeps them honest and
testable. Synchronous hub indexes preserve the existing ordering guarantees that
the sync protocol depends on. Scoped tokens compose by intersection, so an
admin's scoped token is safe to hand a consumer. Enforcing at the read boundary
(bootstrap + hub + MCP), rather than per-write, targets the actual exposure the
red-team found.

**Consequences.** nonlinear can now host mutually-distrusting consumers in one
instance: give a consumer a guest account added only to your team, or a token
scoped to it — they see that team and nothing else. Running one instance per
product is now a maximum-isolation option, not the only way. New surfaces to
keep in sync when adding a synced model: add its visibility rule to
`filterPayload` *and* the hub's `visibleTo`/indexes (a model that resolves to a
team through a parent needs an index). Write-side enforcement was initially
deferred, then closed once dogfooding showed the inconsistency: the MCP blocked
writes to unseen teams (via `resolveTeam`) but REST/GraphQL did not, so a
credential could create an issue in a team it couldn't read. All create paths
now assert team access (membership ∩ token scope) before writing —
`requireTeamAccess` in the REST routes and a `vis` check in the GraphQL
mutations — mirroring the MCP; the intended cross-team channel remains public
intake (unauthenticated, needs no membership). Public intake also gained a
signed status link, so anonymous submitters can track without an account
(entry 19's write-only caveat no longer holds). The three audience guides were
updated to describe the enforced model, including that you can only file into a
team you can see.

---

## 21. Internal intake — a third visibility tier between member and outsider

**Decision.** Add a middle tier to the trust model: a team can accept **internal
intake** (a `Team.internalIntake` flag, **on by default**; public intake is a
superset that implies it). An authenticated workspace member/agent who is *not*
a member of an internal-intake team may see its **shell** (metadata, roster,
workflow states, labels), **file** issues to it as themselves, **comment** on the
issues they filed, and **track** only those — but never the team's other issues,
projects, docs, or edit anything. Poles unchanged: full membership (see/do
everything) and anonymous public intake (write + signed status link, no login).

**Context.** After entries 19–20 the model was binary: member (full) or outsider
(public intake only). That left a real gap the owner hit running an internal
fleet of agents and teams — a registered member/agent who *uses* team A's product
but isn't on team A had no way to file to A and follow up as themselves. Public
intake fit poorly (anonymous, admin-attributed, tracked by out-of-band URLs when
the filer is a *known* entity already in the system), and full membership
over-shares (exposes A's whole backlog/roadmap). The want: cross-team
communication with a modicum of accident-defense, without going wide-open and
without agents juggling special URLs for things they filed.

**Alternatives considered.** (a) _Full RBAC_ (roles × permissions × resources) —
too heavy for the need and against the project's low-complexity grain. (b) _An
"authenticated public intake" endpoint_ — a parallel write path attributing to
the real user, but the filer still couldn't *track* their issue through the
normal store (the client needs the team shell + their issues synced), so it
would need its own read path anyway. (c) _A third visibility tier woven through
the one visibility module_ — chosen: it reuses the load-bearing
bootstrap/hub/write-gate machinery from entry 20, and "track what I filed" is a
precise query because issues already carry `creatorId`.

**Why.** One `Visibility` now carries `teamIds` (member) **and** `intakeTeamIds`
(intake) **and** `userId`; every read/write site already routed through that
module (filterPayload, the sync hub, `requireTeamAccess`, the MCP resolvers), so
the tier slots in as `canIntakeTeam` (member-or-intake, for filing/shell reads)
and `canReadIssue` (member-team issues, or your own in an intake team). On by
default makes the fleet frictionless; a team seals itself by toggling it off.
Legacy jsonb team rows lack the flag, so `effectiveInternalIntake` treats missing
as on — no migration. Edit/delete/projects stay member-only, so intake is
genuinely "file + follow up", not a write-anywhere hole.

**Consequences.** The MCP surfaces the tier so a fleet agent needs no
provisioning: `whoami.intakeTeams`, `list_teams` `access: member|intake`,
`create_issue` into intake teams, `my_work.filed`. Web: the team's Visibility &
access settings gain the toggle, and the sidebar Teams nav lists only member
teams (intake shells are filing targets, not nav sections; humans file via New
Issue and track via My Issues → Created). New rule when adding a synced model:
decide its tier — most team-scoped models are member-only, but anything a filer
needs to interpret their own issue (states, labels) belongs to the shell. The
sync hub gains an issue→creator index and rebootstraps connections when intake
topology changes (a team toggling the flag). Guests get intake access too (it's
low-privilege and serves discovery); tighten later if a use case demands it.

---

## How to extend this log

When you make a decision that would be expensive to reverse — a new storage
engine, a change to the sync protocol, a new auth surface, a departure from any
choice above — add an entry here in the same five-part shape. The value of this
doc is entirely in recording the _alternatives you rejected and why_, because
that is the context a future teammate (or a future you) cannot reconstruct from
the code alone. Keep entries tight; depth on the load-bearing calls beats
breadth across trivia.
