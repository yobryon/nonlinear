# nonlinear — parity roadmap

Feature alignment plan against Linear's publicly marketed product (surveyed from
linear.app: home, Intake, Plan, Build, Monitor, Customer Requests, Features —
July 2026). Linear organizes its product into **Intake → Plan → Build → Diffs →
Monitor** plus platform features; this roadmap uses the same frame.

## Already at parity (shipped)

Teams · issues (priorities, labels, estimates, due dates, sub-issues, relations)
· per-team workflow states · triage inbox with accept/decline · SLAs (auto due
dates by priority) · projects + milestones · initiatives · cycles
(auto-generated) · documents (markdown) · comments with @mentions and reactions
· file attachments · notifications inbox + due-soon reminders · favorites ·
board + list views with drag & drop, multi-select bulk actions, filtering and
grouping · command palette + keyboard shortcuts · insights (throughput,
distributions) · GitHub PR automation (magic words, auto-close on merge) ·
outbound webhooks · dark/light themes · real-time delta sync · self-host
containers.

## P1 — Core product depth (next up)

| Feature | Linear area | Notes |
|---|---|---|
| **Custom views** | Plan | Save a filter/group/display config as a named, shareable view; sidebar section; the missing piece of our filter system. |
| **Full-text search page** | Platform | Palette search exists; add a dedicated search view w/ filters over titles, descriptions, comments (Postgres `tsvector`). |
| **Issue templates** | Intake | Per-team templates pre-filling description/labels/priority; template picker in the new-issue dialog. |
| **Project health updates** | Plan | On Track / At Risk / Off Track status posts with an update feed on each project, shown on the projects list. |
| **Timeline (roadmap) visualization** | Plan | Gantt-style initiative/project timeline using start/target dates — the visual half of initiatives we don't render yet. |
| **Inbox snooze + issue reminders** | Monitor | Snooze notifications until a time; "remind me" on issues (extends the due-soon scheduler). |
| **Parent/sub-issue progress rollups** | Build | Show sub-issue completion on parents in lists/boards (we show it on detail only). |
| **Duplicate detection (heuristic)** | Intake | Similar-title suggestions in triage and on create ("possible duplicate of NON-42"). |
| **Archive views** | Platform | archivedAt exists; add archive action in UI + per-team archive browser. |

## P2 — Collaboration & intake breadth

| Feature | Linear area | Notes |
|---|---|---|
| **Customer requests** | Intake | Request entity linked to issues/projects with customer name/tier/revenue; rollups per customer; intake from email address. |
| **Asks / request forms** | Intake | Public request form per team feeding triage (self-host analog of Slack Asks). |
| **Inline document comments** | Plan | Comment threads anchored to document ranges. |
| **Text-to-issue from documents** | Plan | Select text in a doc → create linked issue. |
| **Automated triage rules** | Intake | Rules engine: match on source/label/keywords → set team, assignee, priority, SLA. |
| **Slack-style integration** | Intake | Incoming webhook → issue creation; outgoing webhook payloads formatted for Slack/Teams (we already POST JSON). |
| **CSV/Jira/Linear import & export** | Platform | Importers into teams (CSV first), plus data export endpoints. |
| **Per-user notification preferences** | Monitor | Choose which events notify; email digests (needs SMTP config). |
| **Estimate scales & velocity** | Build | Configurable estimate scales (exponential/linear/t-shirt); velocity chart in insights and per-cycle burnup. |

## P3 — Platform & scale

| Feature | Linear area | Notes |
|---|---|---|
| **Public API tokens + REST/GraphQL** | Platform | Personal access tokens over the existing REST surface; GraphQL layer if demand. |
| **Custom dashboards** | Monitor | Composable insight tiles (our chart components are already modular). |
| **Pulse (activity digest)** | Monitor | Cross-workspace feed of project updates and status changes; optional AI summaries. |
| **AI features (agents, triage intelligence, Pulse summaries)** | Build/Intake | Linear's 2025-26 direction: assignable agents, suggested assignees/labels, duplicate AI. Self-host analog: bring-your-own-key LLM integration. |
| **Diffs (code review)** | Diffs | Linear now ships code review for human+agent PRs. Large scope; likely out of clone territory — revisit. |
| **Mobile apps / PWA** | Mobile | Ship a PWA manifest + responsive layout pass first; native apps out of scope. |
| **Azure Blob storage adapter** | Platform | Implement `BlobStore` against Azure Blob; config-select like `STORAGE`. |
| **SSO (Entra ID) & SCIM** | Platform | Auth boundary is pluggable; add OIDC login alongside passwords. |
| **Audit log** | Platform | Admin-visible activity log (we already record issue activities; extend to admin events). |

## Non-goals (for now)

Salesforce/Intercom/Zendesk/Gong connectors, Fivetran/Airbyte exports, native
iOS/Android, and Linear's hosted-agent marketplace — these hang off ecosystems
a self-hosted clone doesn't sit in. Revisit if the deployment story changes.
