# Plan — Feature 010: Tactical Detection

> Scope note: this feature is delivered in **two milestones** under one change
> series, matching the Feature-010 spec's own structure:
>
> - **Milestone A — Detection pipeline + Game Review integration.** Two-stage
>   pipeline (ADR-026) producing verified missed-tactic candidates, persisting
>   them, annotating `MoveAnalysis`, and surfacing the missed-tactic glyph +
>   inspection in Game Review.
> - **Milestone B — Game Library statistics & filters.** Per-analysis summaries
>   (persisted, game-scoped), the row insights strip, and the
>   `Analysis` / `Has blunders` / `Has missed tactics` filters.
>
> The spec's context block and this plan's section references are authoritative;
> the detection *algorithm* is defined by `research/tactical-detection.md`,
> `domain/tactics.md` and ADR-026 and is **not** redefined here. This plan only
> fixes ownership, integration, persistence, state model and user-visible
> behavior — including the parts the spec explicitly delegates ("The detection
> pass state model is defined by this feature's pipeline work…").

---

## Deliverable 0 — Small specification/consistency amendments (land first)

No application source is touched. Two small doc updates keep the canonical docs
consistent with what this feature implements, per AGENTS.md "Documentation
rule".

1. **`.opencode/specs/domain/tactics.md`** — append the Feature-010-owned
   persistence/state model that the Feature-010 spec delegates to the pipeline
   work: the per-analysis detection-pass state machine
   (`absent → queued → inProgress → completed | failed`), the absent-vs-zero
   contract, the `puzzleCandidate` persistence shape (natural key
   `[analysisId + sourcePly]`, `verificationStatus`, scoping to an analysis
   identity), and the fact that Stage-1 emits candidates for the user's plies
   only (ADR-026's "every analyzed ply" is read through the product's user-side
   lens, see Design decisions D1). This makes `domain/tactics.md` the canonical
   home of the state model instead of code comments.
2. **`.opencode/specs/ARCHITECTURE.md` §7** — the schema-version paragraph
   currently says "currently **v5**" while the codebase is already at v6 (docs
   lag). Update it to v7 in the same commit as the DB change, and add
   "analysis summaries" to the persistent-entities list (puzzle candidates are
   already listed).

No amendment to ADR-026, ADR-025, the Feature-010 spec, `domain/game-library.md`
(the Library contract was already registered by the doc commits
`2f35404` / `234c3c0`), or `domain/analysis-model.md` (its reserved
`missedTactic`/`detectionVersion` contract already matches the code) is needed.

### Spec inconsistency to flag to the user (non-blocking)

`research/tactical-detection.md` §5 guard 1 ("require at least one alternative
move to score ≥ 80 % of the best move's accuracy contribution; if no
alternative does … reject") contradicts §1.4 of the same document ("the tactical
objective is not trivially achievable by any alternative move") and ADR-026's
authoritative wording ("Reject if the tactical objective is reachable by a
non-forcing alternative (the 'only one good move' guard)"). **This plan
implements the ADR-026 / §1.4 formulation** (reject only when a non-forcing
alternative independently reaches the same objective). The §5 accuracy-phrased
variant would reject legitimate "only winning move" tactics and is treated as
superseded wording. Record this reading in the commit message; raise it to the
user if they want the research text corrected in the same change.

---

## 1. Objective

Deliver Feature 010 per `features/010-tactical-detection.md`:

1. **Two-stage detection pipeline** (ADR-026) over persisted `MoveAnalysis`:
   cheap Stage-1 candidate generation on analysis completion + engine-heavy
   Stage-2 verification (`tactical` profile, ADR-012) using the ADR-018
   position cache, with false-positive guards (forcingness, objective, ≤ 8
   plies, alternative-move, WDL consistency, ADR-025 difficulty ≥ 15).
2. **Persist** verified candidates (research §10 schema, plus analysis-scoping)
   as game-scoped derived data and annotate the owning `MoveAnalysis` rows
   (`missedTactic: true`, `detectionVersion`).
3. **Game Review integration**: canonical missed-tactic glyph on the move,
   classification preserved, tactical continuation inspectable through the
   existing analysis-board PV/arrow/exploration surface — no second tactical
   visualization, no second engine representation (Feature-010 spec §Game Review
   Integration).
4. **Game Library milestone**: persisted per-analysis summaries; the row
   insights strip (Accuracy · Blunders · Mistakes · Inaccuracies · Missed
   tactics, user-side, latest completed analysis); the three analysis-result
   filters; absent-vs-zero handling everywhere.
5. Deterministic fixtures + domain/component/e2e tests for every rule above.

No new runtime dependency is required (`chessops`, the Feature-005 worker
service, the ADR-018 cache repository and Feature-009 domain helpers all exist).
Dependency policy: no additions.

---

## 2. Scope

### In scope (Milestone A)

- Domain: Stage-1 candidate generation; Stage-2 verification core (line
  walking over the tactical-profile MultiPV result, forcingness, tactical
  objective classification, guards, difficulty estimate); pure annotation
  write-back of verified misses onto `MoveAnalysis` records.
- ADR-025 difficulty-estimate helper (canonical home for later Feature-011
  reuse).
- Persistence: `puzzleCandidates` table; `analysisSummaries` table (created in
  A, completed by B); schema v7; deletion cascade; forced re-analysis cleanup.
- Service orchestration: `TacticalDetectionService` + integration in
  `AnalysisService` (summary write on completion; Stage-1 + Stage-2 run after
  analysis) and browser assembly.
- Review UI: missed-tactic glyph through the shared Feature-009 presentation
  tooling; move-list annotation; summary chip already exists (it renders from
  `summarizeAnalysis` once annotations land); minimal "missed tactic inspectable"
  affordance reusing stored engine lines/arrows.

### In scope (Milestone B)

- `domain/gameLibrary` filter state + codec extension (three dimensions),
  predicates, and the row read-model gaining the insights the strip renders.
- Library query path: push-down of the analysis-result dimensions via
  analysis-job + summary repositories (never a `MoveAnalysis` scan) and
  in-memory completion of the existing per-page passes.
- Row strip component + toolbar filter controls + CSS (responsive/a11y).
- Summary lazy backfill for analyses completed before this feature ships (see
  D5).

### Out of scope

- Semantic tactical-motif classification (`tacticalMotifs` reserved).
- A separate tactical visualization or a second engine representation.
- Feature 011 puzzle generation (consumes verified candidates later); Feature
  014 aggregates; Feature 016 sync.
- Changing `classifyMove`, ADR-023/024 math, the Feature-008 pipeline, or the
  engine/cache layers.
- Quiet/non-forcing themes, defensive-resource detection beyond the
  `neutralizing_threat` objective, > 8-ply tactics.
- Opponent-side row statistics, per-row phase breakdown, automatic prose
  explanations.

---

## 3. Existing code to reuse

- **Analysis model & data**: `src/domain/chess/analysis.ts` (`MoveAnalysis`,
  `MultiPvLine`, reserved `missedTactic`/`detectionVersion`),
  `src/domain/analysis/build.ts` (`swapWdl`, `negateEval`, `terminalEvalFor`,
  `InputLine` shapes), `src/domain/analysis/job.ts` (job identity —
  `analysisJobId` = the `analysisId` scope key), `plan.ts` (`PlannedMove`
  replay pattern), `status.ts` (`latestCompletedJob`), `summary.ts`
  (`summarizeAnalysis`), `accuracy.ts` (`gameAccuracy`, ADR-024),
  `src/domain/analysis/test-support.ts` (`makeMove`, `makeRecords`,
  `TEST_ENGINE`).
- **Chess engine math**: `src/domain/chess/classification.ts`
  (`winPercentFromCp`, `cpValueOf`, `WPLOSS_*`), `src/domain/chess/position.ts`
  (`parsePositionFen`, `fenOf`), `src/domain/chess/san.ts` (`uciPvToSan`),
  `mainlineMoves`/`mainlineNodes`/`positionAtPath`
  (`src/domain/chess/move.ts`, `moveList.ts`) as the replay pattern for UCI
  lines, `src/domain/chess/gameEnd.ts`/`build.ts` for terminal-position
  handling.
- **Presentation tooling (Feature 009)**: `src/domain/analysis/classificationMeta.ts`
  (canonical shared classification/review presentation mapping — the spec says
  Feature 010 must not create a competing mapping; the missed-tactic marker is
  added **here**), `src/components/chessboard/pgnAnnotations.ts` (`NAG_META`
  already carries `9 → { glyph: 'X', tone: 'miss', color }`), `MoveList.tsx`
  (`nagOverrides: Map<plyId, number[]>` already renders multiple NAG glyphs per
  move — no component change needed to show a classification glyph plus the
  missed-tactic marker).
- **Engine/cache**: `src/infrastructure/engine/engineService.ts`
  (`analyze(fen, {profile:'tactical'})`, `resolveProfileConfig`),
  `src/infrastructure/engine/cache.ts` (`analysisCacheKey`), `engineProfiles.ts`
  (tactical profile), `src/infrastructure/engine/types.ts`,
  `src/infrastructure/db/engine-cache-repository.ts` (`EngineAnalysisCache`).
- **Service/orchestration patterns**: `src/infrastructure/analysis/analysisService.ts`
  (`resolvePosition` cache-or-run pattern, abort handling, batch loop),
  `src/infrastructure/analysis/browser.ts` (assembly), repositories in
  `src/infrastructure/db/` and their repo tests.
- **Library**: `src/domain/gameLibrary/*` (`filters.ts` URL codec to extend,
  `predicates.ts`, `rowView.ts` insight capabilities, `index.ts`
  `libraryRowOf`), `src/hooks/useGameLibrary.ts`, `useLibraryAnalysis.ts`,
  `src/infrastructure/db/game-library-query.ts`,
  `src/components/games/library/GameLibrary.tsx` + `GameLibraryToolbar.tsx`,
  `src/pages/GamesPage.tsx`, `GameReviewPage.tsx` (stored arrows/panel already
  surface the best-move + stored PV of a selected record's position).
- **Fixtures**: `src/domain/chess/fixtures/defs.ts` already tags
  `cc-rapid-missed-tactic` and `li-bullet-missed-mate` with `missedTactic`;
  `src/domain/chess/fixtures/*` provide games; `classificationScenarios.ts`
  provides `MoveAnalysis[]` fixture builders; `fixtures.test.ts` asserts shape
  validity.
- **DB migration/cascade patterns**: `src/infrastructure/db/schema/v*.ts` +
  `v*-migration.test.ts`, `database.ts`, `app-config.ts`
  (`PERSISTENCE_SCHEMA_VERSION` guard), `game-deletion-cascade.test.ts`,
  `analysis-repositories.test.ts`, `game-library-query.test.ts`.

---

## 4. Files/modules to create or modify

### Docs (Deliverable 0)

- `.opencode/specs/domain/tactics.md` — append the state/persistence model
  (see Deliverable 0).
- `.opencode/specs/ARCHITECTURE.md` §7 — schema-version note → v7, entities
  list gains analysis summaries.

### Source — new

**Domain (`src/domain/tactics/`, `src/domain/puzzle/` — pure, no React/Dexie/Worker):**

- `src/domain/tactics/types.ts` — `TacticalObjective`
  (`winning_material | forcing_mate | decisive_advantage | neutralizing_threat`),
  `RawCandidate`, `VerifiedTacticalCandidate` (research §10 fields +
  `analysisId`), `CandidateVerificationStatus`
  (`raw | verified | failed`), `DetectionPassState`
  (`queued | inProgress | completed | failed`), `DETECTION_VERSION = 1`,
  `CANDIDATE_GENERATION_VERSION = 1`.
- `src/domain/tactics/stage1.ts` — `generateCandidates(records, userColor,
  detectionVersion, now): RawCandidate[]`. Deterministic Stage-1 filter:
  user-side plies only (D1); `wpLoss ≥ 10` computed from the record's
  `evalBefore`/`evalAfter` via `winPercentFromCp(cpValueOf(…))` (the ADR-023
  wp-loss metric ADR-026 references); `playedMove ≠ bestMove`; skip
  `inBook`; skip records lacking a usable eval pair; emit the raw-candidate
  metadata ADR-026/research §3 list (`startingFen` = `positionFen`, `bestMove`,
  `bestPv`, `wpLoss`, eval pair, source game/ply, `analysisId`).
- `src/domain/tactics/line.ts` — pure line walking over UCI tokens from a
  starting FEN (chessops replay): per-ply check/capture detection,
  forcingness `(checks + captures)/(2·L)`, material delta (piece values,
  queen = 9), end-of-line evaluation/WDL, draw-rule terminal detection
  (stalemate, insufficient material, 50-move; threefold handled by the
  orchestrator feeding the repetition context where the line crosses game
  history).
- `src/domain/tactics/objective.ts` — classify the tactical objective of one
  engine line (research §3): `winning_material` (material delta ≥ 3),
  `forcing_mate` (`evalMate ≠ null`, mate distance ≤ 8),
  `decisive_advantage` (`|wpEnd − wpStart| ≥ 30`, not the above),
  `neutralizing_threat` (the side to move was forced-lost before the move and
  the move removes it — evaluated from `wdlBefore`/the position before).
- `src/domain/tactics/verify.ts` — Stage-2 core:
  `verifyCandidate(candidate, engineResult, context): { ok: true; candidate:
  VerifiedTacticalCandidate } | { ok: false; reason }`. Walks the
  tactical-profile MultiPV lines until objective reached / > 8 plies /
  stabilised (no check/capture, `evalCp` delta < 30 over two plies); applies
  the ADR-026 guards (no objective; objective reachable by a non-forcing
  alternative first move — §1.4/ADR-026 reading, see Deliverable 0; WDL at
  line end inconsistent with the objective; line > 8 plies; ADR-025 difficulty
  estimate < 15). Emits the §10 schema + `analysisId`.
- `src/domain/tactics/difficulty.ts` — ADR-025 `estimateDifficulty(inputs)`
  (documented canonical helper; reused by the Stage-2 guard with
  `depth = tactical-profile depth 22`, and later by Feature 011 which persists
  difficulty).
- `src/domain/tactics/annotate.ts` — `annotateVerifiedMisses(records,
  verified: readonly VerifiedTacticalCandidate[], detectionVersion):
  readonly MoveAnalysis[]` — immutable merge of `missedTactic` +
  `detectionVersion` onto the owning plies.
- `src/domain/tactics/index.ts` barrel.
- `src/domain/tactics/*.test.ts` — see §8.
- `src/domain/analysis/summaryDerivation.ts` (new, Milestone B) — builds the
  persisted per-analysis summary from a game's completed analysis
  (`MoveAnalysis[]` + `userColor` + analysis job): `summarizeAnalysis` counts,
  `gameAccuracy` (ADR-024) and the detection-state holder. Lives next to
  `summary.ts` because it is the canonical Feature-009-function composition the
  spec demands ("never a second implementation").
- `src/domain/puzzle/index.ts` (barrel) — only if difficulty ends up there
  instead of `domain/tactics` (see D6; keep one location).

**Infrastructure:**

- `src/infrastructure/db/schema/v7.ts` — additive tables:
  - `analysisSummaries: '&analysisId, gameId'`
  - `puzzleCandidates: '&[analysisId+ply], gameId, analysisId'`
- `src/infrastructure/db/summaries-repository.ts` — `AnalysisSummaryRow`
  (`analysisId` pk, `gameId`, `userColor`, user classification counts,
  `accuracy: number | null`, `accuracyMoves: number`, `detectionState:
  DetectionPassState | 'absent'`, `missedTacticCount: number | null` (null
  until `completed`), `detectionVersion: number | null`, `updatedAt`) and CRUD:
  `putForAnalysis`, `getForAnalysis`, `listForAnalysisIds`, `listForGames`,
  `deleteForGames`, `deleteForAnalysis`.
- `src/infrastructure/db/candidates-repository.ts` — `PuzzleCandidateRow`
  (research §10 + `analysisId`, `verificationStatus`, `wpLoss`),
  `bulkPutForAnalysis`, `listForGameAndAnalysis`, `listVerifiedForGame`,
  `updateStatus`, `deleteForAnalysis`, `deleteForGames`.
- `src/infrastructure/tactics/tacticalDetectionService.ts` —
  `TacticalDetectionService` orchestration (see §7) implementing
  `runPassForCompletedJob(job, game, records, signal)` (Stage 1 + Stage 2,
  cache-aware, cancellable, resumable) and `ensureSummariesForRows(gameIds)`
  lazy backfill entrypoint (Milestone B).
- `src/infrastructure/tactics/browser.ts` + `index.ts` — assembly wiring
  repositories + engine + cache into the service and a memoised getter reused
  by the analysis-service assembly.

### Source — modified

- `src/config/app-config.ts` — `PERSISTENCE_SCHEMA_VERSION = 7`.
- `src/infrastructure/db/database.ts` — register the two new tables and
  `applyV7Schema`.
- `src/infrastructure/analysis/analysisService.ts` — optional options
  `summaries?`, `candidates?`, `detection?`; after `markCompleted` write/refresh
  the per-analysis summary (Milestone A writes it with
  `detectionState: 'queued'`; Milestone B fills counts+accuracy); after a
  forced re-analysis `deleteForAnalysis(stored.id)` also clears the analysis's
  summary + candidates; trigger `detection.runPassForCompletedJob(...)` for the
  completed run (abort-aware), sequencing detection after the analysis loop so
  batches stay bounded (D2).
- `src/infrastructure/analysis/browser.ts` — construct and pass the summaries/
  candidates repositories and the detection service.
- `src/infrastructure/db/games-repository.ts` — `deleteGames` transaction
  gains the two new tables (`where('gameId').delete()`).
- `src/domain/analysis/index.ts` / `src/domain/chess/index.ts` — export new
  domain symbols (tactics barrel, summary derivation) as appropriate.
- `src/domain/analysis/classificationMeta.ts` — **the canonical missed-tactic
  marker entry** of the shared Feature-009 presentation tooling:
  `MISSED_TACTIC_NAG = 9`, label/explanation text, `missedTacticMeta()`
  (tone/label via `NAG_META[9]`). This is the *single* place Feature 010 adds
  presentation metadata (no competing mapping anywhere else).
- `src/pages/GameReviewPage.tsx` — Milestone A:
  - `effectiveNagOverrides` per mainline ply: classification NAG (as today)
    **plus** NAG 9 for plies whose persisted record carries
    `missedTactic === true && detectionVersion !== null` (both glyphs render;
    classification is preserved, never replaced).
  - When the active mainline ply is a verified miss, expose a small canonical
    label (title/aria, e.g. "Missed tactic") next to the existing stored
    engine-lines/arrow display (the record's `bestMove` arrow + stored PV of
    the missed position are already shown by the current Review surface —
    reuse only, no new PV rendering). Data-testids preserved + new ones for the
    marker.
  - ReviewSummary missed-tactic chip already renders from `summarizeAnalysis`
    once annotations exist — only keep/assert.
- `src/domain/gameLibrary/filters.ts` — add `analysis:
  'all'|'analyzed'|'notAnalyzed'`, `hasBlunders: 'all'|'yes'|'no'`,
  `hasMissedTactics: 'all'|'yes'|'no'` to `GameLibraryFilters` +
  `DEFAULT_LIBRARY_FILTERS`, equality/active helpers, URL codec (`an`, `hb`,
  `hm` keys), `clearDimension` union.
- `src/domain/gameLibrary/predicates.ts` — `matchesLibraryFilters` extended for
  the three dimensions against the enriched row (semantics per
  `domain/game-library.md`: evaluated from persisted analysis-job status and
  the stored per-analysis summary; absent detection matches neither yes nor
  no).
- `src/domain/gameLibrary/rowView.ts` / `index.ts` — `LibraryGameRow` gains the
  read-only insights fields the strip renders (`accuracy`, classification
  counts, `missedTactics`) and the analysis-result facts the predicates need;
  `libraryRowOf` composes from `GameSummary` + a summary/status overlay object.
- `src/infrastructure/db/game-library-query.ts` (+ a new small
  `analysis-result-query.ts` helper or extended version) — compute the game-id
  restriction for the three dimensions from `analysisJobsRepository` (status
  derivation) + `summariesRepository`; intersect into the pushed-down
  `GameQuery` (`id` ∈ set) so a filter change never scans `MoveAnalysis`.
- `src/hooks/useGameLibrary.ts` — run the new analysis-result query step;
  after listing rows, resolve each row's per-analysis summary (latest completed
  job → summary) for the strip and filter pass; keep the existing search/
  window pass.
- `src/components/games/library/GameLibrary.tsx` — render the insights strip
  (per `domain/game-library.md` + Feature-010 §Game Library Integration: only
  for `completed`/`outdated`, user-side, absent ≠ zero, em-dash for missing
  accuracy, a11y region label). Add `data-testid`s
  (`row-insights-*`).
- `src/components/games/library/GameLibraryToolbar.tsx` — three labelled
  single-select controls (Analysis / Has blunders / Has missed tactics),
  default All, individually clearable, `data-testid`s
  `filter-analysis` / `filter-has-blunders` / `filter-has-missed-tactics`.
- `src/components/games/library/GameLibrary.module.css`,
  `GameLibraryToolbar.module.css` — strip + filter styles, mobile wrapping.
- Tests listed in §8; e2e in `tests/e2e/`.

---

## 5. Domain/data changes

- **No change** to `MoveAnalysis` shape (the reserved `missedTactic` /
  `detectionVersion` contract already exists). Feature 010 *sets* them for
  plies of verified misses of the **latest completed analysis**, in place, via
  the `annotateVerifiedMisses` pure merge + a repository bulk put keyed
  `[analysisId, ply]`.
- **New entity — puzzle candidate** (game-scoped, deleted with its game;
  research §10 schema): natural key `[analysisId + sourcePly]` so detection is
  scoped to the analysis identity that produced it (a re-analysis → new
  identity → new rows; the old identity's rows are removed by the forced
  re-analysis cleanup, matching the existing `deleteForAnalysis` path).
  `verificationStatus`: `raw → verified | failed`; only `verified` rows carry
  `tacticalObjective`/verification metadata; Feature 011 later consumes
  `verified` rows only.
- **New entity — per-analysis summary** (game-scoped): canonical
  Feature-009-function composition (`summarizeAnalysis` counts + `gameAccuracy`,
  ADR-024) plus detection state; created when an analysis run completes
  (`detectionState` starts `queued` for new runs, `absent` for lazy backfills
  waiting on a pass) and updated when the pass completes
  (`missedTacticCount` only then; `0` is a real zero, `null` is absent).
- **New detection-state model** (spec-delegated, recorded in
  `domain/tactics.md`): per analysis identity
  `absent → queued → inProgress → completed | failed`; completion requires every
  raw candidate to have settled (`verified` or discarded) — a `failed` state
  means one or more candidates carry `verificationStatus: 'failed'` and the
  pass is retried on the next verification run (ADR-026 failure modes).
- **Domain versioning** (ARCHITECTURE.md §9): `DETECTION_VERSION = 1`,
  `CANDIDATE_GENERATION_VERSION = 1`, written on every candidate and on every
  annotated record. Guard/threshold changes bump `DETECTION_VERSION`; existing
  records retain theirs.

---

## 6. UI changes

### Milestone A — Game Review

- Move-list: a verified missed move renders its normal classification glyph
  **and** the canonical missed-tactic marker (NAG 9 → `X` glyph from
  `NAG_META`), driven by the shared `classificationMeta` mapping and the
  existing `nagOverrides` array (MoveList already renders multiple NAGs — no
  MoveList change). Ordinary plies unchanged. New assertion points:
  `data-nag="9"`, plus `data-testid` for the marker's presence.
- Summary chip ("N missed tactics") already renders once annotations exist;
  asserted, not re-built.
- Inspection: selecting a marked move shows the existing stored best-move arrow
  and stored engine line of the missed position (reused, not a second PV);
  board exploration lets the user step the tactical continuation as a variation
  (existing ADR-033 surface). No new component, board, or engine-lines path.

### Milestone B — Game Library

- Row insights strip below the termination/move-count meta line (desktop) and
  inside the same card (mobile):
  `Accuracy 78% · Blunders 2 · Mistakes 3 · Inaccuracies 4 · Missed tactics 1`
  — user-side, latest completed analysis, only for `completed`/`outdated`;
  absent data never rendered as zero (accuracy em-dash when
  `gameAccuracy` yields no value; missed-tactic item omitted until the
  detection pass completed). One labelled region per row with full screen-reader
  text; values are text, never color-only.
- Toolbar: three single-select dimensions (Analysis, Has blunders, Has missed
  tactics) following the canonical Library rules (default All, AND, URL
  round-trip, cleared on change, mobile collapsible layout).
- No change to the Analysis cell, progress, empty/no-match states or selection
  semantics.

---

## 7. Infrastructure changes

- **Database**: schema v7 (two additive tables), version guard bump, cascade in
  `deleteGames`, forced-re-analysis cleanup hook in `AnalysisService`.
- **Detection orchestration** (`TacticalDetectionService`, browser assembly):
  - Stage 1 runs inline after an analysis run completes (pure, fast).
  - Stage 2 runs each raw candidate's `tactical`-profile engine job through the
    Feature-005 worker queue behind the ADR-018 cache lookup (cache key via
    `analysisCacheKey` with the candidate's starting FEN + tactical profile +
    engine identity); `resolvePosition`-style abort handling; engine failures
    mark the candidate `failed` (retried next run) instead of failing the pass
    irrevocably (ADR-026 failure modes).
  - As it verifies, it annotates the owning `MoveAnalysis` rows and updates the
    per-analysis summary; pass completes when every candidate settled.
  - Runs inside `analyzeGames`'s completion path (sequenced after the analysis
    loop; cancellable via the run's `AbortSignal`), so no surprise engine work
    starts at app load; failed/partial passes resume piggybacked on the next
    user-initiated analysis run of that game (D2).
  - No engine work on the UI thread anywhere; Library pages only read persisted
    rows/summaries.
- **Library query path**: the three filter dimensions are resolved from the
  `analysisJobs` + `analysisSummaries` tables (indexed by game/analysis) into a
  game-id restriction pushed into the games query; the existing in-memory
  search/window pass completes the result. Never a per-row/ per-filter
  `MoveAnalysis` scan.
- **No new npm dependencies; no network surface; no worker changes.**

---

## 8. Tests

### Milestone A — domain

- `src/domain/tactics/stage1.test.ts` — deterministic `MoveAnalysis` fixtures
  (`makeMove`-built, plus a real missed-tactic game shape from the fixture
  corpus): emits for user mistake/blunder with `wpLoss ≥ 10` and `played ≠
  best`; excludes `good`/`best`, opponent plies, `inBook`, eval-less records;
  exact emitted field assertions (`startingFen`, `bestPv`, `wpLoss`); empty for
  clean games.
- `src/domain/tactics/line.test.ts` — UCI line replay from a FEN: forcingness
  values, material deltas, checks/captures, terminal/draw detection (use the
  existing `enginePositions` fixtures + `li-blitz-blunder` Nxf7 fork line).
- `src/domain/tactics/objective.test.ts` — objective classification for each of
  the four outcomes using deterministic line fixtures; mate ≤ 8; 50-move/
  stalemate rejections.
- `src/domain/tactics/verify.test.ts` — hand-built MultiPV engine results
  (fake `EngineAnalysisResult` shapes): verified pass for a genuine missed
  tactic (e.g. the fork line); rejection for no-objective, quiet-improvement,
  non-forcing-alternative-reaches-objective (ADR-026 §1.4 reading), WDL-mismatch,
  > 8-ply, difficulty < 15; metadata emission (§10 schema + `analysisId`).
- `src/domain/tactics/difficulty.test.ts` — ADR-025 anchor inputs/buckets.
- `src/domain/tactics/annotate.test.ts` — merge leaves non-miss plies intact,
  sets `missedTactic`/`detectionVersion` on the right plies only.
- `src/domain/analysis/summaryDerivation.test.ts` — counts/accuracy/detection
  holder over `classificationScenarios` fixtures; accuracy `null` handling.

### Milestone B — domain/Library

- `src/domain/gameLibrary/filters.test.ts` extension — three dimensions: URL
  round-trip, defaults, equality/active, clear.
- `src/domain/gameLibrary/gameLibrary.test.ts` extension / new
  `analysisFilters.test.ts` — predicate semantics for every Analysis / Yes / No
  outcome and AND combinations, absent-vs-zero missed tactics, `No` never
  matching unanalyzed or undetected games.
- Row-view composition tests (insights present/absent per analysis status).

### Component/page

- `GameReviewPage.test.tsx` — seed a `MoveAnalysis` fixture with
  `missedTactic: true` on a blunder ply: both the classification glyph and the
  missed-tactic marker render; classification label untouched; ordinary plies
  unchanged; summary chip count correct; marker absent when
  `detectionVersion` null.
- `GamesPage.test.tsx` / `GameLibrary` tests — strip rendering for analyzed vs
  unanalyzed fixtures; hidden strip for queued/in-progress/cancelled/failed;
  zero vs absent missed-tactic rendering; the three filter controls; "no games
  match" state; mobile layout.
- Repository tests: `analysis-repositories.test.ts` extension for the two new
  repositories; `v7-migration.test.ts`; `game-deletion-cascade.test.ts`
  extension (summaries + candidates follow their game; engine cache retained);
  forced-re-analysis cleanup test in `analysisService.test.ts`.

### e2e (`tests/e2e/`)

- `game-analysis-review.spec.ts` extension: analyze a fixture game → review
  shows canonical summary and (engine permitting) a marked missed-tactic ply
  with its classification + marker.
- New/extended Library spec: analyze a fixture game → row shows the stats strip
  → filter by Has blunders/missed tactics → visible set + cleared selection
  verified.

---

## 9. Migration considerations

- **Schema v7**: additive only; existing rows untouched. Existing completed
  analyses have **no** summary row and no detection pass ⇒ Library shows the
  strip's classification/accuracy values only after the lazy backfill (D5) and
  missed-tactic item stays absent until a pass runs (absent ≠ zero is the
  documented, tested state). No data rewrite of `MoveAnalysis`.
- **Engine upgrades (ADR-020)**: verified candidates keep the engine identity
  that verified them; re-analysis/opt-in re-verification is future work.
- **Cache**: unchanged; Stage-2 writes tactical-profile results into the
  existing ADR-018 cache (never synced; never purged on game deletion).
- **Doc migration**: Deliverable 0 lands first (AGENTS.md Documentation rule).

---

## 10. Risks

- **Stage-2 cost** (~5 × 15 s+ per game, ADR-026): the run is sequenced after a
  batch's analysis, cancellable, cache-aware, resumable; never on the UI
  thread. If a candidate's tactical run fails mid-pass, its `failed` state +
  the summary's `failed` state keep the Library honest (absent item) and the
  next run retries.
- **Spec wording conflict in research §5 guard 1** (see Deliverable 0): resolved
  by implementing ADR-026 / §1.4; flag to user.
- **Library perf**: the analysis-result filter dimension must never scan
  `MoveAnalysis`. Mitigated by summary/job-id indexed lookups; keep the
  windowed/paginated rendering; assert no per-row rescan in tests.
- **Review glyph density**: a `blunder` + missed-tactic move shows two glyphs.
  Deliberate (spec: indicator added without replacing classification); verify
  layout/a11y text in component tests; iterate CSS only.
- **Detection scope for old analyses**: pre-feature completed analyses show
  absent missed-tactic data until re-analysis (or D5 backfill + a later
  re-run). Consistent with the spec's absent-vs-zero contract; documented in
  `domain/tactics.md`.
- **Difficulty-estimate inputs (ADR-025)**: `M` ("material involved") and
  `depth` (tactical profile = 22, so no depth bonus) are computed from the
  verified line; estimate semantics documented; Feature 011 will persist the
  full formula output with its deep-verification depth later.
- **DB module-drift**: `database.ts` throws on version mismatch; update
  `app-config`, `database.ts`, schema index and ARCHITECTURE.md §7 note
  together.

---

## 11. Acceptance criteria

1. Deliverable 0 (docs) lands before source changes.
2. Stage-1 runs over persisted `MoveAnalysis` with no new engine work; only
   user-side plies with `wpLoss ≥ 10` and `played ≠ best` become raw
   candidates (ADR-026).
3. Stage-2 verifies each raw candidate with the `tactical` profile through the
   ADR-018 cache and applies every ADR-026 guard; unverified/weak candidates
   never receive the `missedTactic` annotation; only verified candidates are
   persisted for Feature 011.
4. A verified candidate contains: starting position, original/user move,
   tactical solution/PV, tactical objective, verification metadata
   (`engineName/Version/Build`, `analysisVersion`, `verificationDepth`,
   `verificationTimestamp`, `wdlAfterBestLine`), `detectionVersion`, source
   game + ply + analysis identity.
5. Game Review shows the canonical missed-tactic marker on the corresponding
   move **without** replacing its classification; the tactical continuation is
   inspectable through the existing stored PV/arrow/exploration surface; no
   second tactical visualization exists.
6. The per-analysis summary is persisted when an analysis completes, is scoped
   to the analysis identity, is game-owned (deleted with the game), and its
   missed-tactic count is written only when a detection pass completed
   (absent ≠ zero).
7. Library rows for `completed`/`outdated` analyses show the user-side strip
   (Accuracy / Blunders / Mistakes / Inaccuracies / Missed tactics) matching
   Game Review's canonical values; all other statuses show no strip; absent
   data is never rendered or filtered as zero.
8. The Analysis / Has blunders / Has missed tactics filters default to All,
   AND with existing filters and search, round-trip through the URL, clear
   selection on change, and are evaluated from persisted jobs/summaries —
   never by scanning `MoveAnalysis`.
9. Rows and filters stay practical for thousands of games (indexed pushes +
   summaries, no per-row rescan).
10. Strip and filters are responsive (tablet/mobile), keyboard-accessible and
    never color-only.
11. Full verification gate passes (§12); no console errors on a `dev` smoke run.

---

## 12. Verification commands

Run from the repo root, narrowest first, then the full gate (AGENTS.md
Execution policy):

```bash
# Milestone A domain
npx vitest run src/domain/tactics
npx vitest run src/domain/puzzle
npx vitest run src/domain/analysis/summaryDerivation.test.ts
# Milestone B domain + repositories + schema
npx vitest run src/domain/gameLibrary
npx vitest run src/infrastructure/db/schema/v7-migration.test.ts
npx vitest run src/infrastructure/db/analysis-repositories.test.ts
npx vitest run src/infrastructure/db/game-deletion-cascade.test.ts
npx vitest run src/infrastructure/analysis/analysisService.test.ts
# Components/pages
npx vitest run src/pages/GameReviewPage.test.tsx src/pages/GamesPage.test.tsx
npx vitest run src/components/games/library
# Full gate
npm run lint
npm run typecheck
npm run format:check
npm run test
npm run build
npm run dev          # manual smoke: analyze a fixture game → review glyphs + Library strip/filters
npm run test:browser # Chromium available
npm audit
```

Commit order:

1. Deliverable 0 — docs (`domain/tactics.md`, `ARCHITECTURE.md` §7). Commit
   message notes the research §5 / ADR-026 guard-reading decision.
2. Domain: tactics + difficulty + summary derivation modules with tests.
3. Persistence: schema v7, repositories, cascade + forced-reanalysis cleanup,
   `app-config`, `database.ts` (with migration/repo tests).
4. Milestone A orchestration: `TacticalDetectionService` + `AnalysisService`
   integration + browser assembly.
5. Milestone A UI: canonical marker in `classificationMeta`, GameReviewPage
   glyph + inspection polish + tests.
6. Milestone B domain/query: filters/predicates/row-view + analysis-result
   query path + hook.
7. Milestone B UI: strip + toolbar controls + styles + component tests.
8. e2e updates + full verification gate (§12).
