# Plan — Game Library, Analysis & Review polish (queueing, analysis settings, Library UX, Review UI, detection trust)

Covers the bug/UX report spanning Feature 007 (Library), Feature 008
(Game Analysis/Review), Feature 009 (classification/accuracy tooling) and
Feature 010 (tactical detection surfacing). Also updates the Settings
surface (Feature 001/006 seam) with a dedicated **Game analysis**
configuration group.

Depends on shipped Features 001–010; nothing here adds a dependency.

---

## 0. Open product questions (resolve before implementing the gated parts)

These are the items where the request is ambiguous or technically
contradicts the current model. Recommended defaults are given so the rest
of the plan can proceed; the *gated* phases wait for confirmation.

### Q1 — What "analyze only the user's side" really saves (GATES WP-B scope + WP-E review re-analyze scope + the "Summary omits opponent" part)

**Finding (verified against `domain/analysis/plan.ts` + `build.ts`):**
`MoveAnalysis` for a move needs the engine evaluation **before** the move
(its own before-position) and **after** the move. The position after a
user's move is exactly the position **before the opponent's next move**
(the FENs deduplicate in `planGameAnalysis`), so the set of distinct
engine positions that must be searched is effectively **identical** for a
"both sides" and a "user's moves only" run (≈ every non-terminal
position; only the initial position when the user is Black is droppable).
WDL/classification per ADR-023/024 cannot be computed for the user's
moves without those opponent-turn positions.

Consequence: an option labelled "only analyze the user's side" **cannot
halve engine time** under the current analysis model. Real time levers
are the **profile / depth / per-position search time** (WP-B) and the
cache.

**Recommended default (to be confirmed):** implement `sideScope: 'both' |
'user'` as the **classification/reporting scope** of a run:

- `both` — current behavior: opponent plies are classified and counted;
  Review Summary shows both columns.
- `user` — opponent plies are still analyzed (engine positions unchanged,
  so Review navigation/evals stay complete and correct), but opponent
  moves are **not classified and not counted**: no opponent classification
  glyphs/summary column, statistics and per-analysis summaries report the
  user side only, and the Review Summary omits the opponent column.

If instead the user expects real engine-time savings, the alternative is
to *not* run a full profile analysis on every position at all and rely on
depth/time settings; recommend we do **not** change ADR-023/024 semantics
to "classify from before-position only".

### Q2 — Game-analysis engine options granularity (GATES WP-B identity/cache scope)

Options A (recommended): the Game-analysis settings group exposes
**profile** (`fast`/`normal`/`deep`, i.e. the ADR-012 presets), an
optional **depth override** and an optional **per-position max search
time**, plus **side scope**. The *resolved* values become part of the
analysis identity and of the ADR-018 cache key (the session-cache key
function `analysisCacheKey` already supports overrides; the job id and
ADR-018 doc text must be extended).

Option B: profile + scope only (no depth/time overrides) → identity and
cache stay profile-keyed (no ADR-018 doc change). Recommended only if Q2a
is answered "no overrides".

### Q3 — Accuracy decimal places

Recommended: display accuracy with **one decimal** everywhere it is shown
(Library row strip, Review Summary headline) via a single Feature-009
formatting helper; stored value stays the full float. Confirmed by the
request ("rounded number with one decimal point").

### Q4 — Review layout arrangement (GATES WP-E diagram/summary placement)

The Review board column has a fixed height matching the side panel
(board + two clock bars). Recommended arrangement:
`ReviewSummary` moves out of the header into a **bottom band** below the
`AnalysisBoard`: left cell = full-game evaluation diagram at exactly the
board-column width; right cell = the summary directly beneath the side
panel/move list ("next to the diagram"). Mobile: diagram under the board,
summary under the move list. This is the reading used below.

### Q5 — Summary row set

Recommended rows: **Best Move, Good, Inaccuracy, Mistake, Blunder,
Missed tactics** (missed-tactic row only when a detection pass completed
for the shown analysis; 0 is real then). Zero coloring per request:
inaccuracy/mistake/blunder/missed = green when 0 else the classification
color; best/good have no classification color when 0.

### Q6 — Per-row Delete

Recommended: icon in each row's action cluster opens the existing
confirmation dialog for that game.

---

## 0a. Amendments (post-planning review) — supersede conflicting text below

Confirmed with the product owner during planning review:

1. **Q1 (user-side scope) is dropped entirely.** "Analyze only the user's
   side" is **not implemented** — it cannot reduce engine time under the
   ADR-023/024 model, so it is not worth the complexity. All references to
   `sideScope` / `scope: 'user'` / "Re-analyze (only your side)" / "omit the
   Op column" in §§0/2/4/6/7/13/15 are **void**. Analysis always classifies
   both sides. Review offers a single **Re-analyze**; the Summary always
   shows Your/Op columns.
2. **Q2 = Option A (confirmed).** The Game-analysis settings group exposes
   **engine profile** (`fast`/`normal`/`deep`) **+ optional depth override +
   optional per-position search time** (no scope control). Resolved values
   are part of run identity, `outdated` derivation and the ADR-018 cache
   key.
3. **Q4 layout confirmed.** Evaluation diagram beneath the board at board
   width; Summary below the move-list panel beside the diagram (desktop) /
   stacked (mobile).
4. **New WP P9 (classification/accuracy calibration).** Added below after
   P7. Rationale recorded in `## P9`. It revises ADR-023/024 to Lichess's
   real published methodology (thresholds 0.10/0.20/0.30 winning-chance
   loss; Lichess `gameAccuracy`) and adds `eK9h9KP4` as a golden
   regression.

---

## 1. Objective

1. Analysis runs **queue instead of cancel**: starting analysis of another
   game (or a batch) while one is running enqueues the new request; a
   cancelled/partial run can never be presented as *analyzed/completed*.
2. A **Settings "Game analysis" group**: engine profile (+ optional depth
   / search-time), **side scope** (both / user), matching how Review
   re-analyze behaves; analysis identity/status reflect the configuration.
3. Library: **bulk re-analyze** of the selection; **icon row actions**
   (Analyze / Review / Re-analyze / Delete); 🔬 analysis glyph in the top
   nav and on row/review actions; **Lichess-style rows** (no column
   alignment, no table header); a **full-width per-row progress bar**;
   accuracy formatted with **one decimal**; **colored stats**; the row's
   insights appear **as soon as each game's analysis completes** without a
   manual refresh; per-row insights for previously-analyzed games are
   backfilled.
4. Review page: **re-analyze control** (both sides / user side); clearly
   different **inaccuracy vs mistake** colors; a **full-game evaluation
   diagram** beneath the board (same width, dark/light split, click to
   seek); **Summary moved below the move list** next to the diagram with
   colored counts and a prominent accuracy figure.
5. Make **missed-tactic detection verifiable**: fixture/e2e proof it
   surfaces, backfill summaries for old analyses, and no UI refresh needed
   to see it.
6. Update the relevant specs and add tests; commit in coherent phases.

## 2. Scope

### In scope
- Analysis queue/serialization (service + hooks), cancel semantics, and
  "completed ⇒ every required position analyzed" invariants/tests.
- New `SETTINGS_KEYS.analysisGame` group + Settings UI + wiring into
  Library bulk/per-row analysis and Review re-analysis; identity/status
  derivation over the run config; ADR-018/analysis-model doc alignment
  for overrides.
- `sideScope` classification/reporting scope (Q1 default) in plan/build/
  summaries/Review Summary; Library strip unchanged (already user-side).
- Library row redesign, per-row icon actions + Delete, row progress bar,
  🔬 glyph, bulk re-analyze, insights auto-refresh, summaries backfill.
- Accuracy display (1 decimal) helper + usage in Library/Review.
- Review bottom-band layout: evaluation diagram + relocated/colored
  Summary + re-analyze action; distinct classification colors.
- Missed-tactic verification path (e2e over a deterministic engineered
  game + wiring backfill) and any surfacing bug fixes found.
- Spec/ADR updates listed in §11; tests; commits.

### Out of scope
- Changing ADR-023/024 classification semantics (Q1 rejected alternative).
- A second engine provider (the Settings "Engine" select stays a
  Stockfish-only seam, mirroring `AVAILABLE_ENGINES`).
- True virtualization of the Library list.
- Feature 014 aggregate statistics/dashboard work.
- Tactical motif semantics.

## 3. Existing code to reuse

- Engine service/job queue (FIFO, cancellation, `go` depth/movetime
  overrides): `src/infrastructure/engine/engineService.ts`.
- Cache key already encoding overrides: `analysisCacheKey` in
  `src/infrastructure/engine/cache.ts`.
- Analysis orchestration: `src/infrastructure/analysis/analysisService.ts`
  (`analyzeGames`, per-game cancel, force re-analysis, detection hooks),
  `browser.ts` (singleton service).
- Hooks: `useGameAnalysis.ts` (busy/error/analyze/cancel),
  `useLibraryAnalysis.ts` (statuses, per-game progress, batch progress
  line), `useGameLibrary.ts` (filters/rows/reload/selection),
  `useGameReview.ts` (job/records/status reload),
  `useEngineDefaults.ts` + Settings `EngineDefaults` form as the pattern
  for a new settings group.
- Domain: `job.ts` (identity + transitions), `status.ts`
  (`analysisStatusOf`/`analysisLibraryStatus`/`isAnalysisObsolete`),
  `plan.ts`, `build.ts`, `summary.ts`/`summaryDerivation.ts`,
  `accuracy.ts` (float accuracy + sample size),
  `domain/gameLibrary/rowView.ts` (insights/capabilities),
  `infrastructure/db/analysis-result-query.ts` (job+summary → row
  insights), `settings-repository.ts`.
- Review: `GameReviewPage.tsx`, `AnalysisBoard.tsx`, `MoveList`, nav
  (`positionTree`/`step`/paths for click-to-seek), `EvaluationBar`,
  `pgnAnnotations.ts` `NAG_META`, `reviewBoardHighlights.css`.
- Tests: fake engine/analysis services in
  `src/components/games/test-support/`, `src/components/analysis/test-support/`,
  e2e `game-library-stats.spec.ts`, `game-analysis-review.spec.ts`.

## 4. Work packages

Dependency order: P1 → P2 → (P3 ∥ P4 ∥ P5) → P6 → P7 → P9 → P8. P2 contains the
Q2-gated scope parts; everything else proceeds with the recommended
defaults.

### P1 — Analysis runs queue; a cancelled/partial run never shows "analyzed"

Behavior: on the shared browser `AnalysisService` (one singleton, so
Library and Review requests serialize), a second `analyzeGames` request
while one is running is **queued and started only after the current run
finishes**; it never aborts the running request. Explicit user Cancel
stops the current run and clears queued requests (their persisted jobs
stay `queued`, resumable). Hooks stop auto-aborting on a new `analyze`
call. `completed` keeps meaning "every required position analyzed and
records persisted".

- `src/hooks/useGameAnalysis.ts`: remove `controllerRef.current?.abort()`
  on a new analyze; keep abort-on-unmount; `cancel()` keeps aborting the
  current run and must also cause queued (not-yet-started) hook runs to
  be skipped/cancelled.
- `src/infrastructure/analysis/analysisService.ts`: add an in-instance
  run gate (promise chain / mutex) in `analyzeGames`; treat a queued
  second request as a new logical batch processed after the current one.
  Add the completeness invariant at `markCompleted` (see P2) and a
  defensive guard so `completed` is only persisted when
  `completedPositions === totalPositions` and `buildMoveAnalyses`
  succeeded over every planned ply.
- `src/hooks/useLibraryAnalysis.ts`: keep `running`/progress for the
  *active* batch; surface a small "N more batch(es) queued" note when a
  run is waiting (progress line).
- Tests:
  - service: start run A, request run B mid-run (fake engine with
    controllable per-position latency) → A completes (never `cancelled`),
    B starts after, both `completed`; cancel clears queued runs;
    partial-cancel never leaves `completed` without full positions.
  - hooks/component: Library `Analyze` on game B while A is analyzing no
    longer flips A to cancelled; statuses converge to completed.
  - e2e: analyze a short fixture game, immediately queue a second game;
    verify both complete and the first shows its insights.

### P2 — Game-analysis settings + run identity + scope (Q1/Q2 defaults)

Settings:

- `src/config/app-config.ts`: add `analysisGame: 'analysis.game'` key.
- New domain-ish module `src/components/analysis/gameAnalysisSettings.ts`
  (pattern of `engineSettings.ts`): `GameAnalysisSettings { engine:
  EngineId; profile: 'fast'|'normal'|'deep'; depthOverride: number | null;
  searchSeconds: number | null; scope: 'both' | 'user' }`, defaults
  (normal, profile depth, no time bound, `both`), clamps, and
  `resolvedGameAnalysisConfig(settings, capabilities)` → the
  per-position engine options actually used (`maxDepth`, `movetimeMs`).
- `src/hooks/useGameAnalysisSettings.ts` reading/writing the key
  (pattern of `useEngineDefaults`).
- `src/pages/SettingsPage.tsx` (+module CSS): new "Game analysis" row —
  engine (Stockfish, single option), profile, depth override (blank =
  profile), search-time (blank = none), side scope (Both players / Only
  your side). Copy explains that classifications for your side drive
  accuracy/stats/puzzles and that opponent-side stats appear in Review.
- `defaultBulkProfile()` in `useLibraryAnalysis.ts` is replaced by
  reading `analysisGame` settings; the run passes the resolved config.

Identity/status/config plumbing (Q2 default = Option A):

- `src/domain/analysis/job.ts`: `AnalysisJob` gains optional
  `config?: { scope: AnalysisScope; maxDepth?: number; movetimeMs?:
  number }`; `analysisJobId` appends a deterministic config fingerprint
  (`scope` always; depth/time only when overridden) so changing the
  settings produces a distinguishable run (analysis-model.md already
  lists "relevant engine configuration" as part of identity — the code
  now matches the spec).
- `src/domain/analysis/status.ts`: `analysisLibraryStatus` also compares
  the latest completed job's config fingerprint to the *current* settings
  fingerprint → a completed run under an older Game-analysis
  configuration reads `outdated` (opt-in re-analysis).
- `src/infrastructure/analysis/analysisService.ts`: `analyzeGames`/
  `resolvePosition` use the resolved config (depth/time overrides go into
  the engine options and into `analysisCacheKey`, which already accepts
  them); the plan/build unchanged.
- Classification/reporting scope (`sideScope`) per Q1 default:
  - `plan.ts` + `build.ts` still produce one engine result per distinct
    position (unchanged search set).
  - `build.ts`: when `job.config.scope === 'user'`, opponent plies are
    still persisted with eval/best lines (Review correctness) but their
    `classification` is not applied/counted; introduce `scope: 'both' |
  'user'` metadata (job-level) and keep MoveAnalysis rows total per the
    Feature-009 contract by classifying opponent plies only under
    `scope: 'both'`. (`build` receives the job → reads
    `job.config.scope`.)
  - `summary.ts`/`summaryDerivation.ts`: user counts unchanged; opponent
    counts exist only for `both` runs (derive from records only when the
    run scope is `both` — pass scope in or read records' analysis id →
    job scope in Review).
  - `useGameReview.ts`: expose the completed job's `config.scope` on
    `ReviewData`.

Tests: settings read/write/clamp/defaults; identity changes when
scope/depth/time changes; `outdated` on config change; user-scope build
(counts/glyphs/summary), both-scope regression; the "no partial
completed" invariants from P1.

### P3 — Library: bulk re-analyze, icon actions, 🔬, row progress bar

- `GameLibraryToolbar.tsx`: keep **Analyze** (bolt icon) and **Delete**
  for the selection; add **Re-analyze** (icon) enabled when the selection
  contains ≥1 game with status `completed`/`outdated`; wire to a new
  `reanalyze(ids)` on `LibraryAnalysisApi` (`useLibraryAnalysis.ts` →
  `runBatch(ids, true)`).
- Row actions (`GameLibrary.tsx` `AnalysisCell`): icon-only buttons with
  accessible labels/tooltips: 🔬/play for **Review** (link),
  **Re-analyze** (only when completed/outdated), **Analyze/Retry**
  (unanalyzed/failed/cancelled), **Cancel** (queued/in-progress), plus a
  new per-row **Delete** icon → opens the existing confirmation dialog for
  that one game.
- 🔬 glyph: `src/app/routes.ts` NavItem gains optional `icon`/`emoji`
  shown by `Navigation.tsx` before the label for **Analysis**
  (`nav-analysis` test id must be preserved by keeping `label` as the
  a11y name); reuse the same glyph on the row Review/analyze icons
  (`data-testid` kept).
- Progress bar: replace/augment the inline "x/y positions" text with a
  full-width bar filling the row width (a thin strip at the bottom of the
  row when `perGameProgress` is present), driven by
  `completedPositions/totalPositions`; text stays for a11y.

Tests: component (selection toolbar Re-analyze enablement; per-row icon
actions incl. delete flow; progress bar width/% via inline style;
emoji glyph present and labelled), hook unit (multi re-analyze calls
force), e2e (select analyzed + unanalyzed games → bulk re-analyze reruns
only/at least the analyzed ones and rows update).

### P4 — Library rows: Lichess-style layout, colors, accuracy, auto-refresh, backfill

- Row redesign (`GameLibrary.tsx` + `GameLibrary.module.css`): drop the
  grid header/column alignment on desktop; each row becomes a card-like
  block: line 1 = players (with "You" chip) + result chip + side; line 2
  = date · platform · time control · termination/moves; then the action
  cluster (right), progress bar, and the insights strip. Keep
  `role=table/row/cell` semantics and screen-reader labels (never
  color-only); remove the `[data-col]` mobile hacks in favor of the same
  card on all breakpoints (deliberate mobile card = desktop card, stacked
  fields).
- Colors: add tokens for the insight values reusing the canonical
  classification palette (P5) — count values tinted, zero = neutral or
  green per row-strip rules below; accuracy emphasized.
- Accuracy formatting: new helper `formatAccuracy(value, {decimals:1})`
  in `src/domain/analysis/accuracy.ts` or a Feature-009 presentation
  helper next to `classificationMeta.ts`; strip text becomes
  `Accuracy 78.4%` (spec Feature 010 currently says whole percentage —
  updated in P8).
- Auto-refresh after each game: `GameLibrary` reloads Library rows when
  `analysis.running` turns false after a batch and, while a batch runs,
  when a poll observes a row status change queued/inProgress →
  completed/outdated (one debounced `library.reload()`), so the insights
  strip for that game appears without a page refresh. Implement via
  `useLibraryAnalysis` reporting "completed this tick" ids or a callback.
- Backfill: extend the browser `AnalysisService` surface with
  `ensureSummariesForRows(ids)` delegating to the wired
  `TacticalDetectionService` (already implemented but unreachable), and
  call it from the Library (e.g. in `useLibraryAnalysis` when a game's
  status is completed/outdated but it has no summary/insights). Fixes old
  analyzed games showing no strip and enables missed-tactic filters after
  the fact.

Tests: component (card row markup, colored counts, accuracy 1 decimal,
insights appear after completion without reload interaction), hook
(backfill invoked for summary-less completed rows), repository/domain
(helper formatting incl. null/em-dash).

### P5 — Canonical classification colors (distinct inaccuracy vs mistake)

Root cause: `NAG_META` colors NAG 6 (`?!`/inaccuracy) `#a06a00` and NAG 2
(`?`/mistake) `#c77400`; `reviewBoardHighlights.css` uses nearly the same
orange tones; counts are currently uncolored.

- Define one palette and one mapping. Recommended distinct values:
  best = green (`#15781b`), good = neutral (no emphasis), inaccuracy =
  amber/yellow (`#d89000`), mistake = orange (`#d94f00`), blunder = red
  (`#c4261c`), missed tactic = magenta (`#c2185b`); verify contrast in
  both themes.
- New UI module (single source) e.g.
  `src/components/analysis/classificationColors.ts` mapping
  `MoveClassification` (+ missed) → color token and re-exported to:
  `NAG_META` glyph colors (`pgnAnnotations.ts`), the Review Summary count
  colors, the Library insight colors, and the square highlights in
  `reviewBoardHighlights.css` (update rgba values to the new palette).
  Color never carries information alone (glyphs/labels remain).
- Distinctness test: assert the hex/HSL distance between inaccuracy and
  mistake exceeds a threshold, and that tests referencing old colors are
  updated.

### P6 — Review: re-analyze control + scope choice + summary/diagram layout

Re-analyze control (always visible on an analyzed game):

- Header/control area ("Actions") with **Re-analyze** options:
  "Re-analyze (both sides)" and "Re-analyze (only your side)" — both
  force-rerun using the current Game-analysis settings profile; the
  obsolete banner keeps its single Re-analyze (uses settings default
  scope). Keep the existing `runAnalysis` path but parameterize scope +
  settings. `GameReviewPage.tsx` header gains the button group
  (`review-reanalyze` ids preserved/extended).

Evaluation diagram (new component):

- `src/components/analysis/board/EvaluationDiagram.tsx` (+ `.module.css`,
  test): pure presentational component rendering one segment per ply from
  the persisted `MoveAnalysis` eval-after values (same source as the eval
  bar); white/dark (user/opponent) share split whose heights grow/shrink
  with the evaluation; mate/terminal handled; the segment under the mouse
  shows hover label; **click on a segment seeks that ply** via
  `onSeek(path|ply)`.
- Placement (Q4 default): below the board column inside
  `AnalysisBoard`'s `boardColumn` (width = board width, so diagram width
  tracks `boardSize.size`), under the bottom clock bar ("board footer").
- The review page passes `onSeek={handleSeek}`/`setPath` (existing
  callback) and recomputes when records change.

Summary relocation & styling:

- Move `ReviewSummary` from above the board into a bottom region under
  the side panel/move list, side-by-side with the diagram on desktop
  (grid cell under the side panel), stacked below the diagram on mobile.
- New layout per request: accuracy headline at top (larger), then the
  two-column player grid:
  ```
  Your name            Op name (omitted for user-scope runs)
  Best Move    1       3
  Good        16       7
  Inaccuracy   2       4        (0 → green, else class color)
  Mistake      1       2
  Blunder      0       1
  Missed tactics  1    (only when detection completed; green 0)
  ```
- Colored count values per Q5; screen-reader text spells out each value;
  keep existing `summary-*` test ids.
- Opponent column omitted when the shown job's `config.scope === 'user'`
  (or when no opponent plies were classified).
- Accuracy value uses `formatAccuracy` (1 decimal).

Tests (component): diagram renders segment count/click-to-seek (board
position moves), white/black split values, re-analyze action scopes
propagate to the service fake with force+scope, summary relocation ids,
coloring classes, opponent column hidden for user scope, accuracy text.

### P7 — Missed-tactic trust (diagnosis + e2e proof)

- Wire the `ensureSummariesForRows` backfill (P4) and confirm the whole
  surface: Library strip `Missed tactics`, filters, Review marker.
- Add/extend an **e2e** that analyzes a deterministic fixture game
  engineered to contain a genuine missed tactic (a forced fork/mate
  within ≤8 plies meeting Stage-2 guards — reuse the domain
  `verify.test.ts` scenarios' FENs and existing detection fixtures),
  waits for the detection pass to settle (summary `completed`,
  `missedTacticCount` ≥ 0/1), then asserts the Library row shows the
  count and Review shows the marker — proving detection works end to end
  with a real engine.
- Because the reported scenario ("analyzed several games, never saw a
  missed tactic") is consistent with detection passes being interrupted by
  the P1 cancel bug and with summaries never backfilled for older runs,
  P1+P4 are the primary fixes; P7 additionally adds a small Review/Library
  affordance so the detection state is visible (`queued`/`inProgress`/
  `failed` detection shown on the row or Review, e.g. "tactics: pending"),
  so a user can tell detection is still running instead of absent.
- If any Stage-2 guard turns out over-strict on real games during
  verification (e.g. `difficulty-below-15`, `>8-plies`), record the
  evidence and adjust thresholds only through the documented
  `DETECTION_VERSION`/ADR-026 process — not silently.

### P9 — Calibrate classification thresholds & game accuracy to real Lichess (ADR-023/024 revision)

**Reported:** on `eK9h9KP4` (gazza113–tuxitop) Lichess reports black 76% /
3 inaccuracies / 1 mistake / 2 blunders, white 94% / 2 inaccuracies;
ChessRemedy reports black Blunders 0 · Mistakes 1 · Inaccuracies 9, white
4 inaccuracies.

**Root cause (verified against lila source, commit 5013970):**

- ADR-023's "Lichess 2/10/20" bands were derived (fabricated) in
  `research/move-classification.md` by inverting the accuracy curve.
  Lichess's real classifier (`modules/tree/src/main/Advice.scala`,
  `winningChanceJudgements`) buckets a move by the mover's **winning-chance
  loss ≥ 0.10 / 0.20 / 0.30** (≈ **5 / 10 / 15 win%**) → Inaccuracy /
  Mistake / Blunder; nothing is annotated below 0.10 and a played best move
  is never labelled. Mate transitions use cp anchors (`MateAdvice`), and cp
  is clamped to **±1000** before the logistic. ChessRemedy's floor of **2
  win%** is ~2.5× too tight (→ inaccuracy inflation) and its **20 win%**
  blunder bound too strict (15–20 win% losses demoted to mistakes).
- `Blunders 0` while a rook and queen are lost is also consistent with
  **partial coverage shown as `completed`** (the P1 bug) — P1 lands first;
  P9 re-analyzes this exact game and separates the two effects.
- Game accuracy is not Lichess's: ADR-024 uses the unweighted arithmetic
  mean, but Lichess (`modules/analyse/src/main/AccuracyPercent.scala`
  `gameAccuracy`) returns the mean of the **(volatility-weighted mean,
  harmonic mean)** over windowed per-move evals (`window =
  (n/10).squeeze(2,8)`, weights = window Win% stdev `.squeeze(0.5,12)`),
  per-move accuracy = `103.1668100711649·e^(−0.04354415386753951·Δ) −
  3.166924740191411` **+ 1**, clamp `[0,100]`.

**Changes:**

- `src/domain/chess/classification.ts`: bands → 5/10/15 win% (equiv.
  0.10/0.20/0.30 wc); clamp cp to ±1000 before the logistic; mate → ±1000;
  adopt Lichess mate anchors (allowing mate while already being mated ⇒
  inaccuracy etc.); keep `best`/`good`, best-move-tie and forced-move cap.
  `CLASSIFICATION_VERSION` → 2. Old completed jobs automatically read
  `outdated` (id/`isAnalysisObsolete` already key on the version); no data
  migration, opt-in re-analysis.
- `src/domain/analysis/accuracy.ts`: port Lichess `gameAccuracy` exactly;
  per-move gains the `+1`/full constants; conversion parity.
  `MOVE_ACCURACY_VERSION` → 2.
- Update fixtures/tests encoding old bands or version 1
  (`classification.test.ts`, `accuracy.test.ts`, `build.test.ts`, status
  tests, e2e golden), then **capture `eK9h9KP4`'s per-ply evals from one
  full `normal` run** into a deterministic golden + an e2e re-analysis;
  assert counts ≈ 3/1/2 (black) and 2 (white) within ±1 and accuracies
  within ±~3 of 76/94.
- Docs (fold into the P9 commit, not P8): rewrite `research/move-classification.md`
  §2/§5, `ADR-023`, `research/move-accuracy.md` §2/§6/§9 and `ADR-024` with
  real citations and the real `gameAccuracy`. Note engine-depth noise ⇒
  tolerances above.
- Commit message: `fix(023/024): calibrate classification bands and game
  accuracy to Lichess source (classificationVersion 2)`.

### P8 — Spec/ADR updates (do first when implementing each WP)
- `features/007-game-import.md`: row layout (card rows, no column
  alignment; desktop = mobile card), per-row icon actions + Delete,
  🔬 glyph, bulk Re-analyze in the selection toolbar, row progress bar.
- `features/008-game-analysis.md`: §5/§6 queue-not-cancel semantics;
  §4/§9 identity includes resolved engine config + `sideScope`; §2/§10
  scope = classification/reporting scope (Q1 wording); new "Game analysis
  settings" (Settings surface + `analysis.game`); §12/§20 Review layout
  (diagram under board, Summary below move list); §21 re-analyze scope
  control; §22 action icons/delete; §24 "partial run never completed".
- `features/009-move-classification.md`: canonical color palette +
  distinctness rule; accuracy display helper (1 decimal); Review Summary
  coloring/zero rules.
- `features/010-tactical-detection.md`: strip accuracy "one decimal";
  summaries backfill for pre-existing analyses; detection-state affordance
  and the fixture/e2e verification commitment.
- `domain/game-library.md` §7: strip semantics/formatting (1 decimal,
  colors), row layout & action notes (icons/delete/progress bar remain
  UI decisions), backfill note.
- `domain/analysis-model.md`: identity text already lists engine
  configuration — make explicit that resolved depth/movetime + scope are
  part of the deterministic identity; state the "completed ⇒ every
  required position analyzed" invariant is enforced.
- `decisions/ADR-018-engine-analysis-cache.md`: when game analysis can
  carry depth/time overrides, the cache key scope is the ADR-018 tuple
  *plus* the effective depth/time/MultiPV overrides (the session key
  already does this); note stored-key compatibility.
- `ARCHITECTURE.md` §5/§6: engine jobs already support queueing — add one
  line that game-analysis *runs* are serialized and new requests queue
  (no §-structure change).

## 5. Files/modules to create or modify (summary)

Create:
- `src/components/analysis/gameAnalysisSettings.ts` (+test)
- `src/components/analysis/classificationColors.ts` (+test)
- `src/components/analysis/board/EvaluationDiagram.tsx` (+css, +test)
- `src/hooks/useGameAnalysisSettings.ts` (+test)
- `.opencode/plans/…` (this file)

Modify (main ones):
- Analysis: `infrastructure/analysis/analysisService.ts(+test)`,
  `infrastructure/analysis/browser.ts`, `hooks/useGameAnalysis.ts(+test?)`,
  `hooks/useLibraryAnalysis.ts`, `domain/analysis/job.ts(+test)`,
  `domain/analysis/status.ts(+test)`, `domain/analysis/build.ts(+test)`,
  `domain/analysis/summary.ts(+test)`,
  `domain/analysis/summaryDerivation.ts(+test)`,
  `domain/analysis/accuracy.ts(+test)`.
- Settings: `config/app-config.ts`, `pages/SettingsPage.tsx(+css)`,
  `hooks/useEngineDefaults.ts` untouched.
- Library: `pages/GamesPage.tsx`, `hooks/useGameLibrary.ts` (backfill/
  refresh triggers), `components/games/library/GameLibrary.tsx(+css)`,
  `GameLibraryToolbar.tsx(+css)`.
- Review: `pages/GameReviewPage.tsx(+css, +test)`,
  `hooks/useGameReview.ts`, `pages/reviewBoardHighlights.css`,
  `components/chessboard/pgnAnnotations.ts` (NAG colors), app
  `routes.ts`/`Navigation.tsx(+css)`.
- DB: `infrastructure/analysis` surface only — no schema table change
  (job object fields additive; old rows read with defaults). If a schema
  bump is preferred for explicitness: additive v8 documenting the job
  config fields (no backfill transform required) — decision left to
  implementation; P8 docs updated accordingly.
- e2e: `tests/e2e/game-analysis-review.spec.ts`,
  `tests/e2e/game-library-stats.spec.ts` (queue scenario, missed-tactic
  fixture, 1-decimal accuracy).

## 6. Domain/data changes

- `AnalysisJob`: optional `config { scope; maxDepth?; movetimeMs? }`
  (additive; defaults when absent = `both`/profile defaults) — id,
  status/outdated and review consume it.
- `analysisJobId` fingerprint includes scope (always) + depth/time (when
  overridden).
- `analysisLibraryStatus`/`useGameReview` outdated check includes config
  fingerprint vs current settings.
- `buildMoveAnalyses` honours `scope: 'user'` for classification of
  opponent plies (records stay contiguous for Review; see Q1 default).
- `summarizeAnalysis`/`buildAnalysisSummary`: opponent counts/accuracy
  only meaningful for `both` runs (passed through scope or derived in the
  consumer).
- New settings value shape `GameAnalysisSettings` under
  `SETTINGS_KEYS.analysisGame` (schema-free settings table; old installs
  read defaults).
- Row insights model unchanged (already user-side); strip formatting
  helper changes only.
- No change to the `MoveAnalysis` schema, `MoveAnalysis` per-line depth,
  classification versions, ADR-023/024/026 math, or the cache table.

## 7. UI changes

Covered per WP above. Global rules preserved: desktop/tablet/mobile,
mouse+touch, keyboard shortcuts never the only path, dark+light themes,
never color-only, icon buttons carry accessible names/tooltips.

## 8. Infrastructure changes

- `AnalysisService` gains run serialization + `ensureSummariesForRows`
  passthrough; browser assembly unchanged shape.
- Engine/cache: overrides now actually passed for game analysis
  (infrastructure already supports them).
- No new tables if job fields stay object-additive; optional additive
  schema v8 (see §5). No new dependency.

## 9. Dependencies

None new. Reuses Dexie, engine service, chessops, existing UI kit.
Version policy: no pins introduced.

## 10. Tests

- Domain: job id/config fingerprint; status `outdated` on config change;
  user/both scope builds and summaries; accuracy formatting; color
  distinctness; format helpers.
- Service/hooks: queue-not-cancel (both hook + service level); cancel
  clears queued runs; partial runs never `completed`; per-game cancel
  keeps batch going (regression); backfill invocation; auto-refresh
  triggers.
- Components: Settings Game-analysis form; Library toolbar Re-analyze,
  icon row actions + delete, row progress bar, card rows, colored insights
  with 1-decimal accuracy, insight auto-appearance; Review diagram
  click-to-seek, relocated/colored summary, scope-driven opponent column,
  re-analyze scope actions.
- e2e: extend `game-library-stats.spec.ts` (bulk re-analyze, accuracy
  format, queueing) and `game-analysis-review.spec.ts` (diagram seek,
  re-analyze from review, missed-tactic fixture proof, detection pending
  affordance). Deterministic fixtures only; no network/user data.

## 11. Migration considerations

- No data migration required for job `config` (absent → defaults).
- Old completed analyses: summaries/insights backfilled lazily by
  `ensureSummariesForRows` on Library load (P4); they were created under
  `scope:'both'` semantics — treat absent `config.scope` as `both`.
- ADR-018: existing cache rows remain readable; new runs with overrides
  produce distinct keys; optionally prune nothing.
- Existing `useGameAnalysis` callers relying on abort-on-new-run (only the
  Library/Review) change behavior to queue — covered by component tests.

## 12. Risks

- Q1/Q2 scope semantics if user picks the alternative definitions —
  contained behind WP-B/WP-E gates; recommended defaults documented.
- Serialization changes perceived latency (second batch waits) — mitigate
  with "queued" indicator; per-game Cancel still responsive.
- Review layout restructure (bottom band) may regress responsive tests —
  keep AnalysisBoard chrome intact and add diagram as board-column
  content; verify desktop/tablet/mobile.
- Row redesign removes the desktop table header (spec currently
  describes columns) — update Feature 007 spec in P8 and keep table
  semantics/accessibility.
- Changing classification colors may ripple into Playground/SquareBadges
  tests — centralize palette; update assertions.
- e2e missed-tactic fixture could be flaky across Stockfish versions —
  use a decisive fixture (forced mate/fork) with generous verification
  margins and mark engine-version tolerance like the existing e2e
  tolerances.

## 13. Acceptance criteria (maps to the report)

1. Analyzing game B while A is analyzed **queues** B; A completes
   (never auto-cancelled); cancel is explicit.
2. A run cancelled part-way is never shown/kept as `completed`/analyzed;
   Review/row only show a fully-persisted run.
3. Settings page has a **Game analysis** group (engine, profile, depth,
   search time, sides scope) that bulk/per-row/review analysis honours;
   changing it marks old runs `outdated` (opt-in re-analysis) — and the
   game-analysis "best move" no longer silently diverges from the live
   configuration when the same settings are used.
4. Re-analyze works on **selected games** (bulk), not only per row.
5. Row/analysis/review action buttons are **icons** incl. a per-row
   **Delete**; 🔬 (analysis) shows in the top nav and actions.
6. Library rows are **Lichess-style cards** — no table-header/column
   alignment — responsive, accessible.
7. Analysis progress renders as a **row-width progress bar**.
8. Accuracy displays **one decimal**; statistics are **colored** with
   clearly distinct inaccuracy/mistake colors.
9. A row's insights/strip appear **immediately when its game's analysis
   finishes** (no refresh) and older analyzed games get backfilled.
10. Review page offers **re-analyze (both sides / only your side)**.
11. Review shows the full-game **evaluation diagram** under the board at
    board width; clicking a segment **seeks** that move.
12. Review Summary sits below the move list next to the diagram; shows
    accuracy large at top; colored counts with the requested zero rules;
    the **Op column is omitted** when the run analyzed only the user's
    side.
13. Missed-tactic detection is **provably working**: deterministic
    fixture e2e asserts a real missed tactic surfaces in row + Review;
    detection state is visible while pending/failed.
14. Relevant specs/ADRs updated; full test gate green; changes committed
    in the phases below.

## 14. Verification commands

Narrowest-first per WP, then the full gate:

- Focused: `npx vitest run src/domain/analysis src/infrastructure/analysis
  src/hooks/useLibraryAnalysis src/components/games/library
  src/pages/GameReviewPage* src/components/analysis/board/EvaluationDiagram*`
- Full: `npm run lint`, `npm run typecheck`, `npm run format:check`,
  `npm run test`, `npm run build`, `npm run dev` (smoke, no console
  errors), `npm run test:browser` (Chromium), `npm audit`.
- e2e: `npm run test:browser -- game-library-stats` and
  `-- game-analysis-review` for the new scenarios.

## 15. Commit plan (implementer)

One commit per WP, conventional style matching repo history, each green
before the next:

1. `fix(008): queue game-analysis runs; completed requires full position coverage`
2. `feat(008/001): Game-analysis settings (engine profile/depth/search-time) + run identity`
3. `feat(007): bulk re-analyze, per-row icon actions + delete, 🔬 analysis glyph`
4. `feat(007/010): Lichess-style library rows, row progress bar, colored 1-decimal stats, insight auto-refresh + summary backfill`
5. `feat(009): distinct classification palette (inaccuracy vs mistake)`
6. `feat(008/009/033): Review re-analyze, evaluation diagram, relocated colored Summary`
7. `test(010): end-to-end missed-tactic fixture proof + detection-state affordance`
8. `fix(023/024): calibrate classification bands and game accuracy to Lichess source (classificationVersion 2)`
9. `docs(007/008/009/010/014+ADR-018/023/024): spec updates for the polish milestone`

Spec updates (P8) are applied **within** each WP commit where practical
(docs-first per AGENTS.md); commit 8 catches stragglers.

---

## 16. Feedback round 2 (post-P9 Review evaluation questions) — investigate + decide

Reported while reviewing a re-analysed game. Findings are from code
(`GameReviewPage.tsx`, `positionTree.ts`, `MoveList.tsx`,
`components/analysis/evaluation.ts`, `classificationMeta.ts`).

### R2-1 — Evaluation sign confusion: "-0.44 but should be +0.44"

Root cause: **two sign conventions coexist on one screen.**

- The **header eval text** (`AnalysisPanel` `position-eval`) and the
  **evaluation bar** are rendered from the **bottom/user** perspective
  (`evaluationFromBottom(eval, bottomColor, sideToMove)`); `+` always means
  good for the player at the bottom of the board (the user's orientation).
- The **per-move eval chips in the move list** (`storedEvalsByPly` →
  `evalAsWhite`) are rendered **White-positive** (`+` always means good for
  White), like lichess.

When the user plays Black these two disagree in sign at the same position
(move chip `+0.44` vs header `-0.44`), which reads as a bug. When White,
they agree.

Recommended resolution (pending owner confirmation): render **numeric eval
text White-positive everywhere** (header text, move chips, stored panel
lines) — the lichess convention the user quotes — while the **bar stays
bottom-oriented for its height** only (no numeric text tied to bottom sign).
Then `-0.44`/`+0.44` has a single meaning. If instead the product wants
user-perspective text, the move chips/lines must switch to it. Update
`features/006`, ADR-033 notes and `GameReviewPage.tsx`/`AnalysisPanel.tsx`
presentation accordingly (single source helper).

### R2-2 — "2. Nf3!! is 'best' yet the eval dropped +0.39 → +0.26"

Finding: not a classification bug. `best` means `playedMove == bestMove` of
the **position before** the move (single engine search). The two numbers the
user compares are the **eval-after chips of two consecutive positions**, each
computed by an **independent search of that position**. Successive
independent searches of adjacent positions legitimately differ by ~5–15 cp
(opening search noise / depth horizon); 13 cp here is normal, not a dropped
best move.

Two aggravators worth fixing (see P2): (a) per-position results can come from
different effective configs when the ADR-018 cache mixes runs — resolve by
keying the cache on the game-analysis config (already planned); (b) shallow
searches widen the noise — the planned depth/movetime settings are the cure.
Optional presentation improvement (decide): move chips currently show the
position-*after* the move; showing the position-*before* (the eval the move is
judged by) would make "best ⇒ eval unchanged" visually true. Not a defect;
defer unless desired.

### R2-3 — Stop annotating/highlighting `best`/`good`; `!!` everywhere feels wrong

Agreed. Current behaviour: `classificationMeta` maps `best` → NAG 3 (`!!`)
and `isEmphasized` colours/highlights every non-`good` move, so every
engine-equal move gets `!!` + a tint in the move list and square highlights on
the board (`GameReviewPage.tsx` `effectiveNagOverrides`, `emphasizedSquares`,
`classificationBoardBadges`).

Proposed (confirm): in Game Review the **move list** colours/annotates only
`inaccuracy | mistake | blunder` (+ the Feature-010 missed-tactic marker);
`best` and `good` render plain (no NAG, no colour). On the **board**, square
highlights apply only to the negative classes; `best` may keep a *quiet*
destination-square badge but **not** the `!!` glyph — reserve `!!`/
"brilliant" for a future detection (a new ADR + its own classification
extension), per the domain note that presentation emphasis is separate from
the persisted five-state label. `classificationMeta`'s canonical NAG mapping
(best → 3) is retained for PGN/export; the Review introduces an explicit
"annotate only negative" presentation rule (new small helper or filter), not a
change to persisted data. Update `features/009`, `domain/classification.md`,
`classificationMeta.ts` doc table.

### R2-4 — Duplicate variations + weak active-move highlight

Two items:

1. **Duplicate variation on replay.** Replaying a move that already exists as
   a variation child *should* navigate (SAN dedupe exists per node,
   `positionTree.ts` `play`), so duplication is unexpected and needs a
   concrete reproduction (steps + screenshot) before fixing. Candidates to
   verify: transpositional equality where the same move exists under a
   different parent node, or the move list rendering the same SAN in two
   variation sub-lines. Fix = navigate to the existing ply when the move is
   already in the current node's children (already true) and, for
   transpositions, dedupe/navigate by position+UCI, and never append a ply
   that is already reachable from the current node.
2. **Active-move highlight.** `MoveList.module.css` `.moveActive` uses a
   translucent green background (`--color-move-active`, rgba(20,85,30,.2))
   which is weak in dark mode. Strengthen with a border/underline + stronger
   background via theme tokens and verify in both themes.

### R2 decisions to confirm before implementing

Owner decisions (2026-09-06):

- **D1 (R2-1): numeric eval text White-positive everywhere.** Implemented:
  `AnalysisPanel` header + live lines use `formatWhiteEvaluation` (fen-based);
  Game Review stored header flips `barView` to White; move chips already
  White-positive. `bottomColor`/`sideToMove` removed from `AnalysisPanel`
  props (callers updated); the evaluation bar keeps bottom-oriented height.
- **D2 (R2-3): badge left as-is, no fix.** Best-move board badge (`!!`)
  stays; move list + square highlights annotate only negative classes.
- **D3 (R2-2): position-after move chips kept.**
- **D4 (R2-4): active-move highlight kept subtle** — theme tokens
  `--color-move-active`/`--color-move-active-ring` (light + dark) replace the
  hard-coded green; MoveList now moves the keyboard focus ring onto the active
  ply when it changes while a move button is focused (no stray border).
  Duplicate-variation reproduction still open (see R2-4).

### R2 implementation status

- `R2-1` DONE (this milestone): White-positive eval text (commit "feat(009):
  ..." pending).
- `R2-3` DONE: Game Review annotates/highlights only negative classes;
  `best`/`good` quiet in the move list; `classificationBoardBadges` unchanged
  per D2. Tests updated.
- `R2-4` active-highlight tokens + focus-follow-active DONE; duplicate
  variation needs a user reproduction before fix.

### R2 implementation sketch (remaining)

- Spec/doc notes: `features/009` presentation default (Review annotates only
  negative classes; `!!` reserved for a future brilliant detector),
  `features/006`/evaluation note (numeric eval text White-positive, bar height
  bottom-oriented) — folded into the P8 docs sweep.
- Duplicate-variation reproduction (R2-4): append to P3/P6 verification; fix
  on reproduction.

---

## 17. Feedback round 3 (queue lifecycle) — implemented

Reported: a queued job could not be cancelled; after the first game's analysis
finished the next queued game never started; the top banner lingered on
"Analyzed 1 games [Cancel analysis]"; adding a game to the queue did not widen
"Analyzing 1 of 1"; and the banner lacked a position-percentage readout.

Root causes found in code:

- **R3-1 — detection blocked the queue.** `runGameJob` `await`ed the Feature-010
  two-stage detection pass before returning, so a game's job read `completed`
  (its row done) while the serialized batch/queue promise stayed open running
  Stage-2 engine searches — the next queued game/batch did not start until that
  finished (or the user pressed the confusing Cancel). The module header already
  claimed detection "never fails or blocks an analysis batch".
  Fix: `runGameJob` persists `completed` and schedules detection *detached*
  (`void this.runDetection(...)`), so the queue advances the moment a game is
  complete. Detection keeps its idempotent/resumable/cache-absorbing semantics
  and shares the single engine FIFO. (Spec: 008 §7 note added.)
- **R3-2 — queued batches were invisible/uncancellable and mis-counted.** At
  HEAD every analyze call went straight to the service tail, so a waiting batch
  had no persisted job, no `queued` row state and no per-row cancel, and the
  progress line was built only from the *active* batch ids (clobbered by newer
  requests) — "Analyzing 1 of 1" never widened. The hook now holds a real FIFO
  queue (work-in-progress already in the tree): one batch runs at a time,
  waiting games read `queued` on their rows, per-row Cancel pulls a waiting game
  out of the queue (or cancels a persisted job), and the top banner is derived
  over the whole queue so it widens instantly. `progressLine`/`positions` are
  derived (not stored), so no 900 ms poll is needed to re-render the count.
- **R3-3 — banner lingered / semantics unclear.** The top banner now renders
  only while there is queued or running work (`running`), shows the whole-queue
  game count, an aggregate position bar (`positions` → percent) and a Cancel
  button that stops the active run and drops queued requests; it disappears on
  its own once the queue drains.
- **R3-4 — queue-wide % needed per-game totals up front.** Batch prep now plans
  each game once and persists its real `totalPositions` on the queued job, so
  `jobProgress`/the banner can sum the whole batch before games start.

Tests added/updated: service regression "starts the next game as soon as the
previous analysis completes (detection never holds the queue)"; Feature-010
service tests now wait for the detached pass; `useLibraryAnalysis.test.ts`
whole-queue progress/positions + running-clears; GamesPage component test for
the top banner (widens to "1 of 2", per-row cancel pull-out, banner clears);
e2e `game-library-stats.spec.ts` "analyzes two queued games to completion, one
after the other". Spec note in `features/008-game-analysis.md` §7.


