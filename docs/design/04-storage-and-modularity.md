# Storage modularity & the Domain seam

This document explains the two seams that keep nonlinear portable: the
**storage interface boundary** in `packages/core/src/storage.ts`, through which
every persisted byte flows, and the **Domain-as-core / transports-as-adapters**
shape that lets REST, WebSocket, GitHub, intake and MCP all be thin skins over
one in-process `Domain`. It covers why persistence is a jsonb-document-per-row
design on Postgres, why a handful of tables break that rule on purpose, how
migrations run, where attachments live (`BlobStore`), and what all of this buys
us against the "Azure is the eventual target" constraint — plus the limits we
knowingly accepted.

If you have not read `03-real-time-sync.md`, read it first: the sync log is one
of the storage interfaces, and the two documents are two halves of the same
persistence story. This one is about the shape of the boundary; that one is
about what flows across it.

## The load-bearing rule

The owner's fifth hard constraint (`CLAUDE.md` → "Hard constraints") is stated
in one sentence and enforced by the code:

> All persistence goes through the interfaces in `packages/core/src/storage.ts`.
> No package outside `storage-*` may import a database driver. `STORAGE=memory|postgres`
> selects the engine at API startup.

Everything in this document is a consequence of taking that rule literally. The
domain services in `packages/core/src/services/*` never see a SQL string, a
connection pool, or the word `jsonb`. They see the interfaces in `storage.ts`
and nothing else. The two implementations — the in-memory reference in
`packages/core/src/memory.ts` and the Postgres adapter in
`packages/storage-postgres` — are the only code in the repo that knows how rows
are actually stored, and only one of them (`storage-postgres`) imports a driver
(`pg`).

You can verify the rule holds mechanically: `pg` appears in exactly one
package's dependencies, and a grep for `from 'pg'` or `import pg` outside
`packages/storage-postgres` returns nothing. That is the whole invariant.

## Why a storage seam at all

Linear is a hosted product with one backend. nonlinear is a _self-hostable
clone_ whose owner wants it to run three ways that pull in opposite directions:

- **Zero-dependency dev / test.** `STORAGE=memory pnpm --filter @nonlinear/api dev`
  boots the entire product with no database at all. The test suite
  (`vitest`) constructs a `Domain` over `createMemoryStorage()` thousands of
  times without touching Postgres. This keeps the inner loop fast and makes
  business-logic tests hermetic — they exercise real services against real
  storage semantics, just an in-process implementation of them.
- **Cheap self-host.** `docker compose up` runs one small API container against
  `postgres:16-alpine` with a volume. Low cost, low resource — constraint four.
- **Azure later.** Postgres moves to Flexible Server (burstable tier), the API
  to a container service, attachments to Azure Blob. Constraint three.

A storage seam is the cheapest way to serve all three from one codebase. The
alternative — writing the domain directly against Postgres and mocking the
database in tests — would have made the in-memory path a lie (mocks drift from
real behavior) and coupled every service to SQL. Instead the in-memory store is
a _first-class implementation of the same contract_, so "does this work on
memory?" and "does this work on Postgres?" are the same question asked of two
conforming objects.

The seam is also the reason the migration to a new engine is bounded. Adding,
say, a SQLite backend is "implement `Storage` and `BlobStore` in a new
`storage-sqlite` package, add a branch in `apps/api/src/index.ts`." Nothing in
`packages/core` changes.

## The shape of the interface

`packages/core/src/storage.ts` is deliberately small and boring. The core
abstraction is a generic `EntityStore<T>` with five methods:

```ts
export interface EntityStore<T extends { id: string }> {
  get(id: string): Promise<T | null>;
  all(): Promise<T[]>;
  insert(entity: T): Promise<void>;
  update(entity: T): Promise<void>; // full-row replace by id
  delete(id: string): Promise<void>;
}
```

The `Storage` interface (the same file) is then mostly a bag of
`EntityStore<T>` — one per synced model: `workspaces`, `issues`, `labels`,
`comments`, `projects`, `cycles`, `notifications`, `documents`, `customViews`,
`customers`, `triageRules`, and about two dozen more. A few stores extend the
generic with exactly one extra query method where the domain genuinely needs a
lookup other than by id:

- `UserStore.getByEmail` (login), plus password-hash accessors that keep the
  auth secret inside the storage layer and out of `User` documents.
- `IssueStore.byTeam` (issue lists are always scoped to a team).
- `ActivityStore.byIssue` (the activity feed on an issue).
- `TeamStore.nextIssueNumber` — the atomic issue-number reservation, discussed
  below.

Three interfaces intentionally do _not_ fit the `EntityStore` mold because they
are not synced entities: `SessionStore`, `ApiTokenStore`, and `SyncLogStore`.
They model non-document, engine-sensitive concerns — bearer-secret lookup,
ordered append — and each exposes only the operations its consumers actually
call.

**The critical design choice is `update` = full-row replace by id.** There is no
partial update, no field-level patch, no query-by-arbitrary-predicate in the
contract. A service reads an entity, mutates the whole object in memory, and
writes it back. This is what makes the jsonb-document design possible and the
in-memory implementation trivial (`Map<string, T>` with `structuredClone` on
the way in and out). The cost is that every write serializes and rewrites a
whole document; for an issue tracker's entity sizes this is a non-issue, and it
is the same shape the sync log wants anyway (deltas carry full entities — see
`03-real-time-sync.md`).

## The Postgres design: one jsonb document per row

`packages/storage-postgres/src/index.ts` implements the whole `Storage`
interface, and the surprising thing about it is how little code it is. The
generic `PgEntityStore<T>` is the entire storage engine for two dozen entity
types:

```ts
class PgEntityStore<T extends { id: string }> {
  async get(id) {
    return (await q(`SELECT data FROM ${t} WHERE id=$1`, [id])).rows[0]?.data ?? null;
  }
  async all() {
    return (await q(`SELECT data FROM ${t}`)).rows.map((r) => r.data);
  }
  async insert(e) {
    await q(`INSERT INTO ${t} (id,data) VALUES ($1,$2)`, [e.id, JSON.stringify(e)]);
  }
  async update(e) {
    await q(`UPDATE ${t} SET data=$2 WHERE id=$1`, [e.id, JSON.stringify(e)]);
  }
  async delete(id) {
    await q(`DELETE FROM ${t} WHERE id=$1`, [id]);
  }
}
```

Every entity table is the same two columns — `id text PRIMARY KEY, data jsonb
NOT NULL` — declared in `migrations/001_init.sql` and its successors. The full
entity, exactly as `packages/shared` types it, is the `data` column. `pg`
returns `jsonb` already parsed into a JS object, so `get`/`all` need no
deserialization step at all; the round-trip is `JSON.stringify` on the way in
and free on the way out.

### Why documents instead of a normalized relational schema

This is the decision most worth understanding, because it looks lazy and isn't.

The obvious alternative is a proper relational schema: an `issues` table with a
column per field, foreign keys to `teams` and `workflow_states`, a join table
for labels, and so on. That is how you'd build a bespoke tracker. We chose
documents for concrete reasons tied to the constraints:

1. **The contract is already document-shaped.** The storage interface is
   full-entity CRUD and the sync protocol ships full entities. A normalized
   schema would mean shredding an `Issue` into columns on write and
   re-assembling it (with joins) on read, only to hand the domain the same whole
   object the document store returns for free. The relational structure would
   buy us nothing the domain layer consumes.

2. **The domain, not the database, owns invariants.** All business rules live in
   `packages/core` — issue numbering, category timestamps, sub-issue cycle
   prevention, cascade deletes, notification fan-out. We deliberately did _not_
   want a second copy of the schema's meaning encoded as foreign keys and
   triggers, because then every rule lives in two places and the memory engine
   (which has no FKs) would silently allow things Postgres forbids. Keeping
   Postgres "dumb" keeps the two engines behaviorally identical, which is the
   entire point of the seam.

3. **Schema churn is cheap.** nonlinear grew from a core build through P1 and P2
   (see `ROADMAP.md`), adding fields to issues, teams, users, webhooks, and
   notifications repeatedly. With documents, adding a field is a TypeScript
   change plus a one-line backfill; there is no `ALTER TABLE ... ADD COLUMN` per
   field, no column-type migration. You can see this directly in the migrations:
   `003_views_intake_customers.sql` adds `estimateScale`, `intakeEnabled`,
   `mutedNotificationTypes`, `snoozedUntil` and more with `jsonb_build_object`
   backfills, not column DDL.

4. **It stays small and cheap.** Constraint four is low cost / low resource. One
   generic store class, ~15 tables that are all the same two columns, one small
   pool (`max: 5`, "keep small — this app is a single low-resource container").

The honest cost: we give up what a relational schema gives you for free —
cross-entity joins, referential integrity, ad-hoc analytical queries, and
column-level constraints. We pay for the queries we need with **expression
indexes** rather than joins, and we accept that referential integrity is the
domain's job. For an issue tracker whose read pattern is "load a team's worth of
entities and assemble the graph in the client," that trade is strongly
favorable. For a reporting-heavy or join-heavy product it would be the wrong
call, and `09-decision-log.md` records it as such.

### Expression indexes cover the queries we actually run

Documents would be slow if every lookup were a full-table scan of `data`. It
isn't, because the queried fields get GIN-free B-tree **expression indexes** on
the JSON path. From `001_init.sql`:

```sql
CREATE UNIQUE INDEX users_email_idx  ON users        ((data->>'email'));
CREATE INDEX issues_team_idx         ON issues       ((data->>'teamId'));
CREATE INDEX comments_issue_idx      ON comments     ((data->>'issueId'));
CREATE INDEX activities_issue_idx    ON issue_activities ((data->>'issueId'));
CREATE INDEX notifications_user_idx  ON notifications ((data->>'userId'));
CREATE INDEX favorites_user_idx      ON favorites    ((data->>'userId'));
```

Each index exists because a specific store method queries that path:
`IssueStore.byTeam` filters `data->>'teamId'`, `UserStore.getByEmail` filters
`data->>'email'` (and gets uniqueness enforced as a bonus), and so on. Later
migrations add the indexes their features need — `attachments_issue_idx`,
`documents_project_idx`, `project_updates_project_idx`,
`customer_requests_customer_idx`, `document_comments_document_idx`,
`issue_reminders_user_idx`. The rule of thumb: **if a store method filters on a
document field, that field gets an expression index in the same migration that
introduces the query.** Everything else is fetched by primary key or via
`all()` (small collections like workflow states, labels, teams).

### The relational tables that break the document rule on purpose

Four things get real relational tables, because for them a jsonb document would
be either wrong or slow. They are the exceptions that define the rule.

- **`sessions`** — `token PRIMARY KEY, user_id, created_at, expires_at`. Sessions
  are ephemeral bearer secrets looked up by token on every authenticated
  request. They are not synced entities, never appear in the client, and want a
  cheap indexed key lookup plus a `sessions_user_idx` for "log out everywhere."
  Modeling them as documents would gain nothing.

- **`api_tokens`** (`004_api_tokens_agents.sql`) — the same reasoning for
  personal API tokens: `hash` is `UNIQUE` and looked up on every Bearer-auth
  request (`ApiTokenStore.getByHash`), `user_id` has an index for listing a
  user's tokens, and `ON DELETE CASCADE` from `users` cleans them up. Only the
  sha256 hash is stored — never the raw secret — which is exactly the kind of
  "the secret never leaves the storage layer" concern that argues for a
  dedicated table over a synced document. (`auth_credentials` for password
  hashes is the same idea from `001_init.sql`.)

- **`team_counters`** — `team_id PRIMARY KEY, counter bigint`. This is the one
  that would be a _correctness bug_ as a document. Issue numbers (`ENG-42`) must
  be gapless and unique per team under concurrency. `PgTeamStore.nextIssueNumber`
  reserves the next number with a single atomic statement:

  ```sql
  INSERT INTO team_counters (team_id, counter) VALUES ($1, 1)
    ON CONFLICT (team_id) DO UPDATE SET counter = team_counters.counter + 1
    RETURNING counter;
  ```

  A read-modify-write on a `Team` document (`SELECT data; data.counter++;
UPDATE`) would race: two issues created at the same instant would both read
  the same counter and collide. The atomic upsert makes number reservation a
  single serialized operation in the database. (The memory engine gets the same
  behavior for free by being single-process — `MemoryTeamStore` keeps a
  `Map<teamId, number>` and increments it. The two are behaviorally identical
  under the concurrency each engine actually faces.)

- **`sync_log`** — `sync_id bigserial PRIMARY KEY, model, action, data jsonb`.
  The monotonic, ordered append log that the whole real-time system rides on
  (`03-real-time-sync.md`). `bigserial` is doing the load-bearing work: it hands
  out consecutive, gap-tolerant ids atomically, which is exactly the "assign
  consecutive syncIds atomically" promise in `SyncLogStore.append`. The `data`
  column is jsonb (deltas carry full entities), but the _ordering_ is
  relational and could not be a document.

The pattern across all four: **use a document unless the semantics demand
atomicity, ordering, uniqueness on a non-id field, or secret isolation** — the
things a bag of documents can't give you. Everything else stays a document.

## Migrations: plain SQL, applied under a lock

Migrations live in `packages/storage-postgres/migrations/` as numbered plain-SQL
files (`001_init.sql` … `005_user_preferences.sql`) and are applied by
`src/migrate.ts` at API startup, inside `createPostgresStorage` before any store
is handed out. There is no migration framework, no ORM, no DSL — deliberately.
The runner is ~30 lines: create a `schema_migrations(name, applied_at)` table,
list the `.sql` files sorted by name, and apply any not yet recorded.

Two properties are worth calling out:

- **Each migration runs in a transaction, guarded by a table lock.** The runner
  does `BEGIN; LOCK TABLE schema_migrations IN ACCESS EXCLUSIVE MODE;` before
  checking whether a file has been applied. The comment says why: "Serialize
  concurrent migrators (e.g. two api replicas starting at once)." Because Azure
  and container platforms may start more than one replica simultaneously, two
  processes could otherwise both see migration N as unapplied and both run it.
  The lock makes the check-and-apply atomic; the second migrator blocks, then
  finds the row already present and skips. A migration either fully applies and
  is recorded, or rolls back — no half-applied schema.

- **Backfills are part of migrations, not a separate step.** Because entities
  are documents, "add a field" is really "existing rows lack a key." Migrations
  handle this inline with `UPDATE ... SET data = data || jsonb_build_object(...)
WHERE NOT data ? 'newField'`. See `002`'s `triageEnabled`/`slaUrgentHours`
  backfill on teams, or `005`'s whole `preferences` object added to every user.
  The `WHERE NOT data ? 'field'` guard makes them idempotent-in-spirit and cheap
  to reason about.

The honest limitation: there is no down-migration / rollback path. Migrations
are forward-only, and a bad one is fixed by writing another. For a self-hosted
product where the operator controls the upgrade cadence this is acceptable; it
would need rethinking if we ever supported automated rollbacks.

## The `BlobStore` seam: attachments live outside the entity store

Attachment _payloads_ (the actual file bytes) don't belong in the entity store —
you don't want megabytes of binary in a jsonb column replayed through the sync
log. So they get their own, separate seam: `BlobStore` in
`packages/core/src/blob.ts`, deliberately shaped like `Storage` and swapped the
same way.

```ts
export interface BlobStore {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<{ data: Buffer; contentType: string } | null>;
  delete(key: string): Promise<void>;
}
```

The `Attachment` _entity_ (metadata: filename, content type, size, the blob key)
is a normal synced document in the `attachments` table and rides the sync log
like everything else. The bytes live in the `BlobStore` under that key. This
split is what keeps binary out of the real-time path while still letting the UI
know an attachment exists the instant it's uploaded.

Two implementations ship today, both in `blob.ts`:

- **`createMemoryBlobStore()`** — a `Map<string, {data, contentType}>`, used by
  tests and `STORAGE=memory`. The `Domain` even defaults to this if no blob
  store is passed (`createDomain`'s `options.blobs ?? createMemoryBlobStore()`).
- **`createFsBlobStore(dir)`** — writes each blob to a file under `dir` (with a
  `.meta` sidecar for the content type), used by the self-host container. In
  `docker-compose.yml` the API mounts a volume at `BLOB_DIR=/data/blobs`.

Selection mirrors the storage selection exactly, in `apps/api/src/index.ts`:
`config.storage === 'postgres' ? createFsBlobStore(config.blobDir) :
createMemoryBlobStore()`. Postgres deployments get durable files; memory
deployments get memory.

**Azure Blob is the explicit next implementation.** It is a sibling factory
function — `createAzureBlobStore(...)` returning a `BlobStore` — with a config
branch, and nothing in `packages/core` changes. This is P3 in `ROADMAP.md`
("Azure Blob storage adapter — implement `BlobStore` against Azure Blob,
config-select like `STORAGE`") and is called out as a known gap in `CLAUDE.md`.
The interface was designed for it from the start; it is not yet built.

## The other seam: Domain as core, transports as adapters

The storage seam keeps the database out of the domain. The **transport seam**
does the mirror-image thing at the top of the stack: it keeps HTTP, WebSocket,
and MCP out of the domain too. Both seams exist so that `packages/core` is the
one place business logic lives, sandwiched between two thin edges.

`packages/core` exposes a single composition root, `createDomain(storage,
{ blobs })` in `index.ts`. It wires every service (`AuthService`, `IssueService`,
`CommentService`, `WebhookService`, … ~30 of them) to a shared `Ctx = { storage,
bus }` and returns a `Domain` object. That `Domain` is the entire product's
behavior. Everything above it is an adapter that translates some protocol into
`Domain` method calls and translates the results back:

- **REST** (`apps/api/src/server.ts`) — Fastify routes that authenticate a
  request (session cookie _or_ `Bearer` token, both resolving to a `User`) and
  delegate straight to a service. The route layer does auth, validation, and
  HTTP status mapping (`DomainError.status` → HTTP code) and nothing else. It
  holds no business rules.
- **WebSocket hub** (`apps/api/src/hub.ts`) — subscribes to `domain.bus`, replays
  `sync_log` on `hello {lastSyncId}`, and streams live deltas with per-user
  visibility filtering. It reads the sync log and the bus; it does not mutate
  anything. See `03-real-time-sync.md`.
- **GitHub webhook** (`apps/api/src/github.ts`) — verifies an HMAC signature,
  parses `pull_request` events, resolves referenced issues, and calls
  `IssueService` / `CommentService` to comment and move issues. Pure adapter:
  GitHub's payload in, `Domain` calls out.
- **Public intake** (`apps/api/src/intake.ts`) — an unauthenticated per-team
  endpoint (form posts _and_ Slack slash commands) that rate-limits anonymous
  submissions and calls `IssueService.create`. It reaches the same domain the
  authenticated UI does, just through a public, throttled door.
- **MCP** (`apps/api/src/mcp.ts`) — an HTTP MCP server (Streamable HTTP) mounted
  in-process at `/mcp`, Bearer-authenticated, exposing 13 tools that name-resolve
  teams/issues/users and call `Domain` methods. Its header comment says it
  outright: "a protocol adapter over the same `Domain` the REST routes use." It
  is deliberately _not_ a separate container — see `06-agent-platform.md` for
  that decision.

The payoff of this shape is concrete: **a mutation made over MCP, over REST, or
by the GitHub webhook is the same mutation.** It runs the same
`IssueService.create` with the same triage-rule application, the same SLA due
dates, the same notification fan-out, and appends the same deltas to the same
sync log — so a browser watching over WebSocket sees an agent's MCP write
exactly as it sees a human's REST write. There is no "API path" and "agent path"
that could drift. Five transports, one brain.

It also means the transports are individually cheap and testable. Each adapter
is small because it does one translation job; the tests
(`apps/api/src/*.test.ts`) build a `Domain` over memory storage and exercise the
adapters against it without a database.

## How a request actually threads the seams

Putting both seams together, a single "create issue via MCP" call flows:

1. `apps/api/src/mcp.ts` authenticates the `Bearer` token
   (`domain.tokens.authenticate`), resolves the team by key and the assignee by
   name, and calls `domain.issues.create(...)`.
2. `IssueService.create` (in `packages/core`) applies business rules — reserves
   a number via `storage.teams.nextIssueNumber`, sets category timestamps,
   applies matching triage rules, computes SLA due dates, writes the issue via
   `storage.issues.insert`, records activity, and publishes deltas on the
   `SyncBus`.
3. `SyncBus.publish` appends to `storage.syncLog.append` (the `sync_log` table)
   and fans out to live listeners.
4. The Postgres adapter turns `storage.issues.insert(issue)` into `INSERT INTO
issues (id, data) VALUES ($1, $2)` and `syncLog.append` into an `INSERT ...
RETURNING sync_id`.
5. `apps/api/src/hub.ts`, subscribed to the bus, streams the new deltas to every
   connected browser whose visibility rules allow them.

The MCP adapter knew nothing about SQL. The Postgres adapter knew nothing about
MCP or triage rules. The domain knew nothing about either edge. That separation
is the whole design.

## Adding a new synced model (the mechanical recipe)

Because the seams are uniform, adding a persisted, synced entity is a fixed
checklist rather than a design exercise (also in `CLAUDE.md`):

1. Add the entity type and register it in `SyncModelMap` / `SYNC_MODEL_NAMES` in
   `packages/shared`.
2. Add an `EntityStore<T>` field to `Storage` in `packages/core/src/storage.ts`.
3. Implement it in _both_ engines: a `new MemoryEntityStore<T>()` in
   `memory.ts`, and a `new PgEntityStore(pool, 'table_name')` plus a
   `CREATE TABLE (id text PRIMARY KEY, data jsonb NOT NULL)` migration (with an
   expression index if any store method filters on a field).
4. Publish `created`/`updated`/`deleted` deltas from the service.
5. Map it in the web store's `MODEL_TO_KEY`.

Steps 2–3 are the storage seam; the fact that they are this small — usually one
line per engine plus a two-column table — is the return on the document design.

## Honest limitations

- **No joins, no referential integrity in the store.** Documents can dangle: a
  `comment` can reference a deleted `issue` unless the domain's cascade-delete
  logic (in `packages/core`) handles it. The database will not catch a missing
  cascade; a test or a bug report will. We accepted this to keep the two engines
  identical and the store dumb, but it does move a class of guarantees from the
  database into `packages/core`.
- **`all()` is a table scan.** For small collections (teams, labels, workflow
  states) this is fine and intentional. For anything that could grow unbounded
  it would not be — today no entity read through `all()` grows without bound in
  normal use, but that is an invariant maintained by convention, not enforced.
- **Migrations are forward-only.** No rollback path, as noted above.
- **The sync log is never compacted.** `sync_log` grows monotonically; the
  `rebootstrap` path exists (a client too far behind gets a fresh snapshot) and
  is exercised, but there is no pruning job. Called out in `CLAUDE.md` known
  gaps and `03-real-time-sync.md`. For a self-hosted single-team install the
  growth is slow; for a large deployment it would eventually want a compaction
  strategy.
- **Azure Blob is not built.** The `fs` blob store is the only durable
  attachment backend today. The interface (`packages/core/src/blob.ts`) is the
  seam and the adapter is P3 (`ROADMAP.md`).
- **Pool sizing is fixed-small.** `max: 5` by default, tuned for a single
  low-resource container. A multi-replica Azure deployment against Flexible
  Server's connection limits may need this made configurable — the option
  (`PostgresStorageOptions.max`) exists but nothing sets it from config yet.

## Why this is the right modularity for nonlinear

The two seams are not gold-plating; each one directly answers an owner
constraint. The storage seam is what lets the same domain run zero-dependency in
tests, cheaply in a container, and portably to Azure managed services — without
the domain layer ever learning where its data lives. The document design is what
keeps the Postgres adapter small and the two engines behaviorally identical,
which is the only way the memory path can be a trustworthy stand-in rather than a
divergent mock. The transport seam is what lets an agent (MCP), a browser (REST +
WebSocket), a repo (GitHub), and the public (intake) all drive the _same_
product with the same rules and the same real-time propagation.

The through-line: **`packages/core` is the product, and it is bracketed by two
deliberately thin, deliberately swappable edges** — storage below, transports
above. Change the database or add a protocol, and the middle doesn't move. That
is what "modular storage" and "Azure is the eventual target" cost us to build in,
and it is why moving to Azure is expected to be an adapter exercise rather than a
rewrite.
