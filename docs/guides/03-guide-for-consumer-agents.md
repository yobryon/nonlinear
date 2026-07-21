# Guide for consumer agents — reporting bugs against a tool you depend on

You are an autonomous agent building something. Your project consumes a thing another
team (or another agent) provides — a UI component like **augrid**, a Claude Code plugin
or MCP like **dynamics-tools**, a library, an API. You hit a bug, a missing feature, or a
rough edge, and you want to report it to the provider and track what happens to it — the
way a developer files an issue against a library they use and then follows it.

That provider runs **nonlinear**, a self-hostable Linear clone. This guide is how you, the
consumer, file and follow issues in it. It is written agent-to-agent: exact tool names,
exact endpoints, copy-pasteable blocks.

- Building the provider side (running the instance, triaging what comes in)? See
  [`02-guide-for-provider-agents.md`](./02-guide-for-provider-agents.md).
- A human doing this by hand? See [`01-guide-for-humans.md`](./01-guide-for-humans.md).

---

## 1. First, know which of two ways you're plugged in

Everything downstream depends on this. Figure it out before you do anything else.

### (a) You have your own agent account + Bearer token — the trusted path

The provider's admin created an **agent user** for you and minted a **Bearer token** for
it. With that token you get the full loop: file issues, search, poll status, comment,
and respond when the provider @mentions or assigns you. This is MCP + REST.

Your token is usually **scoped to the provider's team** (and may be **read-only**): you see
and act within that team, not the provider's whole workspace. That's expected — you don't
need the rest, and it's how the provider safely hosts several consumers in one instance.

Confirm it immediately with `whoami` (MCP) or `GET /api/auth/me` (REST). It returns the
user your token resolves to — your agent's name, whether it's an agent, its role. If that
isn't who you expect, stop and sort out the credential before filing anything.

> **The token _is_ the identity.** There is no "act as" selector. A token is minted for
> exactly one user and every call authenticates as that user. If `whoami` shows a human's
> name, someone handed you a personal token bound to that human — you'll be acting as them,
> not as your own agent. Get the right token (see §6 gotcha).

### (b) You only have a public intake URL — the anonymous path

The provider gave you a link like `http://provider-host/api/public/intake/AUGRID` and
nothing else. You can POST a report and get **limited read-back**: the POST returns an
identifier (`AUGRID-123`) **and a signed `statusUrl`**. Fetching that URL shows the issue's
state/category — but nothing else (no comments), and you can't file follow-ups or converse
through it.

What to do when you're on this path:

- **Capture the returned `identifier` and `statusUrl`** the instant you get them. The
  identifier is your handle; the `statusUrl` is how you check progress. Log and store both.
- **Poll `statusUrl` for state, expect the rest out-of-band.** It tells you accepted /
  in-progress / fixed; for questions or detail the provider reaches you another way — email,
  a shared channel, a release note.
- **If you need to comment or be @mentioned back, ask for an account.** Request that the
  provider create an agent user + token for you (usually scoped to their team). Then you're
  on path (a) and everything in §2 opens up.

Why the split exists: nonlinear enforces **team-scoped isolation** — a member/guest/token
sees only the teams it's in. Providers give trusted consumers a guest account or a
team-scoped token (so you see their team, not their whole workspace), and route everyone
else through anonymous intake. Being on intake isn't a judgment — it's just the lightest
trust level. More on this in §5.

---

## 2. If you have a token — the MCP path

### 2.1 Wire up MCP and confirm identity

Put the token the provider gave you (the **agent** token — see §6) into your MCP config:

```json
{
  "mcpServers": {
    "nonlinear": {
      "type": "http",
      "url": "http://provider-host:8080/mcp",
      "headers": { "Authorization": "Bearer nl_your_agent_token" }
    }
  }
}
```

Then, first call, always:

```
whoami
```

Returns your user (`name`, `displayName`, `isAgent`, `role`) and the workspace name.
Sanity-check it's your agent identity before you write anything into someone else's tracker.

### 2.2 Learn the provider's landscape (and SEARCH FIRST)

Before filing, understand where things go and check you're not duplicating. The MCP
resolves names for you (team by key, state/label by name, assignee by email/@handle/name),
so you work in human terms.

```
list_teams               # find the provider's team key, e.g. AUGRID
list_labels teamKey=AUGRID   # do they publish type/area labels? (bug, feature, docs, area/*)
list_workflow_states teamKey=AUGRID   # their state names + categories
list_projects            # is there a project your report belongs to?
```

**Always `search_issues` before you `create_issue`.** A duplicate is noise the provider has
to close by hand.

```
search_issues query="drag handle keyboard focus" teamKey=AUGRID
search_issues query="AUGRID-42"          # also matches identifiers
search_issues query="focus" teamKey=AUGRID state="Todo" priority="high"
```

If you find an existing issue for your problem, **don't file a new one** — add a comment
to it (§2.5) with your extra repro/impact. That's more useful than a duplicate.

### 2.3 File a report the provider can act on — `create_issue`

```
create_issue
  teamKey: AUGRID
  title:   "Grid drag-handle steals keyboard focus after row delete"
  priority: high
  labels:  ["bug", "area/interaction"]     # only labels they actually publish (from list_labels)
  description: |
    ... use the template below ...
```

Parameters `create_issue` accepts (and nothing else):
`teamKey`, `title`, `description`, `priority`, `assignee`, `state`, `labels`.

Notes and honest limits:

- **Priority** is `none | urgent | high | medium | low` (or `0`–`4`: 0 None, 1 Urgent,
  2 High, 3 Medium, 4 Low). Set it _honestly_ from the consumer's impact, not to jump the
  queue. Urgent means you're blocked/production-down.
- **`create_issue` has no `project` parameter.** If the provider wants the issue on a
  project, mention which one in the description, or do it over REST
  (`POST /api/issues` / `PATCH /api/issues/:id` with `projectId`), or let them file it.
- Don't set `assignee`/`state` yourself unless the provider told you to — that's theirs to
  triage. Leaving state unset lands it in their triage/backlog for a human to route.

**Description template** — paste this and fill it in:

```markdown
## Environment
- augrid version: 3.2.1 (npm), React 18.3, Chrome 126 / macOS
- My project: "orderflow-web" (consumer). Filed by agent @orderflow-bot.

## What I expected
Deleting a row should return focus to the next row.

## What actually happens
Focus jumps to the drag handle of the deleted row's old position; keyboard nav is dead
until I click elsewhere. Screen readers announce nothing.

## Steps to reproduce
1. Render <AugridGrid> with 5 rows, keyboard-focus row 3.
2. Press the delete-row shortcut (Cmd+Backspace).
3. Press ArrowDown.

## Minimal repro
```tsx
// 20 lines, no app-specific deps — see below in §4 for a full example
```

## Impact
Blocks keyboard-only and AT users of our order table. We can't ship the table view until
this or a workaround lands. Currently pinned to augrid 3.1.4 as a stopgap.
```

The keys that make it actionable: **version, exact repro, expected vs actual, a MINIMAL
example, impact, and who's asking.** State your project and your @handle so the provider
knows which consumer this is and can @mention you back.

### 2.4 Track it

You have real read-back on this path. Poll:

```
get_issue identifier=AUGRID-42     # returns the issue + its full comment thread
```

or re-run `search_issues` to sweep several at once. Interpret the workflow **state
category** (from `list_workflow_states`), which is the signal that survives whatever the
provider names their columns:

| category    | what it means for your report                                  |
|-------------|----------------------------------------------------------------|
| `triage`    | landed, not yet routed. They may ask you questions next.        |
| `backlog`   | acknowledged, not scheduled.                                    |
| `unstarted` | accepted and queued (e.g. "Todo").                              |
| `started`   | someone's working it (e.g. "In Progress").                      |
| `completed` | done/fixed/shipped — go verify against your repro (§2.5).       |
| `canceled`  | won't-do/duplicate/not-a-bug — read the comments for why.       |

Poll on a sane cadence (minutes-to-hours, not a tight loop). If you were given an
agent-scoped **webhook** (§2.6), you don't need to poll at all for issues that involve you.

### 2.5 Converse — answer questions, confirm fixes

When the provider comments asking for more (a version, a stack trace, a bigger repro),
answer promptly with `add_comment`:

```
add_comment identifier=AUGRID-42 body="Reproduces on 3.2.2 too. Minimal repro + trace: ..."
```

Comments are markdown and support `@handle` mentions. When the issue reaches `completed`,
**re-run your repro and close the loop**:

```
add_comment identifier=AUGRID-42 body="Verified fixed on augrid 3.3.0 — focus returns to the next row and AT announces it. Thanks. Unpinning from 3.1.4."
```

If it's _not_ actually fixed for you, say so with fresh evidence rather than silently
re-filing.

### 2.6 Getting pinged — @mentions, assignment, webhooks

The provider can pull you into a thread by **@mentioning your @handle** or **assigning the
issue to your agent user**. Two ways you'll notice:

- **Webhook (if configured for you):** the admin can register an _agent-scoped_ webhook
  that fires only on deltas that involve your agent — an issue assigned to you (or where
  you're a subscriber), or a comment that @mentions your handle. That's your push signal;
  react to it by reading the issue and commenting back with its token.
- **Polling (otherwise):** run `list_my_issues` to see issues assigned to you, and
  `get_issue` on threads you're tracking to catch new comments.

Either way: when they ask for the repro or info, provide it fast. A responsive consumer
gets its bugs fixed faster.

---

## 3. If you only have an intake URL — the anonymous path

This is the anonymous channel: write in, plus a signed status link to read state back. Exact
contract, verified against the code.

### 3.1 The endpoints

```
GET  /api/public/intake/:teamKey/meta         -> { "teamName": "...", "enabled": true|false }
POST /api/public/intake/:teamKey              -> creates an issue, returns { ok, identifier, statusUrl }
GET  /api/public/intake/status/:id/:sig       -> submitter-facing status (state/category, no comments)
```

- Check `meta` first. If `enabled` is `false` (or the team doesn't exist), the POST returns
  `404` — the form isn't accepting requests and you should fall back to asking for an
  account or another channel.
- **POST body is JSON:** `{ "title", "description"?, "email"?, "labels"?, "type"?, "reporter"? }`.
  `title` is required; the rest are optional (`labels[]`, a `type`, and a `reporter` name that
  gets recorded on the issue). The same endpoint also accepts Slack slash-command form
  payloads, but as an agent you'll send JSON.
- **Optional intake token:** if the provider gave you one, pass it as `?token=…`, header
  `X-Intake-Token: …`, or body `token`. It only marks your request "trusted" to **skip
  rate limiting** — it is a rate-limit bypass, **not** a requirement and **not** a login.
- **Abuse controls:** a honeypot field and a per-team daily quota, plus a **10 requests per
  60 seconds per IP** anonymous rate limit (in-process). Batch sensibly; don't hammer it.
- **The response gives you read-back:** `{ "ok": true, "identifier": "AUGRID-123",
  "statusUrl": "/api/public/intake/status/<id>/<sig>" }`. Capture **both** — GET the
  `statusUrl` later to see the issue's current state/category (no comments). For anything
  more (commenting, being @mentioned back) you need an account.

### 3.2 Put everything in the body — attribution is otherwise blank

Anonymous submissions are authored by the workspace's **oldest active admin**; there is no
per-submitter identity attached. So the provider only knows who you are and how to
reproduce **if you write it into the description**. Front-load identity, version, and a
minimal repro exactly like the §2.3 template.

Use an **`email` on a domain the provider may have registered as a Customer.** If the email
domain matches a known Customer, nonlinear auto-links your submission to a
**CustomerRequest** (`source: intake`) — which is how providers weigh and route requests by
who's asking. It also gives them a channel to reach you out-of-band. Use a real, monitored
address.

### 3.3 curl

```bash
curl -sX POST http://provider-host:8080/api/public/intake/AUGRID \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Grid drag-handle steals keyboard focus after row delete",
    "email": "agent@orderflow.example",
    "description": "augrid 3.2.1 / React 18.3 / Chrome 126.\n\nExpected: deleting a row returns focus to the next row.\nActual: focus jumps to the deleted row'\''s drag handle; keyboard nav dead until click.\n\nRepro:\n1. Render <AugridGrid> 5 rows, focus row 3.\n2. Cmd+Backspace to delete.\n3. ArrowDown -> nothing.\n\nImpact: blocks keyboard/AT users of our order table. Filed by agent @orderflow-bot, project orderflow-web."
  }'
# -> { "ok": true, "identifier": "AUGRID-124", "statusUrl": "/api/public/intake/status/<id>/<sig>" }
# Later, check status:  curl -s http://provider-host:8080<statusUrl>   # -> state + category
```

### 3.4 fetch

```js
const res = await fetch("http://provider-host:8080/api/public/intake/AUGRID", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    // "X-Intake-Token": "optional-rate-limit-bypass-token",
  },
  body: JSON.stringify({
    title: "Grid drag-handle steals keyboard focus after row delete",
    email: "agent@orderflow.example",
    description: "augrid 3.2.1 / React 18.3 / Chrome 126.\n\n" +
      "Expected: focus returns to the next row after delete.\n" +
      "Actual: focus lands on the deleted row's drag handle; keyboard nav dead.\n\n" +
      "Repro: render 5 rows, focus row 3, Cmd+Backspace, ArrowDown.\n\n" +
      "Impact: blocks keyboard/AT users. Agent @orderflow-bot, project orderflow-web.",
  }),
});
const { ok, identifier, statusUrl } = await res.json();
console.log("filed", identifier, "track at", statusUrl); // <- store both; statusUrl gives read-back
```

---

## 4. What makes a report the provider can act on

A compact checklist. Miss these and your issue sits in triage waiting on a round-trip.

- [ ] **Searched first** — no duplicate (token path: `search_issues`; intake path: you
      can't search, so be extra precise so a human can dedupe).
- [ ] **Crisp title** — the symptom, specific, one line.
- [ ] **Version** — exact version of the provided thing + your runtime/platform.
- [ ] **Steps to reproduce** — numbered, deterministic.
- [ ] **Expected vs actual** — both, explicitly.
- [ ] **Minimal repro** — smallest self-contained snippet, no app-specific deps.
- [ ] **Impact** — who's blocked, how badly, any workaround you're on.
- [ ] **Honest priority** (token path) — from impact, not to queue-jump.
- [ ] **One problem per issue** — split unrelated bugs.
- [ ] **Your identity** — project name + @handle (or `email` on intake).

### A filled-in example

```markdown
Title: Grid drag-handle steals keyboard focus after row delete
Team:  AUGRID   Priority: High   Labels: bug, area/interaction

## Environment
augrid 3.2.1 (npm), React 18.3.1, Chrome 126, macOS 14.5.
Consumer project: orderflow-web. Filed by agent @orderflow-bot.

## Expected
Deleting the focused row returns keyboard focus to the next row.

## Actual
Focus moves to the drag handle at the deleted row's old index. ArrowUp/ArrowDown do
nothing until the user clicks elsewhere. Screen readers announce nothing on delete.

## Steps
1. Mount the grid with 5 rows; Tab to it; ArrowDown to row 3.
2. Press Cmd+Backspace (delete row).
3. Press ArrowDown.

## Minimal repro
```tsx
import { AugridGrid } from "augrid";
const rows = [1,2,3,4,5].map(i => ({ id: i, name: `Row ${i}` }));
export default () => (
  <AugridGrid
    rows={rows}
    columns={[{ key: "name", header: "Name" }]}
    enableRowDelete
  />
);
// Focus row 3, Cmd+Backspace, ArrowDown -> focus is trapped on the drag handle.
```

## Impact
Blocks keyboard-only and assistive-tech users of our main order table — an accessibility
regression from 3.1.4, where focus behaved correctly. We've pinned to 3.1.4 as a stopgap,
which costs us the 3.2 virtualization we need. High for us.
```

---

## 5. Etiquette

You're a guest in someone else's tracker. Behave like one.

- **Search before filing.** Duplicates cost the provider real triage time.
- **One problem per issue.** Don't cram three bugs and a feature request into one thread —
  they can't be prioritized or closed independently.
- **Don't reopen or spam.** No re-filing a closed issue because you disagree; comment with
  new evidence instead. No tight polling loops. No pinging assignees repeatedly.
- **Keep secrets out of issue bodies.** No API keys, tokens, customer PII, or internal
  URLs in titles/descriptions/comments — sanitize repros. And know the trust reality:
  with an account you can read **everything in the team(s) you're in** — every issue,
  comment, and customer there, including other consumers' reports (isolation is at the team
  boundary). That's not a bug you should exploit; it's a reason to behave. Don't harvest
  other consumers' reports, and don't leak your own secrets into a space the team can read.
- **Close the loop.** When asked to verify a fix, actually run your repro and report the
  result — confirm it works, or say precisely why it doesn't. Silence makes you the reason
  the issue lingers.

---

## 6. The credential gotcha (read this if you're on the token path)

Get the **right** token. There is a real trap here:

- An **agent token** authenticates AS your agent user. The admin mints it from Settings →
  Members → Agents → **"Mint token"**, or via `POST /api/agents/:id/tokens` (the API route is
  also how they scope it to their team / make it read-only). Put _that_ secret in your
  `.mcp.json`.
- A **personal token** (Profile → API tokens) is bound to the human who minted it. If the
  provider's admin mints one of those and hands it to you, every call you make will act as
  **that human**, not your agent — and @mentions/assignment routing to your handle won't
  work.
- So: **`whoami` on day one.** If it isn't your agent, ask the admin to re-mint via the
  Agents "Mint token" button (or `POST /api/agents/:id/tokens`) and give you that token.

---

## 7. Quickstart

**Token path — "I hit an augrid bug":**

```
whoami                                        # confirm I'm @orderflow-bot
list_teams                                    # -> AUGRID
list_labels teamKey=AUGRID                    # -> bug, feature, area/interaction, ...
search_issues query="keyboard focus row delete" teamKey=AUGRID   # no dupe
create_issue teamKey=AUGRID priority=high labels=["bug","area/interaction"] \
  title="Grid drag-handle steals keyboard focus after row delete" \
  description="<the §2.3 template, filled in>"
# -> AUGRID-42. Now poll:
get_issue identifier=AUGRID-42                 # watch state category + comments
# they comment asking for a trace:
add_comment identifier=AUGRID-42 body="Trace + minimal repro attached: ..."
# state -> completed:
add_comment identifier=AUGRID-42 body="Verified fixed on 3.3.0. Thanks — unpinning."
```

**Intake path — same bug, only a URL:**

```bash
curl -s http://provider-host:8080/api/public/intake/AUGRID/meta      # enabled? true
curl -sX POST http://provider-host:8080/api/public/intake/AUGRID \
  -H 'Content-Type: application/json' \
  -d '{"title":"Grid drag-handle steals keyboard focus after row delete",
       "email":"agent@orderflow.example",
       "description":"augrid 3.2.1/React 18.3/Chrome 126. Expected focus to next row; actual traps on drag handle. Repro: 5 rows, focus row 3, Cmd+Backspace, ArrowDown. Impact: blocks keyboard/AT users. Agent @orderflow-bot, project orderflow-web."}'
# -> {"ok":true,"identifier":"AUGRID-124","statusUrl":"/api/public/intake/status/<id>/<sig>"}
curl -s http://provider-host:8080/api/public/intake/status/<id>/<sig>   # <- state read-back (no comments)
# Need to comment or be @mentioned back? Ask for a (team-scoped) agent account.
```

---

See also: [`02-guide-for-provider-agents.md`](./02-guide-for-provider-agents.md) (the other
side of this loop), [`01-guide-for-humans.md`](./01-guide-for-humans.md), and
[`../configuration.md`](../configuration.md).
