# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

**nonlinear** is a self-hostable clone of [Linear](https://linear.app) — teams, issues, workflow states, priorities, labels, projects/milestones, cycles, sub-issues, relations, comments/reactions/@mentions, file attachments, triage inbox, SLAs, initiatives + timeline/roadmap, documents with inline comments, saved views, full-text search, issue templates, project health updates, customers + requests, a public intake form (and Slack slash-command), triage automation rules, CSV import/export, team insights (throughput/velocity/burn-up), notifications inbox (due-soon + reminders + snooze + email digest), favorites, outbound webhooks (JSON + Slack), a GitHub PR integration, command palette, keyboard shortcuts, and real-time delta sync — running entirely in containers. `docker compose up --build` gives you the whole product on http://localhost:8080 (with MailHog at :8025 for digest emails).

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
- **packages/core** — domain services (auth, teams, issues, comments, projects, cycles, labels, relations, favorites, notifications, bootstrap, attachments, initiatives, documents, webhooks, due-soon, views, templates, projectUpdates, reminders, customers, docComments, triageRules, CSV importer) + the storage interfaces (and `BlobStore`) + an in-memory reference storage used by tests and `STORAGE=memory`. All business rules live here: issue numbering (`TEAM-123`), category timestamps, activity records, notification fan-out + muting, @mention parsing, sub-issue cycle prevention, cascade deletes, lazy cycle generation, triage-rule application on `IssueService.create`, SLA due dates. `createDomain` in `index.ts` is the composition root — new services register there and are exported from it; cross-service cascades (e.g. issue delete → reminders/customerRequests) are injected as optional deps.
- **packages/storage-postgres** — implements the storage interfaces. Entities are stored as one **jsonb document per row** with expression indexes on queried fields; relational tables only where semantics demand it (sessions, `team_counters` for atomic issue numbers, ordered `sync_log`). Migrations are plain SQL in `migrations/`, applied by `src/migrate.ts` at startup under a lock.
- **apps/api** — Fastify. Session-cookie auth (`nl_session`, scrypt hashes), thin REST routes that delegate to core services, and `src/hub.ts`: the WebSocket hub that replays `sync_log` deltas after a client's `hello {lastSyncId}` (buffering live deltas until replay completes) then streams live. Notification/favorite deltas are filtered to their owner. Also: multipart attachment + CSV upload, a 10-minute scheduler running due-soon **and** reminder scans, an hourly email-digest sender (`src/digest.ts`, nodemailer; no-op without `SMTP_URL`; MailHog in compose), the outbound webhook dispatcher, `src/github.ts` (HMAC GitHub PR webhook), `src/intake.ts` (unauthenticated public intake — form posts + Slack slash commands, rate-limited unless the team intake token is presented), and `src/mcp.ts` — the **HTTP MCP server** at `/mcp` (Streamable HTTP, `@modelcontextprotocol/sdk`), a protocol adapter over the same `Domain` (an in-process module, deliberately _not_ a separate container — see the agent note below).

**Auth is dual:** browser session cookie _or_ `Authorization: Bearer <personal API token>` (`domain.tokens.authenticate`). Tokens are non-synced bearer secrets (sha256-stored, like sessions) minted in Profile → API tokens; the MCP server and any scripted/agent client authenticate with them.

**Agents.** nonlinear supports agents three ways, all Bearer-authenticated: (1) the MCP server (tool layer, 13 tools name-resolved), (2) the REST API directly, (3) **agent users** — `isAgent` teammates you assign issues to / @mention, created by an admin (`POST /api/agents`, token minted via `POST /api/agents/:id/tokens` since agents can't log in). A webhook with `agentUserId` set only fires on events where that agent is the assignee or @mentioned (`WebhookService.involvesAgent`). `examples/agent/` is a runnable reference of the assign/mention → webhook → comment-back loop.

- **apps/web** — React + Vite + zustand. `store.ts` holds normalized entity maps; `sync.ts` bootstraps over REST then applies WS deltas (reconnect w/ backoff, `rebootstrap` support). Mutations go through REST and merge the response optimistically (`putEntity`); the same change also arrives as a delta, which is idempotent. Styling is a hand-rolled design system in `styles.css` (CSS variables, `data-theme` dark/light on `<html>`); icons are hand-drawn SVGs in `icons.tsx` mimicking Linear's state/priority iconography.

### Sync model (the load-bearing design)

Every mutation appends full-entity deltas to a monotonic sync log (`SyncBus.publish` → storage `syncLog.append` → live listeners). Clients bootstrap a full snapshot tagged with `syncId`, then stay current over `/api/ws`. On reconnect they send `lastSyncId`; the server replays anything newer or answers `rebootstrap`. When adding a new synced model: add it to `SyncModelMap`/`SYNC_MODEL_NAMES` in shared, a store + table (one jsonb table) in both storage impls, publish deltas from the service, and map it in the web store's `MODEL_TO_KEY`.

### First-run behavior

The first register creates the workspace, an admin user, and a default team (with Linear's default workflow states). Later registers join as members of every non-private team. `GET /api/meta` tells the login page whether setup is required.

## Roadmap

`ROADMAP.md` tracks feature parity against Linear's marketed product (Intake/Plan/Build/Monitor frame). P1 and P2 are shipped; **P3** (public API tokens, custom dashboards, Pulse activity digest, BYO-key AI features, PWA/mobile, Azure Blob adapter, SSO, audit log) remains. Pick from the top of P3 when asked to "continue toward parity".

## Known gaps / deferred

- Azure Blob `BlobStore` implementation (fs volume is the current attachment store; the interface in `packages/core/src/blob.ts` is the seam).
- Outbound webhooks are fire-and-forget (5s timeout, no retry queue).
- No public API tokens; the REST API is session-cookie only. No GraphQL.
- Sync log is never compacted (rebootstrap path exists and is exercised when it is).
- No rate limiting; auth is same-origin cookie based — put HTTPS in front and set `SECURE_COOKIES=true` in production.
