# nonlinear

A fast, self-hostable issue tracker — a [Linear](https://linear.app) clone that a
person or team can run on their own containers (and move to Azure when they
outgrow a single box). Keyboard-first, real-time, and container-native.

```bash
docker compose up --build
# → web+api+postgres on http://localhost:8080  (MailHog at :8025 for digest emails)
```

The **first account you register** creates the workspace and becomes its admin.
After that, registration is invite-only by default — see below.

## What's in the box

Teams, issues (priorities, labels, estimates, due dates, sub-issues, relations),
per-team workflow states, triage inbox + SLAs, projects/milestones, initiatives,
cycles, documents with inline comments, comments/reactions/@mentions,
attachments, saved views, full-text search, templates, project health updates,
customers + a public intake form, triage automation, CSV import/export, insights,
**custom dashboards**, a **Pulse** activity digest, notifications + email digest,
favorites, outbound webhooks, a GitHub PR integration, a **GraphQL API**, an
**MCP server** + agent teammates, **SSO/SCIM + audit log**, optional **BYO-key
AI** (Pulse summaries + suggested labels), a command palette, keyboard shortcuts,
an installable **PWA**, and real-time delta sync.

## Configuration

Everything an operator sets — Postgres, HTTPS/cookies, **who can register**,
**SSO (OIDC)**, SCIM, Azure Blob attachments, SMTP, GitHub — is an environment
variable on the `api` container. The default `docker compose up` needs none of
them.

→ **[docs/configuration.md](docs/configuration.md)** is the full reference,
including step-by-step **SSO setup** for Entra ID / Okta / Google and the
registration/invite model.

## How it's built

pnpm monorepo, TypeScript ESM end-to-end. A single small API process (Fastify)
over jsonb-on-Postgres, a ~130 KB SPA (React + zustand), nginx standing in for
Azure Static Web Apps. All persistence goes through swappable storage interfaces
(`STORAGE=memory|postgres`); every integration is a thin transport adapter over
one in-process domain.

- **[CLAUDE.md](CLAUDE.md)** — how to build, run, and navigate the codebase.
- **[docs/design/](docs/design/)** — the product-design reasoning: _why_ the
  major choices were made, with alternatives and trade-offs. Also readable
  in-app under **Design docs**.
- **[ROADMAP.md](ROADMAP.md)** — feature parity against Linear, and what's next.

## Development

```bash
pnpm install
STORAGE=memory pnpm --filter @nonlinear/api dev   # API with zero external deps
pnpm dev            # hot-reload api (:3000) + web (:5173)
pnpm test           # all tests (vitest)
pnpm typecheck      # tsc --noEmit across workspaces
```
