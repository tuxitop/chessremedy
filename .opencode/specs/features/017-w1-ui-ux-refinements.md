# Feature 017 — W1 UI/UX Refinements

> Cross-cutting UI workstream, not a new product capability. It refines the
> application shell (Feature 001), the Game Library surface (Feature 007), the
> Library analysis actions (Feature 008), the tactical-training surfaces
> (Feature 013), the statistics consumption (Feature 014) and the Dashboard
> page (Feature 015). It introduces **no new domain rule, no new persisted
> table and no new dependency**.

## Purpose

Make the shipping V1 UI coherent, honest and discoverable before further
feature work: a distinct light theme, section names that match what users do
("Training", "Statistics"), a header that yields screen space but stays
reachable, a Game Library selection bar that keeps bulk actions next to the
selection, a pagination count that never implies every matched game is
rendered, clearer Settings help with a global hint default, and a Statistics
default partition that opens on the user's busiest concrete partition and
remembers the choice.

All decisions below are owner-approved; where an implementation detail is not
fixed by the owner, the spec records the recommended default and flags it under
"Conflicts, ambiguities & ADR assessment".

## Scope

### In scope

1. Light-theme page background token (off-white) with white cards; dark theme
   unchanged.
2. Section rename **Puzzles → Training** and **Dashboard → Statistics**,
   including nav labels, page `<h1>`s, route paths, `ROUTES` keys and the page
   file/component rename (`DashboardPage` → `StatisticsPage`), with
   backwards-compatible redirects.
3. Nav order **Home, Games, Training, Statistics, Analysis, Settings**.
4. Non-sticky header that hides on scroll-down and reveals on scroll-up, always
   visible near the top, accessible and defined for mobile.
5. Game Library: Analyze / Re-analyze / Delete moved from the filter row into
   the selection bar next to "Clear selection"; the standalone "Selected: N"
   text removed.
6. Pagination count copy that reflects the rendered page window:
   `Showing {shown} of {total} games`, reconciled with `Page X of Y`.
7. Settings: a global **default hint configuration** that new sets/blocks
   inherit, help text for hint levels and for the informational target
   accuracy / target solving time, and removal of the stale
   "Hint behaviour — Coming in Feature 012" placeholder.
8. Statistics: default the partition selector to the concrete partition with
   the most games, and persist the choice in a `partition` URL param.

### Out of scope

- Any change to chess, analysis, classification, puzzle, cycle, statistics or
  mastery **semantics**. `domain/game-library.md` selection rules,
  `CycleConfig`/`HintConfig` semantics and every Feature-014 calculation are
  unchanged.
- Any new ADR, IndexedDB schema bump, table, column or index.
- Any new dependency (no scheduler, no UI kit, no router replacement).
- Renaming puzzle domain entities, the per-game `/games/:id/puzzles` route or
  `GamePuzzlesPage`.
- Redesigning the Game Library row cards, filters, charts or the training
  surfaces beyond the selection-bar and count-copy changes above.

## Owner-approved decisions (items 1–8)

| #   | Decision                                                                                          |
| --- | ------------------------------------------------------------------------------------------------- |
| 1   | Light `--color-bg: #f6f8fa`, `--color-surface: #ffffff`; dark unchanged; page shells use `--color-bg` |
| 2   | "Puzzles"→"Training", "Dashboard"→"Statistics"; routes `/puzzles*`→`/training*`, `/dashboard`→`/statistics`; old paths redirect; `DashboardPage`→`StatisticsPage`; per-game `/games/:id/puzzles` kept |
| 3   | Nav order Home, Games, Training, Statistics, Analysis, Settings                                   |
| 4   | Header hides on scroll-down, reveals on scroll-up, always visible near top; accessible + mobile   |
| 5   | Library Analyze/Re-analyze/Delete move to the selection bar next to "Clear selection"; drop "Selected: N" |
| 6   | Count label `Showing {shown} of {total} games`, window-based, reconciled with `Page X of Y`        |
| 7   | Global default hint configuration setting + hint/target help; remove stale Feature-012 placeholder |
| 8   | Statistics default partition = most games; persisted via `partition` URL param                    |

## User-facing behavior

### 1. Light theme

- **Token change.** In `src/styles/tokens.css`, the light block
  (`:root, [data-theme='light']`) sets `--color-bg: #f6f8fa`. `--color-surface`
  stays `#ffffff` (cards, panels, toolbars, rows, inputs, popovers). The dark
  block (`[data-theme='dark']`) is **unchanged**.
- **Page canvas.** `src/styles/global.css` keeps `html, body { background:
  var(--color-bg) }`, so the page background becomes off-white everywhere
  without per-page work. `#root`, the AppShell `.shell` and `main` must not
  paint `--color-surface`; they inherit the off-white canvas.
- **Page shells must stop painting `--color-surface` as the page background.**
  No full-viewport wrapper may use `--color-surface` for the page canvas; a
  full-page shell uses `--color-bg` (or no background). In the current tree the
  canvas is `body` only; any new full-page wrapper must follow this rule.
- **Header token.** Because the light `--color-bg-elevated` (`#f6f8fa`) now
  equals the page canvas, the AppShell header uses `--color-surface` (white)
  plus its existing bottom border so the bar stays distinct from the page. This
  is the recommended resolution of the token collision (see Ambiguities).
- **Card surfaces stay white.** Toolbars, rows, filter bars, Settings rows,
  chart cards and dialogs keep `--color-surface`. Components that previously
  used `--color-bg` as an inset/card fill (e.g. `SetEditorPage`,
  `SetDetailPage`, `MembershipList`, `CycleConfigForm`) are re-checked so an
  inset never becomes indistinguishable from the page; if needed they use
  `--color-bg-elevated`/`--color-bg-sunken`.
- Both themes still meet WCAG AA contrast for text and controls (see
  Accessibility).

### 2. Section rename, routes and page files

**Labels and headings**

- Nav label **"Puzzles" → "Training"**; nav label **"Dashboard" →
  "Statistics"**.
- `TrainingHomePage` `<h1>` stays **"Training"** (already correct).
- `DashboardPage` `<h1>` becomes **"Statistics"** and the subtitle copy stays
  truthful (rating, accuracy, mistakes and training progress).

**Route paths** (`src/app/routes.ts`, `src/app/router.tsx`)

| Old path                                                | New path                                                       |
| ------------------------------------------------------- | -------------------------------------------------------------- |
| `/puzzles`                                              | `/training`                                                    |
| `/puzzles/new`                                          | `/training/new`                                                |
| `/puzzles/mastered`                                     | `/training/mastered`                                           |
| `/puzzles/sets/:setId`                                  | `/training/sets/:setId`                                        |
| `/puzzles/sets/:setId/cycles/:cycleNumber`              | `/training/sets/:setId/cycles/:cycleNumber`                    |
| `/puzzles/sets/:setId/cycles/:cycleNumber/results`      | `/training/sets/:setId/cycles/:cycleNumber/results`            |
| `/dashboard`                                            | `/statistics`                                                  |
| `/games/:id/puzzles`                                    | **unchanged** (per-game puzzle view)                           |

**`ROUTES` keys and helpers.** Rename the section keys and helpers so the code
speaks "training"/"statistics":

- `puzzles` → `training`, `puzzlesNew` → `trainingNew`,
  `puzzlesMastered` → `trainingMastered`, `puzzlesSet` → `trainingSet`,
  `puzzlesCycle` → `trainingCycle`,
  `puzzlesCycleResults` → `trainingCycleResults`, `dashboard` → `statistics`.
- `puzzlesSetPath` → `trainingSetPath`, `puzzlesCyclePath` →
  `trainingCyclePath`, `puzzlesCycleResultsPath` → `trainingCycleResultsPath`.
- Keep `QUICK_TRAIN_SET_ID` and all puzzle/cycle domain identifiers.

**Page/component files.** Rename `src/pages/DashboardPage.tsx` →
`src/pages/StatisticsPage.tsx` (and `DashboardPage.module.css` →
`StatisticsPage.module.css`, `DashboardPage.test.tsx` →
`StatisticsPage.test.tsx`); component `DashboardPage` → `StatisticsPage`; the
lazy import in `router.tsx`; the root test id `dashboard-page` →
`statistics-page`. Keep `TrainingHomePage` (already section-named) and
`MasteredPuzzlesPage` (it names the domain artifact "mastered puzzles").

**Backwards-compatible redirects.** Old section paths redirect client-side
(`<Navigate replace>` / a small redirect component) to the new path,
**preserving the query string and hash**:

- `/puzzles` and `/puzzles/*` → the same suffix under `/training`
  (`/puzzles/sets/x` → `/training/sets/x`).
- `/dashboard` → `/statistics`.
- Redirects use `replace` so the browser back button does not loop.
- The per-game `/games/:id/puzzles` route must **not** redirect.
- `/training` and `/statistics` never redirect to themselves.

**Reference sweep.** Every reference to the renamed section is updated:
`NAV_ITEMS`, `Navigation` test ids (derived from the label:
`nav-training`, `nav-statistics`), `AppShell.test.tsx` expected labels, links
and empty states in `TrainingHomePage`, `DashboardTrainingSection`,
`RepeatedlyFailedList`, `presentation/dashboard/*`, analysis deep-links and
their tests.

### 3. Navigation order

`NAV_ITEMS` (`src/app/routes.ts`) becomes, in order:

1. Home
2. Games
3. Training
4. Statistics
5. Analysis (keeps its `ANALYSIS_GLYPH`; `ROUTES.analysisLive` unchanged)
6. Settings

No item is added or removed; only order and the two labels change.

### 4. Header behavior

The header stops being always-sticky (`src/components/layout/AppShell.module.css`
currently `position: sticky; top: 0`). New contract:

- **Always visible near the top.** While `scrollY` is at or below the header
  height (a small threshold, recommended `scrollY <= headerHeight`, ~48–64px),
  the header is shown regardless of scroll direction.
- **Hide on scroll-down.** When `scrollY > headerHeight` and the user scrolls
  down, the header translates up out of view (`transform: translateY(-100%)`).
- **Reveal on scroll-up.** Scrolling up reveals it again.
- **Reveal on focus.** Keyboard focus anywhere inside the header
  (`:focus-within`) reveals it, so a user who tabbed to the nav never has focus
  on an off-screen control.
- **Reveal when a header surface is open.** If a header control opens a menu,
  popover or dialog, the header stays/reveals visible until it closes.
- **Transform, not removal.** Hiding uses a transform (and `pointer-events:
  none` while fully hidden), never `display: none`/`visibility: hidden`, so
  focus order is stable and `:focus-within` works. The header remains in the
  accessibility tree.
- **Animation.** Uses the existing `--duration-base`/`--easing-standard` tokens;
  `prefers-reduced-motion: reduce` disables the animation (instant show/hide).
- **Listener.** A passive scroll listener throttled with
  `requestAnimationFrame` (or an `IntersectionObserver` sentinel) reads only
  `scrollY`; it never measures layout in the scroll handler.
- **No overlay.** When hidden, the header must not intercept pointer events over
  page content.
- **Skip link.** Add a "Skip to main content" link as the first focusable
  element in `AppShell`, visually hidden until focused, targeting the existing
  `<main id="main-content">`. The header remains a `<header>` landmark and the
  nav keeps its `aria-label="Primary"`.

**Mobile behavior.** The same hide-on-scroll-down / reveal-on-scroll-up rule
applies on touch, with a slightly larger reveal threshold to avoid accidental
hiding during momentum scrolling. The header stays full width, respects safe-area
insets, and the nav keeps its horizontal scroll. A touch that taps the top edge
or scrolls up reveals the header. It never hides while a header menu/dialog is
open.

### 5. Game Library selection bar

Current layout (`GameLibraryToolbar.tsx` filter row) holds a selection cluster
with `Selected: N` + Analyze / Re-analyze / Delete icon buttons; the results row
holds the count + `Select all` / `Clear selection (N)`.

New contract:

- The Analyze / Re-analyze / Delete actions are **removed from the filter row**.
  The filter row keeps filters, Clear filters and Import only.
- The **selection bar is the results-row control area**: it shows
  `Select all` when nothing is selected, and when `selectedCount > 0` shows the
  bulk actions next to `Clear selection (N)`.
- **Remove the standalone `Selected: N` text.** The count is carried by
  `Clear selection (N)` (the selection count is not shown twice).
- **Layout / copy** (left to right):
  - left: the count label (item 6);
  - right: `Select all` (0 selected) **or** `Analyze` · `Re-analyze` ·
    `Delete` · `Clear selection (N)` (≥1 selected).
  - The actions keep their accessible names ("Analyze selected games",
    "Re-analyze selected games", "Delete selected games"); icon buttons may keep
    icons with visible-on-focus tooltips, but each control has a real accessible
    name and is keyboard/touch operable.
  - `Analyze` is enabled per the existing rule (analysis service available and
    selection has at least one analyzable game); `Re-analyze` is enabled only
    when at least one selected game is `completed`/`outdated`; `Delete` opens
    the existing confirmation dialog naming the count and consequence.
- **Behavior unchanged.** Selection is the id set of `domain/game-library.md`
  §6; it is still cleared when filters/search change or games are deleted;
  `Select all` still selects the **whole matched result set**, not just the
  rendered page; bulk actions still operate on the selection.
- **Mobile.** The bar wraps under the count label; the actions remain reachable
  without hover and do not require horizontal scrolling.

### 6. Pagination count copy

The count label must be derived from the **rendered page window**, never from
the stored table size. Contract:

```
total     = matched rows for the current filters/search   (library.rows.length)
pageSize  = rows per page
page      = current 1-based page, clamped to [1, totalPages]
totalPages= max(1, ceil(total / pageSize))
shown     = max(0, min(pageSize, total - (page - 1) * pageSize))
label     = "Showing {shown} of {total} games"   // "game" when total === 1
pager     = "Page {page} of {totalPages}"
```

- Example: `pageSize = 50`, `total = 77`, page 1 → **"Showing 50 of 77 games"**;
  page 2 → **"Showing 27 of 77 games"**.
- `library.totalStored` (all games in IndexedDB) must **never** be the
  denominator of the "Showing" label; it may only drive the "No games have been
  imported" empty state.
- The label is the single authoritative place for the matched total. The pager
  reads `Page X of Y`; it may append `· {total} games` **only** using the same
  `total`, and must never use `totalStored`.
- When `total === 0` the label is not rendered; the existing "no games" /
  "no matches" state is shown instead.
- `page` resets to 1 when filters/search or `pageSize` change, and is clamped
  when the matched set shrinks below the current page.
- The label keeps `aria-live="polite"`.
- `Select all` continues to operate on all `total` matched rows, so the label
  never implies the page is the whole selection scope.

### 7. Settings clarity + global hint defaults

**New settings key.** `src/config/app-config.ts`:

```ts
SETTINGS_KEYS.defaultHintConfig = 'training.hints';
```

Value shape: `HintConfig` (`{ enabledLevels: readonly HintLevel[];
firstHintLevel: HintLevel }`, `domain/training/cycleTypes.ts`). Stored in the
existing settings table through `settingsRepository` (like
`usePuzzleTimerSetting`); **no schema change**. Fallback when unset:
`DEFAULT_CYCLE_CONFIG.hints` = `{ enabledLevels: [1, 2, 3, 4], firstHintLevel:
2 }`.

**Settings row.** A labelled row on the Settings page (recommended test id
`settings-row-hints`, title **"Puzzle hints"**) with:

- checkboxes **Level 1–4** for `enabledLevels`;
- a **First hint level** select (1–4) for `firstHintLevel`;
- immediate save on change (consistent with the other Settings rows).

**Help text** (associated with the controls via `aria-describedby`):

- **Level 1 — Relevant piece**: shows the piece type that starts the solution
  (text only, no board highlight).
- **Level 2 — Piece square**: highlights that piece's starting square.
- **Level 3 — Destination**: highlights the destination square of the first
  solution move.
- **Level 4 — Move**: shows the full first solution move in SAN.
- Hints never fail a puzzle and never count as a wrong move; the reveal starts
  at the configured first level and ascends, skipping disabled levels, capped at
  Level 4.
- **Target accuracy** and **target solving time** (set/cycle configuration) are
  **informational only** — displayed targets, never gates; a cycle is never
  blocked, failed or completed differently because a target is missed.

The per-set `CycleConfigForm` (`src/components/puzzles/cycles/CycleConfigForm.tsx`)
also shows the Level 1–4 legend next to "Hint levels available" and the
"informational target, never a gate" note next to Target accuracy / Target
solving time, so the same clarity exists where the values are actually set.

**Seeding new sets/blocks.** The stored global hint config replaces the
hardcoded `DEFAULT_CYCLE_CONFIG.hints` as the hint source for **new** sets and
blocks:

- `training-sets-service.defaultConfigFor(ordering)` and `blockConfig()` seed
  `hints` from the stored global value (fallback `DEFAULT_CYCLE_CONFIG.hints`);
  the block preset still fixes `ordering: 'difficultyAsc'`,
  `retryFailed: 'endOfCycle'`, `allowSkip: true`, `plannedCycles` and the unset
  targets.
- `SetEditorPage` seeds its initial `config.hints` from the global value.
- All other `CycleConfig` fields keep seeding from `DEFAULT_CYCLE_CONFIG`/the
  block preset.
- **Existing sets and cycles are unaffected**: their stored `config` (and every
  cycle's config snapshot) is immutable; the global default applies only to
  sets/blocks created after it changes. The user can still override hints per
  set in the set editor (the global value is a default, not a lock).
- No `CycleConfig.configVersion` bump: the shape and semantics of `CycleConfig`
  are unchanged; only the initial values differ.

**Stale placeholder.** Remove the `SETTINGS_PLACEHOLDERS` entry
`Hint behaviour — Coming in Feature 012 — Puzzle Training` (Feature 012 has
shipped and hints are now configured per set and globally). Keep the
Synchronization placeholder (Feature 016 is still unshipped).

### 8. Statistics default partition + persistence

Applies to the renamed `/statistics` page (Feature 015's game-analysis section).

- **New URL param** `partition`, consistent with the existing filter params
  (`platform`, `timeControl`, `timeFrame`) and the training `set` param.
  Values: `all`, or a concrete partition key `{platform}:{timeControl}` (the
  existing `partitionKey` helper).
- **Default when the param is absent.** Default to the **concrete partition
  with the most games** — the `gameMetrics` partition with the largest
  `games.length` among `combined === false` partitions. Tie-break
  deterministically: canonical platform order (Lichess, Chess.com, then other
  real sources; `fixture` excluded), then ADR-013 time-control category order
  (bullet, blitz, rapid, classical, correspondence, unknown), then partition key
  ascending.
  - If no concrete partition exists (no games / no observations), the value is
    `all`, which renders the existing empty state.
  - The resolved default is written to the URL with `replace` so a refresh is
    stable and the view is bookmarkable.
- **Persistence.** Selecting a partition writes `partition` (`replace` history)
  alongside the filter params and the `set` param; on refresh the URL restores
  the choice. Selecting a partition never drops the other params.
- **Explicit `all`** is preserved and never replaced by the most-games default.
- **Invalid/stale param** (malformed, references a partition no longer present,
  or a `fixture`/`combined`-only partition): fall back to the most-games
  default and rewrite the URL; never crash and never render an empty partition.
- **Implementation shape.** The partition state moves from
  `DashboardGameSection` local `useState` into `useDashboard` (URL-backed, like
  `set`). The default derivation is a pure, deterministic presentation selector
  in `src/presentation/dashboard/selection.ts`
  (`selectDefaultPartition(partitions)`), replacing/expanding
  `defaultPartitionValue`; it uses only already-loaded Feature-014 partitions
  and computes no statistic.
- **Mixed view rule preserved.** A mixed/combined view is still never the
  default; the default is a single concrete partition. W1 changes *which*
  concrete partition is default (most games instead of the first), not the
  no-silent-merge rule.

## Domain behavior

W1 adds **no domain rule**. It only consumes existing domain vocabulary:

- The global hint default is a stored `HintConfig` (Feature 013 /
  `domain/tactical-training.md`); `CycleConfig` semantics and `configVersion`
  are unchanged.
- The partition default is a presentation selector over Feature-014 results; no
  statistics, denominators or thresholds are computed.
- The Game Library selection bar uses the existing selection model
  (`domain/game-library.md` §6) and existing capability-registered actions
  (Feature 008).
- The pagination label is presentation over the existing matched set.
- Route/nav/theme/header changes are presentation and shell only.

## Data requirements

- **Settings key:** `SETTINGS_KEYS.defaultHintConfig = 'training.hints'`, value
  `HintConfig`, stored in the existing settings table. Fallback
  `DEFAULT_CYCLE_CONFIG.hints`. Validation/normalization reuses the hint rules
  of `validateCycleConfig` (levels subset of `1..4`, `firstHintLevel` in
  `1..4`; an empty `enabledLevels` is a valid "hints off" value).
- **URL params:** add `partition` (`all` | `{platform}:{timeControl}`) on
  `/statistics`. Existing filter params and `set` are unchanged. Redirects
  preserve the query string/hash.
- **No IndexedDB schema change:** `PERSISTENCE_SCHEMA_VERSION` stays `10`; no
  new table, column or index; no data migration. Route/page renames are code
  only.
- **No new dependency.**

## States

- **Theme:** light (off-white page, white cards), dark (unchanged); both render.
- **Header:** top/visible; scrolling down/hidden; scrolling up/revealed;
  focus-revealed; reduced-motion; menu/dialog open (stays visible).
- **Navigation:** six labels in the canonical order; active item marked
  (text/`aria-current`, not colour alone); old path redirected.
- **Library selection bar:** none selected (`Select all`); one/many selected
  (actions + `Clear selection (N)`); disabled `Analyze`/`Re-analyze`; delete
  confirmation open; mobile-wrapped.
- **Pagination:** `total = 0` (empty/no-match state, no label); `total <=
  pageSize` (single page); multiple pages; last page; page clamped after a
  filter change.
- **Settings hints:** unset (fallback applied); stored valid value; stored
  invalid value (fallback); saving; save failure.
- **Statistics partition:** no partitions (`all`); concrete default (most
  games); explicit concrete; explicit `all`; stale/invalid param (fallback);
  partition read loading/error.
- **Redirect:** old path with/without query/hash; `/games/:id/puzzles`
  unaffected.

## Error cases

- **Invalid stored `training.hints`** (not an object, bad level, unknown
  `firstHintLevel`): fall back to `DEFAULT_CYCLE_CONFIG.hints`; never crash; do
  not surface a raw error to the user.
- **Settings save failure:** keep the last value and show the existing inline
  error pattern; never silently claim success.
- **Invalid/stale `partition` param:** fall back to the most-games default and
  rewrite the URL; never render an empty partition or crash.
- **Statistics read failure:** the existing inline "Could not load statistics"
  retry applies; the partition default cannot be computed, so the page keeps
  `all`/its last valid value.
- **Pagination:** `page > totalPages` after the matched set shrinks → clamp to
  the last page; `total = 0` → label omitted.
- **Redirect:** unknown `/puzzles/*` suffix → redirect to `/training` rather
  than 404; `/training`/`/statistics` never self-redirect (no loop).
- **No `window`/scroll API** (tests/SSR): the header defaults to visible and the
  listener is a no-op.

## Edge cases

- Light theme: `--color-bg` and `--color-bg-elevated` are both `#f6f8fa`; the
  header uses `--color-surface` so it stays distinct.
- Dark theme values are untouched.
- `total = 1`: "Showing 1 of 1 game" (singular).
- `total = pageSize`: "Showing {total} of {total} games".
- `total` not divisible by `pageSize` (last page `shown < pageSize`).
- `Select all` with many pages: the selection can exceed the page window;
  `Clear selection (N)` shows the true selection count.
- Partition count tie: resolved by the documented tie-break order.
- One platform/time control: a single partition is the default.
- Explicit `all` with no partitions: renders the empty state.
- Global hint default changed after sets exist: existing sets/cycles unchanged;
  only new sets/blocks inherit it.
- Global hint default with all levels unchecked: valid ("hints off").
- Old `/puzzles/sets/:setId/cycles/:cycleNumber/results?x=1#y` redirects to the
  `/training/...` equivalent preserving query and hash.
- `/games/:id/puzzles` is never treated as an old section path.
- Nav test ids change (`nav-puzzles`/`nav-dashboard` → `nav-training`/
  `nav-statistics`); tests must not assert the old ids.

## Accessibility requirements

- **Header:** first focusable element is the "Skip to main content" link
  (visible on focus, targets `#main-content`); the header reveals on
  `:focus-within`; hiding is transform-based and never removes controls from the
  focus order or the accessibility tree; `prefers-reduced-motion: reduce`
  disables the animation; the header never traps focus; when hidden it does not
  overlay content.
- **Navigation:** text labels; active state conveyed by `aria-current` plus a
  visual style, never colour alone; the nav keeps `aria-label="Primary"`.
- **Library selection bar:** every action is a real labelled control
  (keyboard/touch, never hover-only); the selection count is text
  (`Clear selection (N)`); the delete confirmation is accessible and names the
  consequence.
- **Pagination:** the count label is text with `aria-live="polite"`; Previous/
  Next are labelled and disabled at the ends; rows-per-page is a labelled
  control; no information is colour-only.
- **Settings:** hint checkboxes/select and target inputs have labels and
  associated help (`aria-describedby`); help text is available to screen
  readers, not tooltip-only.
- **Statistics partition selector:** labelled, keyboard/touch operable; the
  default is not conveyed by colour; the mixed-view note is text.
- **Theme/contrast:** off-white page, white cards and text/controls meet WCAG AA
  in both themes; focus rings remain visible.

## Responsive / mobile requirements

- **Header:** the same hide/reveal behavior on touch with a larger reveal
  threshold; full-width, safe-area aware; the nav remains horizontally
  scrollable; a tap near the top or an upward scroll reveals it; it stays
  visible while a header menu/dialog is open.
- **Library selection bar:** wraps below the count on narrow viewports; actions
  stay reachable without hover or horizontal scrolling; icon buttons keep
  accessible names.
- **Pagination:** the count label, rows-per-page and pager wrap cleanly; touch
  targets ≥ ~44px; no horizontal page scroll.
- **Settings:** rows stack; hint controls and help text remain readable and
  touch-operable.
- **Statistics:** the partition selector works on touch and renders one
  partition at a time on mobile; the most-games default still applies.
- No layout regressions from the off-white canvas on any breakpoint.

## Performance constraints

- **No engine, no network.** All changes are presentation, routing and settings
  reads.
- **Header:** one passive scroll listener throttled with
  `requestAnimationFrame`; the handler reads `scrollY` only; no long task and no
  layout thrash.
- **Library:** the `shown`/`total` computation is O(1); the selection bar adds
  no query. Bulk actions reuse the existing analysis/delete services.
- **Settings:** one settings read/write; no query.
- **Statistics:** the default partition is computed from the already-loaded
  `gameMetrics` partitions (O(partitions)); no extra read; URL writes use
  `replace`.
- **Redirects:** client-side only; no network round-trip.
- No new dependency; the bundle impact is limited to the renamed/edited
  components.

## Acceptance criteria

1. The light theme renders an off-white page (`--color-bg: #f6f8fa`) with white
   cards (`--color-surface: #ffffff`); the dark theme is unchanged; both meet
   WCAG AA.
2. The nav shows **Home, Games, Training, Statistics, Analysis, Settings** in
   that order; "Training" and "Statistics" replace "Puzzles" and "Dashboard".
3. Section routes are `/training` (with `/training/new`, `/training/mastered`,
   `/training/sets/...`) and `/statistics`; `ROUTES` keys/helpers are renamed;
   `DashboardPage` is `StatisticsPage` with `<h1>Statistics</h1>`.
4. `/puzzles`, `/puzzles/*` and `/dashboard` redirect to the new paths
   preserving query/hash; `/games/:id/puzzles` is unaffected; no redirect loop.
5. The header hides on scroll-down, reveals on scroll-up, is always visible near
   the top, reveals on keyboard focus, respects reduced motion, and behaves the
   same on mobile without trapping focus; a skip-to-content link exists.
6. The Game Library selection bar shows Analyze / Re-analyze / Delete next to
   `Clear selection (N)`; the filter row has no bulk actions; no standalone
   "Selected: N" text; selection semantics and `Select all` scope are unchanged.
7. The count label reads `Showing {shown} of {total} games` from the rendered
   page window (e.g. "Showing 50 of 77 games") and is reconciled with
   `Page X of Y`; `totalStored` is never the label denominator.
8. Settings exposes a global **default hint configuration** stored at
   `SETTINGS_KEYS.defaultHintConfig`, with Level 1–4 help and the informational
   target note; new sets/blocks inherit it (falling back to
   `DEFAULT_CYCLE_CONFIG.hints`); existing sets/cycles are unaffected; the stale
   Feature-012 "Hint behaviour" placeholder is removed.
9. The Statistics page defaults to the concrete partition with the most games
   (deterministic tie-break), persists the choice in the `partition` URL param,
   preserves an explicit `all`, and falls back safely on a stale/invalid param.
10. No ADR, schema change, table/column/index, or dependency is introduced.
11. All changes are covered by automated tests (below) and the full gate passes.

## Testing requirements

### Focused tests first

- **Theme:** assert the light token values (`--color-bg` `#f6f8fa`,
  `--color-surface` `#ffffff`) and that the dark block is unchanged; a render
  smoke test for page vs card backgrounds.
- **Nav/routes:** `NAV_ITEMS` order and labels; every `ROUTES` key/path;
  `AppShell` renders `nav-training`/`nav-statistics` and the expected labels;
  `StatisticsPage` renders `<h1>Statistics</h1>`.
- **Redirects:** `/puzzles` → `/training`; nested `/puzzles/sets/x` →
  `/training/sets/x` preserving query/hash; `/dashboard` → `/statistics`;
  `/games/:id/puzzles` renders the puzzle page (no redirect); no self-redirect.
- **Header:** visible at the top; hidden after a down-scroll beyond the
  threshold; revealed on an up-scroll; revealed on focus; reduced-motion
  instant; skip link present and targets `#main-content`.
- **Library selection bar:** with 0 selected only `Select all`; with N selected
  Analyze/Re-analyze/Delete + `Clear selection (N)`; no "Selected:" text; filter
  row has no bulk actions; disabled states; delete confirmation.
- **Pagination:** `shown`/`total`/`page` math for `50/77` (both pages),
  `1/1` singular, `total <= pageSize`, last page, `total = 0` (label omitted),
  page clamp after filtering; pager copy consistent; `Select all` selects all
  matched rows.
- **Settings:** key/value round-trip and fallback; the settings row controls and
  help text; new custom set and new block inherit the stored hints (and fall
  back when unset); existing set/cycle configs are untouched; the
  "Hint behaviour" placeholder is gone; `CycleConfigForm` help text present.
- **Statistics partition:** default = most games; tie-break determinism; URL
  param written/restored; explicit `all` preserved; stale/invalid param
  fallback; coexists with `set` and filters; `combined` never chosen by default.

### Accessibility / responsive

- Keyboard reachability of the skip link, nav, selection bar, pagination and
  partition selector; focus reveal of the header; `aria-live` count label;
  labelled help text; `prefers-reduced-motion`.
- Mobile/tablet render tests for the wrapped selection bar, pagination and
  settings rows; Playwright where Chromium is available.

### Deterministic fixtures

- Reuse existing Game Library, training-set and Feature-014 statistics fixtures;
  add partition fixtures with a clear most-games winner and a tie, and a
  `HintConfig` fixture (valid, invalid, unset).

### Narrow-first order

Run the focused component/selector tests above first, then the full gate
(`npm run lint`, `typecheck`, `format:check`, `test`, `build`, `dev`,
`test:browser` when Chromium is available, `npm audit`) per `AGENTS.md`.

## Dependencies

- Feature 001 — shell, theme/settings repository.
- Feature 007 — Game Library toolbar/results/selection surface.
- Feature 008 — Library bulk/per-row analysis actions and status.
- Feature 013 — training routes, set/block creation and `CycleConfig` seeding.
- Feature 014 — statistics partitions consumed by the page.
- Feature 015 — the page being renamed/defaulted.
- No new dependency; no ADR; no schema change.

## Conflicts, ambiguities & ADR assessment

### Conflicts with existing specs

1. **Feature 013 uses `/puzzles` as the nav entry and route** for the training
   home, set detail, cycle session and the mastered list. W1 renames the section
   route to `/training`; the old paths redirect at runtime, but Feature 013's
   prose still names `/puzzles`. W1 supersedes those route references; a
   follow-up Feature 013 doc edit is recommended (not part of this spec).
2. **Feature 015 is titled "Dashboard" and uses `/dashboard`** for the page and
   nav. W1 renames the user-facing section to "Statistics" and the route to
   `/statistics`, and renames `DashboardPage` → `StatisticsPage`. The feature
   spec may keep "Dashboard" as the internal feature name, but its route/nav/h1
   references are superseded and should be updated in a follow-up.
3. **Feature 015 §1** fixes the default as "a single concrete partition" but
   does not say which; the code picks the first. W1 refines this to "the concrete
   partition with the most games". This is a refinement, not a contradiction.

### Ambiguities resolved with a recommended default

1. **Light `--color-bg-elevated` collision.** `--color-bg-elevated` is already
   `#f6f8fa`, equal to the new page colour. Recommended: leave
   `--color-bg-elevated` as-is and switch the AppShell header to
   `--color-surface` (white) so the bar stays distinct. Confirm if the header
   should instead keep `--color-bg-elevated` and the page use a different
   off-white.
2. **Global hint default scope.** Item 7 says "default hint configuration"
   seeded from `DEFAULT_CYCLE_CONFIG`. Recommended: store only `HintConfig`
   (levels + first level); all other `CycleConfig` fields keep seeding from
   `DEFAULT_CYCLE_CONFIG`/the block preset. Confirm if the whole `CycleConfig`
   should be globally configurable instead.
3. **Selection bar location.** The owner says "selection bar next to Clear
   selection". Recommended: the existing results-row control area is the
   selection bar (count left; `Select all` or actions + `Clear selection (N)`
   right). Confirm if a distinct new bar is intended.
4. **Pager total.** Recommended: `Page X of Y` only, with the matched total
   shown once in the "Showing" label, to avoid two totals. Confirm if the pager
   should also show `· {total} games`.
5. **Header threshold.** Recommended `scrollY <= headerHeight` as "near the
   top"; the exact pixel threshold is an implementation detail.
6. **`MasteredPuzzlesPage` name.** Kept (it names the domain artifact); only its
   route moves under `/training`. Confirm.
7. **Redirect depth.** Recommended: `/puzzles/*` (all nested paths) redirect,
   preserving query/hash, while `/games/:id/puzzles` is untouched. Confirm.

### ADR assessment

**No new ADR is required.** Every item is a presentation, routing, shell or
settings-default decision:

- Theme tokens, nav labels/order, header behavior, selection-bar layout and
  pagination copy are UI decisions (PRODUCT §14 leaves the exact themes to
  implementation).
- The global hint default is an ordinary settings value in the existing
  settings store; `CycleConfig`/`HintConfig` semantics and `configVersion` are
  unchanged, and no scheduler is introduced (ADR-031 untouched).
- The partition default uses the existing Feature-014 results and the existing
  URL-serialization convention; no statistics are computed in the UI
  (ADR-010/Feature 014 boundary intact).
- No dependency changes (ADR-002/014 chessboard and the Dependency policy are
  untouched); no persistence/schema change (ADR-001/ARCHITECTURE §7).

If the owner later decides the global hint default is a training-semantics
change (rather than a default value), that is a versioned spec change, not an
ADR.

## Context

Required reading (paths only; see `.opencode/CONTEXT-MAP.md`):

- `AGENTS.md`
- `.opencode/DECISIONS.md`
- `.opencode/specs/PRODUCT.md` (§10 hints, §14 themes)
- `.opencode/specs/ARCHITECTURE.md` (§3 layers, §7 storage)
- `.opencode/specs/features/007-game-import.md`
- `.opencode/specs/features/008-game-analysis.md`
- `.opencode/specs/features/013-tactical-training-cycles.md`
- `.opencode/specs/features/014-game-history-statistics.md`
- `.opencode/specs/features/015-dashboard.md`
- `.opencode/specs/domain/game-library.md`
- `.opencode/specs/decisions/ADR-009-testing-stack.md`
- `.opencode/specs/decisions/ADR-010-charting-library.md`
- `.opencode/specs/decisions/ADR-013-time-control-categories.md`
- `.opencode/specs/decisions/ADR-031-tactical-training-cycles.md`
