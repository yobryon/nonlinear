# 10. The Plumb slate — decisions as first-class, status that rides the motion

Product input arrived from **Plumb** (a meta-project methodology run against nonlinear across
two real projects) as a ranked functionality slate: [NON-53](/issue/NON-53). This doc is the
design of record for building it. It expands each item into a concrete shape against
nonlinear's architecture, records the decisions taken (with alternatives), and fixes the build
order. Where entries 19–22 hardened the *trust* model, this is the *gravity* work: make the
tracker a place the thinking can live, not just the exhaust.

## Thesis (from the field work)

Narrative status accretes wherever a project's primary thought lives. A build-heavy project's
gravity sits near its tracker and it stays roughly true; a judgment-heavy project's gravity sits
in its decisions log, and the tracker becomes a satellite holding **under 1% of the recorded
thought** — false in both directions at once. The fix is not more reconciliation ceremony; it
is to **move the tracker onto the path the work already travels**: give judgments a first-class
home, let status updates ride the motions the work already makes, and give every participant a
real name (the last one — per-agent identities — shipped as personas, entry 22).

## Guardrails (what we will not build)

Adopted verbatim from the proposal, because they match nonlinear's grain:

1. **Mirror out, don't pull the repo in.** Compete with a repo `decisions.md` by *exporting* to
   it (item 1's export), not by absorbing the failure catalog / wire contracts / design docs.
   Those stay where the diffs are.
2. **Don't become the bus.** WS sync is web-client delta sync, never push-to-agent. Agents pull
   via MCP. No real-time push toward agents.
3. **Pull, never push, on staleness.** Views and summaries (item 6) yes; nag alarms no — a
   signal dominated by false positives is acted on wrongly the one time it's believed.
4. **Reduce touches, never add ceremony.** Every feature lowers the per-update cost; none adds a
   protocol step.

## Decisions taken

| # | Decision | Alternative rejected |
|---|---|---|
| D1 | **Decision is its own synced entity**, fixed lifecycle `proposed → ruled → superseded \| carried`, never "done". | Reusing Issue with a "decision" label — a judgment has no assignee/completion; forcing it into work-item states is the exact miscategorization the field work named. |
| D2 | **Numbering `TEAM-D#`** (e.g. `VAN-D12`) from a per-team decision counter, parallel to `team_counters`. | A global decision sequence (loses team locality); reusing the issue counter (conflates two namespaces). |
| D3 | **Decision comments are a dedicated entity** (`decisionComment`), mirroring the existing `docComments` pattern. | Generalizing `Comment` to a polymorphic `{targetType,targetId}` — invasive across storage/sync/notifications/reactions for no gain over the established per-target precedent. |
| D4 | **Decisions are member-only** — not visible to the intake tier. | Shell-visible to intake filers — a team's judgments are its private reasoning; intake is for filing/tracking *your own* issue, not reading the provider's arguments. |
| D5 | **`waiting_on` ships manual-clear first**, auto-clear-on-response as a fast follow. | Full auto-clear in v1 — "their next action" is ambiguous (any comment? a ruling?); ship the primitive, learn the clearing rule. |
| D6 | **Commit ingestion defaults to propose-close**, surfaced for one-tap confirm. | Auto-close — "a state means someone judged it done"; auto-moving state on a commit trailer violates that. Per-project auto-close is a later opt-in. |
| D7 | **Reconcile is pull-only** (a view + a summary endpoint). | A staleness alarm — guardrail 3. |
| D8 | **Cross-team read-through is a narrow projection** (identifier, title, state, updatedAt) gated by an explicit link + provider opt-in. | Exposing the full linked issue across the team boundary — reopens the isolation hole entries 19–22 closed. |

---

## Item 1 — First-class decision records (the flagship)

**Entity** (`packages/shared/src/entities.ts`), new synced model `decision`:

```ts
type DecisionStatus = 'proposed' | 'ruled' | 'superseded' | 'carried';
interface Decision {
  id: string;
  teamId: string;            // namespace + visibility owner
  number: number;            // per-team → `${team.key}-D${number}`
  title: string;
  body: string;              // the argument, prose-first (markdown)
  status: DecisionStatus;
  authorId: string;
  ruledById: string | null;  // who ruled (usually the PO)
  ruledAt: string | null;
  supersedesId: string | null;   // first-class edge → the decision this replaces
  governedIssueIds: string[];    // issues this decision governs
  createdAt: string;
  updatedAt: string;
}
```

- **Lifecycle** is a fixed enum, not per-team workflow states. `proposed` (awaiting a ruling) →
  `ruled`; a ruled decision may later become `superseded` (replaced) or `carried` (reaffirmed
  after review).
- **Supersession as an edge (D2 failure family).** Setting `supersedesId` on a new decision
  flips the target to `superseded`; the reverse (`superseded-by`) is derived. Rendered as a
  chain.
- **Numbering** reuses the atomic-counter pattern: a `decision_counters` table (postgres) /
  in-memory counter, `nextDecisionNumber(teamId)`. Resolvable by `VAN-D12` like issues.
- **Comments** via a dedicated `decisionComment` entity (D3): `{id, decisionId, userId, body,
  createdAt, editedAt}` with @mention fan-out — this is where the PO answers (the VAN-28 value).

**Storage/sync wiring** (the standard new-model path): add to `SyncModelMap` /
`SYNC_MODEL_NAMES` (shared); `DecisionStore` + `DecisionCommentStore` + jsonb tables in memory
and postgres; `decision_counters`; a `DecisionService` (core) that publishes deltas and enforces
supersession + numbering; map both in the web store's `MODEL_TO_KEY`.

**Visibility.** Team-scoped, member-only: a `canReadDecision(vis, decision)` = `seesTeam`. The
bootstrap `filterPayload` and the hub both gate decisions/decisionComments to team members.

**API.** REST `/api/decisions` (create/update/rule/supersede/delete), `/api/decision-comments`;
`GET /api/teams/:id/decisions.md` — the **one-way export**: a rendered markdown doc, one section
per decision (`## VAN-D12 — Title`, status, author/ruler/date, supersession chain, governed
issues by identifier, then the body), stable `#van-d12` anchors. This is the adoption-critical
feature for repo-attached teams.

**MCP.** `create_decision`, `rule_decision`, `supersede_decision`, `link_decision_issue`,
`list_decisions`, `get_decision`, `comment_decision` — judgments authored in-flow.

**Web.** A per-team **Decisions** sidebar entry; a list (by number, status filter); a detail
that leads with the body (the argument is the artifact), with properties for status, author,
ruled-by, supersedes/superseded-by, governed issues, and a comment thread; `VAN-D#` autolink.

**Size: L.** The flagship and the largest single item.

## Item 2 — PO decision queue ("Awaiting me")

Once items 1 + 3 exist this is largely a **view**. A unified surface listing everything that
waits on the viewer: decisions in `proposed` with `waiting_on = me`, plus issues/decisions with
`waiting_on = me`. Inline **Rule** action on a decision (optional note → a decision comment)
sets `ruled`/`ruledBy`/`ruledAt` and clears `waiting_on` — the answer lands as the ruling, where
the statuses are. Notifications: new types `awaiting_decision` / `waiting_on_you`, fired on
**queue-add only**, through the existing fan-out + muting. **Size: S–M.**

## Item 3 — `waiting_on` — the word no tracker has

An orthogonal field `waitingOnId: string | null` on Issue (and Decision) — **not** a workflow
state. jsonb, no migration. Settable on any item; names the person/agent it's blocked on;
queryable. The killer query "waiting on **nobody**" (an item in a started/review-category state
with `waitingOnId = null`) *is* the Plank board-review finding, mechanized as a filter.

- **Web**: a `waiting_on` property in issue/decision detail; a ViewControls filter chip
  (`@person` / nobody / anyone).
- **MCP**: settable via `update_issue` and `comment_and_state` (item 7); a `waiting_on_me`
  bucket added to `my_work`.
- **Clearing (D5)**: manual first; fast-follow auto-clear when the named person next
  comments/rules on the item.

**Size: S.**

## Item 4 — Commit ingestion (status rides the commit)

MCP `sync_commits(commits: [{ sha, message, date }], repoUrl?)` — the lightest, most
agent-friendly form (no webhook infra). Parses each message for `Closes|Fixes|Refs TEAM-N`
(and `#TEAM-N` mentions) among issues the caller can write:

- `Refs` / bare mention → a comment `referenced in commit <sha> — <subject>` (linked if
  `repoUrl` given).
- `Closes|Fixes` → **propose-close** (D6): a comment noting the proposing commit; the batch of
  proposed closes is returned for one-tap confirmation (composes with item 7c's batch move).
  Never moves state directly.

Idempotent per `(issueId, sha)` (skip a sha already commented on an issue). The reconcile pass
becomes one call instead of N. Optionally extend `github.ts` push handling later; per-project
auto-close is a future opt-in. **Size: M.**

## Item 6 — Reconcile view (pull-diagnostic)

A lens, never an alarm. Open issues ranked by **staleness = now − max(last state change, last
activity)**, where activity = last comment, last linked commit (item 4), last decision reference
(item 1). Computable from existing activity records + comments.

- **Web**: a "Reconcile" view (per team) sorted by staleness desc, showing state, last activity,
  `waiting_on`.
- **API/MCP**: a one-line summary `GET /api/teams/:id/reconcile/summary` →
  `{ open, untouched5d, waitingNobody }`, and MCP `reconcile_summary(teamKey)` returning the
  same — drops straight into a status-report instrument.

**Size: M.**

## Item 7 — MCP ergonomics (the fast wins)

Three thin MCP tools, no storage changes — the fastest ROI, pure friction reduction:

- **(a) `find_issue(query)`** — fuzzy resolve over the existing full-text search; returns best
  matches so the agent never leaves the thread to look up a number.
- **(b) `comment_and_state(identifier, { body?, state?, waiting_on? })`** — the commonest update
  as one motion (compose `comments.create` + `issues.update`).
- **(c) `update_issues(updates: [{ identifier, state?, assignee?, waiting_on? }])`** — batch
  moves; the reconcile pass as one call.

**Size: S.** Built first for momentum.

## Item 8 — Cross-team linking (deferred, isolation-sensitive)

Cross-space `blocks/blocked-by` over the existing (workspace-wide) `issueRelations`, plus a
**narrow** read-through: a viewer who can see one side of a link sees only a **projection** of
the linked provider issue — `{ identifier, title, stateName, updatedAt }` — never the full
issue. A new `canSeeLinkedProjection(vis, relation)` predicate, exactly as wide as "the status
of an issue explicitly linked to one you can see." This is the only item that reopens the
isolation model, so it lands **last**, with its own tests. **Size: M–L.**

## Build order

`7 → 3 → 1 → 2 → 4 → 6 → 8` — fastest momentum first, flagship in the middle, isolation-entangled
item last. Item 5 (per-agent identities) already shipped as personas (entry 22); the field work
asking for exactly what we built is the slate's own validation.

Each item ships behind the same bar as the rest of the codebase: typecheck, tests, a decision-log
touch where it changes a load-bearing choice, and the guides updated where an agent-facing
surface (MCP tools, decisions) changes.
