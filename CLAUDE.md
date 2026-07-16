# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

**nonlinear** is a self-hostable clone of [Linear](https://linear.app) — teams, issues, workflow states, priorities, labels, projects/milestones, cycles, sub-issues, relations, comments/reactions/@mentions, notifications inbox, favorites, command palette, keyboard shortcuts, and real-time delta sync — running entirely in containers. `docker compose up --build` gives you the whole product on http://localhost:8080.

## Hard constraints (from the project owner)

1. **Clone Linear as closely as practical** — data model, workflows, and UX feel (speed, keyboard-first, real-time).
2. **Fully containerized** — everything runs on local Docker; no host-installed services.
3. **Azure is the eventual deploy target** — prefer Azure managed services when needed, but keep plain-container portability. Web is designed to move to Azure Static Web Apps (see `infra/web/staticwebapp.config.json`), API to a container service, Postgres to Flexible Server (burstable tier).
4. **Low cost / low resource** — one small API process, jsonb-on-Postgres storage, ~100 KB gzipped SPA. Prefer burstable/consumption tiers.
5. **Modular storage** — all persistence goes through the interfaces in `packages/core/src/storage.ts`. No package outside `storage-*` may import a database driver. `STORAGE=memory|postgres` selects the engine at API startup.
6. **Front-end served like Azure SWA** — nginx (`infra/web/nginx.conf`) serves the built SPA and proxies `/api` + `/api/ws`, mirroring `staticwebapp.config.json`.

## Commands

```bash
docker compose up --build      # full stack: web+api+postgres on http://localhost:8080
pnpm install                   # workspace deps
pnpm dev                       # hot-reload api (:3000, needs a postgres or STORAGE=memory) + web (:5173, proxies /api)
STORAGE=memory pnpm --filter @nonlinear/api dev   # api with zero deps, in-memory storage
pnpm test                      # all tests (vitest)
pnpm --filter @nonlinear/core test                # one workspace
pnpm --filter @nonlinear/core test src/util/fractional.test.ts   # single file
POSTGRES_TEST_URL=postgres://nonlinear:nonlinear@localhost:15432/t pnpm --filter @nonlinear/storage-postgres test   # pg integration tests (skipped without env var)
pnpm typecheck                 # tsc --noEmit across workspaces
pnpm build                     # build all workspaces (shared must build before dependents; pnpm -r handles order)
pnpm lint / pnpm format        # prettier check / write
```

Tests import workspace siblings from **source** via vitest aliases, but `tsc` and Docker builds resolve them via each package's built `dist/` — if types seem stale or missing, rebuild the upstream package (`pnpm --filter @nonlinear/shared build` etc.).

## Architecture

pnpm monorepo, TypeScript ESM end-to-end (`.js` import specifiers everywhere except apps/web which uses bundler resolution).

- **packages/shared** — the contract: entity types, enums (Linear's priority scheme 0=None 1=Urgent…4=Low; state categories triage/backlog/unstarted/started/completed/canceled), input DTOs, the sync protocol (`SyncDelta`, `BootstrapPayload`, WS messages), and the fractional-ordering util (`keyBetween`) used for board/list manual ordering.
- **packages/core** — domain services (auth, teams, issues, comments, projects, cycles, labels, relations, favorites, notifications, bootstrap) + the storage interfaces + an in-memory reference storage used by tests and `STORAGE=memory`. All business rules live here: issue numbering (`TEAM-123`), category timestamps (startedAt/completedAt/canceledAt), activity records, notification fan-out, @mention parsing, sub-issue cycle prevention, cascade deletes, lazy cycle generation on the team cadence.
- **packages/storage-postgres** — implements the storage interfaces. Entities are stored as one **jsonb document per row** with expression indexes on queried fields; relational tables only where semantics demand it (sessions, `team_counters` for atomic issue numbers, ordered `sync_log`). Migrations are plain SQL in `migrations/`, applied by `src/migrate.ts` at startup under a lock.
- **apps/api** — Fastify. Session-cookie auth (`nl_session`, scrypt hashes), thin REST routes that delegate to core services, and `src/hub.ts`: the WebSocket hub that replays `sync_log` deltas after a client's `hello {lastSyncId}` (buffering live deltas until replay completes) then streams live. Notification/favorite deltas are filtered to their owner.
- **apps/web** — React + Vite + zustand. `store.ts` holds normalized entity maps; `sync.ts` bootstraps over REST then applies WS deltas (reconnect w/ backoff, `rebootstrap` support). Mutations go through REST and merge the response optimistically (`putEntity`); the same change also arrives as a delta, which is idempotent. Styling is a hand-rolled design system in `styles.css` (CSS variables, `data-theme` dark/light on `<html>`); icons are hand-drawn SVGs in `icons.tsx` mimicking Linear's state/priority iconography.

### Sync model (the load-bearing design)

Every mutation appends full-entity deltas to a monotonic sync log (`SyncBus.publish` → storage `syncLog.append` → live listeners). Clients bootstrap a full snapshot tagged with `syncId`, then stay current over `/api/ws`. On reconnect they send `lastSyncId`; the server replays anything newer or answers `rebootstrap`. When adding a new synced model: add it to `SyncModelMap`/`SYNC_MODEL_NAMES` in shared, a store + table (one jsonb table) in both storage impls, publish deltas from the service, and map it in the web store's `MODEL_TO_KEY`.

### First-run behavior

The first register creates the workspace, an admin user, and a default team (with Linear's default workflow states). Later registers join as members of every non-private team. `GET /api/meta` tells the login page whether setup is required.

## Known gaps / deferred

- File attachments (interface would go behind storage boundary; Azurite/Azure Blob planned).
- Due-soon notifications need a scheduler; type exists, nothing emits it.
- Command palette/shortcuts don't mount on `/settings/*` routes.
- Sync log is never compacted (rebootstrap path exists and is exercised when it is).
- No rate limiting; auth is same-origin cookie based — put HTTPS in front and set `SECURE_COOKIES=true` in production.
