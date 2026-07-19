# Users, preferences & settings IA

This document explains how nonlinear models people and the knobs they can turn:
personal preferences, workspace administration, and per-team configuration. The
central design claim is that these are **three different scopes with three
different owners and lifetimes**, and that treating them as one bucket of
"settings" — which is the easy first instinct — produces a confusing product and
a leaky data model. We keep them separate on purpose, and the separation shows up
in the information architecture (`apps/web/src/pages/Settings.tsx`), in where the
data lives (`packages/shared/src/entities.ts`), and in who is allowed to change
what (`packages/core/src/services/extras.ts`, `auth.ts`).

If you are new here, read this alongside the auth/sync notes in `CLAUDE.md`; this
document is the "why," not an endpoint reference.

## The three scopes, and why conflating them is wrong

Linear — and nonlinear after it — has three distinct kinds of configuration, and
they differ along every axis that matters:

- **Personal** — things that belong to _you_ and follow you everywhere: theme,
  font size, which screen the app opens to, whether you want the daily email
  digest. They are yours alone; no teammate sees or is affected by them. They
  should sync to every device you log in from.
- **Workspace** — things that describe the whole organization: its name, who its
  members are, what roles they hold, which teams exist, the shared label
  vocabulary. Changing these affects everyone, so they are admin-gated.
- **Team** — things that describe how _one_ team works: its workflow states, its
  estimate scale, whether it runs cycles, its SLA thresholds, its triage rules
  and intake settings. They affect that team's members but no one else.

The tempting shortcut is to flatten all of this into a single "settings" screen
and a single permission ("can the user edit settings?"). That is wrong for two
independent reasons.

First, **ownership and blast radius differ**. Your theme is a private cosmetic
choice; renaming the workspace is an organization-wide act; changing a team's
workflow states rewires how that team's board is grouped. A single permission
gate would either lock you out of your own theme (too strict) or let any member
rename the company and delete another team's states (too loose). By separating
the scopes we can apply exactly the right rule to each: personal settings need no
authorization beyond "you are you" (`updateProfile` acts on `req.user.id`,
`server.ts:520`), workspace settings require `admin` (`requireAdmin`,
`server.ts:338`), and team settings are edited by anyone but naturally bounded to
one team.

Second, **the correct home for the data differs**. Personal preferences must
travel with the user, so they live _on_ the `User` entity and sync like any other
entity (see below). Team configuration lives on the `Team` entity. Workspace
identity lives on the `Workspace` entity. Flattening them into one "settings blob"
would have forced an awkward choice about which entity owns it and would have
broken the clean per-scope sync story. Keeping them on the entity that owns them
is what lets each one sync, cache, and authorize independently.

The navigation in `Settings.tsx` makes the split legible to the user: the left
rail has a **Personal** section header (Preferences, Profile, Notifications, API
tokens) and a **Workspace** section header (General, Members, Teams, Labels), and
a team's own settings live at their own route (`/settings/team/:teamKey`), reached
from the team in the sidebar. The headers are not decoration — they are the mental
model we want the user to hold.

## Personal preferences: on the user, synced, applied client-side

`UserPreferences` (`packages/shared/src/entities.ts:25`) is deliberately small:

```ts
interface UserPreferences {
  theme: ThemePreference; // 'system' | 'dark' | 'light'
  fontSize: FontSize; // 'small' | 'default' | 'large'
  home: HomeView; // 'inbox' | 'my-issues' | 'active-team'
  displayNames: DisplayNameFormat; // 'full' | 'display'
  firstDayOfWeek: FirstDayOfWeek; // 'sunday' | 'monday'
}
```

`DEFAULT_PREFERENCES` (`entities.ts:35`) is the seed every new user gets
(`auth.ts:75`), and it also acts as the fallback when the store has no user yet
(`preferences.ts:15`). The enums are closed string unions defined in
`packages/shared/src/enums.ts` so the compiler enforces valid values end to end.

### Why preferences live on the User and sync

We embed `preferences` as a field on the `User` entity rather than storing it in
`localStorage`, or in a separate per-device settings table. Two decisions drove
this:

- **Sync across devices.** The `User` is already a synced model. By putting
  preferences on it, they ride the existing delta-sync pipeline for free: when you
  change your theme on your laptop, `updateProfile` publishes an `updated('user')`
  delta (`extras.ts:185`) and your phone's open tab receives it. If preferences
  lived only in `localStorage` they would be stranded per-browser — exactly the
  frustration Linear avoids and we wanted to match.
- **One write path.** `updateProfile` in `UserService` (`extras.ts:158`) does a
  shallow merge — `user.preferences = { ...user.preferences, ...input.preferences }`
  (`extras.ts:181`) — so a client can `PATCH /api/profile` with just
  `{ preferences: { theme } }` and leave the rest untouched. The web client does
  exactly this (`theme.ts:22`, `Settings.tsx:106`). This is why the toggle in the
  profile menu can send `{ theme }` alone rather than the whole object.

The honest trade-off: preferences are on the same entity as things like `role`
and `email`, so a `User` delta carries cosmetic churn. In practice user updates
are rare and the entity is small, so we accepted the simplicity of one entity
over a second synced model.

### The flash-of-wrong-theme problem, and the localStorage mirror

Preferences sync, but sync happens _after_ bootstrap, and bootstrap happens after
the first paint. If theme lived only on the synced user, every page load would
flash the default theme for a beat before the real one arrived — the classic
"flash of unstyled/wrong theme." So `preferences.ts` keeps a **write-through
mirror** in `localStorage`: `applyPreferences` writes `nl-theme-pref` and
`nl-font-size` alongside applying them (`preferences.ts:30`), and
`applyStoredPreferences` (`preferences.ts:48`) reads them back to paint the last
known theme _before_ bootstrap completes. The synced `User` remains the source of
truth; `localStorage` is only a first-paint cache. This is the one place we
deliberately duplicate preference state, and the comment at the top of the file
says why.

### Theme, including "system", applied to `<html>`

Themes are applied by stamping `data-theme` (and `data-fontSize`) on
`document.documentElement` (`preferences.ts:26`); the entire visual system is CSS
variables keyed off `[data-theme]` in `styles.css`, so flipping the attribute
re-themes the whole app with no React re-render. `getTheme` (`theme.ts:9`) reads
the painted attribute.

The interesting case is `'system'`. We store the _preference_ ("system"), not the
resolved value, and resolve it at apply time via `matchMedia('(prefers-color-scheme:
light)')` (`resolveTheme`, `preferences.ts:18`). Crucially, we also register a
`matchMedia` change listener (`preferences.ts:37`) so that if the OS flips from
light to dark while you are sitting in the app, and you are in system mode, the
app follows live. Storing the resolved value instead would have frozen you to
whatever the OS was at the moment you picked "system" — defeating the point. The
listener is bound once (`mediaListenerBound` guard) and re-checks the _current_
preference each time it fires, so it correctly does nothing if you have since
switched to an explicit theme.

`toggleTheme` (`theme.ts:27`) — wired to the profile-menu light/dark toggle
(`Sidebar.tsx:471`) — flips between the two concrete themes based on what is
_painted now_, which means toggling out of "system" lands you on the opposite of
whatever your OS currently shows. That is the intuitive behavior; the alternative
(toggle does nothing meaningful while in system mode) would feel broken.

### The other preferences and where they bite

- **`home`** decides the landing route. `DefaultRedirect` (`App.tsx:85`) reads
  `preferences.home` and navigates to `/inbox`, `/my-issues`, or the first team's
  issues accordingly. This is a pure client concern; the server never needs to
  know.
- **`displayNames`** switches every rendered person-name between full name and
  `@handle`. Rather than scatter this conditional across the UI, we route
  person-name rendering through one helper — `personName(user)`
  (`preferences.ts:61`) — used by pickers and lists (`pickers.tsx:108`). One
  preference, one function, consistent everywhere.
- **`firstDayOfWeek`** feeds week-bucketing in insights and date pickers via the
  `firstDayOfWeek()` helper (`preferences.ts:66`, consumed in
  `Insights.tsx:22`). We store `'sunday' | 'monday'` and convert to the `0|1`
  JS day index at the edge, keeping the stored value human-readable.

## The settings IA in `Settings.tsx`

`SettingsPage` (`Settings.tsx:39`) is a single route subtree with a left nav and a
`<Routes>` switch. The Personal group routes to `PreferencesSettings`,
`ProfileSettings`, `NotificationsSettings`, and `TokensSettings`; the Workspace
group routes to `WorkspaceSettings`, `MembersSettings`, `TeamsSettings`, and
`LabelsSettings`; and `team/:teamKey` renders `TeamSettings`. The default
(`Settings.tsx:90`) redirects to Preferences.

A few deliberate choices:

- **Preferences vs. Profile are split.** Preferences is _how the app behaves for
  you_ (theme, home, names). Profile is _who you are to others_ (full name,
  `@handle`, avatar color — `ProfileSettings`, `Settings.tsx:1129`). They are both
  "personal," but one is private taste and the other is your public identity in
  the workspace, so they get separate pages. The `@handle` even has a uniqueness
  check on save (`extras.ts:168`) because other people mention you by it.
- **Team settings are reached from the team, not from a flat list.** A team's
  configuration is dense — General, Estimates, Cycles, Triage, SLAs, Workflow
  states, Members, Templates, Triage rules, Intake, Import/export, and a Danger
  zone (`TeamSettingsInner`, `Settings.tsx:608`). Putting all of that behind
  `/settings/team/:teamKey`, keyed by the team you selected, keeps each team's
  knobs scoped to that team and avoids a monster global settings page. The
  `Teams` workspace page (`Settings.tsx:499`) is just the index that lists teams
  and creates new ones.
- **Labels are workspace-level with an optional team scope.** `LabelsSettings`
  (`Settings.tsx:1029`) lists all labels and lets you create one either as a
  Workspace label (`teamId: null`) or scoped to a team. This mirrors Linear's
  workspace/team label split and is why the label list shows "Workspace" or the
  team name per row (`Settings.tsx:1049`).

### The top-left profile / workspace menu

The always-available entry point is the workspace button at the top-left of the
sidebar (`Sidebar.tsx:188`), which opens a popover (`wsMenu`) showing the
workspace name plus your name and email (`Sidebar.tsx:437`). From there you get
**Settings** (with its `G S` shortcut hint), **Invite & manage members** (a
shortcut straight to `/settings/members`), a **light/dark theme toggle**, and
**Log out** (`Sidebar.tsx:443`–`482`). This is the same pattern Linear uses:
identity and the global actions hang off the workspace switcher, not off a
separate account icon. The theme toggle lives here (not buried in Preferences)
because it is the one setting people flip constantly.

## Roles: admin, member, guest

`UserRole` is `'admin' | 'member' | 'guest'` (`enums.ts:USER_ROLES`). Roles are a
workspace-scope concept and are edited only by admins.

- **Admin** can rename the workspace, manage members (change roles, deactivate),
  create teams and agents, and manage webhooks. Enforcement is server-side:
  `requireAdmin` guards webhook/agent routes (`server.ts:338`, `495`, `502`), and
  `UserService.adminUpdate` re-checks `actor.role === 'admin'` before changing
  another user's role or active flag (`extras.ts:197`). The UI mirrors this by
  only rendering the role picker and deactivate button when `me.role === 'admin'`
  (`Settings.tsx:416`), but the UI check is cosmetic — the server is the gate.
- **Member** is the default for everyone after the first user (`auth.ts:69`) and
  is the role agents get too.
- **Guest** exists in the model and is assignable through the role picker
  (`Settings.tsx:483`), but — being honest — nonlinear does **not yet** enforce a
  reduced guest capability set anywhere; a guest today behaves like a member. The
  role is carried so the data model matches Linear's and so future access-scoping
  (e.g. guests limited to specific teams) has a field to hang off. If you are
  looking for "what does guest actually restrict," the answer is "nothing yet" —
  see the access-control gap below.

There is one important safety invariant: `adminUpdate` refuses to remove or
deactivate the **last active admin** (`extras.ts:207`), so a workspace can never
lock itself out of administration. Deactivating a user also kills their sessions
immediately (`extras.ts:205`).

## Agents as member-role users

Rather than invent a separate "bot" entity, nonlinear models agents as ordinary
`User`s with `isAgent: true` (`entities.ts:64`). `AuthService.createAgent`
(`auth.ts:108`) mints one with `role: 'member'`, no password (inserted via
`storage.users.insert`, _not_ `insertWithPassword`, so login is impossible —
`auth.ts:137`), a synthetic non-login email in a reserved
`@agents.nonlinear.local` domain (`auth.ts:119`), and auto-membership in every
non-private team (`auth.ts:141`). Creation is admin-only (`server.ts:495`), and
agents authenticate with a bearer API token minted for them
(`POST /api/agents/:id/tokens`).

This "an agent is just a teammate" decision is what makes the whole agent story
cheap: because an agent is a real `User`, you can assign it issues, `@mention` it,
and see it in pickers with no special-casing. The UI surfaces its nature with an
"agent" chip and an "API-driven teammate" label instead of an email
(`Settings.tsx:402`, `413`), and the Members page has an **Agents** admin section
to create them (`Settings.tsx:442`). The alternative — a parallel `Agent` type —
would have forced every assignee/mention/notification path to handle two kinds of
actor. See `CLAUDE.md` and `examples/agent/` for the full assign → webhook →
comment-back loop.

## The invites model: "reaching the server is the invite"

nonlinear has **no invite tokens, no email invitations, no pending-member state**.
The model, stated plainly in the Workspace settings copy (`Settings.tsx:242`), is:
anyone who can reach the server can register from the login screen, and on
registering they join every non-private team automatically (`auth.ts:92`). The
very first registrant is special — they create the workspace, become its admin,
and get a default team with Linear's default workflow states (`auth.ts:44`, `82`).

This is a deliberate fit to the **self-hosted** deployment story. In a
self-hosted tool the network boundary _is_ the trust boundary: you put the app
behind your VPN, SSO proxy, or private network, and reachability equals
authorization. Building an email-invite flow would have meant wiring transactional
email, invite-token lifecycle, and expiry — real complexity — to re-implement a
boundary the deployment already provides. So "share the app URL" is the invite
(`Settings.tsx:245`).

The honest limitations: without SSO/SCIM configured there is still no
password-invite flow, and — as `CLAUDE.md` notes — no rate limiting on
registration, so open password exposure to the internet is unsafe. The intended
posture is "put HTTPS/SSO in front."

## SSO and SCIM: the enterprise identity path

For deployments with an identity provider, the "reaching the server is the
invite" model is replaced by two config-gated adapters (see decision log entry
14). **OIDC single sign-on** (`apps/api/src/sso.ts`) runs the authorization-code

- PKCE flow, verifies the ID token with `jose` (JWKS signature, issuer,
  audience, nonce), and resolves the identity in the domain
  (`AuthService.findOrProvisionSso`): match by the stable IdP subject, else link an
  existing account by email, else just-in-time provision a member if
  `OIDC_AUTO_PROVISION` allows it and the email domain is on the allow-list. The
  subject↔user link lives in the storage auth layer (`sso_identities`), never on
  the synced `User`, so the IdP identifier never crosses the sync boundary. The
  login page shows a "Continue with …" button when `GET /api/meta` reports SSO is
  configured. **SCIM 2.0** (`apps/api/src/scim.ts`, bearer-guarded by
  `SCIM_TOKEN`) lets the IdP create and deactivate accounts at `/scim/v2/Users`;
  Groups are deliberately out of scope because team membership here is a product
  concern, not IdP-driven. Deactivation — by SCIM or an admin — revokes sessions
  and is guarded so the last active admin can't be locked out
  (`UserService.setActive`).

Every security-relevant action (logins, provisioning, role/active changes,
token/agent/webhook/team events) is written to a workspace **audit log**
(`AuditService`, the non-synced `audit_log` table), surfaced admin-only under
Settings → Audit log and paged with a stable `(createdAt, id)` cursor. It is not
synced because it is admin-only and can grow without bound.

## Notification preferences: muting and the email digest

Notification settings are personal, and they live on the `User` too, as two
fields: `mutedNotificationTypes: NotificationType[]` and `emailDigest: boolean`
(`entities.ts:66`–`68`), plus a server-managed `digestLastSentAt`.

- **Muting is per-type, opt-out.** `NotificationPrefs` (`NotificationPrefs.tsx`)
  renders a switch per `NotificationType` (assigned, unassigned, status changes,
  comments, mentions, due-soon, reminders), where "on" means _not muted_. Toggling
  writes the full `mutedNotificationTypes` array through `updateProfile`. The mute
  is enforced at the source of the fan-out: `pushNotification` returns `null`
  early if the recipient has muted that type (`notify.ts:18`), so a muted type
  produces neither an in-app notification nor a digest entry. Muting at fan-out
  time — rather than filtering on read — means muted events are never persisted
  for you at all, which keeps the inbox and the digest consistent by construction.
- **The email digest is opt-in and server-gated.** `emailDigest` defaults to
  `false` (`auth.ts:73`). The hourly digest sender (`apps/api/src/digest.ts`)
  skips any user who is inactive or hasn't opted in (`digest.ts:43`), throttles by
  `digestLastSentAt` (`digest.ts:44`), and — importantly — the whole feature is a
  no-op unless the server has `SMTP_URL` configured (MailHog stands in for local
  dev). The Notifications page tells the user this dependency directly
  (`NotificationPrefs.tsx:51`). We chose opt-in because emailing people by default
  from a self-hosted box you may not have configured for mail is a bad surprise.

## API tokens: personal, but deliberately not synced

Personal API tokens (Profile → API tokens, `TokensSettings` → `ApiTokens`) are a
personal-scope feature but are handled unlike every other preference: they are
**not** part of the sync store. As the component comment says, tokens are bearer
secrets, so they are fetched directly over REST rather than living in the
normalized entity maps (`ApiTokens.tsx:9`). The secret is shown exactly once at
creation and never again (`ApiTokens.tsx:41`, `54`) — the server stores only a
hash, mirroring how sessions are handled. This is the right call: syncing a bearer
secret into every device's store and every delta log would be a needless exposure.
Tokens authenticate REST and the MCP server at `/mcp`; see the auth notes in
`CLAUDE.md`.

## What Linear's Preferences has that we don't — yet

Our `UserPreferences` is intentionally a small, high-value subset. Linear's
Preferences surface is larger, and a few gaps are worth naming honestly rather
than pretending parity:

- **Agent personalization.** Linear is investing in per-agent configuration
  (persona, default behaviors, suggested assignees/labels). We model agents as
  users but expose no agent-specific preference surface beyond name and token.
  This tracks the P3 "AI features / agents" line in `ROADMAP.md`.
- **Connected accounts.** Linear lets a user link GitHub/Google/etc. to their
  personal profile. nonlinear's integrations are workspace/team-level (the GitHub
  PR webhook is configured in Workspace settings, `Settings.tsx:250`; intake is
  per-team) — there is no per-user connected-accounts concept. SSO/OIDC (now
  shipped) links an identity for sign-in but not arbitrary per-user service
  accounts.
- **Finer interface controls.** Linear offers many more toggles (list density,
  which properties show, keyboard scheme, etc.). We ship the ones with the most
  leverage — theme, font size, home, display names, first day of week — and stop
  there rather than build a settings sprawl.

None of these are built; when you are asked to "extend preferences," start from
the P3 table in `ROADMAP.md` and add fields to `UserPreferences` in
`packages/shared` (they will sync automatically), a control row in
`PreferencesSettings`, and an application point in `preferences.ts`. Adding a
preference is a genuinely small change _because_ the scope separation and the
single write/apply path described here are already in place.
