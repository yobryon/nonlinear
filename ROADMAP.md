# nonlinear — parity roadmap

Feature alignment plan against Linear's publicly marketed product (surveyed from
linear.app: home, Intake, Plan, Build, Monitor, Customer Requests, Features —
July 2026). Linear organizes its product into **Intake → Plan → Build → Diffs →
Monitor** plus platform features; this roadmap uses the same frame.

## Already at parity (shipped)

**Core (original build):** Teams · issues (priorities, labels, estimates, due
dates, sub-issues, relations) · per-team workflow states · triage inbox with
accept/decline · SLAs (auto due dates by priority) · projects + milestones ·
initiatives · cycles (auto-generated) · documents (markdown) · comments with
@mentions and reactions · file attachments · notifications inbox + due-soon
reminders · favorites · board + list views with pointer-based drag & drop,
multi-select bulk actions, filtering and grouping · command palette + keyboard
shortcuts · insights (throughput, distributions) · GitHub PR automation ·
outbound webhooks · dark/light themes · real-time delta sync · self-host
containers.

**P1 (shipped):** custom/saved views (sidebar + `/view/:id`) · full-text search
page (`/search`, titles + descriptions + comments) · issue templates (per-team,
in the create dialog) · project health updates (On Track / At Risk / Off Track
feed + chips) · timeline / roadmap visualization (`/timeline`) · inbox snooze +
per-issue reminders · sub-issue progress rollups in lists · heuristic duplicate
detection in the create dialog · archive views (`/team/:key/archive`).

**P2 (shipped):** customers + requests (tier/revenue, `/customers`) · public
intake form + Slack slash-command endpoint (`/intake/:key`) · inline document
comments (text-anchored, resolvable) · text selection → doc comment · automated
triage rules (keyword → set fields, applied on create) · Slack-format outbound
webhooks · CSV import (incl. Jira columns) + export · per-user notification
preferences + daily email digest (SMTP) · configurable estimate scales
(exponential/fibonacci/linear/t-shirt) + velocity chart + per-cycle burn-up.

**Agents (shipped):** personal API tokens (Bearer auth for REST + MCP) · a
hosted **MCP server** at `/mcp` (Streamable HTTP, in the API container) with 13
tools · **agent users** — non-human teammates you assign issues to and @mention
· agent-scoped webhooks that fire only on the agent's assignments/mentions · a
runnable reference agent (`examples/agent`). This is the direct answer to
"can an agent use nonlinear the way it uses Linear."

**Enterprise auth (shipped):** OIDC **single sign-on** (authorization-code +
PKCE, ID-token verified via `jose`; match-by-subject → link-by-email →
JIT-provision) with a login-page button, config-gated by `OIDC_ISSUER` ·
**SCIM 2.0** user provisioning (`/scim/v2/Users`, bearer-guarded by
`SCIM_TOKEN`) · a workspace **audit log** (non-synced, admin-only paged
`GET /api/audit`, surfaced in Settings) recording logins, provisioning,
role/active changes, and token/agent/webhook/team events. Verified end-to-end
in Docker against a mock OIDC provider.

**Monitor & AI (shipped):** **Custom dashboards** — a synced `Dashboard` of
composable insight tiles (stat, throughput, velocity, burn-up,
by-state/priority/assignee, project-health), shared or personal, reusing the
Insights chart components · **Pulse** — a cross-workspace activity digest
(project health updates, completions, new projects, cycle finishes, per-team
throughput) at `/pulse` · **BYO-key AI** — admin-set workspace LLM config
(Anthropic / OpenAI, key stored server-side, never synced) powering a Pulse
"Summarize with AI" action and AI-suggested labels on issues.

## P3 — Platform & scale

| Feature                 | Linear area | Notes                                                                                         |
| ----------------------- | ----------- | --------------------------------------------------------------------------------------------- |
| **GraphQL API**         | Platform    | Personal API tokens + REST are shipped; add a GraphQL layer if demand (Linear's is GraphQL).  |
| **Diffs (code review)** | Diffs       | Linear now ships code review for human+agent PRs. Large scope; likely out of clone territory. |
| **Mobile apps / PWA**   | Mobile      | Ship a PWA manifest + responsive layout pass first; native apps out of scope.                 |

**Shipped from P3:** SSO (Entra ID / OIDC) · SCIM · audit log · Azure Blob
storage adapter (`createAzureBlobStore`, verified against Azurite) · custom
dashboards · Pulse activity digest · BYO-key AI features (Pulse summaries +
suggested labels).

## Non-goals (for now)

Salesforce/Intercom/Zendesk/Gong connectors, Fivetran/Airbyte exports, native
iOS/Android, and Linear's hosted-agent marketplace — these hang off ecosystems
a self-hosted clone doesn't sit in. Revisit if the deployment story changes.
