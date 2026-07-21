# Interaction design: drag, keyboard, mobile

This document explains how nonlinear handles the three interaction surfaces that
make Linear _feel_ like Linear: direct manipulation (drag to reorder and
re-assign), keyboard-first navigation (a command palette plus single-key
shortcuts), and a responsive layout that survives on a phone. These are the
parts of the product where "clone Linear as closely as practical — data model,
workflows, and **UX feel** (speed, keyboard-first, real-time)" (CLAUDE.md, hard
constraint 1) stops being about data and starts being about milliseconds and
muscle memory.

The through-line for every decision here is a small set of values:

- **Speed over ceremony.** Common actions should take one gesture, not a dialog.
- **No modal-heavy flows.** Popovers and inline pickers, not full-screen forms.
  The only true modals are the command palette and the new-issue dialog.
- **Direct manipulation.** If you can see it, you should be able to drag it,
  and the drop target should be obvious _while_ you drag, not after.
- **Keyboard-first.** Everything reachable by mouse should be reachable without
  it, and the fast path should be a chord you can learn once.

Nothing here uses a drag-and-drop library, a keyboard-shortcut library, or a UI
framework beyond React + zustand. That is deliberate — the whole SPA is budgeted
at roughly 100 KB gzipped (CLAUDE.md, hard constraint 4), so each of these
subsystems is a few dozen lines of hand-rolled code rather than a dependency.

---

## 1. The drag engine

> **Update (decision log entry 18).** The sections below describe the _original_
> hand-rolled pointer-drag engine (`dragdrop.ts`). It has since been **replaced
> by SortableJS**, wrapped in `apps/web/src/sortable.tsx`, because the hand-rolled
> engine had no real touch story — on a phone a drag fought the page scroll, and
> long lists couldn't autoscroll while dragging. SortableJS brings both for free:
> touch long-press activation (a plain touch still scrolls; a short press starts a
> drag) and autoscroll near an edge. The React contract is "read the dropped
> neighbors, revert SortableJS's DOM change, let React re-render the authoritative
> order," and the caller still computes the fractional `keyBetween` from the
> neighbors' `sortOrder` — so the _ordering_ design below is unchanged; only the
> _gesture_ layer moved to a library. The HTML5-DnD debugging story is kept
> because it's still why we don't use native DnD.

### The debugging story (why not native HTML5 DnD)

The obvious way to build drag-and-drop on the web is the native HTML5
Drag-and-Drop API: set `draggable="true"`, listen for `dragstart` / `dragover` /
`drop`. We started there. It does not survive contact with this product, and the
reason is worth recording because it is non-obvious and cost real time.

The failure mode: **Chrome silently aborts a native drag when the DOM mutates
near `dragstart`.** Our list and board rows are React components whose selected/
dragging state changes the instant a drag begins — we add a `dragging` class,
we set `dragId` in state, which re-renders the row. Native DnD interprets the
element being re-created/moved underneath it as the drag source disappearing,
and it kills the gesture. You get a `dragstart` with no subsequent `dragover`,
or a drag that "sticks" and never fires `drop`. It is intermittent, because it
depends on whether React's commit lands inside the browser's drag-initiation
window. Intermittent DnD is the worst possible bug: it looks like it works in
the demo and fails for the user.

On top of that, native DnD had three secondary problems we would have had to
fight regardless:

- **The drag image is uncustomizable** in any way that looks good. `setDragImage`
  takes a snapshot of a DOM node; you cannot render a clean floating pill with
  your own styling and have it track the cursor smoothly across browsers.
- **Events are flaky across the board** — `dragleave` firing on child elements,
  `dragover` requiring `preventDefault` in exactly the right place to signal a
  valid drop target, `drop` coordinates that don't match `elementFromPoint`.
- **No touch story.** HTML5 DnD does not fire on touch at all without a polyfill.

The header comment in `apps/web/src/dragdrop.ts` records the verdict directly:

> HTML5 drag-and-drop proved unreliable (Chrome aborts native drags when the DOM
> changes near dragstart, ghosts are uncustomizable, events are flaky), so every
> drag surface uses this instead: plain pointer events, a threshold before the
> drag activates so clicks stay clicks, a floating ghost pill, hit-testing via
> elementFromPoint, and Escape to cancel.

### What we built instead

`beginPointerDrag()` in `apps/web/src/dragdrop.ts` is the entire engine — one
function, ~110 lines, no state outside the closure it creates. Every draggable
surface calls it from an `onPointerDown` handler and passes callbacks. Because
it is built on pointer events (not the DnD API), the browser has no opinion
about whether the DOM changed; React can re-render freely.

The design decisions inside it map one-to-one to the pain points above:

**A travel threshold so clicks stay clicks.** A `pointerdown` is not yet a drag.
The engine records the start point and does nothing until the pointer has moved
more than `threshold` pixels (default 5, `Math.hypot(e.clientX - startX, …)` in
`onMove`). Below the threshold, the eventual `pointerup` is an ordinary click and
navigates to the issue. This is why the same row can be both "click to open" and
"drag to move" without a mode switch — the gesture disambiguates itself by
distance. The `event.button !== 0` guard means right-click never starts a drag
(it opens the context menu instead).

**A floating ghost pill we own.** On activation the engine appends a
`div.drag-ghost` to `document.body` and moves it to `cursor + (12, 8)` on every
`pointermove` (`positionGhost`). It is our element, styled by `.drag-ghost` in
`styles.css` (a rounded overlay pill with the issue key and title), so it looks
identical in every browser and in both themes. `body.drag-active` flips the
cursor to `grabbing` globally and disables text selection for the duration.

**Hit-testing via `elementFromPoint`.** Rather than trusting drag events on
targets, the engine asks the document what is under the cursor
(`document.elementFromPoint(e.clientX, e.clientY)`) and hands that element to the
`onHover` / `onDrop` callbacks. The callers then walk up from that element to
find a drop zone using `data-*` attributes (see §2). This is robust precisely
because it doesn't depend on event bubbling through a re-rendering tree.

**Edge auto-scroll.** Long lists and wide boards need to scroll while you drag
toward their edge. `autoScroll` walks up from the hovered element to the nearest
scrollable ancestor and nudges `scrollTop`/`scrollLeft` when the cursor is within
48 px (`EDGE`) of an edge, at 14 px/frame (`SPEED`). It handles both axes, which
is what lets you drag a card down a tall column _and_ across to a column offscreen
to the right.

**Escape to cancel, and the phantom-click swallow.** A capturing `keydown`
listener cancels the drag on Escape. The subtle bit is `cleanup(didDrag)`: after
a real drag, the browser will still synthesize a `click` on `pointerup`. If we let
it through, dropping a card would _also_ navigate to that card's detail page. So
after a drag we install a one-shot capturing `click` handler that swallows the
next click, and — because a click isn't guaranteed when you release off any
element — we also dispatch a synthetic click on the next tick to make sure the
swallower is always consumed. This is the kind of edge case native DnD hides from
you and pointer events make you handle explicitly; the trade-off is worth it for
the reliability.

### Callbacks, not inheritance

`beginPointerDrag` knows nothing about issues, columns, or sort order. It only
reports _what is under the cursor_ and _when the drag ends_. Every surface —
board, grouped list, and the generic reorder hook — supplies its own hit-testing
and its own drop logic. That is why the same 110 lines back four different
draggable experiences.

---

## 2. Board and list: cross-axis moves and precise insertion

Two components consume the engine for issues, both in
`apps/web/src/issueViews.tsx`: `Board` (Kanban columns) and `GroupedIssueList`
(the grouped list view). They share a pattern:

1. On `pointerdown`, call `beginPointerDrag` with a ghost of
   `"{issueKey}  {title}"`.
2. In `onHover`, run a `hitTest` that reads `data-*` attributes off the element
   under the cursor and stores a `{ group, index }` drop target in React state.
3. Render a visible drop indicator at that target.
4. In `onDrop`, translate `{ group, index }` into an issue patch and fire it.

**Hit-testing is attribute-driven.** Rows carry `data-card-group` /
`data-card-index` on the board and `data-issue-index` / `data-row-group` in the
list. `hitTest` does `target.closest('[data-card-group]')` (or the list
equivalent), and — critically — decides _before or after_ the row by comparing
the cursor's Y against the row's vertical midpoint
(`e.clientY < rect.top + rect.height / 2`). Half-above means "insert before this
index," half-below means "insert after." If the cursor is over the column but
not over any card (empty column, or the gap below the last card), it falls back
to `closest('[data-board-group]')` and targets the end of the group. This is how
you can drop into an empty column at all.

**The insertion indicator is not a placeholder.** We show a thin accent-colored
line exactly where the row will land — `.insert-line` in the list (a 2 px accent
border with a small dot on the left) and `.drop-slot.over` on the board (a 2 px
bar rendered between every pair of cards, lit up only at the active index).
Showing the _seam_ rather than opening a gap keeps the surrounding layout stable
and makes the drop position unambiguous. The whole target column/group also gets
a `.drag-over` outline so you always know which bucket you're aiming at.

**Cross-axis drops re-assign, not just re-order.** The board and list both group
issues by a field (status, priority, or assignee — see `groupIssues`). Dropping
a card into a _different_ group is a semantic change: `groupPatch(grouping,
group)` returns `{ stateId }`, `{ priority }`, or `{ assigneeId }` depending on
what the view is grouped by. So dragging a card from "Todo" to "In Progress"
sets its state; dragging between assignee lanes reassigns it. A drop within the
same group only reorders. The board additionally guards on `group.stateId` so you
can only drag between real status columns, never into a synthetic category
bucket. This is direct manipulation doing double duty — the same gesture that
Linear users expect to reorder also mutates the grouped attribute, which is
exactly Linear's behavior.

**Ordering is manual and remembered.** Board order (and list order, when drag is
enabled) is stored per-issue in `issue.sortOrder`, and the list re-sorts by it
(`sortForBoard`, and the `orderedGroups` memo in `GroupedIssueList`). Contrast
with the _default_ list sort, `sortForList`, which sorts by priority then
recency and is not drag-reorderable — dragging is only wired up when a `grouping`
prop is passed, because reordering only makes sense when there's a stable manual
axis to reorder within.

### Fractional indexing: why `sortOrder` is a string

The load-bearing trick under all reordering is **fractional indexing**, in
`packages/shared/src/fractional.ts` (`keyBetween`). `sortOrder` is a base-36
fraction string representing a number in `(0, 1)`: `"i"` is ~0.5, `"4"` is ~0.11,
`"4i"` sits between `"4"` and `"5"`. Sort keys compare lexicographically, and the
invariant "keys never end in `0`" guarantees lexicographic order equals numeric
order.

To drop an issue between two neighbors, we take the `sortOrder` of the card
before the gap and the card after it, and ask `keyBetween(before, after)` for a
key strictly between them — see the `onDrop` handlers in both `Board.startCardDrag`
and `GroupedIssueList.startRowDrag`. `null` bounds mean start/end of the list.

Why this instead of integer positions? The alternative — storing `position: 0,
1, 2, …` — means inserting one card requires **renumbering every card after it**,
which is O(n) writes, O(n) sync deltas, and a race magnet when two people reorder
at once. Fractional indexing makes an insert a **single write to a single row**:
you never touch the neighbors. That matters doubly here because every mutation
becomes a sync-log delta broadcast to every connected client (the sync model in
CLAUDE.md) — a renumber would flood the log. The trade-off is that keys grow
longer as you repeatedly insert into the same gap, and with enough adversarial
reordering they could in principle need rebalancing; we accept that because in
practice keys stay short and no rebalance path is built yet (not a concern at
this scale — see `keyAfterAll` for the append case, which keeps keys minimal).

There is one honest sharp edge: `keyBetween` **throws** if `a >= b` (neighbors
out of order, which can happen transiently under concurrent edits). Every caller
wraps it in `try/catch` and, on failure, keeps the issue's existing `sortOrder`
rather than crashing the drop. That is the correct conservative choice — a
momentarily-wrong order fixes itself on the next clean drag, whereas a thrown
exception would lose the whole gesture.

---

## 3. The generic reorder hook: states, milestones, favorites

Not everything draggable is an issue. Workflow states (Settings), project
milestones (project detail), and sidebar favorites are all simple vertical lists
that need drag-to-reorder. Rather than duplicate the board/list machinery, these
share `useDragReorder<T>` in `apps/web/src/ui.tsx`.

The hook is deliberately minimal. You give it the array and an `onMove(dragged,
insertAt)` callback; it gives you back four things to spread onto your rows:

- `itemProps(index)` → sets `data-reorder-index` so the row is a hit target.
- `dragProps(item, label)` → an `onPointerDown` that starts a pointer drag with
  the given ghost label.
- `dragId` → the id currently being dragged (for a `.reorder-dragging` dim).
- `insertBefore` → the index the drop line should render before (for a
  `.reorder-before` top border).

Internally it is the same before/after-by-midpoint hit-test as the board
(`insertionAt` compares cursor Y to row midpoint) sitting on the same
`beginPointerDrag`. The only new piece is the companion helper `sortKeyForInsert`,
which does the index bookkeeping the callers would otherwise get wrong: because
`insertAt` is an index in the _pre-drag_ array (which still contains the dragged
item), it removes the dragged item, adjusts the target index if the item was
being moved downward (`from < insertAt ? insertAt - 1 : insertAt`), and then calls
`keyBetween` on the resolved neighbors — again returning `null` on the
out-of-order throw so the caller can bail cleanly.

Three call sites, three lines each:

- `Sidebar.tsx` (favorites): computes the new key, optimistically patches, and
  `api.reorderFavorite(dragged.id, sortOrder).catch(toastError)`.
- `pages/Settings.tsx` (workflow states): reorders states within a team; the drag
  source is an explicit grip handle ("Drag to reorder") rather than the whole row,
  because the row also has click targets.
- `pages/Projects.tsx` (milestones): reorders milestones within a project.

The design value here is **one drag engine, one ordering scheme, many surfaces**.
A new reorderable list is a `useDragReorder` call plus a `sortOrder` field, not a
new subsystem. That both keeps the bundle small and guarantees that dragging
_feels the same_ everywhere — same threshold, same ghost, same insertion line,
same Escape-to-cancel — which is itself a UX-consistency win.

---

## 4. Keyboard-first: the command palette and single-key shortcuts

### The command palette (Cmd/Ctrl-K)

`apps/web/src/CommandPalette.tsx` is the keyboard-first anchor of the whole
product, mounted once at the App root. Cmd/Ctrl-K opens it from anywhere; the
handler in `App.tsx`'s `Shortcuts` component intercepts the chord _before_ the
typing-target guard, so it works even while you're focused in an input.

Inside, it is a single search box over a fused list of two result kinds:

- **Commands** — a static list of navigations and actions (create issue, go to
  Inbox / My Issues / Projects / Search / Timeline / Customers / Initiatives /
  Documents / Settings, toggle theme) plus **dynamic** entries generated from the
  store: one "Go to {team} issues" per team and one "Go to project {name}" per
  project. Team commands carry the team key as a `keywords` field so typing the
  key matches even though it isn't in the visible label.
- **Issues** — when there's a query, a live substring match over every issue's
  title and key, sorted by recency, capped at 12.

The two lists are flattened into one `flat` array so arrow keys traverse
seamlessly across the section boundary; Enter runs the highlighted item; Escape
closes. Highlighted-item auto-scroll (`scrollIntoView({ block: 'nearest' })`) and
mouse-hover-sets-highlight keep keyboard and mouse in sync. Commands advertise
their single-key equivalents as hints (`C`, `G I`, `/`) rendered as `.kbd` pills,
so the palette teaches the shortcuts.

Why a palette at all, given we also have a sidebar? Because it collapses
navigation, search, and command execution into one modal you can reach without
your hands leaving the keyboard — the Linear-feel of "type where you want to go."
It is one of only two genuine modals in the product, which is consistent with the
"no modal-heavy flows" value: the palette earns its modality by being the
keyboard hub.

### Single-key shortcuts and the G-chord

`Shortcuts` in `App.tsx` is a global `keydown` listener implementing the
Linear-style bindings:

- **C** — create a new issue (`openNewIssue()`).
- **/** — jump to Search.
- **G then a letter** — "go to": `G I` Inbox, `G M` My Issues, `G P` Projects,
  `G S` Settings/Preferences. `G` sets a `pendingG` flag with an 800 ms timeout;
  the next key resolves the destination or the flag expires. This is a tiny
  hand-rolled chord state machine — no library, just a boolean and a `setTimeout`.

Two guards keep these from firing at the wrong time, and they encode real care:

- `isTypingTarget(e.target)` bails if focus is in an INPUT/TEXTAREA/SELECT or any
  `contentEditable` element, so typing "c" in a title field doesn't spawn a new
  issue. Any modifier (`metaKey/ctrlKey/altKey`) also bails — those belong to the
  browser or the palette.
- The listener also bails if the palette or new-issue dialog is already open, so
  the modals own the keyboard while they're up.

The Cmd/Ctrl-K check sits _above_ the typing guard on purpose — the palette must
open from inside a text field, the plain letters must not.

### Multi-select and the bulk bar

Selection lives in `useSelection` (a zustand store in `issueViews.tsx`) and
implements the desktop-list conventions users already know from Finder/Gmail:

- **Cmd/Ctrl-click** toggles a row into the selection (`toggle`).
- **Shift-click** selects the range from the anchor to the clicked row
  (`rangeTo`), using an `order: string[]` array the list keeps current so
  "range" means _visible_ order, not store order.
- A plain click clears the selection and opens the issue.

When anything is selected, `BulkBar` (rendered once at App root) slides up with
count and actions: change status (only when all selected issues share a team —
`sameTeam`), priority, assignee, add labels, or delete (with a confirm). Each
action fans out `patchIssue` across every selected issue. Escape clears the
selection. The bulk bar is a **non-modal** action surface — it appears in place,
over the content, without stealing focus or blocking the view, which is the whole
point: bulk-editing 30 issues shouldn't mean a wizard.

---

## 5. Mobile: off-canvas drawer, stacking, and the 820 px line

The responsiveness story is a single breakpoint at **820 px**
(`@media (max-width: 820px)` in `styles.css`) plus a handful of structural
swaps. This is a responsive _layout pass_, honestly scoped — ROADMAP lists "Ship
a PWA manifest + responsive layout pass first; native apps out of scope" under
Mobile, and this is the layout pass; the PWA manifest is **not yet** built (it
sits in P3, per CLAUDE.md).

**The sidebar becomes an off-canvas drawer.** On desktop the sidebar is a normal
flex column. Below 820 px it becomes `position: fixed`, full-height, 264 px wide
(capped at 82 vw), translated fully off-screen to the left. A `.mobile-header`
bar (hidden on desktop, `display: flex` only in the media query) appears with a
hamburger, the workspace initial, and Search / New-issue buttons. Tapping the
hamburger sets `mobileNav` state in `AppShell`, which adds `.nav-open` to `.app`;
the CSS transitions the drawer's `transform` to `none` (slide in) and drops a
`.nav-backdrop` scrim over the content. Two nice touches in `AppShell`: the
drawer auto-closes on navigation (a `useEffect` on `location.pathname`), and the
backdrop closes it on tap — so you never get stranded with the menu open. The
Settings sub-navigation uses the same pattern independently (`.settings-nav` /
`.settings-nav-toggle`).

**Detail views stack instead of sitting side-by-side.** The issue/document detail
layout is a two-pane `.detail` (content + metadata side panel) on desktop. In the
media query it switches to `flex-direction: column`, and `.detail-side` drops its
left border for a top border — the side panel slides _under_ the main content and
the whole thing scrolls as one column. Topbars `flex-wrap` instead of
overflowing, the per-row updated-date column is hidden (`.issue-row .date {
display: none }`) to reclaim width, board columns shrink to 82 vw so one column
fills the screen with the next peeking in, and the palette/modals go
near-full-width. None of this is a separate mobile app — it's the same components
reflowing, which keeps the bundle single and the behavior consistent.

**Touch drag is best-effort.** Because the drag engine is built on _pointer_
events, drag works on touch at all — a touch is a pointer, `elementFromPoint`
works under a finger, the ghost tracks the touch point. That is a real benefit of
having abandoned HTML5 DnD (which has no touch story). But it is honestly
best-effort, and the code shows why: there is **no `touch-action` CSS** and **no
`setPointerCapture`** anywhere in the web app. Without `touch-action: none` on the
draggable elements, a touch-drag competes with the browser's native scroll
gesture — the OS may claim the gesture as a pan before our 5 px threshold
promotes it to a drag, especially inside a scroll container. So on a phone,
reordering can be fiddly; tapping to open, the pickers, and the bulk actions are
the reliable touch paths. Making touch-drag first-class would mean adding
`touch-action: none` to drag handles and likely pointer capture — that work is
**not yet** done and is the natural companion to the PWA item on the roadmap.

---

## 6. Design values, restated as trade-offs

Every choice above is downstream of a few decisions we'd make again:

- **Own the drag engine.** ~110 lines of pointer-event code replaced a native API
  that fought our rendering model and a family of third-party libraries we'd have
  to ship. The cost is that we handle edge cases (the phantom-click swallow,
  edge-scroll, the click/drag threshold) by hand; the payoff is reliability,
  a bundle that stays tiny, and one consistent feel across four surfaces.
- **Fractional `sortOrder` over integer positions.** Single-row writes instead of
  cascading renumbers, which is what makes reordering cheap enough to broadcast
  over the sync log. The cost is growing keys and a rebalance path we haven't
  built; acceptable at this scale.
- **Popovers and inline pickers over modals.** The palette and new-issue dialog
  are the _only_ real modals. Status/priority/assignee/label edits, filtering,
  grouping, context menus, and bulk actions all happen in transient popovers that
  don't block the view. This is the "no modal-heavy flows" value made concrete.
- **Keyboard as a first-class path, learned once.** Cmd/Ctrl-K plus C, /, and the
  G-chord cover the high-frequency actions, and the palette advertises them so the
  shortcuts are discoverable rather than hidden.
- **One responsive codebase, breakpoint at 820 px.** No separate mobile app; the
  same components reflow. Touch-drag rides for free on pointer events but is
  explicitly best-effort until the PWA/touch work in P3.

For where this sits in the larger picture — the sync model that makes each
reorder a broadcast delta, and the roadmap items (PWA, custom dashboards) that
touch these surfaces next — see CLAUDE.md and ROADMAP.md.
