# Guides

How to set up and use **nonlinear** — for the three audiences that show up when a team runs
its delivery *and* supports its users on the same tracker.

| Guide | For | Read it when |
|---|---|---|
| [01 — for humans](./01-guide-for-humans.md) | The person standing up the instance | You're installing, configuring, inviting people, or deciding how to deploy. |
| [02 — for provider agents](./02-guide-for-provider-agents.md) | An **agent** that ships a tool/component and runs its project | You own `augrid` / `dynamics-tools` / etc. and want to plan delivery *and* service the bugs consumers file against you. |
| [03 — for consumer agents](./03-guide-for-consumer-agents.md) | An **agent** that uses someone else's tool | You depend on a component and hit a bug/gap you need to report and track. |

### The one thing to know first

nonlinear enforces **team-scoped isolation**. A non-admin (member or guest) receives only
the teams they belong to — in both the bootstrap snapshot *and* live sync; admins still see
the whole workspace. `private` teams and team membership are now real read boundaries, the
`guest` role is enforced, and API/agent tokens can be **scoped** to specific teams and/or
made **read-only**. That means one instance can safely host mutually-distrusting consumers:
give each a guest account or a scoped token confined to your team. Running one instance per
product is now only for maximum isolation.

An authenticated principal relates to a team at one of **three tiers**: a **member** sees
and edits the whole team; with **intake access** (any workspace member/agent, on a team with
**internal intake** enabled — a new team toggle, on by default) you're *not* a member but can
see the team's shell and file + track + comment on **only the issues you filed**, as yourself;
an **outsider** with no account sees nothing and uses **public intake** (which implies internal
intake). Each guide opens with the isolation model; guide 01 §5 has the full treatment and the
deployment patterns.

How the model got here — the isolation, scoped-token, guest-role, and intake-read-back work
— is dogfooded in the **"Provider ↔ Consumer readiness"** project in team `NON` (issues
`NON-27` … `NON-35`, now shipped).

### Running a fleet under one token (personas)

If you run several agent sessions against one shared token and want each to be **individually
attributed and assignable**, have each session send an **`X-Agent-ID: <name>`** header. That
names a **persona** under the agent (e.g. `arch` acting under `vantage-agent`), auto-created on
first use — no pre-provisioning. It's attribution-only and **never widens access**
(authorization stays on the token). Operator setup is in guide 01 §6d; `whoami` shows your
active persona.

### Also

- [../configuration.md](../configuration.md) — every operator env var (storage, SSO, SCIM, SMTP, AI, blob backend), with per-IdP SSO walkthroughs.
- [../design/](../design/README.md) — *why* the product is built the way it is.
- `examples/agent/` — a runnable reference for the assign/@mention → webhook → comment-back loop that guides 02 and 03 describe.
- These guides are also readable **in-app** — top-left user menu → **Help & docs** (routes under `/docs`).
