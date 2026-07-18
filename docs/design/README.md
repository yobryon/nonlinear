# Design docs index

This directory holds the **product-design thinking** behind nonlinear — a
self-hostable clone of [Linear](https://linear.app). Where the rest of the repo
tells you *how the thing is built*, these documents tell you *what we decided to
build and why*. They are written for a new product or engineering teammate who
needs to understand the shape of the product, the reasoning behind its major
choices, and the trade-offs we knowingly accepted.

## What this corpus is (and isn't)

These are design documents, not an API reference and not a changelog. They are
*reflected from the running app* — every claim is grounded in code that exists
today (`packages/shared`, `packages/core`, `packages/storage-*`, `apps/api`,
`apps/web`), and where a feature isn't built we say "not yet" and point at
`ROADMAP.md`. The goal is that after reading them you could explain, to someone
who has never seen the codebase, why nonlinear stores entities as jsonb
documents, why sync is a monotonic log of full-entity deltas, why the MCP server
runs in-process rather than as its own container, and what "clone Linear as
closely as practical" actually forced on us.

They deliberately do not duplicate three things that live better elsewhere:

- **`CLAUDE.md`** — the build/architecture guide. It is the authoritative source
  for how to run the stack, the monorepo layout, the composition root
  (`createDomain`), and the mechanical recipe for adding a synced model. When a
  design doc needs to explain *why* a mechanism exists, it links back to the code
  that `CLAUDE.md` catalogues. Treat `CLAUDE.md` as the map of the territory;
  treat these docs as the reasoning about it.
- **`ROADMAP.md`** — feature status against Linear's marketed product, in
  Linear's own Intake → Plan → Build → Monitor frame. P1 and P2 are shipped; P3
  (GraphQL, custom dashboards, Pulse, BYO-key AI, PWA, Azure Blob, SSO, audit
  log) is not. Whenever a design doc discusses something unbuilt, `ROADMAP.md` is
  the single source of truth for its status — the docs defer to it rather than
  restating it.
- **The source itself** — the docs cite real files, entities, and functions so
  you can read the implementation directly instead of trusting prose.

## Table of contents

| # | Document | What it covers |
|---|----------|----------------|
| 01 | [Product vision](./01-product-vision.md) | Why a self-hostable Linear clone at all, the owner's hard constraints (containerized, low-cost, Azure-portable, keyboard-first speed), and what "as closely as practical" includes and excludes. |
| 02 | [Domain model](./02-domain-model.md) | The entity graph and its Linear-fidelity choices — issues/teams/states, the 0–4 priority scheme, state categories, sub-issues, relations, projects/milestones/initiatives/cycles — anchored in `packages/shared` types. |
| 03 | [Real-time sync](./03-real-time-sync.md) | The load-bearing design: full-entity deltas on a monotonic sync log, bootstrap-then-stream, reconnect/replay vs. rebootstrap, optimistic REST merges, and owner-filtered deltas (`SyncBus`, `apps/api/src/hub.ts`, `apps/web/sync.ts`). |
| 04 | [Storage & modularity](./04-storage-and-modularity.md) | The storage-interface seam (`packages/core/src/storage.ts`), jsonb-document-per-row with expression indexes, the `memory` vs. `postgres` engines, the `BlobStore` seam, and why no package outside `storage-*` touches a driver. |
| 05 | [Interaction design](./05-interaction-design.md) | The keyboard-first, real-time UX: command palette and shortcuts, board/list views with fractional ordering (`keyBetween`), multi-select bulk actions, the hand-rolled design system and Linear-mimicking iconography. |
| 06 | [Agent platform](./06-agent-platform.md) | The three ways an agent uses nonlinear (MCP server, REST, agent users), why the MCP server is in-process, Bearer-token auth, agent-scoped webhooks (`involvesAgent`), and the reference agent in `examples/agent`. |
| 07 | [Work hierarchy](./07-work-hierarchy.md) | How work nests and rolls up — initiatives → projects → milestones → issues → sub-issues, plus cycles as a time axis — the parity rationale, cycle-prevention rules, and progress rollups. |
| 08 | [Users & settings](./08-users-and-settings.md) | Identity and configuration: dual auth (session cookie + personal tokens), first-run workspace/admin/team bootstrap, team membership and privacy, notification preferences, and per-team configurables (estimate scales, workflow states). |
| 09 | [Decision log](./09-decision-log.md) | The running record of consequential choices with alternatives and honest limitations — jsonb over relational, in-process MCP, fire-and-forget webhooks, no sync-log compaction, cookie-only REST — the institutional memory. |

## Start here

If you are new, read in this order:

1. **01 Product vision** — the constraints everything else answers to. Nothing
   downstream makes sense without the owner's four hard rules.
2. **02 Domain model** — the vocabulary. Every other doc talks about issues,
   states, projects and cycles; get the shape of the graph first.
3. **03 Real-time sync** — the single most load-bearing decision in the system,
   and the one that most shapes how storage, the API, and the web client are
   written. If you read only one deep doc, read this.
4. **04 Storage & modularity** — the other half of the persistence story, and
   the seam that keeps a database driver out of the domain layer.

After that, branch by interest: **05** if you work on the front end, **06** if
you work on the agent/integration surface, **07–08** for the product breadth,
and **09** whenever you hit a "why on earth is it done *this* way" moment — the
decision log is written to answer exactly those.

A good habit: keep `CLAUDE.md` open in one tab and `ROADMAP.md` in another. These
docs assume both are within reach.
