# Domain model

This document walks the entity graph that defines nonlinear — what the objects
are, how they relate, and the invariants the domain layer guarantees. It is a
map for understanding _what we built and why_, not an API reference. The single
source of truth for the shapes is `packages/shared/src/entities.ts` (the
interfaces) and `packages/shared/src/enums.ts` (the closed value sets); the rules
that keep those shapes coherent live in `packages/core/src/services/*` and are
composed in `packages/core/src/index.ts`.

Two framing decisions color everything below:

- **The types are the contract.** `packages/shared` has no runtime dependencies
  and no database awareness. Every entity is a flat, JSON-serializable record —
  all ids are opaque strings, all timestamps are ISO 8601 strings (see the
  header comment in `entities.ts`). The same interface is what the API returns,
  what the sync log ships, and what the web store normalizes. There is no
  separate "DB model" vs. "API model" split; there is one shape per concept.
- **Almost everything is synced; secrets are not.** The set of models that flow
  through delta sync is enumerated once, in `SyncModelMap` /
  `SYNC_MODEL_NAMES` in `packages/shared/src/sync.ts`. If an entity is in that
  map, every mutation to it is appended to the sync log and streamed to clients.
  The deliberate exceptions — sessions and API tokens — are covered at the end.

## The containment spine: Workspace → Team → Issue

nonlinear is single-tenant per deployment, but the data model still names the
tenant explicitly. A **`Workspace`** (`entities.ts:45`) is the root: a name, a
`urlKey`, timestamps. In practice there is one, created by the first register
(see CLAUDE.md "First-run behavior"), but modeling it as a first-class synced
entity means the client can display workspace identity and we keep the door open
without a schema change.

A **`Team`** (`entities.ts:76`) is the primary unit of work and of
configuration. This is the most option-laden entity in the system, deliberately:
Linear pushes almost all workflow policy down to the team, and we mirror that.
A team carries:

- **Identity & scope** — `key` (uppercase issue prefix like `ENG`, unique per
  workspace), `name`, `color`, `icon`, and `private`. Private teams are excluded
  when later users auto-join on register.
- **Cycles** — `cyclesEnabled` and `cycleDurationWeeks` control sprint-style
  time-boxing (see Cycle below).
- **Triage** — `triageEnabled`. When on, new issues land in the team's Triage
  state for review instead of the backlog.
- **SLA** — `slaUrgentHours` and `slaHighHours` (either nullable, null = off).
  When set, creating an Urgent or High issue auto-assigns a `dueDate` that many
  hours out.
- **Estimation** — `estimateScale`, one of `exponential | fibonacci | linear |
tshirt` (`enums.ts:57`). The scale is just a _display and input_ concern: the
  stored `estimate` on an issue is always a plain number. The scale picks which
  numbers are offered and, for t-shirt, what labels (`XS…XL`) to render them as
  — see `ESTIMATE_SCALE_VALUES` in `enums.ts`. We chose to store the raw number
  rather than an enum token so that switching a team's scale never rewrites
  existing issues and so throughput/velocity math can sum estimates directly.
- **Intake** — `intakeEnabled` and `intakeToken` (a rotating shared secret) gate
  the public intake form and inbound Slack/webhook issue creation
  (`apps/api/src/intake.ts`).
- **`issueCounter`** — the last issue number handed out. This field is subtle and
  covered under issue numbering.

Team membership is its own edge, **`TeamMembership`** (`entities.ts:106`), rather
than an array on either side. Modeling it as a join entity means membership
changes are their own deltas and don't force a re-sync of the (potentially large)
team or user record.

### Workflow states belong to the team, categories are the invariant

Each team owns an ordered list of **`WorkflowState`** rows (`entities.ts:113`):
a `name`, `color`, `position` (for display order within the team), and — the
load-bearing field — a `category` drawn from the fixed set in `enums.ts:20`:

```
triage → backlog → unstarted → started → completed → canceled
```

The **names and colors of states are user-editable; the category vocabulary is
not.** This is the key normalization decision in the whole model. A team can
rename "In Progress" to "Cooking" or add a second started-category state ("In
Review"), but every state must still map to one of six categories. That lets the
rest of the system reason about issue lifecycle without knowing team-specific
state names: "is this issue done?" is `state.category === 'completed'`, not a
string match. The default states a new team gets are defined in
`services/teams.ts` (`DEFAULT_STATES`): Backlog, Todo, In Progress, In Review,
Done, Canceled — deliberately Linear's defaults. A Triage state is created lazily
at `position: -1` when triage is enabled, so it always sorts first.

## Issue: the center of gravity

**`Issue`** (`entities.ts:124`) is where the model's density lives. Beyond the
obvious fields (`title`, Markdown `description`, `creatorId`), an issue points at:
its `stateId` (workflow state), `priority`, `assigneeId`, and optionally a
`projectId` + `milestoneId`, a `cycleId`, a `parentId` (for sub-issues), an
`estimate`, a `dueDate`, `labelIds`, and `subscriberIds`. That is a lot of
nullable foreign keys, and each one encodes a real relationship discussed below.

### Priority is a number, not a string

`priority` is Linear's numeric scheme (`enums.ts:2`): `0 None, 1 Urgent, 2 High,
3 Medium, 4 Low`. The counterintuitive part — urgent is the _low_ number — is a
direct copy of Linear, and it is deliberate: sorting ascending by the raw number
puts the most urgent work first, and "No priority" (0) sorts alongside it at the
top the same way Linear does. `PRIORITY_LABELS` maps the numbers to display
strings. We kept the numeric encoding rather than a semantic enum precisely so
sort-by-priority is a trivial numeric comparison.

### Identifier and numbering: `TEAM-N` and the counter invariant

An issue has no stored identifier string. Instead it stores an integer `number`
that is **sequential within its team**, and the human identifier is derived:
`${team.key}-${number}` (e.g. `ENG-123`). Numbers are handed out by
`storage.teams.nextIssueNumber(teamId)`, called from `IssueService.create`
(`services/issues.ts:104`).

The invariant we must hold is _no two issues in a team ever share a number, even
under concurrent creates._ This is the one place the model needs true atomicity,
and it is why the Postgres storage keeps a dedicated relational table,
`team_counters`, rather than a jsonb document. The allocation is a single
`INSERT … ON CONFLICT (team_id) DO UPDATE SET counter = counter + 1 RETURNING`
(`packages/storage-postgres/src/index.ts:115`) — atomic under Postgres row
locking, and there is a test that fires 20 concurrent allocations and asserts
they come back distinct (`postgres.test.ts:60`). The `Team.issueCounter` field is
a _mirror_ of this counter, kept only so the client can display the next number;
its comment in `entities.ts:100` says exactly that ("server-side concern, synced
for display only"). The authoritative counter is `team_counters`, never the
synced team document.

Two consequences worth internalizing: numbers are never reused (delete an issue
and its number stays retired), and **moving an issue to another team re-numbers
it.** The update path (`services/issues.ts:181`) detects a `teamId` change,
allocates a fresh number from the destination team, and — because states are
team-scoped — resets the issue to the destination team's default state and clears
its `cycleId`. That is the honest cost of team-scoped identifiers.

### Category-driven lifecycle timestamps

An issue carries four lifecycle timestamps: `startedAt`, `completedAt`,
`canceledAt`, `archivedAt`. The first three are **derived from the category of
the issue's current state, not set directly.** On create (`services/issues.ts:130`)
and on every state change (`services/issues.ts:195`) the service does, in effect:

- `startedAt` is stamped the first time the issue enters a `started`-category
  state and then _preserved_ (`issue.startedAt ?? now`) — it records first-start,
  not most-recent-start.
- `completedAt` is set to now when entering a `completed` state and cleared to
  `null` otherwise, so reopening a done issue clears its completion time.
- `canceledAt` behaves the same way for `canceled`.

Because these follow category rather than a specific state id, they keep working
when a team renames or adds states. Cycle-time and throughput reporting reads
these timestamps, which is the reason to maintain them centrally rather than
trusting callers. `archivedAt` is the exception — it is set explicitly by the
archive action, not derived, because archival is orthogonal to workflow position.

### Sub-issues and the cycle-prevention invariant

`parentId` makes issues a tree. The invariant is that the parent graph stays
acyclic. On both create and re-parent, `IssueService` walks the ancestor chain
before accepting a `parentId`: it rejects self-parenting outright, then follows
`parentId` links upward and throws `cyclic_parent` if it reaches the issue being
edited (`services/issues.ts:283-298`). We chose an explicit walk over, say, a
stored materialized path because the tree is shallow in practice and the walk is
simple to reason about. Deleting a parent does **not** delete its children; the
delete cascade instead orphans them by setting each child's `parentId` back to
`null` (`services/issues.ts:404`). That is a deliberate call: losing a parent
issue should not silently destroy the sub-issues someone filed under it.

### Fractional sort order

`sortOrder` is a string, not a number, and it is how manual drag-ordering works
in boards and lists. The values are fractional-index keys generated by
`keyBetween(a, b)` / `keyAfterAll(keys)` in `packages/shared/src/fractional.ts`
(re-exported through core's `util/fractional.ts`). To drop an item between two
neighbors you compute a key that sorts lexicographically between their keys; new
items get `keyAfterAll(siblings)` to land at the end
(`services/issues.ts:127`). The payoff is that **reordering one item mutates only
that one item** — no renumbering of the whole column, so a reorder is a single
one-row delta over sync. The trade-off is that keys grow longer as you
repeatedly insert into the same gap; there is no compaction pass, which is
acceptable because human drag frequency is low. The same `sortOrder` mechanism is
reused on `Project`, `ProjectMilestone`, `Initiative`, `Favorite`, `CustomView`,
and `IssueTemplate`.

### Relations, activity, labels

Issue-to-issue links are a separate entity, **`IssueRelation`** (`entities.ts:225`),
typed `blocks | related | duplicate` (`enums.ts:40`), with `issueId` and
`relatedIssueId`. Keeping relations as their own rows (rather than arrays on the
issue) means a link is one delta and either endpoint can be queried.

Every meaningful field change also appends an **`IssueActivity`**
(`entities.ts:438`) — a typed, append-only record (`ACTIVITY_TYPES`, `enums.ts:114`)
carrying a small `data` payload like `{ from, to }`. This is what renders the
issue's history timeline. Activities are generated inside the same update method
that performs the change, so the audit trail and the mutation can't drift.

**`Label`** (`entities.ts:154`) has a nullable `teamId`: a null means a
workspace-level label shared across teams, a set value scopes it to one team.
Issues reference labels by id array (`labelIds`), so a label rename is one delta
and every issue re-renders.

## Comments, reactions, mentions

**`Comment`** (`entities.ts:164`) is Markdown text on an issue, with an
`editedAt` distinct from `updatedAt`. **`Reaction`** (`entities.ts:175`) is an
emoji on a comment by a user — modeled as its own entity so a reaction toggles
with a single create/delete delta rather than rewriting the comment. @mentions
are not a stored relationship; they are parsed out of comment (and description)
Markdown at write time and turned into `issue_mentioned` notifications. Commenting
also fans out `issue_commented` notifications to subscribers. This mention-parsing
and notification fan-out is a core-layer responsibility (see CLAUDE.md's core
description), which is why the entity itself stays a plain text record.

## Planning layer: Project, Initiative, Cycle, Milestone

These three concepts answer three different planning questions, and it is worth
being precise about how they differ.

**`Project`** (`entities.ts:183`) is a **cross-team** unit of scoped work: a body
of effort with a `leadId`, a `memberIds` array, `startDate`/`targetDate`, and a
`status` (`ProjectStatus`: `backlog | planned | started | paused | completed |
canceled`, `enums.ts:30`). Crucially it holds a `teamIds` **array** — a project
can span multiple teams, which is exactly why it is not owned by a team the way
issues, states, and cycles are. Issues point at a project via `projectId`; the
project does not enumerate its issues. A project optionally rolls up into an
initiative via `initiativeId`.

**`ProjectMilestone`** (`entities.ts:203`) is a checkpoint _within_ a project
(name, description, `targetDate`, `sortOrder`). An issue's `milestoneId` is
subordinate to its `projectId`: the update path clears `milestoneId` whenever the
issue is removed from its project (`services/issues.ts:264`), so you can never
have an issue on a milestone but not on the milestone's project.

**Project health** is not a field on the project. It is expressed through
**`ProjectUpdate`** (`entities.ts:363`) — a dated post carrying a
`ProjectHealth` (`on_track | at_risk | off_track`, `enums.ts:54`) and a Markdown
body, authored by a user. "Latest one wins": the current health of a project is
the health of its most recent update. We modeled health as a stream of updates
rather than a mutable field so the project carries a narrative history ("was
at-risk in May, on-track now"), which is what the health/update timeline shows.

**`Initiative`** (`entities.ts:267`) sits _above_ projects: it is the
roadmap-level grouping, with its own `status` (`planned | active | completed`,
`enums.ts:111`), `ownerId`, and `targetDate`. Projects opt into an initiative;
initiatives don't list their projects. This gives the two-level hierarchy Linear
uses for its timeline/roadmap view.

**`Cycle`** (`entities.ts:214`) is the time-boxed sprint, and it _is_ team-owned
(`teamId`, plus a per-team sequential `number`, `startsAt`, `endsAt`). Issues
join a cycle via `cycleId`. Cycles are generated lazily: `CycleService` only
materializes upcoming cycles when a team has `cyclesEnabled`, walking forward from
the latest existing cycle's end by `cycleDurationWeeks`
(`services/cycles.ts:48`). We generate on demand rather than running a scheduler
so a dormant team accrues no cycle rows, and the week boundary is normalized via a
`startOfWeek` helper.

So the planning hierarchy reads: **Initiative ⊃ Project ⊃ Milestone**, orthogonal
to **Team ⊃ Cycle**, with an Issue able to sit in a project, a milestone, and a
cycle at once.

## Knowledge & customer layers

**`Document`** (`entities.ts:280`) is a standalone Markdown doc, either
workspace-level (`projectId: null`) or attached to a project. **`DocumentComment`**
(`entities.ts:408`) is a threaded comment on a document that can optionally
`anchorText` — quote a span of the document it refers to, which the UI highlights
— and can be resolved (`resolvedAt`). This is the inline-comment feature; anchor
text is stored as the literal quoted string rather than a character offset so it
survives edits to surrounding text (at the cost of breaking if the quoted text
itself is edited — an honest limitation).

**`Customer`** (`entities.ts:383`) records a customer account: `name`, free-form
`tier`, `revenue` (for prioritization math), and a `domain` (email domain used to
auto-link intake). **`CustomerRequest`** (`entities.ts:396`) links a customer to
an issue and/or project with a body and a `source` (`manual | intake`,
`enums.ts:86`). This is how "which customers asked for this?" is answered. The
intake path (`apps/api/src/intake.ts:107`) looks up a customer by matching the
submitter's email domain (`domain.customers.findByEmailDomain`) and, on a hit,
files a `CustomerRequest` automatically — the link between inbound support volume
and the backlog. When an issue is deleted, its customer requests are _detached_
(issue link nulled), not deleted, via the cascade injected into `IssueService`
(`services/issues.ts:402`).

## Automation & configuration entities

**`TriageRule`** (`entities.ts:422`) is per-team automation: an ordered
(`position`), toggleable rule with a list of case-insensitive `keywords` and a set
of fields to apply (`setPriority`, `setAssigneeId`, `setLabelIds`,
`setProjectId`) when _any_ keyword appears in a new issue's title or description.
Rules run inside `IssueService.create` (via `applyTriageRules`,
`services/issues.ts:88`) and only fill fields the caller left unset — so an
explicit assignee always beats a rule. Running at create time, in the domain
layer, means rules apply uniformly whether an issue arrives via the UI, the REST
API, MCP, or the public intake form.

**`CustomView`** (`entities.ts:333`) is a saved filter/group/display config:
a `ViewFilters` bundle (priorities, assignees — note `Array<string | null>` so
"unassigned" is a real filter value — labels, states, projects), a `grouping`
(`state | priority | assignee`), a `display` (`list | board`), and a `shared`
flag. Shared views appear for everyone; private ones only for the creator. The
filter shape is a fixed struct rather than an arbitrary query so it can be
validated and executed on both storage backends identically.

**`IssueTemplate`** (`entities.ts:349`) pre-fills new-issue fields for a team
(`titlePrefix`, description, priority, labels, estimate). **`Favorite`**
(`entities.ts:246`) is a per-user pin to an issue/project/cycle/label
(`FavoriteType`, `enums.ts:105`) with its own `sortOrder`. **`Attachment`**
(`entities.ts:255`) is metadata about an uploaded file on an issue — the _bytes_
live in a `BlobStore` (the seam in `packages/core/src/blob.ts`), never in the
synced entity; only filename, content type, size, and uploader sync.

## Users, agents, and preferences

**`User`** (`entities.ts:53`) has the expected identity fields plus a `role`
(`admin | member | guest`, `enums.ts:108`) and a per-workspace-unique
`displayName` handle used in mentions. Two areas deserve note:

- **Preferences** are a nested `UserPreferences` struct (`entities.ts:25`) —
  theme, font size, home view, display-name format, first day of week — with a
  `DEFAULT_PREFERENCES` constant. They are _synced across devices_ because they
  live on the user entity, so changing your theme on one machine follows you.
  Notification muting is adjacent: `mutedNotificationTypes` (an array of
  `NotificationType`) suppresses both in-app and digest notifications, and
  `emailDigest` / `digestLastSentAt` drive the opt-in daily email digest (the
  server writes `digestLastSentAt`).
- **`isAgent`** marks a non-human teammate driven by an API token. An agent user
  is a full user — it can be assigned issues and @mentioned like anyone else —
  but it can't log in with a password (admins mint its tokens). This one boolean
  is what lets the webhook layer target an agent: a `Webhook` with `agentUserId`
  set fires only on events where that agent is the assignee or is @mentioned
  (CLAUDE.md, "Agents"). Modeling agents as ordinary users rather than a separate
  entity means every assignment, mention, and notification path works for them
  with zero special-casing.

**`Notification`** (`entities.ts:233`) is per-user, typed (`NotificationType`,
`enums.ts:43`), and points at an issue (and optionally a comment). It carries
`readAt` and `snoozedUntil` (hidden from the inbox until that time). Notifications
sync, but a client only ever receives its _own_ — the WebSocket hub filters
notification and favorite deltas to their owner (CLAUDE.md, apps/api hub note), so
the fan-out that generated a notification for someone else never leaks to you.

## What is synced vs. what is not

Everything above is in `SyncModelMap` (`packages/shared/src/sync.ts:40`) and
therefore flows through the delta sync log: every create/update/delete is stamped
with a monotonic `syncId`, appended, and streamed to connected clients, which
bootstrap a snapshot and then stay live. Adding a new synced model means touching
that map, both storage backends, the publishing service, and the web store's
`MODEL_TO_KEY` — the checklist is in CLAUDE.md's "Sync model" section. Deletes
ship only `{ id }`, not the full entity (`sync.ts:110`).

The deliberate non-synced entities are the **bearer secrets**:

- **Sessions** — the browser `nl_session` cookie's server-side record (scrypt
  hashed). Not an entity in `entities.ts` at all; it lives only in the Postgres
  `sessions` table / memory-store equivalent.
- **`ApiToken`** (`entities.ts:313`) — personal tokens for REST + MCP access. The
  interface's own doc comment says it plainly: "Never synced — a bearer
  credential, like sessions." Only the token's `prefix` (for display), name, and
  usage timestamps are stored; the secret itself is sha256-hashed and shown once
  at creation. `ApiToken` is absent from `SyncModelMap` on purpose.

The reasoning is a security boundary, not an oversight. Sync ships full entity
snapshots to every client; a credential that appeared in a delta would be handed
to every connected device and replayed from the durable log forever. Secrets are
validated server-side (`domain.tokens.authenticate`) and never enter the client's
normalized store. This is why `IssueReminder` (`entities.ts:375`) — which _is_
synced — is fine (it's just a personal reminder), but tokens are not.

## Where the rules live

The entity shapes are inert; the invariants in this document are enforced by the
services in `packages/core/src/services/`, wired together by `createDomain` in
`packages/core/src/index.ts` — the composition root that hands every service the
same `Ctx` (`{ storage, bus }`, defined in `packages/core/src/domain.ts:53`).
`SyncBus.publish` (`domain.ts:33`) is the single choke point through which all
deltas reach the log and live listeners, which is why "every mutation is a delta"
holds without per-service discipline. Cross-service cascades — issue delete →
detach customer requests and reminders — are injected as optional dependencies
into `IssueService` rather than hard-wired, keeping the dependency graph a DAG.
When you need the precise behavior of a field, read the service method that
writes it; this document tells you which one and why it exists.

## Honest limitations

- **Team-scoped issue numbers** mean cross-team moves re-number and reset state.
  There is no global issue identifier.
- **Anchored document comments** store the quoted text, so editing the quoted
  span (not just its surroundings) orphans the anchor.
- **Fractional `sortOrder` keys never compact**, so pathological repeated
  same-gap inserts grow key length unbounded (not a practical concern at human
  drag rates).
- **The sync log is never compacted** (CLAUDE.md, "Known gaps"); the
  `rebootstrap` path is the safety valve.
- SSO/SCIM-provisioned users, an audit-log surface beyond `IssueActivity`, and
  public/scoped API tokens are **not yet** built — they sit in ROADMAP P3
  ("Platform & scale"). The auth boundary is intentionally pluggable to make the
  OIDC addition additive.
