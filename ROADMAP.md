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

## P3 — Platform & scale

| Feature                                                        | Linear area  | Notes                                                                                                                                          |
| -------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Public API tokens + REST/GraphQL**                           | Platform     | Personal access tokens over the existing REST surface; GraphQL layer if demand.                                                                |
| **Custom dashboards**                                          | Monitor      | Composable insight tiles (our chart components are already modular).                                                                           |
| **Pulse (activity digest)**                                    | Monitor      | Cross-workspace feed of project updates and status changes; optional AI summaries.                                                             |
| **AI features (agents, triage intelligence, Pulse summaries)** | Build/Intake | Linear's 2025-26 direction: assignable agents, suggested assignees/labels, duplicate AI. Self-host analog: bring-your-own-key LLM integration. |
| **Diffs (code review)**                                        | Diffs        | Linear now ships code review for human+agent PRs. Large scope; likely out of clone territory — revisit.                                        |
| **Mobile apps / PWA**                                          | Mobile       | Ship a PWA manifest + responsive layout pass first; native apps out of scope.                                                                  |
| **Azure Blob storage adapter**                                 | Platform     | Implement `BlobStore` against Azure Blob; config-select like `STORAGE`.                                                                        |
| **SSO (Entra ID) & SCIM**                                      | Platform     | Auth boundary is pluggable; add OIDC login alongside passwords.                                                                                |
| **Audit log**                                                  | Platform     | Admin-visible activity log (we already record issue activities; extend to admin events).                                                       |

## Non-goals (for now)

Salesforce/Intercom/Zendesk/Gong connectors, Fivetran/Airbyte exports, native
iOS/Android, and Linear's hosted-agent marketplace — these hang off ecosystems
a self-hosted clone doesn't sit in. Revisit if the deployment story changes.
