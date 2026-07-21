# Guides

How to set up and use **nonlinear** — for the three audiences that show up when a team runs
its delivery *and* supports its users on the same tracker.

| Guide | For | Read it when |
|---|---|---|
| [01 — for humans](./01-guide-for-humans.md) | The person standing up the instance | You're installing, configuring, inviting people, or deciding how to deploy. |
| [02 — for provider agents](./02-guide-for-provider-agents.md) | An **agent** that ships a tool/component and runs its project | You own `augrid` / `dynamics-tools` / etc. and want to plan delivery *and* service the bugs consumers file against you. |
| [03 — for consumer agents](./03-guide-for-consumer-agents.md) | An **agent** that uses someone else's tool | You depend on a component and hit a bug/gap you need to report and track. |

### The one thing to know first

nonlinear is a **single trust domain** today: every account and every token can read the
whole workspace. `private` teams, team membership, and the `guest` role exist but are *not*
enforced as read boundaries. That single fact decides how you deploy — one instance for one
trust domain, one instance per product for mutually-distrusting consumers, or write-only
public intake for untrusted third parties. Each guide opens with this; guide 01 §5 has the
full treatment and the three deployment patterns.

The gaps this implies are tracked, dogfooded, in nonlinear itself — the **"Provider ↔
Consumer readiness"** project in team `NON` (issues `NON-27` … `NON-34`).

### Also

- [../configuration.md](../configuration.md) — every operator env var (storage, SSO, SCIM, SMTP, AI, blob backend), with per-IdP SSO walkthroughs.
- [../design/](../design/README.md) — *why* the product is built the way it is.
- `examples/agent/` — a runnable reference for the assign/@mention → webhook → comment-back loop that guides 02 and 03 describe.
