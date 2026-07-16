# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

**nonlinear** (codename) is a self-hostable clone of [Linear](https://linear.app) — issues, teams, projects, cycles, workflows, keyboard-first UI, and real-time sync — built so a person or small organization can run it cheaply in containers.

**Status: greenfield.** As of 2026-07-15 no code exists yet; this file is the project charter. As real code, commands, and structure land, update this file to match reality — anything below marked *(planned)* is a decision, not a description of existing code.

## Hard constraints (from the project owner)

1. **Clone Linear as closely as practical** — data model, workflows, and UX feel (speed, keyboard-first, real-time collaboration).
2. **Fully containerized** — the whole app must run on local Docker via `docker compose up`. No host-installed services.
3. **Azure is the eventual deploy target** — when a managed service is needed, prefer an Azure one, but keep everything runnable in plain containers first.
4. **Low cost, low resource utilization** — compute cost should scale gently with usage. Prefer one small process over a fleet; burstable/consumption tiers over provisioned ones.
5. **Modular storage** — all persistence goes behind interfaces so the storage engine can be swapped later. No app code talks to a database driver directly.
6. **Front-end served like Azure Static Web Apps** — locally, a container serves the built SPA and proxies `/api/*` to the backend, mimicking SWA's linked-backend routing. Keep routing config expressible as `staticwebapp.config.json` so a real SWA deploy is a lift, not a rewrite.

## Architecture decisions *(planned)*

### Stack
- **TypeScript monorepo** (pnpm workspaces) — one language end-to-end so the domain model and sync payload types are shared between API and web.
- **API**: Node 22 + Fastify, a single container. WebSockets served from the same process (no separate realtime service) to keep the footprint at one small container.
- **Web**: React + Vite SPA, built to static assets.
- **Web serving**: nginx container serving the SPA build + proxying `/api` and `/ws` to the api container (the SWA stand-in per constraint 6).
- **Database**: PostgreSQL 16 in a container locally; Azure Database for PostgreSQL Flexible Server (burstable tier) in production. Postgres is the *default* engine, not a hard dependency — see storage layering below.
- **File/attachment storage**: local volume or Azurite locally; Azure Blob Storage in production, behind the same interface.
- **Auth**: local email/password with sessions first; keep the auth boundary pluggable so Azure Entra ID can be added without touching domain code.

### Repo layout
```
apps/
  api/               Fastify server: REST + WebSocket sync
  web/               React SPA
packages/
  core/              Domain model, business logic, and ALL storage interfaces
  storage-postgres/  Postgres implementation of core's storage interfaces
  shared/            API contracts + sync protocol types shared by api and web
infra/
  web/               nginx config (SWA stand-in), staticwebapp.config.json
docker-compose.yml   Full local stack: web, api, postgres (+ azurite when attachments land)
```

### Storage layering (constraint 5 — the load-bearing rule)
- `packages/core` defines repository/unit-of-work interfaces and owns the domain types. It imports **no** database drivers.
- `packages/storage-postgres` implements those interfaces. A future `storage-sqlite`, `storage-cosmos`, etc. would be siblings.
- `apps/api` composes core + one storage implementation at startup (constructor injection; engine chosen by env var).
- If you find yourself importing `pg`/SQL/blob SDKs anywhere outside a `storage-*` package, stop — that's the boundary being violated.

### Real-time sync
Linear's defining trait is instant sync. The model to follow: clients keep a local cache, the server assigns a monotonically increasing sync id to every mutation, and clients catch up via "give me everything since syncId N" plus a live WebSocket delta stream. Design the sync protocol in `packages/shared` first — it shapes everything else. Keep the transport abstract enough that Azure Web PubSub could replace in-process WebSockets if horizontal scaling ever demands it.

## Commands *(planned — verify against reality once code exists, then remove this caveat)*

```bash
docker compose up --build     # full stack: web on :8080, api on :3000, postgres
pnpm install                  # workspace deps (inside containers or on host for IDE support)
pnpm dev                      # hot-reload dev servers (api + web) outside containers
pnpm test                     # all tests (vitest)
pnpm --filter api test        # tests for one workspace
pnpm --filter api test path/to/file.test.ts   # single test file
pnpm lint                     # eslint + prettier check
pnpm typecheck                # tsc --noEmit across workspaces
```

Tests use vitest; storage-postgres integration tests run against the compose postgres container.

## Build order (suggested, not yet started)

1. Scaffold monorepo + docker compose skeleton (empty api responding on `/healthz`, nginx serving a stub SPA, postgres up).
2. Domain model + storage interfaces in `core`; postgres implementation; migrations.
3. Sync protocol in `shared`; REST + WebSocket endpoints in `api`.
4. Web app: auth, issue list/board, issue detail, keyboard-first command palette.
5. Teams, projects, cycles, workflows — iterate toward Linear parity.
