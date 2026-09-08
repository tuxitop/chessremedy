# Plan — Feature 011: Tactical Puzzle Generation

> Source of truth: `.opencode/specs/features/011-puzzle-generation.md`. Required
> context per `.opencode/CONTEXT-MAP.md`: ADRs `decisions/ADR-006`,
> `decisions/ADR-025`, `decisions/ADR-026`, `decisions/ADR-012`,
> `decisions/ADR-018`, `decisions/ADR-031`; domain `domain/puzzle-model.md`,
> `domain/tactics.md`, `domain/tactical-training.md`, `domain/game-library.md`;
> research `research/puzzle-generation.md`, `research/tactical-detection.md`.
>
> Pipeline ownership is fixed by ADR-026 / the Feature-010 spec: Feature 011
> **consumes verified candidates only** (`puzzleCandidates` `verified` rows),
> does **no engine work**, does **no candidate generation**, and never
> recomputes difficulty. It owns final puzzle assembly + persistence (schema v8
> `puzzles` table), the generation-pass state machine, the Library row
> insight/action surface, and the read-only per-game puzzle list/preview view.
> The Feature-010 spec's open item 1 is already resolved in code (verified
> candidates persist `difficulty` and `acceptedFirstMoves`), so Feature-011 is a
> pure, engine-free, cache-free consumer of the verified-candidate row
> (verify.ts:643-649; VerifiedTacticalCandidate types.ts:130,154,164).
>
> This plan is organized as stages A–G (domain → persistence → service →
> Library → per-game view → tests/fixtures → docs/gate). Stages are
> dependency-ordered: A → B → C, then D (needs B+C), E (needs B), F rides on
> D/E, G last. Each stage lands independently with its own tests and a narrow
> gate; the full gate runs at the end.

---

## 1. Objective

Turn Feature-010's verified tactical candidates into durable, immutable,
game-scoped **training puzzles** (`features/011-puzzle-generation.md` Goal):

1. **Pure domain assembly** — one verified candidate → one immutable `puzzle`
   row (natural key `[sourceGameId + sourcePly]`), carrying provenance,
   `startingFen`, `userMovePlayed`, `sideToMove`, the verified solution line
   (`bestPv`), `acceptedFirstMoves`, the stored ADR-025 `difficulty`
   (passthrough — never recomputed, depth bonus never applies at depth 22),
   verification metadata copied unchanged, and the version trio
   (`puzzleGeneratorVersion`/`detectionVersion`/`candidateGenerationVersion`).
2. **Persistence** — schema **v8** `puzzles` table (immutable rows, add-only
   on the natural key, game-scoped index) + additive puzzle-generation state
   holders on the per-analysis summary row (older rows simply lack the
   fields), + deletion-cascade extension.
3. **Generation service** — per-analysis pass state machine
   (`absent → queued → inProgress → completed | failed`), auto-trigger when a
   detection pass completes, on-demand Generate/Resume, cancel, live session
   registry, supersede on forced re-analysis, orphan reconciliation. No engine
   and no ADR-018 cache involvement.
4. **Game Library integration** — per-row `puzzleCount` insight with the
   absent-vs-zero contract, generation state notes, and the "Puzzles from this
   game" row action (capability `puzzles`), mirroring the Feature-010
   missed-tactic surfacing.
5. **Read-only per-game puzzle list/preview** — a dedicated card layout with a
   shared Chessground board per puzzle (starting position, read-only),
   difficulty bucket/score, tactical objective, provenance and the expected
   solution; Generate/Resume affordance when the pass is not complete.
6. Deterministic puzzle fixtures (the seven kinds the spec lists), domain /
   repository / service / component tests and one committed-engine e2e proof
   (analysis → detection → generation → Library + per-game view).

No new runtime dependency (Dependency policy: none added).

---

## 2. Scope

### In scope

- Domain puzzle module: row type, `assemblePuzzle` (pure), `sideToMove`
  derivation from the starting FEN, difficulty-bucket helper, `PUZZLE_GENERATOR_VERSION`.
- Schema v8 `puzzles` table + repository (list/count/add-if-absent); summary
  generation-state holders; `deleteGames` cascade; version constant + guard.
- `PuzzleGenerationService` orchestration + `AnalysisService`/assembly wiring
  (auto-trigger, cancel, supersede, live registry, reconcile).
- Library row insights (puzzle state note, real-zero rules) + "Puzzles from
  this game" action + generation affordance.
- New route + page: read-only per-game puzzle list/preview.
- Fixtures + domain/repository/service/component/e2e tests.

### Out of scope (V1 boundary, restated from the spec)

- **No engine work of any kind**: no tactical/MultiPV/`deep` runs, no
  re-verification, no ADR-018 cache reads, no difficulty recomputation, no
  `depthBonus` (depth input stays the tactical verification depth 22).
- Candidate generation / detection (Feature-010). Feature-010 applies no
  difficulty rejection floor; a puzzle-quality threshold is Feature-011 policy
  (owner decision — §10 OQ-1).
- Solving interaction, hints, attempts, post-solve analysis (Feature-012).
- Training-set/cycle lifecycle or per-puzzle scheduling (Feature-013, ADR-031:
  no FSRS / per-puzzle scheduler in V1; `Puzzle` carries no scheduling state).
- Per-puzzle editing/deletion UI (puzzles are removed with their source game).
- Cross-game FEN dedup / transposition merging (two games → two puzzles).
- Branching opponent defences beyond the verified forcing line (`bestPv`).
- Semantic motif labelling (`tacticalMotifs` reserved, unpopulated).
- Puzzle re-rating from solver performance / retroactive re-mapping.
- Sync of derived puzzle/generation data as standalone values (Feature-016
  tombstones only).
- Changing the Feature-010 pipeline, ADR-023/024/025 math, engine/cache
  layers, or `DETECTION_VERSION`/`CANDIDATE_GENERATION_VERSION` (both are
  copied onto puzzles unchanged).

---

## 3. Existing code to reuse

Concrete anchors verified in code (file:line):

- **Verified-candidate input & freshness**: `src/domain/tactics/types.ts`
  (`VerifiedTacticalCandidate` :130, optional `difficulty` :154,
  `acceptedFirstMoves` :164, `DETECTION_VERSION = 10` :71,
  `CANDIDATE_GENERATION_VERSION = 2` :82); `src/domain/tactics/verify.ts`
  (difficulty + accepted moves persisted on every verified candidate
  :577-583, :643-649). Because detection v9 made the persisted detection
  version the freshness key (types.ts:63-70; analysisService/scanGame
  :363-368), a pass run at the current version yields verified rows that
  always carry `difficulty` + `acceptedFirstMoves` — Feature-011 reads only
  `detectionVersion === DETECTION_VERSION` rows.
- **Candidate repository**: `src/infrastructure/db/candidates-repository.ts`
  — `listForGameAndAnalysis` (:113, natural key `[analysisId+sourcePly]`),
  `listVerifiedForGame` (:125, Feature-011 documented input), `deleteForGames`.
- **Summary row = shared state holder**: `src/domain/analysis/summaryDerivation.ts`
  (`SummaryDetectionState` :33, `ScanProgress` :43, `buildAnalysisSummary`
  :134, `detectionHolderFor` absent-vs-zero :114); `src/infrastructure/db/summaries-repository.ts`
  (`AnalysisSummaryRow` :26, `putForAnalysis`/`getForAnalysis`/`listAll`).
- **Detection pass orchestration (the pattern Feature-011 mirrors)**:
  `src/infrastructure/tactics/tacticalDetectionService.ts`
  (`runPassForCompletedJob` :197 — idempotency gate, stale wipe, empty-pass
  real-zero write :265-271, per-candidate settle loop, abort→`queued` writes,
  deferred-failure→`failed`, final `completed` write :453-457; `writeSummary`
  :526); `src/infrastructure/analysis/analysisService.ts` — `startScan` live
  registry + detached pass + crash→`failed` + settle cleanup (:822-874),
  `void this.startScan(...)` auto-trigger after a job completes (:783),
  `writeQueuedSummary` (:792), forced re-analysis supersede path
  `cancelScanAndSettle` (:881) + `clearDetectionState` (:901) + the force
  branch in `runAnalysisBatch` (:595-604), `scanGame` on-demand entry (:337),
  `reconcileOrphans`/`pauseOrphanedDetections` (:418, :437), `scans` map
  (:177). Service option pattern: `detection?: TacticalDetectionService` in
  `AnalysisServiceOptions` (:113) and optional dependency guards everywhere.
- **Assembly/wiring**: `src/infrastructure/analysis/browser.ts`
  (`createBrowserAnalysisService` :35 — constructs detection with the shared
  engine + repositories, memoised getter).
- **Schema/cascade**: `src/infrastructure/db/schema/v7.ts` (additive table
  pattern + docs), `v7-migration.test.ts` (hand-built pre-versioned Dexie
  migration harness), `database.ts` (table registration + version guard :56),
  `src/config/app-config.ts:9` (`PERSISTENCE_SCHEMA_VERSION = 7`),
  `src/infrastructure/db/games-repository.ts` `deleteGames` transaction
  (:240-260 — the cascade-ready dependent-kind list Feature-011 extends),
  `game-deletion-cascade.test.ts` (per-kind cascade expectations).
- **Game Library**: `src/domain/gameLibrary/rowView.ts`
  (`GameActionCapability` already lists `'puzzles'` :26; `GameRowInsights`
  already lists `puzzleCount`/`masteredPuzzleCount` :74-75; the concrete
  action list today is hard-wired in the page, not yet registry-driven —
  `ROW_ACTIONS_BY_CAPABILITY = ['delete']` :86). `src/infrastructure/db/analysis-result-query.ts`
  (`analysisInsightsForGame` :92 — the pure overlay Feature-011 extends);
  `src/hooks/useGameLibrary.ts` (`loadLibraryRows` :77 — where per-game counts
  get fetched); `src/components/games/library/GameLibrary.tsx` —
  `rowInsightItemsFor`/`GameRowInsights` (:900-1043), `DetectionScanAction`
  (:1050 — the model for the generation affordance + `data-testid`
  `row-scan-<kind>-<id>`), `scanProgressVisible` (:1418) + `RowScanProgressBar`
  (:1435), the always-on poll over `activeDetectionGames()`/`liveAnalysisGames()`
  (:197-277), `runScan` optimistic registry (:292), row Review `Link` to
  `/games/:id/review` (:1264), `formatAccuracy` from
  `classificationMeta.ts`, count colours from
  `src/components/analysis/classificationColors.ts` (`missedTacticCountColor`
  :59 — zero-green rule).
- **Board wrapper (shared, mandatory)**: `src/components/chessboard/Chessboard.tsx`
  — controlled `position: ChessOpsPosition`, `interactive={false}` for
  read-only, `orientation`, `boardTheme`/`pieceSet`, `lastMove`, plus
  `BoardContainer`/`useBoardSize` for fluid mobile sizing. FEN→position via
  `src/domain/chess/position.ts` (`parsePositionFen` :17, `fenOf` :30); SAN for
  the a11y solution text via `src/domain/chess/san.ts` (`uciPvToSan` :21).
- **Fixtures & test conventions**: `src/domain/analysis/test-support.ts`
  (`makeJob`, `makeMove`, `makeRecords`, `TEST_ENGINE` — never imported by
  production), `src/infrastructure/analysis/test-support/fakeAnalysisEngine.ts`,
  `src/domain/tactics/verify.test.ts` (hand-authored engine-shaped lines, the
  Nxf7 fork FEN/line corpus), `tacticalDetectionService.test.ts` (real fixture
  game + plan-built records + hand-authored Stage-2 shapes), `GameLibrary.test.tsx`
  (`row-insights-*` assertions), `tests/e2e/game-analysis-review.spec.ts`
  missed-mate proof (:277-333 — deterministic `chesscom:7123456703` game,
  real engine, row + Review assertions), fixture games in
  `src/domain/chess/fixtures/defs.ts` (`li-bullet-missed-mate` :130,
  `li-blitz-blunder` :153, …).

---

## 4. Stages

### Stage A — Domain: puzzle row model, assembly, invariants, fixtures (pure)

**Aim:** the engine-free, deterministic heart of the feature: a puzzle row
type, the candidate→puzzle assembly function, ADR-025 bucket helpers, and the
seven deterministic puzzle fixture kinds — all testable without Dexie, engine
or network.

**Files — new:**

- `src/domain/puzzle/types.ts` —
  - `TacticalObjective` re-exported/imported from `@/domain/tactics` (never
    re-declared);
  - `PuzzleGenerationState = 'queued' | 'inProgress' | 'completed' | 'failed'`
    (mirror of `DetectionPassState`; `'absent'` is the "no field" state on the
    summary row, see Stage B);
  - `PuzzleRow` (the immutable persisted shape): natural-key fields
    `sourceGameId`, `sourcePly`; provenance `analysisId` (the generating
    analysis), `startingFen`, `userMovePlayed`, `sideToMove` (`Color`);
    solution `bestMove`, `bestPv` (UCI), `acceptedFirstMoves` (UCI);
    `tacticalObjective`; `difficulty` (number — the candidate's stored ADR-025
    estimate); verification metadata copied unchanged from the candidate
    (`verificationMetadata`, plus `candidateSolutionLength`); the version trio
    `puzzleGeneratorVersion`, `detectionVersion`, `candidateGenerationVersion`;
    `createdAt`. All fields `readonly`. **No scheduling/training state**
    (ADR-031, puzzle-model.md).
  - `PUZZLE_GENERATOR_VERSION = 1` — ARCHITECTURE §9; bumped only when the
    generator/formula/assembly semantics change (a future ADR, never
    retroactively re-mapping stored scores — ADR-025 Consequences).
- `src/domain/puzzle/assemble.ts` —
  - `assemblePuzzle(candidate: VerifiedTacticalCandidate, now: number): PuzzleRow`
    — pure, total over the Feature-011 input contract. Field mapping per the
    spec "Puzzle assembly": copy provenance + `bestMove`/`bestPv` +
    `acceptedFirstMoves` + `tacticalObjective` + `difficulty` + verification
    metadata + `detectionVersion`/`candidateGenerationVersion`; add
    `puzzleGeneratorVersion` and `createdAt`. **Side to move**: derive the
    mover from `startingFen` (`parsePositionFen` turn) — the position before
    the user's missed move, so the user is always the mover (spec "Side to
    move", AC #3); `userMovePlayed` is provenance only, never the solution.
  - **Invariants** (pure asserts the assembly guarantees, unit-tested):
    1. Difficulty is **copied, never recomputed** — no `estimateDifficulty`
       call exists in Feature-011 code; the row equals the candidate's
       `difficulty` exactly.
    2. `bestPv`/`candidateSolutionLength` are the candidate's verified line —
       no re-walk, no extension.
    3. `acceptedFirstMoves` is copied (defaults to `[bestMove]` when absent —
       mate fast path), never re-derived.
    4. `sideToMove` is the `startingFen` mover.
    5. The row carries no scheduling fields.
- `src/domain/puzzle/buckets.ts` — ADR-025 bucket boundaries as one canonical
  helper for the UI and later Feature-013 ordering:
  `difficultyBucketOf(score): { name: 'Trivial'|'Easy'|'Medium'|'Hard'|'Expert';
  min; max }` over the ADR-025 ranges 0-14/15-34/35-59/60-79/80-100. (The
  formula lives in `domain/tactics/difficulty.ts`; the *buckets* are ADR-025
  display metadata, placed here next to the puzzle model and imported by the
  per-game view. Do not duplicate in the UI.)
- `src/domain/puzzle/objectiveLabel.ts` — small pure label map for the four
  tactical objectives (`winning_material` → "Winning material", …) for the
  per-game view + screen-reader text. (F010 precedent: `classificationMeta.ts`
  owns presentation metadata in the domain; no second mapping in components.)
- `src/domain/puzzle/test-support.ts` — deterministic **verified-candidate
  fixtures** covering the spec's seven kinds, each a hand-authored
  `VerifiedTacticalCandidate` with a legal FEN + walkable UCI line (no engine):
  1. mate-in-one (reuse the `li-bullet-missed-mate` position: user White at
     ply 6 misses `Qxf7#` — `bestPv = ['h5f7']`, objective `forcing_mate`);
  2. mate-in-two / short mating sequence;
  3. material-winning combination (the `verify.test.ts` Nxf7 fork corpus —
     `winning_material`, 3-ply line);
  4. exchange-winning tactic;
  5. a missed-tactical-opportunity puzzle (from a verified candidate of the
     `cc-rapid-missed-tactic` / missed-mate fixture shape);
  6. multi-move combination (≤ 8 plies);
  7. a puzzle with **more than one acceptable first move**
     (`acceptedFirstMoves: [best, alt]`, exercising the alternatives
     persistence contract).
  Provide `puzzleFixture(kind)`/`puzzleRowFixture(kind)` builders
  (candidate-level and assembled-row-level) + a `puzzleFixtures` index, so
  Stage D/E component tests and Stage F repository tests share one source.
- `src/domain/puzzle/index.ts` barrel.
- `src/domain/puzzle/assemble.test.ts`, `src/domain/puzzle/buckets.test.ts`,
  `src/domain/puzzle/test-support.test.ts`.

**Invariants asserted in Stage A tests:** row shape; immutability (no
mutable fields, no scheduling state); difficulty passthrough incl. a
`difficulty: 0` candidate (ADR-025 floor case — a real value, never treated as
absent); side-to-move = FEN mover; alternatives persistence; version-trio
retention; cross-game separation is a *repository* property (two rows share
nothing — assembly is per-candidate); a candidate whose verification came from
the stored-mate fast path (`verificationSource: 'stored-analysis'`) assembles
identically (only the copied metadata differs).

**AC coverage:** #1 (assembly produces exactly one row with the full field
set), #2 (difficulty equals the stored estimate; no recompute path exists), #3
(side to move / provenance), #9 (fixtures deterministic and engine-free).

**Exit check:** `npm run test -- src/domain/puzzle` + focused
`src/domain/tactics/*.test.ts` still green.

---

### Stage B — Persistence: schema v8, puzzles repository, summary holders, cascade

**Aim:** durable, immutable, game-scoped puzzle rows plus the additive
generation-state holders on the shared per-analysis summary row; deletion
cascade extended.

**Files — new:**

- `src/infrastructure/db/schema/v8.ts` — additive `puzzles` table:
  `puzzles: '&[sourceGameId+sourcePly], sourceGameId, analysisId'`.
  - Natural primary key `[sourceGameId + sourcePly]` = the spec's one-durable-
    puzzle-per-game-position key. `sourceGameId` index for per-game
    list/count/cascade; `analysisId` index for provenance/debug and later
    transitive cleanup.
  - Purely additive (new empty table): no `upgrade` backfill.
- `src/infrastructure/db/puzzles-repository.ts` —
  - `PuzzleRow` alias + `PuzzlesRepository`:
    - `addIfAbsent(rows): Promise<number>` — **idempotent add**: skip any row
      whose `[sourceGameId+sourcePly]` already exists (bulk read of existing
      keys, then `bulkAdd` only the missing ones; never `put` — a `put` would
      overwrite an immutable row). Returns rows added. This is the only write
      path Feature-011 uses.
    - `getPuzzle(gameId, sourcePly)`; `listForGame(gameId)` (ordered by
      `sourcePly`); `countForGame(gameId)`; `countForGames(gameIds):
      Promise<Record<GameId, number>>` (Library pushdown — one query over the
      `sourceGameId` index, never per-row scans);
    - `deleteForGames(gameIds)` (cascade);
    - invariant comment block: rows are immutable once written; the repository
      never exposes an update/overwrite for the row body.
  - Dexie impl mirroring `DexiePuzzleCandidatesRepository` structure.
- `src/infrastructure/db/schema/v8-migration.test.ts` — hand-built v7 Dexie
  (mirroring `v7-migration.test.ts`), assert v8 opens with pre-v7/v7 rows
  untouched + empty `puzzles` table.

**Files — modified:**

- `src/config/app-config.ts` — `PERSISTENCE_SCHEMA_VERSION = 8` + comment line
  ("v8 adds the Feature-011 `puzzles` table").
- `.opencode/specs/ARCHITECTURE.md` §7 — schema-version note "currently **v7**"
  → v8 and the persistent-entities/version history line (same commit as the
  DB change, mirroring the Feature-010 plan's docs-with-DB precedent).
- `src/infrastructure/db/database.ts` — register
  `puzzles!: Table<PuzzleRow, [string, number]>`, import `PuzzleRow` from the
  puzzles repository, `applyV8Schema(this)`, bump the guard message to 8.
- `src/infrastructure/db/schema/index.ts` — export `applyV8Schema`.
- `src/domain/analysis/summaryDerivation.ts` — additive generation holders:
  - `SummaryPuzzleState = PuzzleGenerationState | 'absent'` (absent = no
    generation pass exists for the analysis);
  - `BuildAnalysisSummaryOptions` + `PerAnalysisSummary` gain `puzzleState:
    SummaryPuzzleState`, `puzzleProgress: ScanProgress | null`, and
    `puzzleGeneratorVersion: number | null`; the builder keeps the
    absent-vs-zero discipline — a **completed** generation state is the only
    one that may carry `puzzleGeneratorVersion`, and count/zero is *never*
    derived here (puzzleCount = live row count from the puzzles table, Stage D).
  - Defaults: `puzzleState: 'absent'`, `puzzleProgress: null`,
    `puzzleGeneratorVersion: null` (older rows simply lack/absent the fields —
    no migration).
- `src/infrastructure/db/summaries-repository.ts` —
  - `AnalysisSummaryRow` gains the three additive optional fields
    (`puzzleState?`, `puzzleProgress?`, `puzzleGeneratorVersion?`); readers
    treat `undefined` as `'absent'`/`null`;
  - add `patchForAnalysis(analysisId, patch: Partial<AnalysisSummaryRow>)`
    (Dexie `.modify`) so one state machine can update **only its own fields**
    on the shared row without rebuilding the other machine's fields;
  - keep `putForAnalysis` for full-row writes.
- `src/infrastructure/db/games-repository.ts` — `deleteGames` (:240): add
  `this.database.puzzles` to the transaction and
  `await this.database.puzzles.where('sourceGameId').anyOf(gameIds).delete();`.
  Engine cache stays untouched.
- `src/infrastructure/db/game-deletion-cascade.test.ts` — seed puzzle rows for
  the deleted game (build via `assemblePuzzle` from the Stage-A fixtures),
  assert they are removed and the other game's puzzles + the engine cache
  remain.

**Invariants (repository-level, unit-tested):** add-only on the natural key
(re-`addIfAbsent` of the same row is a no-op returning 0 — AC #4); two games
with the same FEN/tactic produce two rows (AC #4/#5); count/list by game are
index-based; deletion removes every puzzle of the game and no other game's
rows (AC #8); a completed-with-0 puzzle state is represented only by
`puzzleState: 'completed'` + zero rows — absent state is `undefined`
(**absent is never zero**); a summary write by one state machine preserves the
other machine's fields (`patchForAnalysis` + read-modify-write tests).

**AC coverage:** #4, #5 (immutability + add-only mechanics), #8 (cascade);
foundational for #6/#7.

**Exit check:** `npm run test -- src/infrastructure/db` (incl.
`database.test.ts`, migration + cascade suites) + `npm run typecheck`.

---

### Stage C — Generation service: pass state machine, triggers, registry

**Aim:** orchestration that mirrors `TacticalDetectionService`, but with pure
assembly + batched IndexedDB writes and **no engine/cache dependency**.

**Files — new:**

- `src/infrastructure/puzzles/puzzleGenerationService.ts` — `PuzzleGenerationService`
  with an interface mirroring the detection service's surface:
  - `runPassForAnalysis(analysisId, game: {id, userColor}, signal?)` — the pass
    over one analysis identity:
    1. Load the summary; **idempotency gate**: if `puzzleState === 'completed'`
       (for this analysis) return without touching anything. Reset/gate on the
       **detection freshness precondition**: only run when the summary's
       `detectionState === 'completed'` and `detectionVersion ===
       DETECTION_VERSION` (mirror of the scanGame freshness check,
       analysisService.ts:363-368); otherwise leave the state `absent` and
       return (the Library renders the Feature-010 note — spec "States, errors
       and edge cases").
    2. Read the analysis's verified candidates:
       `candidates.listForGameAndAnalysis(gameId, analysisId)` filtered to
       `verificationStatus === 'verified' && detectionVersion ===
       DETECTION_VERSION` (freshness — guarantees `difficulty` +
       `acceptedFirstMoves` are present, see Stage A). `total` = that set's
       size; an empty set completes normally (real "no puzzles generated by
       this analysis") — write `puzzleState: 'completed'`,
       `puzzleProgress: {done:0, total:0}`, `puzzleGeneratorVersion` (AC #6).
    3. Persist `puzzleState: 'queued'` (scheduled) then `'inProgress'` with
       `puzzleProgress {done: 0, total}`.
    4. For each verified candidate (ordered by `sourcePly`):
       `assemblePuzzle(candidate, PUZZLE_GENERATOR_VERSION, now)` then
       `puzzles.addIfAbsent([row])` (already-present `(game, sourcePly)` rows
       are skipped — the resume/idempotency path). After each settled
       candidate advance + persist `puzzleProgress` (one small patch write per
       candidate, ≤ the 16-candidate cap — spec Performance). Abort at the
       next candidate boundary on `signal`: write `puzzleState: 'queued'` with
       progress (resumable — already-written rows are skipped on resume via
       the natural key). A write/assembly error interrupts the pass →
       `puzzleState: 'failed'` (already-written rows persist; retried via the
       same entry point).
    5. On full success write `puzzleState: 'completed'`, final
       `puzzleProgress`, `puzzleGeneratorVersion`.
    - All summary updates go through `summaries.patchForAnalysis` (Stage B) so
      detection fields and classification counts are never clobbered; the
      reverse is handled in Stage C's analysisService modification + a guard in
      the detection service's summary writes (below).
  - Note in the module header: engine-free by construction (no `EngineService`,
    no cache import); bounded by `MAX_CANDIDATES_PER_GAME` (16) via the
    verified-candidate count.
- `src/infrastructure/puzzles/index.ts` + `browser.ts` — assembly without the
  engine: repositories (`puzzles`, `candidates`, `summaries`) + `now`;
  memoised `getBrowserPuzzleGenerationService()`.

**Files — modified:**

- `src/infrastructure/analysis/analysisService.ts` —
  - `AnalysisServiceOptions` gains `generation?: PuzzleGenerationService | null`
    (mirror of `detection?`, :113).
  - **Auto-trigger hook (the shared choke point):** in `startScan`'s settled
    `done` continuation (:835-870), after the detection pass settles, read the
    summary of that analysis and — when `detectionState === 'completed' &&
    detectionVersion === DETECTION_VERSION` — schedule
    `generation.runPassForAnalysis(job.id, {id, userColor})` detached via a new
    `startGeneration(job, game)` helper that registers the pass in a new
    in-memory `generations` map (`{controller, done}`), exactly mirroring
    `scans`/`startScan`. Because both the automatic post-analysis scan and the
    on-demand `scanGame` entry run through `startScan`, **both** completion
    paths auto-trigger generation (spec "Trigger & scheduling": automatic +
    after a resumed scan completes). Generation never blocks the analysis
    queue and never touches the engine FIFO.
  - **Supersede on forced re-analysis**: in the `force` branch (:595-604),
    before clearing the superseded identity, abort + settle any live/queued
    generation pass of that game (`cancelGenerationAndSettle`, mirror of
    `cancelScanAndSettle` :881) — already-created puzzles persist (Stage-B
    add-only repository); the new run starts its own pass from `absent` once
    its detection completes.
  - **Live registry + cancel + reconcile**:
    - `activeGenerationGames(): Promise<GameId[]>` (from the `generations`
      map) and `cancelGeneration(gameId)` (abort the live pass → it leaves the
      summary `queued`/resumable) — exposed for the Library poll + per-game
      view;
    - extend `reconcileOrphans`/`pauseOrphanedDetections` (:418-459) to also
      relabel owner-less `inProgress` **generation** state to `queued`
      (report `pausedGenerations` in `ReconcileResult`);
    - `clearPausedAnalysisJobs` (:469): no change needed — a stuck (never
      completed) analysis can have no puzzles (generation only starts after
      detection completed), and completed analyses are never "stuck".
  - `clearDetectionState` (:901) — also reset/patch the summary's puzzle fields
    (deleting the summary already covers forced re-analysis, which deletes the
    row entirely; the extra guard is for the refresh-scan path below).
- `src/infrastructure/analysis/browser.ts` — construct the generation service
  (no engine) and pass it to `AnalysisService`.
- `src/infrastructure/tactics/tacticalDetectionService.ts` — **state-field
  preservation guard**: the detection service's full-row `writeSummary`
  (:526-562) rebuilds the summary from `buildAnalysisSummary`, which would drop
  puzzle fields. Change: when the pass **starts** a (re)derivation (the stale-
  wipe / first `queued`/`inProgress` write), explicitly **reset** the puzzle
  fields to absent (a re-run's old puzzle verdict is stale); for every later
  write in the same pass carry the existing row's puzzle fields through the
  rebuilt row (read-modify-write). This is the one place detection and
  generation share the row concurrently, and the two state machines can only
  overlap during a detection refresh of an already-generated analysis — the
  guard makes the reset deterministic. Tests cover both directions (Stage F).

**Invariants (service-level):** pass state transitions are acyclic
(`absent → queued → inProgress → completed | failed`, resumable from `queued`);
generation is idempotent per analysis identity (re-run / resume / retry /
later analysis over the same positions writes only absent `(game, sourcePly)`
rows — AC #4/#5); completed-with-0 verified candidates = real
`completed`/zero-row result, never `absent`; a pass never runs while detection
is `absent/queued/inProgress/failed` or its version is stale; supersede never
deletes puzzle rows; no engine/cache types are imported by the generation
service.

**AC coverage:** #2 (no deep run exists anywhere in the feature), #4, #5, #6
(state machine + real-zero + auto-trigger after detection completes).

**Exit check:** new `puzzleGenerationService.test.ts` + full
`tacticalDetectionService.test.ts`/`analysisService.test.ts` still green
(their summary assertions must not break from the new fields), `npm run
typecheck`.

---

### Stage D — Game Library integration: puzzleCount insight + row action

**Aim:** per-row truthful puzzle surfacing with the absent-vs-zero contract,
the generation-state notes, and the "Puzzles from this game" action.

**Files — modified:**

- `src/domain/gameLibrary/rowView.ts` — extend the read-model (types mostly
  pre-declared: `puzzleCount?` :74, `puzzles` capability :26):
  - `GameRowInsights` gains `puzzleState?: SummaryPuzzleState` and
    `puzzleProgress?: { done, total } | null` (the row needs the generation
    state + live progress to render notes/bar; the *count* stays the actual
    row count);
  - document the puzzle absent-vs-zero contract next to the missed-tactic
    fields (mirror of :44-65).
- `src/domain/gameLibrary/predicates.ts` — **no filter dimension in V1**
  (the spec only owns the row insight + action; Feature-014 may add filters).
- `src/infrastructure/db/analysis-result-query.ts` — `analysisInsightsForGame`
  (:92) becomes:
  - add an optional per-game puzzle-count input (`countsByGame:
    Readonly<Record<GameId, number>>`); the insight derivation gains:
    - detection-gating first (unchanged `hasCompletedDetection`/freshness),
    - then `puzzleState`/`puzzleProgress` from the summary,
    - and `puzzleCount` **only when** `puzzleState === 'completed'` (the real
      row count from the table; `0` is real). Every other state → no
      `puzzleCount` value + `puzzleState` present so the row can render the
      truthful note.
  - keep the function pure; counts are a parameter (never a repository import
    in the pure layer).
- `src/hooks/useGameLibrary.ts` — `loadLibraryRows` (:77-118): alongside jobs
  + summaries, fetch `puzzlesRepository.countForGames(ids)` for the listed
  rows and pass the map into the insight overlay.
- `src/components/games/library/GameLibrary.tsx` — the Feature-010 precedents
  extended:
  - `rowInsightItemsFor` (:900): when `puzzleState === 'completed'` push
    `{ key: 'puzzles', testId: 'row-insights-puzzles', text: 'Puzzles N', spoken
    … }` (neutral color; zero reads green via the existing zero-rule palette —
    reuse `ZERO_COUNT_COLOR`); for non-completed states push the state note
    exactly like the detection items (:938-995):
    - detection not completed/outdated → **no puzzle item** (the Feature-010
      note already tells the truth — spec "Row puzzleCount");
    - `puzzleState 'absent'` → "Puzzles not generated" (+ Generate affordance);
    - `'queued'/'inProgress'` → "Generating puzzles…" **only while the service
      reports the game live** (new `generationRunning` prop fed from
      `activeGenerationGames()`, mirror of `activeDetectionIds`), else
      "Puzzle generation interrupted";
    - `'failed'` → "Puzzle generation failed" (+ Resume).
  - New `PuzzleGenerationAction` component (mirror of `DetectionScanAction`
    :1050): rendered when detection is completed/fresh and
    `puzzleState ∈ {absent, queued, inProgress, failed}` — labels "Generate
    puzzles" / "Resume puzzle generation" / "Retry puzzle generation"
    (`data-testid="row-puzzles-generate-<id>"` etc.); calls a `runGeneration`
    callback → `analysisService.generatePuzzles(gameId)` (new optional
    `AnalysisServiceLike` member backed by the service; optimistic registry
    update like `runScan` :292).
  - Live progress strip while a generation pass is genuinely running: reuse
    `scanProgressVisible`/`RowScanProgressBar` shape with a new
    `puzzleProgressVisible(row, live)` + bar reading `row.puzzleProgress`
    ("Generating puzzle X of Y") — only while live (spec Accessibility:
    interrupted passes never announce progress).
  - Always-on poll (:197-277): also poll `activeGenerationGames()`; reload rows
    when a generation pass settles; throttle-reload while one is live (generation
    is short — ≤16 rows — but the contract is identical to the scan poll).
  - "Puzzles from this game" row action: an `IconButton`/link in the
    `AnalysisCell` action cluster (:1262-1336) for completed/outdated rows
    (`data-testid="game-puzzles-<id>"`, label "Puzzles from this game"),
    linking to `/games/:id/puzzles` (Stage E). Always reachable for a
    completed/outdated analysis — opening the view on an empty/not-yet-
    generated game shows the view's empty/state-note state (the affordance
    never implies a zero count — spec "Row action").
  - Keep the page's direct-action pattern (the capability registry declares
    the contract in `rowView.ts`; concrete wiring follows the existing
    hard-wired `AnalysisCell`/`DetectionScanAction` precedent — see §10 R-3).
- `src/hooks/useGameAnalysis.ts` — `AnalysisServiceLike` gains optional
  `activeGenerationGames?()`, `generatePuzzles?(gameId): Promise<outcome>`,
  `cancelGeneration?(gameId)`, `reconcileOrphans` result extension (mirror of
  the scan members :43-69). `fakeAnalysisService` gains matching fakes.
- `src/components/analysis/classificationColors.ts` — add
  `puzzleCountColor(count)` (zero-green rule) **or** reuse `ZERO_COUNT_COLOR`
  inline; pick one canonical helper so Feature-013/014 reuse it.

**Invariants (component/derivation):** absent ≠ zero everywhere (a row never
renders a number before the latest completed analysis's generation pass
completed); a real zero renders only when `puzzleState === 'completed'` and
zero rows exist (AC #6); rows without a completed analysis show no puzzle item
(Feature-008 rules unchanged); the count is the persisted `puzzles` row count,
never a candidate/`MoveAnalysis` scan; "Generating…"/progress render only for
a live in-session pass.

**AC coverage:** #6, #7 (row count + action wiring, no engine).

**Exit check:** `npm run test -- src/components/games/library` + GameLibrary
component tests + `analysis-result-query.test.ts`.

---

### Stage E — Read-only per-game puzzle list/preview view

**Aim:** a dedicated, deliberate route (`/games/:id/puzzles`) listing the
game's puzzles as cards — board, difficulty, objective, provenance, expected
solution — with the Generate/Resume affordance, fully read-only.

**Files — new:**

- `src/pages/GamePuzzlesPage.tsx` (lazy-loaded like `GameReviewPage`):
  - Loads `game = gamesRepository.getGame(id)`, the game's puzzle rows
    (`puzzlesRepository.listForGame(id)`), the latest completed analysis's
    summary (generation state/progress), and the live-generation flag from the
    shared service. No engine, no cache.
  - Header: game label + back link to the Library; generation state line
    (per-game truth: "Puzzles not generated" / "Generating puzzle X of Y…" only
    while live / "Generation interrupted — resume" / "Generation failed —
    retry" / "N puzzles"); Generate/Resume/Retry button when the pass is not
    complete (spec "Per-game puzzle list/preview" + Accessibility).
  - Puzzle cards (deliberate cards, not a shrunk table — Responsive/mobile):
    - read-only Chessground board of `startingFen` via the shared wrapper:
      `Chessboard position={positionOf(fen)} interactive={false}
      orientation={sideToMove}` under `BoardContainer`/`useBoardSize` (fluid on
      mobile); `parsePositionFen` → chessops `Position`.
    - difficulty: bucket name + score (`difficultyBucketOf`), spelled out for
      AT;
    - tactical objective (`objectiveLabel`); provenance text: "Move N (ply P)" +
      "You played X · Solution Y…" using `uciPvToSan` over the replay of
      `startingFen` for the spoken/visible solution, engine + detection/
      generator version metadata where useful;
    - solution line + accepted alternatives shown as SAN (read-only display,
      no solve interaction — Feature 012 owns solving).
  - Empty state (no rows + generation not complete) renders the state note, not
    a zero. Keyboard focus managed on open/close; labelled region per card.
- `src/pages/GamePuzzlesPage.test.tsx` — component tests rendering fixture
  puzzles with **no engine** (fake service + repositories over
  fake-indexeddb); assert board host present, difficulty bucket + objective +
  provenance text, empty/state-note states, mobile card layout, keyboard/AT
  behaviour, Generate affordance wiring.
- `src/components/games/puzzles/` — the card/list components (or keep them in
  the page file if small; prefer a small component folder mirroring the
  Library layout so CSS stays per-surface).

**Files — modified:**

- `src/app/router.tsx` — lazy route `games/:id/puzzles` (mirror of
  `games/:id/review` :42-48).
- `src/app/routes.ts` if it enumerates review-style routes.
- `src/components/games/library/GameLibrary.module.css` (action glyph) + new
  `GamePuzzlesPage.module.css`.

**Invariants:** the view never mutates puzzle/game/analysis data (no solve, no
attempts, no post-solve analysis, no re-generation controls beyond the
Generate/Resume state affordance); boards are non-interactive; all essential
actions are reachable by keyboard/touch; layout works on desktop/tablet/mobile
in both themes.

**AC coverage:** #7 (per-game puzzle list — board, difficulty, objective,
provenance — without an engine), #9 (component fixtures, no engine/network).

**Exit check:** page component tests + a manual `npm run dev` smoke (open a
game with seeded puzzles, check board renders read-only, resize to mobile
viewport).

---

### Stage F — Fixtures consolidation + tests (repository/service/component/e2e)

Stage A introduced the domain fixtures and Stage A–E each carry their own
focused tests. Stage F closes the gaps the spec's Testing requirements list:

- **Domain/unit** (`src/domain/puzzle/assemble.test.ts` + additions): every
  acceptance-criteria-1-3 property, zero-difficulty passthrough, seven fixture
  kinds all assemble to well-formed rows (spec "Fixture puzzles").
- **Repository** (`src/infrastructure/db/puzzles-repository.test.ts`):
  natural-key put/get/list-by-game/count, idempotent re-add returns 0 and
  leaves the original row byte-identical, per-analysis generation-state
  holders (patch preserves detection fields and vice versa), cascade deletion
  with the game (`game-deletion-cascade.test.ts` extended in Stage B).
- **Service** (`src/infrastructure/puzzles/puzzleGenerationService.test.ts`,
  mirroring `tacticalDetectionService.test.ts` style over the real
  `li-bullet-missed-mate` fixture + hand-authored verified rows):
  - auto-trigger fires when a detection pass completes (both the post-analysis
    path and the on-demand `scanGame` path), including the **zero-candidate**
    completion (real zero, AC #6);
  - no-trigger while detection is absent/queued/inProgress/failed or stale
    (freshness);
  - idempotency: re-run/resume adds no duplicate rows (AC #4); interrupted
    pass → `queued` + resume skips already-written rows; failure → `failed`
    + retry;
  - two games, same tactic → two puzzles (AC #4/#5); re-analysis (new
    analysisId, or forced re-analysis of the same identity) never deletes or
    replaces existing puzzles and adds only absent `(game, sourcePly)` rows
    (AC #5);
  - supersede: forced re-analysis cancels a live/queued generation pass and
    the new run starts from `absent`;
  - cancel mid-pass leaves `queued` + partial rows; reconcile relabels
    orphaned `inProgress` generation state to `queued`;
  - detection-service summary writes never clobber puzzle fields and reset
    them on a fresh pass (and the reverse via the generation service).
- **Component** (`GameLibrary.test.tsx` + `GamePuzzlesPage.test.tsx`): row
  `puzzleCount` across absent/queued/inProgress(only-live)/failed/completed-
  zero/completed-N, state-note + generate action rendering, action opens the
  per-game view, view renders the fixture puzzles with no engine, empty/state-
  note states, mobile + AT behaviour (spec "Testing requirements" +
  Accessibility).
- **End-to-end** (`tests/e2e/`, extending the Feature-010 committed-engine
  proof in `game-analysis-review.spec.ts` or a sibling spec): the deterministic
  `chesscom:7123456703` missed-mate game is analyzed with a real engine; the
  detection pass completes; the generation pass then auto-completes; the test
  asserts a genuine puzzle appears in **both** the Library row count
  (`row-insights-puzzles` "Puzzles 1") and the per-game puzzle view
  (board + expected `forcing_mate` objective + difficulty + provenance —
  e.g. ply 6, "you played d3", solution Qxf7). Proves the whole chain with a
  real engine + a real verified candidate (spec "End-to-end"). Guarded by the
  same Chromium availability / serial mode as the existing specs.

**AC coverage:** all nine, with #1–#9 mapped in §11.

---

### Stage G — Docs, version notes, full gate

**Files — modified (docs only):**

- `.opencode/specs/domain/puzzle-model.md` — append the Feature-011-owned
  generation-pass state model (`absent → queued → inProgress → completed |
  failed` per analysis identity), the absent-vs-zero contract, and the
  immutable-row natural-key invariants, mirroring the precedent where the
  Feature-010 plan appended the detection state model to `domain/tactics.md`.
- `.opencode/specs/features/011-puzzle-generation.md` — only if a doc-vs-code
  conflict is found during implementation; otherwise no change (open items
  stay open: item 2's ADR-025 depth clarification belongs to ADR-025, item 3
  is research reconciliation).
- `src/config/app-config.ts` comment already updated in Stage B; the database
  guard message in Stage B.
- **Version note:** Feature-011 introduces `PUZZLE_GENERATOR_VERSION = 1`
  (new constant); it **does not bump** `DETECTION_VERSION` or
  `CANDIDATE_GENERATION_VERSION` (no Feature-010 rule changes here). The
  version trio is copied onto every puzzle (ARCHITECTURE §9, ADR-020).

**Full gate:** `npm run lint`, `npm run typecheck`, `npm run format:check`,
`npm run test`, `npm run build`, `npm run dev` smoke (no console errors),
`npm run test:browser` when Chromium is available, `npm audit`.

---

## 5. Domain/data changes (consolidated)

- **New entity — `Puzzle`** (`domain/puzzle-model.md`, ADR-006/031): immutable,
  game-scoped, no scheduling state, natural key `[sourceGameId + sourcePly]`
  (one durable puzzle per game position; re-analysis and idempotent re-runs
  never overwrite — spec Deduplication & re-analysis).
- **Difficulty** = the candidate's stored ADR-025 estimate at the tactical
  verification depth (22), copied unchanged; `depthBonus` never applies to V1
  engine-verified puzzles; no deep (30) confirmation run exists anywhere in
  this feature (AC #2, ADR-025 Consequences + spec Difficulty).
- **Side to move** = the `startingFen` mover (the user at their missed decision
  point); `userMovePlayed` is retained as provenance only.
- **Generation-pass state** = additive holders on the per-analysis summary row
  (`puzzleState`, `puzzleProgress`, `puzzleGeneratorVersion`); older rows lack
  the fields; `absent` generation is never rendered as a zero.
- **Versioning:** `puzzleGeneratorVersion` (new, 1) + copied
  `detectionVersion`/`candidateGenerationVersion` + engine metadata on every
  row.
- **Ownership/deletion:** puzzles follow their source game
  (ARCHITECTURE §7, game-library.md §8); no orphaned puzzle may remain.

---

## 6. UI changes

Library row insight strip gains the puzzle count/state note; a per-row
"Puzzles from this game" action; the generation affordance (Generate/Resume/
Retry) + live progress bar under completed-analysis rows; a new read-only
per-game puzzle route with card layout + shared read-only Chessground boards.
Light/dark themes via existing CSS tokens; a11y via labelled regions,
spelled-out numbers, `aria-live` only while a pass is live, keyboard + touch.

---

## 7. Infrastructure changes

Schema v8 (`puzzles` table); puzzles repository; puzzle-generation service +
browser assembly; analysis-service wiring (auto-trigger, cancel, supersede,
live registry, reconcile); summary repository `patchForAnalysis`; deletion
cascade extension; DB version guard bump. No engine, no worker, no cache, no
new dependency.

---

## 8. Tests

Spread across the stages (A–F): pure assembly/bucket/fixture tests; migration
+ repository tests; service state-machine/idempotency/resume/cancel/supersede
tests; component tests for the Library row and the per-game view (no engine);
one committed-engine e2e proof. All domain/service fixtures are deterministic
and engine-free.

---

## 9. Migration considerations

- **Schema v8** is purely additive (new empty `puzzles` table); v1–v7 rows are
  untouched (migration test mirrors `v7-migration.test.ts`).
- **Summary rows** gain optional puzzle fields — no backfill, no data
  migration; `undefined` = absent.
- **Legacy analyzed games** whose latest completed analysis has a completed
  detection result but no generation fields render "Puzzles not generated"
  with the on-demand Generate affordance (never a zero); the summary lazy
  backfill (`ensureSummariesForRows`) is unchanged and the new fields default
  to absent.
- **Legacy verified candidates** without `difficulty`/`acceptedFirstMoves`
  are pre-detectionVersion-9 rows; the freshness gate already wipes and
  re-derives them on the next scan, so the generation pass only ever reads
  fresh rows that carry both fields (defensive skip + refresh note in Stage C).
- **Existing puzzle rows** survive re-analysis, detection refreshes, and
  engine upgrades unchanged (immutability, ADR-020) — no re-rating, no
  retroactive re-mapping.

---

## 10. Risks & open questions

**Owner decisions (product rule — flag, do not silently choose):**

- **OQ-1 — Puzzle-quality threshold.** The spec leaves open whether
  Feature-011 applies its own quality threshold when promoting verified
  candidates into training puzzles ("Feature-011 decides whether a
  *puzzle-quality* threshold applies… Game-Review surfacing is unaffected").
  Options:
  - **(a) No threshold in V1 (recommended).** Every verified candidate of the
    latest completed analysis (≤ 16/game) becomes a puzzle. Matches Feature-010
    `detectionVersion` 5's "a tactic the user genuinely missed surfaces however
    easy a puzzle it would make"; keeps the pass semantics simple (completed =
    processed all verified candidates, real zero only when zero candidates);
    difficulty-based selection belongs to Feature-013 set criteria. Risk:
    trivial one-move mates enter the puzzle pool — acceptable for personal
    training; ADR-025 buckets still let sets filter later.
  - **(b) A difficulty floor (e.g. `difficulty >= 15`, the "Easy" minimum).**
    Mirrors the pre-`detectionVersion`-5 wording in ADR-025 Consequences §
    ("Feature 010 rejects candidates below 15" — stale text this plan would
    need to correct). Consequence: a completed generation pass can yield zero
    rows while verified candidates exist — fine per the state machine, but the
    "what you missed" training story is weakened and the count no longer
    tracks the verified-candidate set.
  Recommend (a); if (b), ADR-025 Consequences and the Feature-010 spec's
  detectionVersion-5 note must be reconciled in the same change.

**Design decisions with recommended resolutions (implementation-level; raised
here because the spec delegates them):**

- **R-1 — Auto-trigger hook location.** The detection pass completes inside
  `TacticalDetectionService.runPassForCompletedJob`, but both invocation paths
  (post-analysis auto-scan and on-demand `scanGame`) run through
  `AnalysisService.startScan`'s settled `done` continuation
  (analysisService.ts:835-870). **Resolution:** hook generation there as a
  sibling of detection (optional `generation?` dependency, like `detection?`),
  gated on the settled summary reading `completed` + current
  `DETECTION_VERSION`. This keeps detection unchanged, centralizes supersede +
  registries + reconcile in the app service, and covers both trigger paths in
  one place. Alternative (trigger inside the detection service at its final
  `completed` write) couples detection → generation; rejected unless the owner
  prefers depth-2 composition.
- **R-2 — Shared summary-row state coexistence.** Generation state and
  detection state live on the same per-analysis row (spec: additive holders on
  "the per-analysis summary row"). **Resolution:** additive optional fields +
  a `patchForAnalysis` partial-update path; detection's full-row `writeSummary`
  resets puzzle fields only when it starts a fresh (re)derivation and carries
  them through otherwise. Overlap can only occur during a detection refresh of
  an already-generated analysis; the reset is deterministic and tested.
- **R-3 — Capability-registry extension point.** `rowView.ts` declares the
  `puzzles` capability + `puzzleCount` insight, but the Library page wires row
  actions directly (`AnalysisCell`, `DetectionScanAction`); the registry is not
  yet a pluggable action provider. **Resolution:** extend the rowView types and
  document the contract, then follow the existing hard-wired page pattern for
  the concrete button/notes (as Feature-010 did for scans). A pluggable action
  provider refactor is out of scope.
- **R-4 — Per-game puzzle view shape.** Route `/games/:id/puzzles` (mirror of
  `/games/:id/review`) rather than a modal: survives navigation, has a stable
  URL, mobile-friendly, and Feature-013 can hand off its set-building entry
  point there.
- **R-5 — Puzzle identity.** The natural key `[sourceGameId + sourcePly]` is
  the row key; no separate public id is minted in V1 (Feature-012/013 attempt
  and set-membership references can use a derived `puzzleId` string when those
  features land — no schema change needed).
- **R-6 — Stale-detection rows.** A latest-completed-analysis detection result
  from an older `DETECTION_VERSION` is outdated (plan-015 freshness gate):
  puzzle count/state notes are suppressed with it (the "out of date" note
  applies) even if puzzle rows exist; the "Puzzles from this game" action stays
  reachable so the immutable rows remain inspectable. Refresh scan re-runs
  generation after re-completed detection.

---

## 11. Acceptance criteria (spec #1–9 → stage)

| # | Criterion | Covered in |
|---|-----------|------------|
| 1 | Assembly → exactly one immutable row per `(game, sourcePly)` with FEN, user move, solution line, objective, alternatives, difficulty, verification metadata, generator version | Stage A (+F tests) |
| 2 | Difficulty = Feature-010 ADR-025 estimate at depth 22; no deep run; `depthBonus` never applies | Stage A invariant + Stage C (no engine import) |
| 3 | Side to move = user's color at the position before the missed move; original move retained as provenance | Stage A |
| 4 | Re-running adds no duplicates; two games, same tactic → two puzzles | Stage B repo + Stage C service |
| 5 | Re-analysis never deletes/replaces existing puzzles; adds only absent `(game, sourcePly)`; membership/attempts untouched | Stage B/C |
| 6 | Zero-verified-candidate detection → completed generation + real `0`; not-completed generation → state note, never zero | Stage C + Stage D |
| 7 | Library row `puzzleCount` (absent-vs-zero) + "Puzzles from this game" → read-only per-game list (board, difficulty, objective, provenance), no engine | Stage D + E |
| 8 | Deleting a game deletes its puzzles; no orphans | Stage B |
| 9 | Deterministic fixtures, engine/network-free | Stage A + F |

---

## 12. Verification commands

Narrow-first per stage, full gate at the end (AGENTS.md Execution policy):

```text
# Stage A
npm run test -- src/domain/puzzle src/domain/tactics
# Stage B
npm run test -- src/infrastructure/db
# Stage C
npm run test -- src/infrastructure/puzzles src/infrastructure/tactics src/infrastructure/analysis
# Stage D
npm run test -- src/components/games/library src/infrastructure/db/analysis-result-query.test.ts
# Stage E
npm run test -- src/pages/GamePuzzlesPage.test.tsx
# Stage F
npm run test   # full unit/component suite
# Full gate (Stage G)
npm run lint
npm run typecheck
npm run format:check
npm run test
npm run build
npm run dev          # smoke: import/analyze → detect → generate → Library row → per-game view; no console errors
npm run test:browser # e2e incl. the generation proof spec (Chromium available)
npm audit
```
