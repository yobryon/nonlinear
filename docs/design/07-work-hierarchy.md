# Work hierarchy: issues, projects, initiatives, cycles

This document explains how nonlinear models _work_ — the nested vocabulary of
issues, cycles, projects, and initiatives — and, more importantly, _why_ the
model is shaped the way it is. If you are new here, the single most useful
mental model to hold is this: **teams own execution, work items cross teams.**
Almost every design decision below falls out of taking that sentence seriously.

The audience is a product/eng teammate who needs to reason about the model, not
an API consumer. Where a REST shape matters we point at it, but the goal is to
convey the product thinking. Everything here is grounded in code you can open:
the domain services under `packages/core/src/services/` and the entity contract
in `packages/shared/src/entities.ts`.

## The shape at a glance

nonlinear has four units of work, and they nest — loosely, not rigidly:

```
initiative        (roadmap grouping — spans quarters, spans teams)
  └─ project      (a unit of work with an OUTCOME — spans teams)
       └─ milestone   (a checkpoint inside a project)
       └─ issue   (the atom — always belongs to exactly one team)
            └─ sub-issue (an issue with a parentId)

cycle             (a team's time-boxed iteration — issues opt in)
```

The load-bearing asymmetry: an **issue** is anchored to exactly one team and
carries the team's identity in its number (`ENG-123`). Everything above it —
projects, initiatives — is deliberately _not_ team-scoped; a project lists the
teams it touches (`teamIds`), and an issue optionally points _up_ at a project.
Cycles sit off to the side: they are strictly a team's own iteration rhythm, and
an issue references at most one.

The nesting is loose on purpose. An issue can belong to a project _or not_, to a
cycle _or not_, to a milestone _or not_, to a parent _or not_. None of these are
required. This mirrors Linear, and it matters: the hierarchy is a set of
optional lenses over a flat pool of issues, not a containment tree you must fill
out top-down before you can file a bug.

## Issues: the atom, and why they are team-scoped

The issue is the only entity in the system that _must_ exist for anything else
to be useful. Its contract lives at `packages/shared/src/entities.ts` (`interface
Issue`) and its behavior at `packages/core/src/services/issues.ts`
(`IssueService`).

An issue is born into a team and never floats free of one. The `teamId` is
required at creation (`IssueService.create` calls `storage.teams.get` and throws
`notFound('Team')` if it's missing), and the human-facing identifier is derived
from the team: `${team.key}-${number}`, where `number` comes from an atomic
per-team counter (`storage.teams.nextIssueNumber`). This is the design comment
on line 127-128 of `entities.ts`. We chose team-scoped sequential numbers over
global UUIDs-in-the-URL because that is the identifier people actually say out
loud ("can you look at ENG-412"), and because it makes a team's issue space feel
like _theirs_.

The consequence of team-scoping shows up in one of the more surgical pieces of
`IssueService.update`: **moving an issue to another team re-numbers it.** When
`input.teamId` changes we mint a fresh number from the destination team's
counter, reset the workflow state to that team's default, and — notably — clear
`cycleId` to null (lines 177-188). We clear the cycle because cycles belong to
the _old_ team; carrying a foreign team's iteration reference across the move
would be meaningless. This is the model defending its own invariant: a cycle
reference on an issue must always name a cycle of that issue's current team,
which `update` re-checks (`cycle.teamId !== issue.teamId → notFound('Cycle')`).

Everything else on an issue is an optional pointer: `projectId`, `milestoneId`,
`cycleId`, `parentId`, `assigneeId`, `labelIds`. The service treats each as an
independently-settable field with its own activity record, so the issue detail
timeline can narrate "moved to project X", "added to cycle 14", "set parent to
ENG-3". Sub-issues are just issues with a `parentId`, and the only structural
rule enforced is **no cycles in the parent chain** — `update` walks ancestors
and throws `cyclic_parent` if it would close a loop (lines 282-303). We did not
build a separate "sub-task" entity; a sub-issue is a full issue so it can have
its own assignee, state, estimate, and even its own sub-issues. This is a
deliberate Linear-parity choice and it keeps the model small.

## Cycles: a team's iteration rhythm, generated for you

Cycles (`packages/core/src/services/cycles.ts`, `CycleService`) are the one
piece of the hierarchy that is purely a _team_ concern. A cycle is a
time-boxed window — Linear's answer to a sprint — with a `teamId`, a
monotonically increasing `number` within that team, and a `startsAt`/`endsAt`
pair. Issues opt in via `cycleId`.

The interesting product decision here is that **cycles are auto-generated, not
hand-created.** A team that wants iterations shouldn't have to remember to open
"Cycle 15" every two weeks. So `ensureCurrentCycles(teamId)` runs lazily —
called by the API on bootstrap — and rolls the calendar forward: starting from
the end of the latest existing cycle (or the start of the current week for a
brand-new team), it creates fixed-duration cycles until one covers _now_ and one
sits in the future (the `while (cursor < now + durationMs)` loop, lines 59-68).
Duration comes from the team's own `cycleDurationWeeks`, and the whole mechanism
is gated on `team.cyclesEnabled` — a team that doesn't run cycles gets none, and
`ensureCurrentCycles` returns an empty array immediately.

We chose _lazy generation on read_ over a scheduled cron job for a reason
consistent with the rest of the system: nonlinear tries to keep its background
machinery minimal (the API has exactly one 10-minute scheduler, for due-soon and
reminder scans — see CLAUDE.md). Generating cycles when someone actually loads
the workspace means there's no drift to reconcile, no missed-tick problem, and
nothing to run when nobody's looking. The honest cost is that cycles only
advance when the team is active; a workspace nobody visits for a month won't have
its cycles pre-created, but they'll appear the instant someone bootstraps. That
trade is fine because a cycle nobody has looked at yet has no work in it anyway.

The `startOfWeek` helper (lines 108-114) anchors generation to Monday in UTC.
That is a known simplification: it does not yet honor a team's `firstDayOfWeek`
preference or local timezone for the cycle boundary. Not a correctness bug for
the iteration model, but a place a future polish pass would look.

## Projects: the cross-team unit with an outcome

Projects are where the "work crosses teams" idea becomes concrete, and they are
the richest entity in this document. The contract is `interface Project`
(`entities.ts` line 183), the service is
`packages/core/src/services/projects.ts` (`ProjectService`), and the whole UI
surface is `apps/web/src/pages/Projects.tsx`.

### Framing: what a project _is_

We took Linear's framing almost verbatim, and it's worth stating because it
drives the schema. Linear describes a project as _"a larger unit of work with a
clear outcome, shared across teams, comprised of issues and optional
documents."_ Our empty-state copy in `Projects.tsx` (the `ProjectsPage` empty
state, lines 476-479) says the same thing in our own words: _"Projects are
larger units of work with a clear outcome, like a feature you want to ship. They
span multiple teams and are made of issues and their own documents."_ And the
overview editor's placeholder literally prompts for the outcome — "What's the
outcome? Describe the goal, scope, and context…" (`ProjectOverview`, line 273).

Every word in that framing is a design commitment:

- **"clear outcome"** → the project's `description` is treated as the outcome
  statement, front and center on the Overview tab, editable inline.
- **"shared across teams"** → `teamIds` is a _list_, required non-empty. A
  project with zero teams is rejected at both create and update
  (`throw new DomainError('no_teams', …)`, projects.ts lines 35-37 and 86-88).
  This is the schema-level enforcement of "a project must touch at least one
  team but is not owned by one."
- **"comprised of issues"** → issues point up via `projectId`; the project has
  no issue list of its own. Progress is _computed_ from the issues that point at
  it (see below).
- **"optional documents"** → documents carry a nullable `projectId`, so a
  document can belong to a project or stand alone.

### Why teamIds is a list, not an owner

This is the crux. An issue has one `teamId`; a project has `teamIds: string[]`.
The difference encodes the difference between _execution_ and _coordination_.
Execution happens inside a team — one team's workflow states, one team's cycles,
one team's triage queue. Coordination toward an outcome spans teams — the
"ship dark mode" project pulls issues from Design, Web, and Mobile. If we had
made a project belong to a single team, cross-team work would have had no home
and people would fake it with labels. By making `teamIds` a set, a project can
recruit issues from any of its teams, and the "Add issue" button on the project's
Issues tab seeds the new issue with `project.teamIds[0]` as a sensible default
(`Projects.tsx` line 830-831) while leaving the user free to pick another.

Members and lead layer a people-model on top: `leadId` (single directly
responsible person) and `memberIds` (the working set). These are plain user
references validated nowhere near as strictly as team membership — a project
lead need not be a member of every team the project spans, which is the point.

### The Overview tab: the project as a home page

Open `ProjectDetail` in `Projects.tsx` and you'll see the project detail is a
two-tab affair — `overview` and `issues` (line 655, the `tab` state). The
**Overview tab** is the project's home page and is worth walking through because
it's the concentrated expression of the model:

1. **Outcome / description** (`ProjectOverview`) — inline-editable markdown,
   double-click to edit. This is the "clear outcome."
2. **Computed progress** — not a stored field. `ProjectOverview` filters
   `issues` down to `i.projectId === project.id && !i.archivedAt`, counts those
   whose workflow-state category is `completed` or `canceled`, and renders a
   percentage bar (lines 243-250). The same computation is factored out as the
   exported `projectProgress(projectId)` helper (lines 431-439) so the project
   _list_ row can show the same "3/8 done" without duplicating logic. Progress
   is derived so it can never drift from the issues themselves.
3. **Properties** — teams (as chips), lead, and the start→target date range,
   plus a members avatar row with an add button.
4. **Health updates** (`ProjectUpdatesSection`) — see below.
5. **Milestones** — reorderable checkpoints, each showing its own done/total.
6. **Documents** (`ProjectDocuments`) — the project's own docs, creatable in
   context.

The **Issues tab** is just the standard grouped/filtered issue list (`ViewControls`

- `GroupedIssueList`) scoped to this project. Reusing the same issue-view
  machinery the rest of the app uses is deliberate: a project is not a special
  container with its own bespoke issue UI; it's a _filter_ over the global issue
  pool that also happens to have a home page.

### Health updates: status as a narrated feed, not a field

A naive design would put a single `health` enum on the project. We didn't. Look
at `ProjectUpdateService` (`packages/core/src/services/projectUpdates.ts`): a
**project update** is its own entity — `{ projectId, authorId, health, body,
createdAt }` — and a project's health is _the health of its most recent update_.
`latestHealth(projectId)` (lines 87-98) computes it by scanning updates and
picking the newest; the web side mirrors this in the `latestHealth` helper and
`HealthChip` component (`Projects.tsx` lines 57-85), which sort updates by
`createdAt` descending and read `[0]`.

The three health values are `on_track`, `at_risk`, `off_track`
(`PROJECT_HEALTHS` in `enums.ts`), rendered as colored chips mapped through
`HEALTH_META`. Why a feed instead of a field?

- **A status change is a story, not a state.** "At risk — the vendor API slipped
  a week" is worth keeping; a bare enum throws away the _why_. The `body` field
  carries the narrative, and the feed becomes the project's status history.
- **It composes with the roadmap.** The Timeline (see initiatives) reads the
  latest health per project by folding the same update stream, so a health post
  ripples straight to the roadmap with zero extra plumbing.
- **Authorship and permissions fall out naturally.** Updates have an `authorId`,
  and the service enforces that you can only edit your own updates, but an
  admin _or_ the author can delete one (`update` is author-only, `remove` allows
  `actor.role === 'admin'`, projectUpdates.ts lines 48-50 and 63-66). That is
  exactly the etiquette you'd want for a status feed.

The cost is that "current health" is a computation over a collection rather than
a cheap column read. In a jsonb-per-row store that's a scan-and-filter, which is
fine at the scale a self-hosted clone targets, but it's an honest thing to note.

### Milestones: checkpoints inside the outcome

Milestones (`ProjectMilestone`, and the `createMilestone`/`updateMilestone`/
`removeMilestone` methods on `ProjectService`) are lightweight named checkpoints
scoped to a single project. An issue's `milestoneId` is subordinate to its
`projectId`: setting a project clears nothing, but _clearing_ a project also
clears the milestone — see `IssueService.update` line 264 (`if (!input.projectId)
issue.milestoneId = null`) and the project-removal cascade, which nulls both
`projectId` and `milestoneId` on every affected issue (projects.ts lines
112-120). Milestones are manually orderable via fractional `sortOrder` keys
(`keyAfterAll`, and the drag-reorder wiring in `Projects.tsx`'s
`milestoneReorder`), same as issues in a list. We did not give milestones their
own status or health — they are intentionally just a name, an optional target
date, and a done/total rollup computed from the issues assigned to them.

### Deletion is a cascade, and it's a good example of the whole model

`ProjectService.remove` (projects.ts lines 105-147) is the clearest single view
of how the project sits in the graph. Deleting a project does **not** delete its
issues — it _detaches_ them (`issue.projectId = null; issue.milestoneId = null`).
It _does_ delete the project's milestones, its favorites, and (via the injected
`projectUpdates` cascade) its update feed, and it detaches its documents
(`document.projectId = null`). This encodes a value judgment: **issues and
documents are first-class and outlive the project; milestones and health updates
are project-internal and die with it.** All of this is published as one batched
set of sync deltas so every connected client converges atomically.

## Initiatives: the roadmap grouping above projects

Initiatives (`interface Initiative`, tersely commented _"Roadmap grouping of
projects"_ at `entities.ts` line 266; service at
`packages/core/src/services/initiatives.ts`) are the top of the hierarchy and
the simplest entity of the four. An initiative has a name, description, color,
an `ownerId`, a `targetDate`, and a `status` from `INITIATIVE_STATUSES`
(`planned | active | completed`). It has **no `teamIds`** — an initiative is a
strategic grouping and cares nothing about teams directly. Projects point up at
it via a nullable `initiativeId`.

The relationship is deliberately loose in the same way project↔issue is: a
project may belong to one initiative or none, and deleting an initiative
**detaches** its projects rather than cascading into them (`InitiativeService.remove`
nulls `project.initiativeId` on each child, lines 65-72). Projects are the
durable unit; the initiative is a lens over them.

Where initiatives earn their keep is the **Timeline / roadmap view**
(`apps/web/src/pages/Timeline.tsx`). The timeline groups every project under its
initiative (`p.initiativeId === initiative.id`), sorts projects by start date,
and renders each as a horizontal bar across a month-scaled time axis running from
one month before the earliest start to one month after the latest target
(`projectStartMs`/`projectEndMs` and the domain computation, lines 49-54 and
138-139). Projects with no initiative — or a dangling `initiativeId` — fall into
an "orphans" group so nothing is invisible (lines 116-118). Crucially, the
timeline colors each project bar by its **latest health**, folding the same
`projectUpdates` stream that the project page reads (lines 122-134). So the whole
top-to-bottom story — issue done/undone → project progress and health →
initiative roadmap — is one derivation chain over the issue and update pools,
with nothing denormalized.

### Comparison to Linear, and where we stop

Linear's initiatives can themselves nest and can carry their own documents and
updates; ours are flat and lean. We built the grouping and the roadmap
visualization because that's the 80% of the value, and stopped short of
initiative-level documents, initiative health, or nested initiatives. If those
are wanted they're a natural extension — an initiative already looks a lot like
a project minus `teamIds` — but they are **not yet** built. See ROADMAP.md;
initiatives + timeline are listed under shipped core, and no P3 line expands
them, so today they are a deliberate floor, not a ceiling.

## The issue-flow supporting cast

Around the issue sit four features that shape how work _enters and is viewed_.
They aren't part of the nesting, but they're the machinery that makes the atom
usable, so a new teammate should know where they live.

### Triage: the front door for un-owned issues

Triage is a _per-team_ intake queue. A team with `triageEnabled` gets a workflow
state in the `triage` category, and `IssueService.defaultState` routes brand-new
issues there when triage is on (issues.ts lines 43-47) — so anything created
without an explicit state (public intake forms, Slack commands, automations)
lands in triage rather than the backlog. The `Triage.tsx` page is the review
surface: it lists issues sitting in the team's triage state and offers one-click
**accept** (move to the backlog/unstarted state) or **decline** (move to
canceled) — see the `acceptState`/`declineState` resolution at the top of
`Triage.tsx`. Triage is where "should this be worked at all?" gets answered
before an issue joins the team's real workflow.

### SLAs: priority-derived due dates

SLAs are the quiet automation that ties priority to a deadline. A team can set
`slaUrgentHours` and `slaHighHours`; when an issue is created (or its priority
raised) without an explicit due date, `IssueService.slaDueDate` derives one —
`now + slaUrgentHours` for priority 1 (Urgent), `now + slaHighHours` for
priority 2 (High), nothing otherwise (issues.ts lines 57-64, applied at create
line 124 and on priority change lines 225-228). It only _fills_ an empty due
date; it never overwrites one a human set. This is a small feature with a nice
property: it turns "urgent" from a label into an actual clock, and it feeds the
existing due-soon notification scan for free.

### Templates: pre-filled issue shapes

Issue templates (`IssueTemplateService`, `templates.ts`) are per-team,
pre-filled issue skeletons — a name, optional `titlePrefix`, description,
priority, labels, and estimate — surfaced in the create dialog. They exist so
recurring kinds of work ("Incident", "Customer bug") start from a consistent
shape instead of a blank box. They're team-scoped because the labels and
workflow they presume are the team's.

### Custom / saved views: reusable lenses over the pool

Custom views (`CustomViewService`, `views.ts`) persist a filter + grouping +
display (`list`/`board`) combination under a name. A view can be personal or
`shared`, and optionally scoped to a `teamId` or left workspace-wide. This is
the same insight as projects, generalized: much of the product is _filters over
one flat issue pool_, and a saved view just lets you name a filter and pin it to
the sidebar. Sharing is permission-gated (`assertCanManage`), so a shared team
view isn't editable by everyone who can see it.

## What a team owns vs. what crosses teams

Pulling it together, here is the ownership line the whole model draws:

| Concern                              | Scoped to one team?                  | Where it lives         |
| ------------------------------------ | ------------------------------------ | ---------------------- |
| Issue (identity, number, state)      | **Yes** — `issue.teamId`, `TEAM-123` | `IssueService`         |
| Workflow states                      | Yes — per-team                       | team config            |
| Cycles                               | Yes — `cycle.teamId`, auto-generated | `CycleService`         |
| Triage queue                         | Yes — team's triage state            | `Triage.tsx`           |
| SLAs, templates, triage rules        | Yes — team config                    | respective services    |
| **Project** (outcome, lead, members) | **No** — `teamIds` is a list         | `ProjectService`       |
| Milestones                           | Belong to a project, not a team      | `ProjectService`       |
| Health updates                       | Belong to a project                  | `ProjectUpdateService` |
| **Initiative** (roadmap grouping)    | **No** — no team reference at all    | `InitiativeService`    |
| Documents                            | Optional project link, else free     | `DocumentService`      |

Read top to bottom, the table _is_ the thesis: the things that govern how work
gets _executed_ are the team's; the things that describe what the work is _for_
cross teams. An issue is the hinge — it belongs to a team but points up at
cross-team structure.

## Honest gaps and deferrals

- **Cycle boundaries ignore team calendar/timezone preferences.** Generation
  anchors to Monday-UTC (`startOfWeek` in cycles.ts), not the team's
  `firstDayOfWeek`. Cosmetic for now, but real.
- **Lazy cycle generation means idle workspaces don't pre-roll cycles.** They
  materialize on next bootstrap. Acceptable given no work accumulates in an
  unopened future cycle, but worth knowing.
- **Current project health is a scan, not a column.** `latestHealth` folds the
  whole update collection each time. Fine at self-host scale; a candidate for
  denormalization if project counts ever grow large.
- **Initiatives are flat and lean.** No nesting, no initiative-level documents
  or health, unlike Linear. A deliberate floor; extendable but **not yet**
  built (ROADMAP.md).
- **No cross-team rollup on projects beyond issue progress.** A project shows
  computed issue done/total and its latest health, but there's no per-team
  breakdown or velocity-into-a-project analytic. The insights features exist at
  the team level; wiring them to projects is unbuilt.
- **Milestones are minimal by design.** No status, no health, no assignee — just
  a name, a date, and a rollup. If richer milestones are wanted they'd grow
  toward looking like mini-projects; we chose not to.

None of these are accidental omissions in the core model — the nesting,
team-scoping, and derivation-over-denormalization decisions are the intended
design. The gaps are at the edges, and the roadmap frame (Intake → Plan → Build
→ Monitor) is where the next increments would slot in.
