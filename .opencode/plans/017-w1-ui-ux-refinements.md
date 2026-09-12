# Plan 017 — W1 UI/UX Refinements

> Source of truth: `.opencode/specs/features/017-w1-ui-ux-refinements.md` (frozen).
> This plan implements the eight owner-approved items in that spec. It adds no
> domain rule, no persisted table, no schema bump and no dependency. Plan-only:
> no application code, tests or commits are produced by authoring this file.

## 1. Objective

Ship the W1 UI/UX refinements so the V1 surface is coherent, honest and
discoverable:

1. Distinct light theme (off-white page, white cards), dark unchanged.
2. Rename **Puzzles → Training** and **Dashboard → Statistics**, including nav
   labels, page `<h1>`s, route paths, `ROUTES` keys/helpers, the
   `DashboardPage` → `StatisticsPage` file/component rename, with
   backwards-compatible redirects; per-game `/games/:id/puzzles` kept.
3. Nav order **Home, Games, Training, Statistics, Analysis, Settings**.
4. Header hides on scroll-down, reveals on scroll-up, always visible near the
   top, accessible and mobile-safe, plus a skip-to-content link.
5. Game Library bulk actions moved from the filter row into the results-row
   selection bar; standalone `Selected: N` removed.
6. Pagination label `Showing {shown} of {total} games` derived from the
   rendered page window.
7. Settings global default hint configuration at
   `SETTINGS_KEYS.defaultHintConfig = 'training.hints'`, hint/target help copy,
   removal of the stale Feature-012 placeholder; new sets/blocks inherit it.
8. Statistics defaults to the concrete partition with the most games and
   persists it in a `partition` URL param.

## 2. Scope

In scope: exactly the eight items above, their tests, and the reference sweep
the renames force. Out of scope: chess/analysis/classification/puzzle/cycle/
statistics/mastery semantics; any new ADR, IndexedDB schema/table/column/index;
any new dependency; renaming puzzle domain entities, the per-game
`/games/:id/puzzles` route or `GamePuzzlesPage`; redesigning Library row cards,
filters, charts or training surfaces beyond items 5–6.

## 3. Existing code to reuse

| Area                    | Reuse anchor                                                                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Theme tokens            | `src/styles/tokens.css:1-6` (light), `:35-39` (dark); `src/styles/global.css:4-8`                                                   |
| Shell header            | `src/components/layout/AppShell.tsx:11-22`; `src/components/layout/AppShell.module.css:7-18`                                         |
| Nav                     | `src/components/layout/Navigation.tsx:9-26` (testid derived from label)                                                              |
| Routes                  | `src/app/routes.ts:3-17`, `:21-36`, `:45-52`; `src/app/router.tsx:56-121`                                                            |
| Library selection       | `src/components/games/library/GameLibraryToolbar.tsx:243-270`; `GameLibrary.tsx:590-605`, `:698-709`, `:1823-1879`; `useGameLibrary.ts:257-262` |
| Pagination math         | `src/components/games/library/GameLibrary.tsx:75-79`                                                                                 |
| Settings pattern        | `src/hooks/usePuzzleTimerSetting.ts:18-43`; `src/infrastructure/db/settings-repository.ts:3-31`                                      |
| Hint domain             | `src/domain/training/cycleTypes.ts:43-48`, `:189-198`; `src/domain/training/cycle.ts:295-347`, `:365-384`                            |
| Set/block seeding       | `src/infrastructure/training/training-sets-service.ts:452-478`, `:505-537`; `src/pages/SetEditorPage.tsx:86-97`, `:115-117`          |
| Cycle config UI         | `src/components/puzzles/cycles/CycleConfigForm.tsx:114-151`, `:170-194`                                                              |
| Statistics partitions   | `src/presentation/dashboard/selection.ts:54-91`; `src/hooks/useDashboard.ts:154-169`, `:230-294`; `src/components/dashboard/DashboardGameSection.tsx:239-298` |
| Partition count         | `src/domain/statistics/compute.ts:85-91`; `src/domain/statistics/gameMetrics.ts:75-76`                                               |
| Testing conventions     | ADR-009; `src/test/test-utils.tsx:12-27`; `vitest.config.ts:11-15`                                                                    |

## 4. Files/modules to create or modify

### New files

- `src/styles/tokens.test.ts` — token-value regression guard.
- `src/app/redirects.tsx` — `LegacySectionRedirect` + `legacyRedirectRoutes`.
- `src/app/routes.test.tsx` — `NAV_ITEMS`, `ROUTES` keys/paths, redirect tests.
- `src/components/layout/useHeaderVisibility.ts` — rAF-throttled scroll hook.
- `src/components/games/library/pagination.ts` — pure `pageWindow`/label math.
- `src/components/games/library/pagination.test.ts`.
- `src/hooks/useDefaultHintConfig.ts` — read/write/validate `training.hints`.
- `src/hooks/useDefaultHintConfig.test.ts`.

### Renamed files

- `src/pages/DashboardPage.tsx` → `src/pages/StatisticsPage.tsx`
  (component `DashboardPage` → `StatisticsPage`, props type renamed).
- `src/pages/DashboardPage.module.css` → `src/pages/StatisticsPage.module.css`.
- `src/pages/DashboardPage.test.tsx` → `src/pages/StatisticsPage.test.tsx`.

### Modified files (non-test)

- `src/styles/tokens.css` (light `--color-bg`), `src/components/layout/AppShell.module.css`
  (header `--color-surface`), inset CSS re-check:
  `SetEditorPage.module.css:57`, `TrainingHomePage.module.css:185`,
  `SetDetailPage.module.css:127`, `ThemePicker.module.css:33`,
  `MembershipList.module.css:21`, `CycleConfigForm.module.css:30`.
- `src/app/routes.ts`, `src/app/router.tsx`.
- `src/pages/{TrainingHomePage,SetEditorPage,SetDetailPage,CycleSessionPage,CycleResultsPage,GamePuzzlesPage,MasteredPuzzlesPage}.tsx`.
- `src/components/dashboard/DashboardStates.tsx:70` (`/puzzles` link → `/training`,
  label "Go to Training").
- `src/components/layout/AppShell.tsx` + `AppShell.module.css` (skip link, hide/reveal).
- `src/components/games/library/GameLibraryToolbar.tsx` (+ `.module.css`) and
  `src/components/games/library/GameLibrary.tsx` (+ `.module.css`).
- `src/config/app-config.ts` (`SETTINGS_KEYS.defaultHintConfig`).
- `src/pages/SettingsPage.tsx` (+ `.module.css`), `src/components/puzzles/cycles/CycleConfigForm.tsx` (+ `.module.css`).
- `src/domain/training/cycle.ts` + `src/domain/training/index.ts` (export hint validation).
- `src/infrastructure/training/training-sets-service.ts`.
- `src/presentation/dashboard/selection.ts`, `src/hooks/useDashboard.ts`,
  `src/components/dashboard/DashboardGameSection.tsx`, `src/pages/StatisticsPage.tsx`.

### Modified tests

- `src/components/layout/AppShell.test.tsx`, `Navigation.test.tsx` (order/labels).
- `src/pages/{GamesPage,CycleResultsPage,CycleSessionPage,SetDetailPage,SetEditorPage,TrainingHomePage,MasteredPuzzlesPage,GamePuzzlesPage}.test.tsx`.
- `src/components/puzzles/cycles/{SetCard,CycleConfigForm}.test.tsx`.
- `src/components/dashboard/{DashboardStates,DashboardGameSection}.test.tsx`.
- `src/presentation/dashboard/{selection,noDomainMath}.test.ts`.
- `src/hooks/useDashboard.test.ts`.
- `src/infrastructure/training/training-sets-service.test.ts`.
- `tests/e2e/013-tactical-training-cycles.spec.ts`,
  `tests/e2e/013-woodpecker-block.spec.ts`, `tests/e2e/015-dashboard.spec.ts`.

## 5. Domain/data changes

- **No domain rule change.** `CycleConfig`/`HintConfig` semantics and
  `configVersion` are unchanged; only the initial `hints` values differ.
- **No schema change.** `PERSISTENCE_SCHEMA_VERSION` stays `10`. The hint
  default is an ordinary row in the existing `settings` table.
- **New settings value:** key `training.hints`, value `HintConfig`
  (`{ enabledLevels: readonly HintLevel[]; firstHintLevel: HintLevel }`).
  Fallback `DEFAULT_CYCLE_CONFIG.hints` = `{ enabledLevels: [1,2,3,4],
  firstHintLevel: 2 }` (`cycleTypes.ts:189-198`).
- **Validation:** reuse the hint rules of `validateCycleConfig`
  (`cycle.ts:365-384`). Recommended default (see Ambiguities A7.1): export the
  existing private `validateHintConfig` as a public function from `cycle.ts`
  and the `@/domain/training` barrel; the settings hook calls it and falls back
  on `ok: false`. An empty `enabledLevels` is valid ("hints off").
- **URL param:** add `partition` (`all` | `{platform}:{timeControl}`) on the
  Statistics page. Existing `platform`/`timeControl`/`timeFrame`/`set` params
  are unchanged.
- **No migration.** Route/page renames and the partition param are code-only.

## 6. UI changes

### 6.1 Light theme (item 1)

- `tokens.css`: light block `--color-bg: #ffffff` → `#f6f8fa`; leave
  `--color-surface: #ffffff`, `--color-bg-elevated: #f6f8fa` and the whole dark
  block unchanged.
- `global.css` already paints `html, body` with `--color-bg`; `#root` and
  `main` do not paint a surface, so the canvas becomes off-white with no
  per-page work.
- `AppShell.module.css:15`: header `background: var(--color-bg-elevated)` →
  `var(--color-surface)` so the white bar stays distinct from the off-white
  page (spec's recommended resolution of the `--color-bg-elevated` collision).
- Re-check the six `var(--color-bg)` inset fills (listed in §4) so an inset
  never becomes indistinguishable; switch to `--color-bg-elevated` /
  `--color-bg-sunken` only where contrast fails (verification, not a blanket
  change).

### 6.2 Section rename, routes, page files (item 2)

**`ROUTES` (`routes.ts:3-17`)**

| Old key                 | New key                 | New path                                                   |
| ----------------------- | ----------------------- | ---------------------------------------------------------- |
| `puzzles`               | `training`              | `/training`                                                |
| `puzzlesNew`            | `trainingNew`           | `/training/new`                                            |
| `puzzlesMastered`       | `trainingMastered`      | `/training/mastered`                                       |
| `puzzlesSet`            | `trainingSet`           | `/training/sets/:setId`                                    |
| `puzzlesCycle`          | `trainingCycle`         | `/training/sets/:setId/cycles/:cycleNumber`                |
| `puzzlesCycleResults`   | `trainingCycleResults`  | `/training/sets/:setId/cycles/:cycleNumber/results`        |
| `dashboard`             | `statistics`            | `/statistics`                                              |

Helpers `puzzlesSetPath`/`puzzlesCyclePath`/`puzzlesCycleResultsPath`
(`routes.ts:21-36`) → `trainingSetPath`/`trainingCyclePath`/
`trainingCycleResultsPath`. Keep `QUICK_TRAIN_SET_ID` and all puzzle/cycle
domain identifiers. `analysisLive`/`playground` unchanged.

**`NAV_ITEMS` (`routes.ts:45-52`)** becomes, in order: Home, Games, Training
(`ROUTES.training`), Statistics (`ROUTES.statistics`), Analysis
(`ROUTES.analysisLive`, keeps `ANALYSIS_GLYPH`), Settings. `Navigation.tsx:17`
derives testids from the label, so `nav-puzzles`/`nav-dashboard` become
`nav-training`/`nav-statistics` automatically.

**`router.tsx`**

- Lazy `DashboardPage` (`:50-52`) → `StatisticsPage` importing
  `@/pages/StatisticsPage`.
- Section children `puzzles*` (`:88-100`) → `training*`; `dashboard` (`:101-108`)
  → `statistics`.
- Keep `games/:id/puzzles` (`:71-78`) exactly as is.
- Extract the route array into an exported `appRoutes: RouteObject[]` and keep
  `export const router = createBrowserRouter(appRoutes)` so tests can build a
  `createMemoryRouter(appRoutes, …)`.

**Redirects (`src/app/redirects.tsx`, new).** A `LegacySectionRedirect`
component reads `useLocation()`, maps the leading prefix (`/puzzles` →
`/training`, `/dashboard` → `/statistics`), preserves `location.search` and
`location.hash`, and renders `<Navigate to={{ pathname, search, hash }}
replace />`. Register explicit sibling redirect routes inside the shell
children so React Router's route ranking keeps them below the real
`training/*` routes:

- `puzzles`, `puzzles/new`, `puzzles/mastered`, `puzzles/sets/:setId`,
  `puzzles/sets/:setId/cycles/:cycleNumber`,
  `puzzles/sets/:setId/cycles/:cycleNumber/results` → prefix-mapped to
  `/training/...` preserving query/hash.
- `dashboard` → `/statistics` preserving query/hash.
- `puzzles/*` catch-all → `<Navigate to="/training" replace />` (unknown suffix
  falls back to `/training` rather than 404; explicit routes win by ranking).
- No redirect route for `training`/`statistics` (no self-redirect), and no
  redirect route may match `games/:id/puzzles`.

**Page/component files.** Rename `DashboardPage.tsx` →
`StatisticsPage.tsx`, `DashboardPage.module.css` → `StatisticsPage.module.css`,
`DashboardPage.test.tsx` → `StatisticsPage.test.tsx`; component and props type
`DashboardPage`/`DashboardPageProps` → `StatisticsPage`/`StatisticsPageProps`;
`<h1>` `Dashboard` → `Statistics`; root testid `dashboard-page` →
`statistics-page`; the `dashboard-live` status copy becomes
"Loading statistics…"/"Statistics loaded." (already truthful). Other
`dashboard-*` testids (`dashboard-game-section`, `dashboard-filter-bar`,
`dashboard-partition`, `dashboard-training-section`, …) stay. Keep
`TrainingHomePage` (already section-named) and `MasteredPuzzlesPage`.

**Reference sweep.** Update every `ROUTES.puzzles*`/`ROUTES.dashboard` key,
helper call, literal old path, back-link and comment in the pages listed in §4,
plus `DashboardStates.tsx:70`. Tests change:
`AppShell.test.tsx:23` label list and testids; every page test that mounts the
old route literals (`CycleSessionPage.test.tsx:119-194,281-287`,
`SetDetailPage.test.tsx:50-57`, `MasteredPuzzlesPage.test.tsx:39-58`,
`GamePuzzlesPage.test.tsx:103-106,493`, `TrainingHomePage.test.tsx`,
`SetEditorPage.test.tsx`, `CycleResultsPage.test.tsx`, `SetCard.test.tsx`) and
the e2e specs.

### 6.3 Header behavior (item 4)

- New `useHeaderVisibility` hook: one **passive** scroll listener throttled by
  `requestAnimationFrame`, reading only `window.scrollY`; no layout reads in
  the handler. Header height is measured once on mount and on resize (via
  `ResizeObserver`/`getBoundingClientRect`) and stored in a ref.
- Contract: `hidden = scrollY > threshold && direction === 'down'`; visible when
  `scrollY <= threshold`; reveal on up-scroll; reveal on `:focus-within`; stay
  visible while a header menu/dialog is open (tracked by a boolean prop/state
  on `AppShell`). Mobile uses a larger threshold (recommended `headerHeight +
  24`).
- `AppShell.module.css`: replace `position: sticky; top: 0` with a fixed/static
  header that uses `transform: translateY(-100%)` when hidden, `pointer-events:
  none` only while fully hidden, `transition: transform var(--duration-base)
  var(--easing-standard)`, and a `@media (prefers-reduced-motion: reduce)`
  override that disables the transition. Hiding is transform-based; the header
  stays in the accessibility tree and focus order. Safe-area insets preserved.
- Skip link: first focusable element in `AppShell`, visually hidden until
  focused, `href="#main-content"`, recommended testid `skip-to-content`.
- No `window`/scroll API (tests/SSR): default visible and the listener is a
  no-op.

### 6.4 Library selection bar + pagination (items 5–6)

- `GameLibraryToolbar` loses `selectedCount`, `analysisEnabled`, `canReanalyze`,
  `onAnalyze`, `onReanalyze`, `onDelete` and the whole selection cluster
  (`:43-58`, `:243-270`). The filter row keeps filters, Clear filters and
  Import only.
- `GameLibrary` results row (`:590-605`) becomes the selection bar:
  - left: the count label (item 6), `aria-live="polite"`;
  - right (`data-testid="library-selection-bar"`): when `selectedCount === 0`,
    a `Select all` control (`data-testid="library-select-all"`); when
    `selectedCount > 0`, Analyze (`library-analyze`), Re-analyze
    (`library-reanalyze`), Delete (`library-delete`) and `Clear selection (N)`
    (recommended `data-testid="library-clear-selection"`).
  - No standalone `Selected: N` text anywhere.
- Enabled rules unchanged: Analyze enabled per existing rule, Re-analyze only
  when ≥1 selected game is `completed`/`outdated`, Delete opens the existing
  confirmation dialog naming the count. `Select all` still selects the whole
  matched set; selection is still cleared on filter/search change and delete.
- Mobile: the results row wraps under the count; actions are non-hover and need
  no horizontal scroll.
- Pagination: add pure `src/components/games/library/pagination.ts` with
  `totalPages(total, pageSize)`, `pageWindow(total, page, pageSize)` and
  `showingLabel(shown, total)` (`"game"` when `total === 1`). `GameLibrary`
  computes `shown = max(0, min(pageSize, total - (page - 1) * pageSize))` and
  renders `Showing {shown} of {total} games` in `library-count`; the pager
  (`library-page-status`) reads `Page {page} of {totalPages}` only
  (recommended default, Ambiguities A6.1). `totalStored` drives only the
  "No games have been imported" empty state and is never the label
  denominator. When `total === 0` the label and selection bar are not rendered.
  Page resets to 1 on filter/search/pageSize change and is clamped via the
  existing `currentPage = min(page, totalPages)`.

### 6.5 Settings hints + help (item 7)

- `SETTINGS_KEYS.defaultHintConfig = 'training.hints'` in `app-config.ts`.
- New `useDefaultHintConfig` hook (mirrors `usePuzzleTimerSetting`): reads the
  stored value, validates/normalizes via the exported hint validation, falls
  back to `DEFAULT_CYCLE_CONFIG.hints`, exposes `{ hints, isReady, save }`,
  immediate save on change, inline error on failure.
- `SettingsPage`: new row `settings-row-hints`, title **"Puzzle hints"**, with
  Level 1–4 checkboxes (`setting-hint-level-1..4`), a **First hint level**
  select (`setting-first-hint-level`) and help text associated via
  `aria-describedby` (recommended testid `setting-hints-help`). Help copy:
  Level 1 relevant piece (text only), Level 2 piece square highlight, Level 3
  destination square, Level 4 full first move in SAN; hints never fail a puzzle
  and never count as a wrong move; the reveal starts at the first level and
  ascends, skipping disabled levels, capped at Level 4. A target note
  (`setting-targets-help`) states target accuracy/solving time are
  informational only, never gates.
- Remove the `Hint behaviour — Coming in Feature 012` entry from
  `SETTINGS_PLACEHOLDERS` (`SettingsPage.tsx:45-56`); keep the Synchronization
  placeholder.
- `CycleConfigForm`: add the Level 1–4 legend next to "Hint levels available"
  (`:170-194`, recommended testid `cycle-config-hints-help`) and the
  "informational target, never a gate" note next to Target accuracy / Target
  solving time (`:114-151`, recommended testid `cycle-config-targets-help`).
- Seeding: `training-sets-service.defaultConfigFor(ordering)` and
  `blockConfig()` (`:505-537`) take the resolved `HintConfig` (recommended:
  inject a `readDefaultHintConfig?: () => Promise<HintConfig>` service option
  that defaults to the settings repo + fallback; `persistNewSet` and
  `createWoodpeckerBlock` await it). All other fields keep the existing
  `DEFAULT_CYCLE_CONFIG`/block-preset values. `SetEditorPage` seeds its initial
  `config.hints` from the hook for **new** sets only; editing an existing set
  keeps the stored `set.config`. Existing sets/cycles are untouched.

### 6.6 Statistics default partition + persistence (item 8)

- `presentation/dashboard/selection.ts`: add
  `selectDefaultPartition(partitions)` and keep `partitionKey`. It considers
  only `combined === false` partitions whose platform is not `fixture`, picks
  the largest game count, and breaks ties by canonical platform order
  (Lichess, Chess.com, then other real sources), then ADR-013 time-control
  order, then partition key ascending. Returns `'all'` when no concrete
  partition qualifies. The game count is read from the Feature-014 partition
  (see Ambiguities A8.1). Define the platform rank locally in `selection.ts`
  (do **not** value-import `@/domain/statistics/query`, which the
  `noDomainMath.test.ts:22-40` guard forbids).
- `useDashboard`: read `searchParams.get('partition')`; expose `partition` and
  `selectPartition(value)`. Resolve the value once partitions are loaded:
  explicit valid concrete / explicit `all` is preserved; absent or
  invalid/stale falls back to `selectDefaultPartition(partitions)` and is
  written with `replace`. A helper builds params from filters + `set` +
  `partition` so filter/set writes never drop `partition` and vice versa.
  Selecting a partition writes `replace` and never drops the other params. A
  stale/`fixture`/combined-only value falls back safely and is rewritten; the
  read-failure path keeps `all`/the last valid value.
- `DashboardGameSection` becomes controlled: props `partition` and
  `onPartition` (remove the local `requestedPartition` `useState`); it still
  validates against the loaded options for rendering.
- `StatisticsPage` passes `dashboard.partition`/`dashboard.selectPartition`
  into the section. `dashboard-partition` testid stays. The mixed-view note is
  unchanged; a combined view is never the default.

## 7. Infrastructure changes

- No new dependency, no ADR, no schema change.
- `settingsRepository` (`settings-repository.ts:3-31`) is reused unchanged.
- `TrainingSetsService` gains an injectable default-hint reader (recommended
  option `readDefaultHintConfig`); production default reads
  `settingsRepository.get(SETTINGS_KEYS.defaultHintConfig)` and normalizes with
  the exported hint validation + `DEFAULT_CYCLE_CONFIG.hints` fallback. The
  service keeps its deterministic `now`/`newId` injection pattern.
- `router.tsx` exports `appRoutes` for `createMemoryRouter` in tests; no runtime
  behavior change.
- The header hook uses only `window` scroll/`requestAnimationFrame` and is a
  no-op without a window.

## 8. Tests

All tests deterministic: no engine, no network, no real user data; existing
Game Library, training-set and Feature-014 fixtures are reused. New fixtures:
a `HintConfig` fixture (valid/invalid/unset) and partition fixtures with a
clear most-games winner and a tie.

| Stage | New/updated tests                                                                                                                             |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `src/styles/tokens.test.ts` (light `#f6f8fa`/`#ffffff`, dark unchanged)                                                                        |
| 2     | `src/app/routes.test.tsx` (NAV order/labels, ROUTES keys/paths, redirects preserving query/hash, `/games/:id/puzzles` unaffected, no self-redirect); `AppShell.test.tsx`; renamed `StatisticsPage.test.tsx`; route-literal updates in page/cycle tests; `noDomainMath.test.ts` PAGE_FILE |
| 3     | `AppShell.test.tsx` header visibility + skip link (jsdom env annotation for scroll; reduced-motion case)                                       |
| 4     | `pagination.test.ts` (`50/77` both pages, `1/1` singular, `total <= pageSize`, last page, `total = 0`, clamp); `GamesPage.test.tsx` selection-bar/count/pager copy |
| 5     | `useDefaultHintConfig.test.ts`; `SettingsPage.test.tsx` (row/controls/help, placeholder gone); `CycleConfigForm.test.tsx` (legend/target note); `training-sets-service.test.ts` (new set/block inherit, unset fallback, existing untouched); `SetEditorPage.test.tsx` (new-set seed) |
| 6     | `selection.test.ts` (most games, tie-break, `all` fallback, fixture/combined excluded); `useDashboard.test.ts` (URL write/restore, explicit `all`, stale fallback, coexists with `set`/filters); `DashboardGameSection.test.tsx` (controlled; default changes from `summary-lichess-bullet` to the most-games partition); `StatisticsPage.test.tsx` |
| 7     | e2e route literals in `tests/e2e/013-*.spec.ts`, `tests/e2e/015-dashboard.spec.ts` (h1 "Statistics")                                           |

Note: the rich dashboard fixture has 12 `lichess:rapid`, 4 `chesscom:blitz`
and 2 `lichess:bullet` games, so the most-games default is `lichess:rapid`
(not the current first partition `lichess:bullet`). Update
`DashboardGameSection.test.tsx:34-46` accordingly.

### Staged sequence (narrow verification per stage)

| Stage | Work                                                             | Narrow verification                                                                                                             |
| ----- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Light theme tokens + header surface + inset re-check             | `npx vitest run src/styles/tokens.test.ts`                                                                                      |
| 2     | Routes/keys/helpers, redirects, page rename, nav order, sweep    | `npx vitest run src/app/routes.test.tsx src/components/layout/AppShell.test.tsx src/pages/StatisticsPage.test.tsx`               |
| 3     | Header hide/reveal + skip link                                   | `npx vitest run src/components/layout/AppShell.test.tsx`                                                                        |
| 4     | Library selection bar + pagination label                         | `npx vitest run src/components/games/library/pagination.test.ts src/pages/GamesPage.test.tsx`                                    |
| 5     | Settings hints/help/placeholder + set/block seeding              | `npx vitest run src/hooks/useDefaultHintConfig.test.ts src/pages/SettingsPage.test.tsx src/components/puzzles/cycles/CycleConfigForm.test.tsx src/infrastructure/training/training-sets-service.test.ts` |
| 6     | Statistics partition default + URL persistence                   | `npx vitest run src/presentation/dashboard/selection.test.ts src/hooks/useDashboard.test.ts src/components/dashboard/DashboardGameSection.test.tsx` |
| 7     | E2E route updates                                                | `npx playwright test tests/e2e/015-dashboard.spec.ts` (when Chromium is available)                                              |
| 8     | Full gate                                                         | `npm run lint && npm run typecheck && npm run format:check && npm run test && npm run build` then `npm run dev` smoke, `npm run test:browser`, `npm audit` |

Run stages 1–7 in order; stage 8 is the only full-gate run. Per `AGENTS.md`,
the full gate must pass with no warnings/errors; any unavoidable warning is
escalated before a workaround.

## 9. Migration considerations

- **No data migration.** `PERSISTENCE_SCHEMA_VERSION` stays `10`; no new table,
  column or index; no `CycleConfig.configVersion` bump.
- **Existing sets/cycles are immutable:** their stored `config` (and every
  cycle snapshot) is unchanged; the global hint default applies only to sets/
  blocks created after it changes. The user can still override hints per set.
- **URL compatibility:** old `/puzzles*` and `/dashboard` bookmarks redirect
  client-side preserving query/hash. The per-game `/games/:id/puzzles` route is
  never treated as a legacy section path.
- **Settings compatibility:** an unset/invalid `training.hints` row falls back
  to `DEFAULT_CYCLE_CONFIG.hints`; no user-facing error.
- **Theme compatibility:** dark values are untouched; only the light page
  canvas changes.

## 10. Risks

- **Rename blast radius:** `ROUTES` key/helper renames are compile-breaking
  until the whole sweep lands; keep stage 2 atomic and rely on `typecheck` to
  find stragglers.
- **Redirect ranking:** explicit legacy routes plus a `puzzles/*` catch-all
  must not shadow real `training/*` routes or `games/:id/puzzles`; covered by
  `routes.test.tsx`.
- **Header scroll in tests:** happy-dom scroll support is limited; use the
  on-demand `// @vitest-environment jsdom` per ADR-009 or a mocked
  `requestAnimationFrame`/`scrollY`, and keep the handler logic pure enough to
  test without layout.
- **Partition default churn:** moving partition state into `useDashboard` and
  making the section controlled changes existing component tests; ensure the
  default write uses `replace` and never loops the statistics read.
- **No-domain-math guard:** the new selector must not value-import
  `@/domain/statistics/query`; keep the platform/time-control rank local.
- **Contrast:** off-white page with white cards must still meet WCAG AA; verify
  focus rings and inset fills in both themes.
- **E2E drift:** three Playwright specs hard-code old routes; update them so
  `test:browser` stays green.

## 11. Ambiguities / spec gaps (resolved with recommended defaults)

- **A1.1 Light `--color-bg-elevated` collision.** Recommended: keep
  `--color-bg-elevated: #f6f8fa` and switch the header to `--color-surface`
  (spec's own recommendation). Confirm if the page should instead use a
  different off-white.
- **A2.1 Unknown legacy suffix.** Recommended: explicit legacy redirect routes
  plus a `puzzles/*` catch-all to `/training` so unknown suffixes do not 404
  (spec's error case). Confirm if `/training/<suffix>` → NotFound is preferred.
- **A4.1 Header threshold.** Recommended: measure header height once
  (mount + resize) and use `scrollY <= headerHeight`; mobile adds ~24px. Exact
  pixels are an implementation detail (spec allows).
- **A5.1 Selection-bar testids.** Recommended: keep `library-selection-bar` as
  the always-rendered right-side control area, keep `library-select-all` for the
  0-selected control, add `library-clear-selection` for `Clear selection (N)`.
  This changes `GamesPage.test.tsx:144-179,212-226`.
- **A6.1 Pager total.** Recommended: `Page X of Y` only; the matched total is
  shown once in the `Showing …` label (spec ambiguity #4). Confirm if the pager
  should append `· {total} games`.
- **A7.1 Hint validation export.** `validateHintConfig` is private
  (`cycle.ts:365`). Recommended: export it (and re-export from the training
  barrel) rather than synthesizing a full `CycleConfig` to validate a
  `HintConfig`. Confirm.
- **A7.2 Quick-train seeding.** `startQuickTrain` (`cycle-service.ts:242`) uses
  `DEFAULT_CYCLE_CONFIG` directly; the spec scopes the global default to new
  **sets/blocks** only. Recommended: leave quick-train on the hardcoded default
  and note a possible follow-up. Confirm.
- **A7.3 Service injection shape.** Recommended: `readDefaultHintConfig`
  injectable option on `TrainingSetsService`, defaulting to a settings-repo
  read + fallback. Confirm if the service should instead import the settings
  repo directly.
- **A8.1 Partition game count.** The spec says "`games.length`", but
  `GameMetricsPartition` (`compute.ts:85-91`) has no `games` array; the
  canonical count is `metrics.games.total` (`gameMetrics.ts:75-76`, equal to
  `entries.length`). Recommended: read `metrics.games.total` via a small
  `PartitionCandidate` shape (`platform`, `timeControl`, `combined`,
  `gameCount`) built in `DashboardGameSection`/`useDashboard`. Confirm if
  `entries.length` is preferred instead.

## 12. Acceptance criteria

Mapped 1:1 to the spec's Acceptance criteria:

1. Light theme off-white page + white cards, dark unchanged, both WCAG AA.
2. Nav shows Home, Games, Training, Statistics, Analysis, Settings in order.
3. Routes `/training*` and `/statistics`; `ROUTES` keys/helpers renamed;
   `StatisticsPage` with `<h1>Statistics</h1>`.
4. `/puzzles*` and `/dashboard` redirect preserving query/hash;
   `/games/:id/puzzles` unaffected; no loop.
5. Header hides/reveals with top/focus/reduced-motion/mobile behavior; skip
   link exists.
6. Selection bar holds Analyze/Re-analyze/Delete + `Clear selection (N)`; filter
   row has no bulk actions; no `Selected: N`; semantics and `Select all` scope
   unchanged.
7. `Showing {shown} of {total} games` from the page window; reconciled with
   `Page X of Y`; `totalStored` never the denominator.
8. Settings global default hint config with Level 1–4 help and the
   informational-target note; new sets/blocks inherit it (fallback
   `DEFAULT_CYCLE_CONFIG.hints`); existing sets/cycles unaffected; stale
   Feature-012 placeholder removed.
9. Statistics defaults to the most-games concrete partition (deterministic
   tie-break), persists `partition`, preserves explicit `all`, falls back
   safely.
10. No ADR, schema change, table/column/index or dependency.
11. All changes covered by automated tests and the full gate passes.

## 13. Verification commands

Narrow (per stage, in order):

```
npx vitest run src/styles/tokens.test.ts
npx vitest run src/app/routes.test.tsx src/components/layout/AppShell.test.tsx src/pages/StatisticsPage.test.tsx
npx vitest run src/components/layout/AppShell.test.tsx
npx vitest run src/components/games/library/pagination.test.ts src/pages/GamesPage.test.tsx
npx vitest run src/hooks/useDefaultHintConfig.test.ts src/pages/SettingsPage.test.tsx src/components/puzzles/cycles/CycleConfigForm.test.tsx src/infrastructure/training/training-sets-service.test.ts
npx vitest run src/presentation/dashboard/selection.test.ts src/hooks/useDashboard.test.ts src/components/dashboard/DashboardGameSection.test.tsx
npx playwright test tests/e2e/015-dashboard.spec.ts
```

Full gate (final stage; per `AGENTS.md` Execution policy):

```
npm run lint
npm run typecheck
npm run format:check
npm run test
npm run build
npm run dev            # smoke run, no browser-console errors
npm run test:browser   # when Chromium is available
npm audit
```

Formatting the plan file itself:

```
npx prettier --write .opencode/plans/017-w1-ui-ux-refinements.md
npx prettier --check .opencode/plans/017-w1-ui-ux-refinements.md
```

## 14. Notes on this plan

- This is a plan only: no application code, tests or commits were produced.
- Every recommended default above is flagged in §11 for owner confirmation
  before implementation where it changes observable behavior.
