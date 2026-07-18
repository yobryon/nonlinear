# Real-time sync architecture

Linear feels the way it does because the client is never waiting on the server. You
change a state, drag a card, add a comment, and it lands instantly — and a moment
later the same change appears on your teammate's screen without a refresh. Cloning
that "feels local, stays shared" quality is the single most load-bearing piece of
design in nonlinear. This document explains the delta-sync mechanism we built to get
it: what it is, why we chose it over the obvious alternatives, where the honest seams
are, and how to extend it when you add a model.

The whole thing is deliberately small. There is no separate sync service, no CRDT
library, no event-sourcing framework. The entire protocol is a monotonic append-only
log of full-entity deltas, a WebSocket that replays the tail of that log, and a
normalized client store that applies deltas idempotently. That smallness is a design
goal (see hard constraint 4 in `CLAUDE.md`: one small API process, low cost), not an
accident.

## The mental model in one paragraph

Every mutation that touches a synced model appends one or more **deltas** to a
durable, globally-ordered **sync log**. Each delta gets a monotonically increasing
integer `syncId`. A client bootstraps by fetching a full snapshot of the world tagged
with the current `syncId`, then holds a WebSocket open. Over that socket it announces
the last `syncId` it has seen; the server replays everything newer from the log and
then streams new deltas live. If the client's `syncId` is too old for the log to
serve, the server tells it to re-bootstrap. The client keeps entities in normalized
by-id maps and applies each delta by id, which makes replay, live streaming, and
optimistic REST responses all converge to the same state regardless of arrival order.

That's it. The rest of this document is the reasoning and the edges.

## The delta and the log

The protocol contract lives in `packages/shared/src/sync.ts` — shared precisely so the
server and browser cannot disagree about the wire format. A delta is:

```ts
interface SyncDelta<M extends SyncModelName> {
  syncId: number;
  model: M;
  action: 'create' | 'update' | 'delete';
  data: SyncModelMap[M] | { id: string }; // full entity, or just { id } for delete
}
```

Two decisions are baked into this shape.

**Full entities, not field patches.** A `create` or `update` delta carries the entire
entity, not a diff of changed fields. This is the most consequential trade-off in the
design, and we made it deliberately — see "Why full-entity deltas" below. A `delete`
carries only `{ id }`, because there is nothing left to describe.

**A single global order.** `syncId` is one integer sequence across the whole
workspace, not per-model or per-team. Any two deltas anywhere in the system are totally
ordered. That is what lets a client say "I've seen up to N" with one number and lets
the server answer "here is everything after N" with one range scan. The cost is that
the sequence is a global write point; we accept it because a self-hosted single-team-
to-mid-size workspace is nowhere near the write volume where a single Postgres sequence
is a bottleneck.

`SyncModelMap` and its companion array `SYNC_MODEL_NAMES` enumerate exactly which of
the domain's entities are synced. Not everything is: issue *activities* are synced as
deltas (so the activity feed updates live) but things like sessions, API tokens, and
the sync log itself are never synced — they are either secrets or infrastructure.

## Publishing: SyncBus

The server-side write path is `SyncBus` in `packages/core/src/domain.ts`. It is
intentionally tiny:

```ts
async publish(deltas: DeltaInput[]): Promise<SyncDelta[]> {
  if (deltas.length === 0) return [];
  const stamped = await this.syncLog.append(deltas);   // durable first
  for (const listener of this.listeners) listener(stamped); // then live fan-out
  return stamped;
}
```

The ordering here is a correctness property, not a style choice: the deltas are made
**durable and stamped with their syncIds first**, then handed to live listeners. A live
subscriber therefore only ever sees deltas that are already in the log. If we fanned
out before appending, a fast client could observe a delta, then reconnect and ask "give
me everything after that syncId" before the row existed — and lose it. Durable-first
closes that window.

Services never touch the log directly. They build deltas with the small constructors
`created(model, entity)`, `updated(model, entity)`, and `deleted(model, id)`, and call
`bus.publish(...)`. `IssueService.remove` in `packages/core/src/services/issues.ts` is a
good worked example: deleting an issue publishes a *batch* — the issue delete plus
deletes for its comments, reactions, relations, notifications, favorites, activities,
and updates to any orphaned sub-issues — all in one `publish` call, so they land in the
log contiguously and apply atomically on every client.

`SyncBus` is constructed once in the composition root (`createDomain` in
`packages/core/src/index.ts`, `new SyncBus(storage.syncLog)`), and the single live
subscriber is the WebSocket hub.

## The log store

`SyncLogStore` (interface in `packages/core/src/storage.ts`) is three methods:

- `append(deltas)` — assign consecutive syncIds atomically, return the stamped deltas.
- `since(syncId)` — deltas with `syncId > since`, oldest first, **or `null`** if
  `since` predates the retained log (meaning: you're too far behind, re-bootstrap).
- `currentSyncId()` — the high-water mark, used to tag a bootstrap snapshot.

There are two implementations, and they must behave identically because the same tests
and the same client run against both.

In Postgres (`packages/storage-postgres/src/index.ts`, class `PgSyncLog`) the log is a
real ordered table:

```sql
CREATE TABLE sync_log (
  sync_id  bigserial PRIMARY KEY,
  model    text NOT NULL,
  action   text NOT NULL,
  data     jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

`bigserial` gives us the monotonic id for free and atomically — a multi-row `INSERT ...
RETURNING sync_id` stamps a whole batch in one statement, so a batch never interleaves
with another writer's batch. `since` first reads `min(sync_id)`; if the caller's cursor
is older than `min - 1`, the requested range has been trimmed away and it returns
`null`. Today nothing ever trims the table, so that branch is effectively unreachable in
production (see the compaction gap below) — but the client and hub already honor it, so
turning on compaction later needs no protocol change.

The in-memory store (`MemorySyncLog` in `packages/core/src/memory.ts`) is the same
semantics over an array and a `nextId` counter, used by `STORAGE=memory` and by nearly
every unit test. Keeping the two in lockstep is why the interface is so narrow.

## Bootstrap: the snapshot

A client starts from nothing, so it needs a full picture before deltas mean anything.
`GET /api/bootstrap` (wired in `apps/api/src/server.ts`, served by `BootstrapService.payload`
in `packages/core/src/services/extras.ts`) reads every synced collection in parallel and
returns a `BootstrapPayload` tagged with `syncId: currentSyncId()`.

The critical detail is *where* the syncId comes from. It is read in the same
`Promise.all` as all the collections, and it is the log's current high-water mark. As
long as the snapshot is at least as fresh as that syncId, the client is safe: any delta
the snapshot might have missed has a syncId greater than the tag, so the reconnect
replay will re-deliver it. We err toward the snapshot being *newer* than its tag (a
delta could land mid-read), which only means the client harmlessly re-applies an
identical full entity later — the idempotency of full-entity deltas is what makes this
tolerable rather than a race.

Bootstrap also performs a lazy side effect: it calls `cycles.ensureCurrentCycles` for
each team so cycles are generated on demand rather than by a cron. That's unrelated to
sync mechanics but worth knowing so the endpoint's cost isn't a surprise.

### Per-user visibility filtering

Not every entity is everyone's business. The snapshot filters the personal models to
the requesting user:

- `notifications` and `favorites` → only rows where `userId === req.user.id`.
- `issueReminders` → only the requesting user's reminders.
- `customViews` → only `v.shared === true || v.creatorId === userId`.

Everything else (issues, projects, comments, labels, teams…) is workspace-visible in
this product — nonlinear does not yet implement private teams' content-level isolation
at the sync layer beyond join-time team membership. That is a deliberate scope line for
a small self-hosted clone, not an oversight to paper over; if you need hard multi-team
data isolation, this filter set is where it would grow.

The `customViews` rule is what makes **agent-scoped views** work. Agent users
(`isAgent` teammates) create custom views like anyone else; because a private view only
syncs to `shared || creatorId === self`, an agent's own scratch views never leak into
human teammates' stores, and vice-versa. There is no separate agent code path — the
same visibility predicate covers it.

## The hub: replay, buffering, live streaming

`SyncHub` in `apps/api/src/hub.ts` is the live half. It subscribes once to the bus in
its constructor and holds a `Set<Connection>`. Each connection tracks its `userId`, a
`replaying` flag, and a `buffer`.

The subtle part is the handshake, and it exists to solve one specific ordering hazard.
When a client connects it sends `hello { lastSyncId }`. The server must replay the log
from `lastSyncId` forward — but that replay is an async database read, and *during* that
read, new live deltas can arrive from the bus. If we streamed those live deltas
immediately, the client could see delta 105 (live) before delta 103 (still being
replayed), violating the in-order guarantee the client relies on.

The fix is buffering. While `replaying` is true, `broadcast` pushes live deltas into the
connection's `buffer` instead of sending them. When `replay` finishes, it:

1. sends the replayed range from the log,
2. flushes any buffered live deltas whose `syncId` is **greater than the max replayed
   syncId** (deduping the overlap where a delta appeared both in the log read and in the
   buffer),
3. clears `replaying`, and
4. sends a `caught_up { syncId }` marker.

After that, live deltas flow straight through. This little state machine is the reason a
reconnecting client never observes a newer delta before an older one, even under
concurrent writes.

If `since(lastSyncId)` returns `null` — the client is too far behind — the hub sends
`{ type: 'rebootstrap' }` and drops the buffer. The connection stays open; the client
just fetches a fresh snapshot and re-announces.

`broadcast` also applies the **same per-user visibility filter** as bootstrap, via the
`visibleTo(delta, userId)` function at the top of `hub.ts`. It must match the bootstrap
filter or a client would either miss a delta it should have or receive one it shouldn't.
Note that `delete` deltas are always considered visible — the client simply ignores a
delete for an id it never had, so it's cheaper and safer to broadcast all deletes than
to remember which ids each user could see.

Liveness is kept up with a `ping`/`pong` heartbeat: the client pings every 25s and the
server pongs, which keeps intermediaries (nginx, Azure front ends) from idling the
socket closed.

## The client: normalized store + idempotent apply

The browser side is `apps/web/src/store.ts` (zustand) and `apps/web/src/sync.ts`.

The store keeps every model as a normalized `ById<T>` map — `issues`, `projects`,
`comments`, and so on — plus the scalar `syncId` and a `connection` status. Normalized
maps are the whole reason deltas are cheap to apply: a delta is just "set or delete this
key," and React components select the slices they render.

`applyBootstrap` replaces the maps wholesale (`indexById` over each array) and sets
`syncId` to the snapshot's tag. `applyDeltas` walks the batch, and for each delta:

- advances `syncId` to `max(syncId, delta.syncId)`,
- routes the model name to its collection via the `MODEL_TO_KEY` table,
- for `delete`, removes the id; otherwise, **overwrites** the id with the full entity.

Because updates carry the full entity and are keyed by id, `applyDeltas` is idempotent
and order-tolerant *within a model*: applying the same delta twice is a no-op, and the
last write for an id wins. `issueActivity` deltas are intentionally skipped in the store
(activity history is fetched on demand per issue), and `workspace` is special-cased
because it's a singleton rather than a map.

### Optimistic writes: `putEntity`

Mutations don't wait for the socket. The UI calls a REST endpoint, and the endpoint
returns the mutated entity, which the client immediately merges with `putEntity(model,
entity)` — the same "set this id in this map" operation as a delta. A beat later the
*same* change arrives as a delta from the hub and applies again, identically. This is
the payoff of full-entity, idempotent, id-keyed deltas: the optimistic path and the sync
path are the same operation, so they can't diverge, and there is no reconciliation code,
no pending-mutation queue, no rollback logic. The REST response and the delta are two
copies of one truth.

The trade-off is that a truly *stale* optimistic value (if the server transformed the
input in a way the response didn't reflect) would be corrected only when the delta
arrives — but since the REST handler returns the persisted entity, the response and the
delta are the same bytes in practice.

### Reconnect and backoff

`sync.ts` owns the socket lifecycle. `startSync` bootstraps over REST, applies it, then
`connect()`s. On `open` it sends `hello { lastSyncId: store.syncId }` and starts the
25s ping. On `close` (and not deliberately stopped) it flips the store to `offline` and
retries with capped exponential backoff: `min(15000, 500 * 2 ** min(attempts, 5))`, so
delays grow 0.5s, 1s, 2s… up to a 15s ceiling and never hammer a downed server.
`onmessage` handles just two server messages meaningfully: `deltas` (apply them) and
`rebootstrap` (fetch a fresh snapshot and `applyBootstrap`). `caught_up` and `pong` are
inert on the client today — they exist for observability and future use.

## Why this design, and what we didn't build

**Why not polling?** Polling `GET /api/bootstrap` on a timer is the simplest possible
thing, and we rejected it on both feel and cost. Feel: polling adds latency equal to
half the interval on average and can't give the sub-second cross-client updates that
make Linear feel alive. Cost: re-sending the whole world every few seconds to every
open tab is exactly the resource profile hard constraint 4 tells us to avoid. Delta
sync sends bytes only when something actually changed. (Bootstrap-style full fetch still
exists — as the *initial* load and the *rebootstrap fallback* — which is the right place
for it: rare, and correct by construction.)

**Why not CRDTs?** CRDTs (Yjs, Automerge) shine when clients edit concurrently
*offline* and must merge without a server referee — collaborative text being the
canonical case. nonlinear's writes are server-mediated: every mutation goes through a
REST endpoint that runs business rules (issue numbering, cascade deletes, notification
fan-out, triage rules) and *then* publishes. The server is the ordering authority, so we
get a single total order for free and don't need per-field conflict resolution. Adopting
a CRDT would mean giving those server-side invariants a second, harder home and shipping
a merge library into a ~100 KB SPA. The one place CRDT-style merging would genuinely help
is concurrent rich-text document editing; today document bodies are last-write-wins like
everything else, which is a known, accepted limitation for a clone at this scope.

**Why not full event sourcing?** Our sync log looks like an event log, but it stores
*state deltas* (the resulting entity), not *domain events* (the intent). True event
sourcing — where the log is the source of truth and current state is a fold over events
— would let us rebuild history and audit everything, but it also means every read
reconstructs state, every schema change is an event-versioning problem, and the
storage-modular jsonb-per-row model in `storage.ts` would fight it. We instead keep
authoritative current state in the entity tables and treat the sync log as a
*transport/catch-up* mechanism that is safe to trim. The audit-log feature on the P3
roadmap will be built from the existing issue *activity* records, not by promoting the
sync log to a system of record.

### Why full-entity deltas specifically

Sending the whole entity on every update is more bytes than a field patch, and we chose
it anyway for three reasons that compound:

1. **Idempotency and order-tolerance.** A full entity keyed by id means "apply twice =
   apply once" and "last write wins." That single property is what collapses the
   optimistic path, the live path, and the replay path into one code path (`putEntity`
   ≡ delta apply). Field patches would need a per-entity version vector and merge logic
   to be safe against reordering and duplication.
2. **No read-modify-write on the client.** To apply a patch you must already hold the
   prior entity and mutate it; a missed prior delta corrupts the result silently. Full
   entities are self-contained — a client can apply an update for an id it's never seen
   and be exactly correct.
3. **Simplicity of publishing.** Services already have the final entity in hand after a
   mutation; `updated('issue', issue)` is trivial. Computing a minimal diff would add
   work at every write site for a bandwidth saving that doesn't matter at this product's
   scale (issues are small jsonb documents).

The honest cost: a one-character title edit ships the whole issue. For nonlinear's
entity sizes that's negligible; for a model with large blob-like fields it would matter,
and the escape hatch is to keep such payloads out of synced entities (attachments store
a blob key, not the bytes — the `BlobStore` seam in `packages/core/src/blob.ts`).

## Known gaps and honest limitations

- **The sync log is never compacted.** Every mutation ever made accumulates in
  `sync_log` forever. The `since` → `null` → `rebootstrap` path is fully built, tested,
  and honored by both the hub and the client — but nothing currently *triggers*
  trimming, so in a long-lived deployment the table grows unbounded and reconnect replay
  can get long for a client that's been away a while. This is called out in `CLAUDE.md`
  under known gaps. The fix is bounded: a periodic job that deletes rows older than some
  retention window (or below a min syncId), after which stale clients naturally take the
  already-working rebootstrap path. No protocol change is needed; it's a scheduled
  `DELETE` plus a decision about the retention policy.
- **No content-level team isolation.** Visibility filtering covers personal models
  (notifications, favorites, reminders, own/shared views) but issues and projects are
  workspace-visible. Private-team content isolation at the sync layer is not yet built.
- **Documents are last-write-wins.** Concurrent edits to the same document body clobber
  rather than merge — the deliberate consequence of not using a CRDT (see above).
- **Fan-out is O(connections × deltas).** `broadcast` filters every delta for every
  connected socket in-process. That's fine for a single small API process (the target
  deployment); it is not horizontally shardable as written. A multi-instance API would
  need the bus fan-out to cross a shared channel (e.g. Postgres `LISTEN/NOTIFY` or a
  broker), which is a future concern, not a current one.

## Adding a new synced model, end to end

The sync machinery is uniform enough that wiring a new model is a checklist, not a
design exercise. Say you're adding a `milestoneComment`. Touch these places:

1. **Shared contract** (`packages/shared/src/sync.ts`): add the entity to
   `SyncModelMap`, add its name to `SYNC_MODEL_NAMES`, and add its array to
   `BootstrapPayload`. The `satisfies` constraint on `SYNC_MODEL_NAMES` will fail the
   build if you add one without the other — that's intentional.
2. **Storage** (`packages/core/src/storage.ts` + both impls): add an `EntityStore` to
   the `Storage` interface, an in-memory store in `memory.ts`, and one jsonb table in
   Postgres (a migration in `packages/storage-postgres/migrations/`, plus the store in
   `index.ts`). One jsonb table per model is the standing pattern — see hard constraint 5
   and the storage docs.
3. **Service** (`packages/core/src/services/…`): after each create/update/delete, call
   `bus.publish([created('milestoneComment', entity)])` (or `updated`/`deleted`). Register
   the service in `createDomain` (`packages/core/src/index.ts`).
4. **Bootstrap** (`BootstrapService.payload` in `services/extras.ts`): read the new
   collection in the `Promise.all` and include it in the returned payload — with a
   per-user filter if it's a personal model.
5. **Hub visibility** (`apps/api/src/hub.ts`): if the model is personal, add a case to
   `visibleTo`. If it's workspace-visible, nothing to do — the default is "visible."
   Make sure it matches the bootstrap filter exactly.
6. **Web store** (`apps/web/src/store.ts`): add the collection to `AppState`, to
   `emptyCollections`, to `applyBootstrap`, and map the model name in `MODEL_TO_KEY`.
   Once it's in `MODEL_TO_KEY`, `applyDeltas` and `putEntity` handle it with no further
   code.

If you skip step 1 the TypeScript build stops you; if you skip step 5 or the bootstrap
filter, the failure mode is a personal model leaking to other users — so those two are
the ones to review carefully. This same six-step recipe is summarized in the "Sync
model" section of `CLAUDE.md`; this document is the *why* behind each step.
