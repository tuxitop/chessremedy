# Plan — Feature 013: Tactical Training Cycles

> Source of truth: `.opencode/specs/features/013-tactical-training-cycles.md`.
> Required context per `.opencode/CONTEXT-MAP.md`: `ARCHITECTURE.md` §7/§9/§10;
> ADRs `decisions/ADR-031`, `decisions/ADR-025` (difficulty-ordering default),
> plus the spec's own Context list and the consumer overlap with
> `decisions/ADR-023`, `decisions/ADR-026`, `decisions/ADR-033`; domain
> `domain/tactical-training.md`, `domain/puzzle-model.md`,
> `domain/game-library.md`, `domain/statistics.md`; research
> `research/cycle-training.md`. Feature-014 §8 is the metric contract this
> feature implements and shares.
>
> Feature 013 is the **training lifecycle**: fixed `trainingSets` and repeated
> `trainingCycles` over them (ADR-031). It replaces the interim `/puzzles`
> practice host with the real cycle host, owns set creation/management and the
> cycle start → resume → complete → abandon → repeat lifecycle, hosts Feature
> 012's `SolveScreen`/`usePuzzleSolve` under **real cycle ids**, and introduces
> the single canonical cycle-metric function Feature 014 reuses. It never runs
> the engine, never touches the network, never mutates a `PuzzleRow`, and never
> schedules puzzles individually.
>
> This plan is organized as stages A–H (domain → persistence → services → host
> contract → set UI → cycle UI + interim-host removal → test closure → docs +
> full gate). Stages are dependency-ordered: A → B → C → D; E needs A+B+C; F
> needs D+E; G closes over A–F; H last. Each stage lands independently with its
> own tests and a narrow gate; the full gate runs at the end.

---

## 1. Objective

Deliver the Feature-013 slice per the spec:

1. **Domain (pure, deterministic, `now`-injected)** — the training-set model and
   membership resolution (game/pool/manual, origin/difficulty filters, the three
   orderings, `targetSize` cap); the cycle model (snapshot, 1-based cycle number,
   status); the presentation queue with the **bounded retry pass** (max one retry
   presentation per puzzle per cycle, driven by the stored `failed` result); the
   terminal/completion predicate; **derived resume reconstruction with no stored
   cursor**; config/version validation and the `CycleConfig` → `SolveHintConfig`
   mapping; and the **single canonical cycle-metric function** (Feature 014 §8)
   plus same-set cross-cycle deltas.
2. **Persistence** — schema **v10** `trainingSets`/`trainingCycles` tables
   (additive, both empty, no backfill), their repositories, indexes, the
   set-deletion cascade (cycles + attempts), and the game-deletion membership
   cleanup; no change to the immutable `puzzles` table or the v9 `puzzleAttempts`
   shape.
3. **Application services** — set creation from a game / the puzzle pool / a
   manual selection; set configuration/archive/delete; cycle start/resume/
   abandon/repeat/results; all deterministic for injected `now`/id factory.
4. **Host contract** — the real cycle session host that drives Feature 012's
   `SolveScreen`/`usePuzzleSolve`/`PuzzleAttemptRecorderLike` (replacing the
   test-only `HostedSession` harness role), plus the small Feature-012
   `SolveScreen` **Skip seam** extension (spec Owner decision 4).
5. **UI** — training home (sets/resume/empty/archived), set creation (game
   hand-off, pool multi-select, manual), set detail (config/membership/history/
   archive/delete), cycle session chrome (progress/exit/skip), cycle results
   (per-puzzle outcomes + canonical aggregates + same-set comparison); the
   interim `/puzzles` practice host and its `practice:*` ids are **removed**.
6. **Deterministic fixtures** for sets, cycles and attempt-driven aggregates; no
   engine, network or real IndexedDB in domain/service tests.

No new runtime dependency (Dependency policy: none added; `chessops` and Dexie
are already present).

---

## 2. Scope

### In scope

- Domain: set/cycle types and validation, membership resolution/ordering,
  cycle snapshot + number, retry-bounded queue, terminal/completion, resume
  reconstruction, hint-config mapping, canonical cycle metrics + comparison,
  fixtures.
- Schema v10 `trainingSets`/`trainingCycles` + repositories; attempts-repository
  set/cycle deletion hooks; set-deletion and game-deletion cascades; migration.
- Application services for set lifecycle, cycle lifecycle and results.
- The cycle host hook and the Feature-012 `SolveScreen` Skip seam.
- Training home / set creation / set detail / cycle session / cycle results
  pages, routes and nav wiring; the per-game "Create training set" hand-off.
- Removal of `src/pages/PuzzlesPage.tsx` (+ `.module.css`, `.test.tsx`), its
  in-memory recorder and `practice:*` ids.
- Tests: domain/repository/service/hook/component + one real-persistence e2e
  with a stubbed engine.

### Out of scope (restated from the spec; owned elsewhere)

- The solving interaction, hints content, wrong-move handling, outcome
  derivation and the attempt-row write (Feature 012; consumed, never
  re-implemented).
- Puzzle generation, immutability and the per-game puzzle view beyond adding
  the set-building entry point (Feature 011).
- Blunder re-rating / per-user puzzle difficulty (deferred; no `PuzzleRow`
  mutation; Owner decision 8).
- Individual-puzzle scheduling / FSRS / due-review state (ADR-031).
- Cross-game FEN dedup or transposition merging.
- Cross-cycle statistics series, game-analysis aggregates and the Dashboard
  (Features 014/015) — Feature 013 only introduces the shared cycle-metric
  function Feature 014 consumes.
- Sync of sets/cycles/attempts as standalone values (Feature 016 tombstones).
- The `masteredPuzzleCount` Library insight (Feature 014); Feature 013 supplies
  the attempt/cycle data only.
- Semantic tactical-motif taxonomy.

---

## 3. Existing code to reuse (verified anchors)

### Feature 012 solve surface (consumed, never re-implemented)

- `src/components/puzzles/solve/SolveScreen.tsx` — host contract
  `SolveScreenProps` `:92-115` (`row`, `context`, `config`, `recorder`,
  `onExit`, `boardSize?`, `storedAnalysis?`, `showTimer?`, `onRestart?`);
  error path calls `onExit(null)` `:648`; "Next puzzle" calls
  `onExit(controller.exitOutcome())` `:504-506`, disabled until `written`
  `:820`; controls row `:810-865`. **No Skip control and no `allowSkip` prop
  exist today** — the Stage-D seam extension is required (spec Owner decision
  4; conflict C-3).
- `src/hooks/usePuzzleSolve.ts` — stage machine `presenting → solving → outcome
  → postSolve` (`SolveStage` `:30`); fail-once keep-trying
  (`recordWrongMoveFail` `:265-287`, `submitMove` `:303-341`); `skip()` `:386-397`;
  `giveUp()` `:399-410`; `retryWrite()` `:419-424`; `exitOutcome()` `:426-431`
  (returns `null` while the row is unwritten — the host must never advance past
  an unwritten row); `writePhase` `:41`.
- `src/domain/training/types.ts` — `SolveHintConfig` `:44-47`;
  `SessionPuzzleContext` `:58-62` (`trainingSetId`/`cycleId`/1-based
  `presentationIndex`); `PuzzleAttemptRow` `:89-114` (immutable, natural key
  documented).
- `src/domain/training/outcome.ts` — `deriveResult` `:54-64` (`wrongMove` →
  `failed`; hint solve → `solvedWithHelp`); `buildAttemptRow` `:93-111`.
- `src/domain/training/hints.ts` — `DEFAULT_SOLVE_HINT_CONFIG` `:43-46`
  (owner UX ruling: levels `[2,3,4]`, first `2`); `nextHintLevel` `:92-104`.
- `src/domain/training/index.ts` — barrel `:12-39` (Feature 013 extends it).
- `src/domain/training/test-support.ts` — `solveConfigFixture` `:150`,
  `cycleContextFixture` `:164`, `attemptRowFixture` `:188`; re-exports the
  Feature-011 row fixtures `:31-39`.
- `src/infrastructure/training/attempts-service.ts` —
  `PuzzleAttemptRecorderLike` `:49-64`; `PuzzleAttemptRecorder` `:117-140`
  (`'added' → 'written'`, `'already-present' → 'already-written'`, genuine
  failure throws `PuzzleAttemptWriteError`).
- `src/infrastructure/training/test-support/hosted-session.ts` —
  `HostedSession` `:395`, `HostedPresentation` `:196`; the **test-only** host
  whose real-cycle role Feature 013 takes over (spec "Interim host
  supersession"). It stays as a Feature-012 test fixture, but is no longer the
  product host.

### Puzzle data and ids

- `src/domain/puzzle/id.ts` — `puzzleIdOf(sourceGameId, sourcePly)` `:28`
  (`"<gameId>:<sourcePly>"`), `parsePuzzleId` `:40`; the canonical set-membership
  reference.
- `src/domain/puzzle/types.ts` — `PuzzleRow` (immutable), `origin?`,
  `acceptedFirstMoves?`, `difficulty`, `tacticalObjective`.
- `src/domain/puzzle/buckets.ts` — `difficultyBucketOf(score)` `:32`,
  `DIFFICULTY_BUCKETS` `:23`.
- `src/domain/tactics/types.ts` — `TacticalObjective` `:11`.
- `src/infrastructure/db/puzzles-repository.ts` — `getPuzzle` `:75`,
  `listForGame` `:79`, `countForGames` `:88`, `deleteForGames` `:104`; **no
  `listAll` yet** (Stage B adds it for the pool view).
- `src/infrastructure/db/games-repository.ts` — `GameSummary` `:58` (carries
  `source`, `normalizedTimeControl`), `listGameSummaries` `:106`/`:211`; the
  pool's platform/time-control enrichment source.
- `src/domain/chess/gameSource.ts` `GameSource` `:11`;
  `src/domain/chess/timeControl.ts` `TimeControlCategory` `:35`.

### Attempt persistence (v9, unchanged shape)

- `src/infrastructure/db/attempts-repository.ts` — interface `:37-72`;
  `addAttempt` first-write-wins `:81`; `listForCycle` `:99`;
  `listForPuzzle` `:104`; `listForCycleAndPuzzle` `:109` (the resume/metrics
  read); `deleteForPuzzleIds` `:117`. Feature 013 adds set/cycle deletion
  methods (Stage B).
- `src/infrastructure/db/schema/v9.ts` `:32-36` — `puzzleAttempts` indexes
  `cycleId`, `puzzleId`, `[cycleId+puzzleId]`, `trainingSetId` already exist.
- `src/infrastructure/db/schema/v9-migration.test.ts` `:20-149` — the
  migration-test harness pattern Stage B mirrors for v10.

### Schema / persistence conventions

- `src/infrastructure/db/database.ts` — tables `:31-47`, apply chain `:52-60`,
  version guard `:66-71`.
- `src/infrastructure/db/schema/index.ts` — applier exports `:1-9`.
- `src/config/app-config.ts` — `PERSISTENCE_SCHEMA_VERSION = 9` `:9` + history
  comment `:3-8`; `SETTINGS_KEYS` `:12-22`.
- `src/infrastructure/db/games-repository.ts` — `deleteGames` `:246-277`
  (transaction + dependent-kind list; derives `puzzleIdOf` ids `:273`); Feature
  013 adds `trainingSets` to the transaction and the membership cleanup.
- `src/infrastructure/db/database.test.ts` — table-list + `verno` expectation
  `:18-27` (extends to v10).
- `src/infrastructure/db/game-deletion-cascade.test.ts` — cascade test to
  extend.
- `src/infrastructure/db/settings-repository.ts` `:10-31` and
  `src/hooks/usePuzzleTimerSetting.ts` `:18-42` — the settings seam reused for
  the solve clock (no new key needed).

### Library / per-game hand-off

- `src/pages/GamePuzzlesPage.tsx` — header `:347-357`, state bar `:359-379`
  (the anchor for the "Create training set" action).
- `src/domain/gameLibrary/rowView.ts` — `masteredPuzzleCount` `:133` (Feature
  014's; Feature 013 does not compute it).
- `src/infrastructure/db/analysis-result-query.ts` `:101` — Library insights
  (no Feature-013 change).

### Interim host to remove (spec "Interim host supersession")

- `src/pages/PuzzlesPage.tsx` — the whole interim practice host;
  `practiceContext` `:48` and `createPracticeRecorder` `:63` are the `practice:*`
  ids and the in-memory recorder to delete.
- `src/pages/PuzzlesPage.module.css`, `src/pages/PuzzlesPage.test.tsx`.
- `src/app/router.tsx` — import `:8` and route `:72` (`/puzzles`).
- `src/app/routes.ts` — `ROUTES.puzzles` `:8`, `NAV_ITEMS` `:23-30` (the nav
  entry stays `/puzzles`, only its element changes).

### Feature-014 metric overlap

- `src/domain/training/cycleMetrics.ts` (new, Stage A) is the **single shared
  canonical cycle-metric function**; Feature 014 §8
  (`.opencode/specs/features/014-game-history-statistics.md:397-451`) reuses it.
  Feature 014 must import it and must not re-derive (spec §8; AC #14). No
  Feature-014 code is written in this plan.

---

## 4. Stages

### Stage A — Domain: set/cycle models, queue, resume, canonical metrics, fixtures (pure)

**Aim:** the deterministic, engine/network/IndexedDB-free heart of the feature,
fully testable with no React and no Dexie.

**Files — new:**

- `src/domain/training/cycleTypes.ts` — the Feature-013 vocabulary:
  - `TrainingSetStatus = 'active' | 'archived'`;
  - `OrderingPolicy = 'difficultyAsc' | 'sourcePly' | 'manual'`;
  - `RetryFailed = 'none' | 'endOfCycle' | 'immediate'`;
  - `HintConfig { enabledLevels: readonly HintLevel[]; firstHintLevel: HintLevel }`;
  - `CycleConfig { ordering; retryFailed; hints; allowSkip; targetAccuracy:
    number | null; targetSolvingTimeMs: number | null; plannedCycles:
    number | null; configVersion: number }`;
  - `SetSource = { kind: 'game'; gameId } | { kind: 'pool'; filters:
    PuzzlePoolFilters } | { kind: 'manual' }`;
  - `PuzzlePoolFilters { origin?; tacticalObjective?; difficultyBucket?;
    sourceGameId?; platform?; timeControlCategory? }` (see R-2);
  - `PuzzlePoolEntry { puzzle: PuzzleRow; platform: GameSource;
    timeControlCategory: TimeControlCategory }` (pool enrichment);
  - `TacticalTrainingSetRow` and `TrainingCycleStatus`/`TrainingCycleRow`
    verbatim from the spec;
  - constants `CYCLE_CONFIG_VERSION = 1`, `CYCLE_METRICS_VERSION = 1`,
    `DEFAULT_TARGET_SIZE = 10`, `DEFAULT_CYCLE_CONFIG` (ordering
    `difficultyAsc`, `retryFailed` `endOfCycle`, hints levels `[1,2,3,4]` with
    `firstHintLevel` 2 per the Feature-012 owner UX ruling, `allowSkip` true,
    null targets, `configVersion: 1`).
- `src/domain/training/set.ts`:
  - `resolveSetMembership({ source, puzzles, poolEntries?, manualIds?, ordering,
    targetSize, originFilter?, difficultyFilter? }): string[]` — resolves the
    candidate universe once (game rows / filtered pool entries / manual ids),
    applies ordering, takes the first `targetSize`, returns canonical
    `puzzleIdOf` ids. A zero-resolution set is returned empty (never an error).
  - `orderPuzzles(puzzles, ordering): PuzzleRow[]` — `difficultyAsc` by
    difficulty then puzzle id; `sourcePly` by `sourceGameId` then `sourcePly`;
    `manual` keeps the provided base order (R-3). Pure and total.
  - `setSourceLabel(source): string` — human-readable provenance descriptor.
- `src/domain/training/cycle.ts`:
  - `nextCycleNumber(existingNumbers): number` = `max + 1` (1-based).
  - `snapshotCycle({ id, set, puzzleIds, config, now }): TrainingCycleRow` —
    pure builder (`status: 'inProgress'`, `cycleMetricsVersion`).
  - `resolvePuzzleCycle(attempts): CycleResolution` — the per-puzzle resolution
    of spec §8 / Feature 014 §8 (`skipped`, `definite`, `firstTrySolved`,
    `eventuallySolved`, `lastResult`, `wrongMoves`, `hints`, `solvingTimeMs`).
  - `isPuzzleTerminal(resolution, retryFailed): boolean` — solved, skipped, or
    presentation count reached.
  - `isCycleComplete({ puzzleIds, attempts, retryFailed, missingPuzzleIds }):
    boolean`.
  - `reconstructResume({ puzzleIds, attempts, retryFailed, missingPuzzleIds }):
    ResumeQueue` — ordered pending entries `{ puzzleId, presentationIndex }`;
    `immediate` retries first (snapshot order), then pending first-pass
    (snapshot order) for `immediate`, first-pass then retries for `endOfCycle`;
    none for `none`; missing ids are terminal and never enqueued. No stored
    cursor (spec §7).
  - `solveHintConfigOf(config): SolveHintConfig` — `{ enabledLevels,
    firstHintLevel }`.
  - `validateCycleConfig(raw): { ok: true; config } | { ok: false; message }`
    — rejects unknown enums/`configVersion` with a typed error, never coerces
    (spec Error cases).
- `src/domain/training/cycleMetrics.ts`:
  - `computeCycleMetrics({ puzzleIds, attempts, missingPuzzleIds? }):
    CycleMetrics` — the canonical shared function implementing Feature 014 §8
    exactly: `puzzlesAttempted`, `puzzlesCompleted`, `puzzlesSkipped`,
    `firstTryAccuracy: number | null`, `solveRate: number | null`,
    `totalPresentations`, `totalWrongMoves`, `hintsUsed`,
    `puzzlesRequiringHint`, `retries`, `puzzlesRequiringRetry`,
    `solvingTime: { totalMs; averageMs: number | null; medianMs: number | null }`,
    and `sampleUnit: 'puzzles'`. `null` = `empty` (zero definite puzzles).
  - `compareCycleMetrics(current, previous): CycleComparison` — `current`,
    `previous`, `absoluteDelta`, and `relativeDelta` only when previous ≠ 0;
    measured deltas only, no causation language (data only).
- `src/domain/training/index.ts` — extend the barrel with the new types,
  functions and the metric function.
- `src/domain/training/test-support.ts` — extend with deterministic fixtures:
  `setFixture(overrides)`, `cycleFixture(overrides)`,
  `attemptRowsForCycle({ puzzleIds, results, ... })`, `poolEntryFixture`,
  `cycleAttemptFixture`. Separated from production data; no engine/network.

**Files — tests (new):** `set.test.ts`, `cycle.test.ts`, `cycleMetrics.test.ts`,
`cycleTypes.test.ts`; extend `test-support.test.ts`.

**Invariants asserted:** membership resolution for all three sources and all
orderings, `targetSize` cap and tie-break determinism, zero-resolution empty
set; cycle snapshot immutability, `max+1` numbering, uniqueness; terminal and
completion predicates for every `retryFailed` mode; retry bound (max two
presentations); skip handling; resume reconstruction (fresh, mid-first-pass,
pending immediate, pending end-of-cycle, complete, missing puzzle) is
deterministic and idempotent; per-puzzle resolution; every aggregate incl.
`empty` (`null`) states and median/average; hint-config mapping; config/version
rejection; comparison deltas. No React/Dexie/engine imports.

**AC coverage:** #1 (membership/ordering, domain half), #4, #5 (skip
exclusion), #6, #7, #8 (aggregate half), #9, #12, #14.

**Exit check:** `npm run test -- src/domain/training src/domain/puzzle` +
`npm run typecheck`.

---

### Stage B — Persistence: schema v10, repositories, cascades, migration

**Aim:** durable, additive `trainingSets`/`trainingCycles` storage with the
set-owned deletion cascade and the game-deletion membership cleanup; no orphaned
cycle or attempt may remain (ARCHITECTURE §7, `domain/game-library.md` §8,
`domain/puzzle-model.md` ownership).

**Files — new:**

- `src/infrastructure/db/schema/v10.ts` — additive v10 (both tables empty, no
  `upgrade` backfill):
  ```text
  trainingSets:    '&id, status, createdAt'
  trainingCycles:  '&id, &[trainingSetId+cycleNumber], trainingSetId, status, startedAt'
  ```
  The compound `&[trainingSetId+cycleNumber]` is the spec's required unique key;
  `status`/`startedAt` serve the Feature-014 per-set/current-cycle reads (R-5).
  Doc header mirrors `v9.ts`: local user data, derived metrics never stored,
  sync exclusion (Feature 016 tombstones only).
- `src/infrastructure/db/schema/v10-migration.test.ts` — hand-built v9 Dexie
  (mirroring `v9-migration.test.ts` `:20-149`); assert v10 opens with pre-v10
  rows untouched, the v9 table list extended with `trainingSets`/`trainingCycles`
  (in order), both empty, and both usable through the new repositories.
- `src/infrastructure/db/training-sets-repository.ts`:
  - `TrainingSetsRow = TacticalTrainingSetRow`;
  - `get(id)`, `list({ status? })` (status-filtered index read; default active),
  - `create(row)`, `update(id, patch)` (name/config/membership/status, bumps
    `updatedAt`),
  - `delete(id)` — one transaction over `trainingSets`, `trainingCycles`,
    `puzzleAttempts`: delete the set, its cycles (`trainingSetId` index) and its
    attempts (`deleteForTrainingSetIds`); puzzles untouched;
  - `removePuzzleIds(puzzleIds)` — game-deletion cleanup: scan the (small) set
    table, filter each `puzzleIds`, `put` changed rows with a fresh `updatedAt`;
    bounded by set count, not puzzle count;
  - `listContainingPuzzle(puzzleId)`.
- `src/infrastructure/db/training-cycles-repository.ts`:
  - `TrainingCyclesRow = TrainingCycleRow`;
  - `get(id)`, `listForSet(setId)` (cycle-number order), `getByNumber(setId,
    cycleNumber)`, `create(row)`, `updateStatus(id, { status, completedAt?,
    abandonedAt? })`, `deleteForSet(setId)`.

**Files — modified:**

- `src/infrastructure/db/attempts-repository.ts` — add
  `deleteForTrainingSetIds(trainingSetIds)` (the `trainingSetId` index) to the
  interface and Dexie implementation (set-deletion cascade). No schema change.
- `src/infrastructure/db/database.ts` — import the two repository row types,
  register `trainingSets!`/`trainingCycles!` tables, `applyV10Schema(this)`,
  bump the guard message to 10.
- `src/infrastructure/db/schema/index.ts` — export `applyV10Schema`.
- `src/config/app-config.ts` — `PERSISTENCE_SCHEMA_VERSION = 10` + history
  comment line ("v10 trainingSets/trainingCycles (Feature 013)").
- `src/infrastructure/db/puzzles-repository.ts` — add `listAll(): Promise<
  PuzzleRow[]>` (the training-home pool view; one bounded read, not a per-row
  scan) and `getPuzzles(ids)` for membership hydration (bulkGet by natural key,
  or a `puzzleIdOf`-parsed `anyOf` on the compound key).
- `src/infrastructure/db/games-repository.ts` — `deleteGames` `:246-277`: add
  `this.database.trainingSets` to the transaction table list and, after the
  puzzle ids are derived `:273`, call
  `new DexieTrainingSetsRepository(this.database).removePuzzleIds(puzzleIds)`
  (cycles/snapshots stay immutable; missing snapshot puzzles are terminal per
  spec §6/§11).
- `src/infrastructure/db/database.test.ts` — table-list expectation gains
  `trainingSets`, `trainingCycles`; `db.verno` expectation 10.
- `src/infrastructure/db/game-deletion-cascade.test.ts` — seed a set containing
  the deleted game's puzzle ids (and a set containing another game's); assert the
  deleted ids are removed from membership, other membership is untouched,
  puzzles/attempts are removed, and no set/cycle/attempt orphan remains.
- `.opencode/specs/ARCHITECTURE.md` §7 — "currently **v9**" → v10 and add the
  version-history line ("v10 adds the Feature-013 `trainingSets`/`trainingCycles`
  tables"), same commit as the DB change (mirrors the Feature-011/012
  docs-with-DB precedent).

**Files — tests (new):**
`src/infrastructure/db/training-sets-repository.test.ts`,
`src/infrastructure/db/training-cycles-repository.test.ts`; extend
`attempts-repository.test.ts` for `deleteForTrainingSetIds`.

**Invariants asserted:** additive migration on empty and populated v9 DBs;
`create/get/list/update/delete` for both repositories; the unique
`[trainingSetId+cycleNumber]` key; status filters; set deletion cascades cycles
+ attempts and leaves puzzles and other sets untouched; game deletion removes
membership ids and no orphan remains; `listAll`/`getPuzzles` are index/bulk
reads; no engine/cache types imported.

**AC coverage:** #10 (persistence half), #11, #14 (no-orphans).

**Exit check:** `npm run test -- src/infrastructure/db` + `npm run typecheck`.

---

### Stage C — Application services: set lifecycle, cycle lifecycle, results

**Aim:** the engine-free application layer that loads persisted rows, calls the
Stage-A pure functions, persists set/cycle rows and exposes typed errors. All
clock/id reads are injectable for deterministic tests.

**Files — new:**

- `src/infrastructure/training/training-sets-service.ts`:
  - `TrainingSetsService` over `TrainingSetsRepository`, `PuzzlesRepository`,
    `GamesRepository`, `AttemptsRepository`, with injectable `now`/`newId`.
  - `createFromGame({ gameId, name, originFilter?, difficultyFilter?,
    ordering, targetSize })` — load `listForGame`, resolve membership.
  - `createFromPool({ filters, name, ordering, targetSize })` — load
    `puzzlesRepository.listAll()` + `gamesRepository.listGameSummaries()`,
    build `PuzzlePoolEntry[]`, resolve membership.
  - `createManual({ puzzleIds, name, ordering, targetSize })`.
  - `rename`, `updateConfig`, `archive`, `unarchive`, `delete`, `list`.
  - A zero-resolution create persists the empty set with an explicit result
    flag (never a fake count, never auto-delete).
  - Typed results (e.g. `{ ok: false; reason: 'invalid-config' | 'not-found' }`),
    never throws for expected states.
- `src/infrastructure/training/cycle-service.ts`:
  - `CycleService` over the two repositories + `PuzzlesRepository` +
    `AttemptsRepository`, with injectable `now`/`newId`.
  - `start(setId)` — load set; hydrate membership puzzles (missing ids tracked);
    reject with a typed `empty-set` result when no puzzle row exists (no empty
    cycle); `snapshotCycle`; persist.
  - `resume(cycleId)` — load cycle + attempts (`listForCycle`) +
    `reconstructResume`; when nothing is pending, mark `completed` and return
    the terminal state (idempotent).
  - `abandon(cycleId)` — typed; keeps attempts; never resumable.
  - `repeat(setId)` — `start` over the current set (new cycle number/snapshot).
  - `results(cycleId)` — load cycle + attempts; `computeCycleMetrics`; return
    per-puzzle resolutions + aggregates + comparison inputs.
  - `listForSet(setId)` — cycle history.
  - Reject `start`/`resume` on `completed`/`abandoned` with a typed result
    (spec Error cases).
  - Config is validated on read via `validateCycleConfig`; an invalid persisted
    config is a typed error (never coerced).
- `src/infrastructure/training/index.ts` — export the services and their result
  types for the UI/host.

**Files — tests (new):** `training-sets-service.test.ts`,
`cycle-service.test.ts` (fake-indexeddb via the shared setup): create from game
and pool; zero-resolution empty set; start/reject-empty; resume after reload;
complete; abandon; repeat; results; write-failure containment (the recorder
throws; the service/host never marks the cycle complete while a row is
unwritten); invalid-config rejection.

**AC coverage:** #1 (service half), #2, #6, #7, #8 (results), #11, #13
(real cycle ids available to the host).

**Exit check:** `npm run test -- src/infrastructure/training` + `npm run
typecheck`.

---

### Stage D — Host contract: cycle session hook + Feature-012 Skip seam

**Aim:** the real cycle host that drives Feature 012's solving screen under real
cycle ids, replaces the `HostedSession` role, and exposes the small Skip seam.

**Files — new:**

- `src/hooks/useCycleSession.ts` — the cycle session controller:
  - options `{ set, cycle, puzzles: ReadonlyMap<puzzleId, PuzzleRow>,
    recorder: PuzzleAttemptRecorderLike, attemptsRepository,
    cycleService, now?, onComplete? }`;
  - loads the cycle's attempts and derives the queue via `reconstructResume`
    (the **source of truth is persisted rows**; the in-memory queue is a
    projection) — this makes resume deterministic/idempotent across reloads and
    tabs;
  - `current: { row, context: SessionPuzzleContext, config: SolveHintConfig } |
    null` — `presentationIndex` from the reconstruction (1 first, 2 retry);
  - `progress { index; total }`, `allowSkip`, `status`
    (`loading | solving | complete | error`), `notice`;
  - `handleOutcome(outcome: PresentationOutcome | null)` — `null` = discard
    (puzzle stays pending, same index); a durable `skipped`/solved outcome
    retires the puzzle; a durable `failed` outcome re-queues per `retryFailed`
    with `presentationIndex + 1` (bounded to 2); after each durable outcome the
    hook re-reads attempts and rebuilds the queue;
  - when the queue empties, calls `cycleService.resume(cycleId)` (which marks
    `completed`) and surfaces `complete` for navigation to results; a genuine
    attempt-write failure keeps the outcome visible (Feature 012) and the hook
    never advances;
  - `exit()` — returns to set detail; the cycle stays `inProgress`; the mounted
    `SolveScreen` unmounts, discarding the presentation (no row).
- `src/hooks/useCycleSession.test.ts` — fixture sets/cycles/puzzles with a stub
  recorder and fake-indexeddb: order, retries (`none`/`immediate`/`endOfCycle`),
  skips, completion, resume after reload, missing puzzle rows, write-failure
  containment, no engine/network.

**Files — modified (Feature-012 contract extension; spec Owner decision 4):**

- `src/components/puzzles/solve/SolveScreen.tsx` — add optional
  `allowSkip?: boolean` to `SolveScreenProps` `:92-115` and render a labelled
  **Skip** control in the controls row `:810-865` when `allowSkip` is true. On
  click it calls `controller.skip()`; a small effect watches `controller` and,
  once `writePhase === 'written'` and a skip was requested, calls
  `onExit(controller.exitOutcome())` (never advances an unwritten row). The
  control is a real labelled button (keyboard + touch, a11y), hidden by default
  so Feature-012's existing behaviour is unchanged. `usePuzzleSolve` already
  implements `skip()` `:386-397`; no domain change.
- `src/components/puzzles/solve/SolveScreen.test.tsx` — add cases: Skip hidden
  by default; shown when `allowSkip`; writes exactly one `skipped` row and calls
  `onExit` with the outcome; skip after a wrong-move fail writes no second row
  and exits (Feature-012 fail-once rule); no advance while the write is
  retryable.

**Invariants asserted:** one immutable attempt row per presentation under the
real `cycleId`/`trainingSetId` with `presentationIndex` 1/2; no practice rows;
retry bound; skip terminal; completion when every snapshot puzzle is terminal or
missing; exit leaves `inProgress`; no engine/network; domain untouched by the
Skip seam.

**AC coverage:** #2, #3, #4, #5 (host half), #6, #7, #12, #13, #15 (session
controls).

**Exit check:** `npm run test -- src/hooks/useCycleSession.test.ts
src/components/puzzles/solve` + `npm run typecheck` + `npm run lint`.

---

### Stage E — Training home + set creation + set detail UI

**Aim:** the set surfaces: training home, set creation (game hand-off, pool
multi-select, manual) and set detail, all keyboard/touch operable and
mobile-responsive.

**Files — new:**

- `src/pages/TrainingHomePage.tsx` (+ `.module.css`, `.test.tsx`): active sets
  as cards (name, puzzle count, current cycle number/status, last activity),
  an "Archived" affordance, a **resume banner** when a cycle is `inProgress`
  linking to the session at the next unanswered puzzle, a **New set** action,
  and an explicit empty state explaining puzzles must be generated first and
  linking to `/games`. Absent data never renders a bare `0` (empty/archived
  states instead).
- `src/pages/SetEditorPage.tsx` (+ `.module.css`, `.test.tsx`): create/edit a
  set — name; source seed (game via `?source=game&gameId=…`, pool filters,
  manual multi-select); origin/difficulty filters; ordering; target size;
  `retryFailed`; hint availability/threshold; `allowSkip`; target
  accuracy/solving-time/planned cycles; membership preview (count + rows with
  origin/objective/difficulty bucket); the effective config snapshot and puzzle
  count before starting a cycle.
- `src/components/puzzles/cycles/` (new, reusable): `SetCard.tsx`,
  `MembershipList.tsx` (paginated/virtualized on mobile),
  `CycleConfigForm.tsx`, `ConfirmDialog.tsx` (destructive confirmation naming
  the object and its cycle/attempt counts), `CycleHistory.tsx`.
- `src/pages/SetDetailPage.tsx` (+ `.module.css`, `.test.tsx`): rename, edit
  config, membership view, cycle history, start/continue a cycle,
  archive/unarchive, delete (destructive confirmation).
- Route additions in `src/app/routes.ts`: `puzzlesNew`, `puzzlesSet`
  (`/puzzles/sets/:setId`); keep `ROUTES.puzzles` `/puzzles` and the existing
  `NAV_ITEMS` entry.

**Files — modified:**

- `src/app/router.tsx` — import `TrainingHomePage`/`SetEditorPage`/
  `SetDetailPage`; replace the interim `PuzzlesPage` element `:72` with
  `TrainingHomePage`; add the nested set routes (lazy-load board-heavy pages as
  the existing precedent `:34-36`).

**Invariants:** stored membership, not a live query; deterministic ordering and
target-size selection surfaced before commit; destructive actions confirmed;
status text not colour-only; touch multi-select; no hover-only interaction.

**AC coverage:** #1 (UI half), #15.

**Exit check:** `npm run test -- src/pages/TrainingHomePage.test.tsx
src/pages/SetEditorPage.test.tsx src/pages/SetDetailPage.test.tsx` +
`npm run typecheck`.

---

### Stage F — Cycle session + results UI, interim-host removal, per-game hand-off

**Aim:** the cycle session chrome around Feature 012's `SolveScreen`, the
read-only cycle results view, the real `/puzzles` host, and the removal of the
interim practice host.

**Files — new:**

- `src/pages/CycleSessionPage.tsx` (+ `.module.css`, `.test.tsx`): session
  chrome (set name, cycle number, "Puzzle X of Y", **Exit** leaving the cycle
  `inProgress`, **Skip** when configured) above Feature 012's `SolveScreen`
  driven by `useCycleSession`; advancing only after the attempt row is durably
  written; on completion navigate to results; no difficulty/ordering/scheduling
  language (ADR-031). Session chrome stays reachable without scrolling past the
  board on small viewports (Feature-012 mobile stacking).
- `src/pages/CycleResultsPage.tsx` (+ `.module.css`, `.test.tsx`): status, cycle
  number, start/completion times, per-puzzle outcomes (retries/skips), the
  canonical aggregates with sample sizes (`empty`, not `0`, for zero definite
  puzzles), abandoned cycles shown separately and never resumable, same-set
  cross-cycle comparison (measured deltas only, no causation), and "Start next
  cycle".
- `src/components/puzzles/cycles/CycleMetricsPanel.tsx` (aggregates + sample
  sizes), `CycleComparison.tsx` (deltas), `PuzzleOutcomeList.tsx`.
- Route additions: `puzzlesCycle`
  (`/puzzles/sets/:setId/cycles/:cycleNumber`), `puzzlesCycleResults`
  (`…/results`).

**Files — modified:**

- `src/app/router.tsx` — add the cycle session/results routes (lazy-load the
  session route, which mounts the board).
- `src/pages/GamePuzzlesPage.tsx` — add a labelled **"Create training set"**
  control in the header/state-bar region `:347-379`, navigating to
  `/puzzles/new?source=game&gameId=<id>` (the Feature-011 hand-off; the page
  stays otherwise read-only).
- `src/pages/GamePuzzlesPage.test.tsx` — assert the action exists and navigates
  with the game id.

**Files — deleted (spec "Interim host supersession"):**

- `src/pages/PuzzlesPage.tsx`, `src/pages/PuzzlesPage.module.css`,
  `src/pages/PuzzlesPage.test.tsx` — remove the interim practice host, its
  in-memory `createPracticeRecorder` `:63` and its `practice:*` ids
  (`practiceContext` `:48`). Confirm no remaining references via grep
  (`practice:`, `PuzzlesPage`). The `/puzzles` nav entry is now served by
  `TrainingHomePage`; `ROUTES.puzzles`/`NAV_ITEMS` are unchanged.

**Invariants:** no `practice:*` ids or in-memory recorder remain; every
essential action is a labelled keyboard/touch control; destructive actions
confirmed; status never colour-only; results spell out values and sample sizes;
the real host writes under real cycle ids.

**AC coverage:** #3 (no practice rows), #5, #8, #9, #10 (UI half), #13, #15.

**Exit check:** `npm run test -- src/pages/CycleSessionPage.test.tsx
src/pages/CycleResultsPage.test.tsx src/pages/GamePuzzlesPage.test.tsx` +
`npm run typecheck` + `npm run lint`.

---

### Stage G — Test closure + deterministic-fixture consolidation

Stages A–F each carry their focused tests. Stage G closes the spec's Testing
requirements:

- **Domain** — every acceptance-criteria property across all orderings,
  `retryFailed` modes, skip on/off, hint-level variants, set/unset targets,
  median/average, empty states, version stamping.
- **Repository** — create/get/list/update/delete; the unique compound key;
  status filters; set-deletion cascade; game-deletion membership cleanup;
  v9→v10 migration on empty and populated DBs; no orphans.
- **Service/host** — create from game and pool; start/reject-empty; full session
  over fixtures (order, retries, skips, completion); resume after reload;
  abandon; repeat; results; write-failure containment.
- **Component** — training home (sets/empty/resume/archived), set detail
  (config/membership/history/archive/delete confirmations), session chrome
  (progress/exit/skip), results (outcomes + aggregates + comparison),
  keyboard/AT behaviour, mobile layout; the interim practice host is gone.
- **End-to-end** — `tests/e2e/013-tactical-training-cycles.spec.ts`: set →
  cycle → solve (Feature-012 screen, stubbed engine) → attempt rows → completion
  → next cycle → results, over the real persistence layer (mirroring the
  committed-engine precedent `tests/e2e/011-puzzle-generation.spec.ts`, but with
  a stubbed engine — no network).

**AC coverage:** all fifteen, mapped in §11.

**Exit check:** `npm run test` (full unit/component suite) +
`npm run test:browser` when Chromium is available.

---

### Stage H — Docs, version notes, full gate

**Files — modified (docs only unless already done in B):**

- `.opencode/specs/ARCHITECTURE.md` §7 — verify the v10 edit from Stage B and
  the deletion-cascade sentence; adjust wording only if inconsistent.
- `src/config/app-config.ts` — the v10 comment/guard is already in Stage B.
- `.opencode/specs/features/013-tactical-training-cycles.md` — **no change**;
  the Owner decisions are implemented as recommended defaults and surfaced in
  §9. If implementation surfaces a doc-vs-code conflict not captured here, stop
  and report it (AGENTS source-of-truth rule).
- **Version note:** Feature 013 introduces no puzzle-generator/detection version
  bump. `CYCLE_CONFIG_VERSION = 1` and `CYCLE_METRICS_VERSION = 1` stamp set
  configs and cycles (ARCHITECTURE §9); a semantics change bumps the relevant
  constant and stored rows are never retroactively re-mapped. Schema v10 is
  additive; no data migration.

**Full gate (AGENTS Execution policy; see `.opencode/skills/verify-gate/SKILL.md`):**
`npm run lint`, `npm run typecheck`, `npm run format:check`, `npm run test`,
`npm run build`, `npm run dev` smoke (no browser-console errors),
`npm run test:browser` when Chromium is available, `npm audit`.

---

## 5. Domain/data changes (consolidated)

- **New entities** (schema v10, `domain/tactical-training.md`, ARCHITECTURE §7):
  - `TacticalTrainingSetRow` — stored membership (`puzzleIds`, not a live
    query), provenance `source`, `targetSize` (default 10), current `config`
    (snapshotted per cycle), `status` active/archived.
  - `TrainingCycleRow` — 1-based `cycleNumber` per set (unique with
    `trainingSetId`), immutable snapshot (`puzzleIds` + `config`), status
    `inProgress`/`completed`/`abandoned`, timestamps, `cycleMetricsVersion`.
- **No change** to the immutable `puzzles` table or the v9 `puzzleAttempts`
  shape; attempts already carry `cycleId`/`trainingSetId`/`presentationIndex`
  and the needed indexes.
- **Cycle metrics are derived, never stored** (spec §8, Owner decision 9);
  the single canonical function lives in `src/domain/training/cycleMetrics.ts`
  and Feature 014 reuses it (no duplicate implementation).
- **No `PuzzleRow` mutation / re-rating** (spec §10, Owner decision 8).
- **Ownership/deletion:** set deletion removes its cycles + attempts (puzzles
  untouched); game deletion removes the deleted puzzle ids from every set's
  membership while cycle snapshots stay immutable (missing snapshot puzzles are
  skipped/terminal). Engine cache untouched.
- **Sync:** no sync added; sets/cycles/attempts are local/derived. Feature 016
  tombstones only (documented on the schema header).

## 6. UI changes

New pages under the existing `/puzzles` nav entry: training home, set
creation/editor, set detail, cycle session (hosting Feature 012's `SolveScreen`),
cycle results. The per-game puzzle view gains a "Create training set" action.
Every essential action is a labelled keyboard/touch control; destructive actions
are confirmed; status is textual, never colour-only; progress/results announce
via `aria-live` on real state changes; mobile renders set cards, stacked detail
and results, reachable session chrome, and paginated/virtualized membership.
The interim `/puzzles` practice host is removed; `/puzzles` is served by the
training home. No change to the Game Library, Feature-012 solving UI beyond the
Skip seam, or the analysis surfaces.

## 7. Infrastructure changes

Schema v10 (`trainingSets`/`trainingCycles` + indexes); two repositories;
attempts-repository set-deletion hook; `puzzlesRepository.listAll`/`getPuzzles`;
`deleteGames` membership cleanup + transaction table; `database.ts` registration
+ `PERSISTENCE_SCHEMA_VERSION = 10` + guard; migration test; application
services and the cycle host hook. No engine, worker, ADR-018 cache, network,
sync or new dependency.

## 8. Tests

Spread across the stages (A–G): pure set/cycle/resume/metric tests; migration +
repository tests (unique key, status filters, set cascade, game membership
cleanup, no orphans); service tests (create from game/pool/manual, start/reject,
resume, complete, abandon, repeat, results, write-failure containment); hook +
component tests (host queue/retries/skip/resume, training home, set editor/detail
with confirmations, session chrome, results/comparison, keyboard/AT, mobile); one
real-persistence e2e with a stubbed engine. No engine/network anywhere; domain
tests use no real IndexedDB.

## 9. Owner decisions (spec "Owner decisions to confirm")

The spec's rewrite resolves these with a recommended default so planning can
proceed. **This plan implements each recommended default**; each is a localized
change if the owner overrides it. They are surfaced here, not silently chosen.

- **OD-1 Retry bound — implement max one retry presentation per puzzle per
  cycle (max two presentations).** The alternative (unbounded immediate retry)
  cannot complete and conflicts with resume.
- **OD-2 Retry driven by the stored `failed` result — implement.** A later
  in-presentation correct move never writes a second row; the stored `failed`
  drives the retry (consistent with Feature 012 fail-once).
- **OD-3 `solvedWithHelp` = hint-only with no wrong move — implement** (Feature
  012's implemented semantics; the stale "and/or after a retry" wording is a doc
  comment only — see conflict C-2).
- **OD-4 Skip affordance — implement.** The cycle host decides `allowSkip` from
  the cycle config; Feature 012's `SolveScreen` renders the labelled control and
  writes the single `skipped` row (small contract extension; see R-4/C-3).
- **OD-5 `targetSize` default 10 as a creation cap, overridable to large sets —
  implement.** Not a hard runtime limit.
- **OD-6 Set sources game + filtered pool + manual — implement.**
- **OD-7 Orderings `difficultyAsc` (default), `sourcePly`, `manual` —
  implement.** `random` (seeded) deferred.
- **OD-8 Blunder re-rating deferred out of V1 — implement.** No `PuzzleRow`
  mutation; per-puzzle signals stay Feature-014 aggregates.
- **OD-9 Cycle metrics derived, not stored — implement.** A future cache must be
  additive/derivable/versioned.
- **OD-10 Set deletion removes its cycles/attempts; no standalone cycle deletion
  — implement.** Abandon covers the user intent.

### Plan-level decisions with recommended resolutions

- **R-1 Shared metric location.** `src/domain/training/cycleMetrics.ts`,
  re-exported from `src/domain/training/index.ts`. Feature 014 imports it and
  must not re-derive (spec §8; AC #14). Chosen over a Feature-014-owned module
  because Feature 013 owns the function per the spec and the domain module
  already hosts the training vocabulary.
- **R-2 `PuzzlePoolFilters` shape (spec undefined).** Define the six filters in
  §4 Stage A; the pool read enriches each `PuzzleRow` with its source game's
  `source`/`normalizedTimeControl` from `listGameSummaries`, so platform and
  time-control filtering are pure and deterministic. Flagged as an ambiguity.
- **R-3 Ordering base for non-manual sources.** `game` base order = `sourcePly`;
  `pool` base order = `puzzleId` ascending; `manual` base order = the provided
  selection order. `orderPuzzles` then applies the configured policy; ties break
  by puzzle id. Flagged as an ambiguity.
- **R-4 Skip seam interpretation.** The spec says "the cycle host owns a Skip
  control ... and `SolveScreen` exposes the seam". The plan renders the control
  in `SolveScreen` (gated by `allowSkip`) because only the presentation
  controller can call `skip()` and write the row; the host owns availability and
  terminal semantics. Flagged.
- **R-5 v10 indexes.** `status`/`createdAt` on `trainingSets`; the unique
  `[trainingSetId+cycleNumber]`, `trainingSetId`, `status`, `startedAt` on
  `trainingCycles` (spec delegates exact Feature-014 read indexes to the plan).
- **R-6 Missing puzzle rows.** Resume/completion take a `missingPuzzleIds` set
  from the service (the domain stays pure); missing ids are terminal and never
  enqueued, and never produce an attempt row.
- **R-7 Route paths.** `/puzzles` (home), `/puzzles/new` (create),
  `/puzzles/sets/:setId`, `/puzzles/sets/:setId/cycles/:cycleNumber`,
  `…/results` (spec leaves exact paths to the plan). Cycle number is used in the
  URL; the service resolves `getByNumber`.
- **R-8 Determinism.** All domain functions take `now`; services take
  injectable `now`/`newId`; no hidden clock/locale reads. Tests pin time.
- **R-9 No new settings key.** Cycle config lives on the set; the existing
  `SETTINGS_KEYS.puzzleTimer`/`usePuzzleTimerSetting` seam is reused for the
  solve clock. If the owner later wants global config defaults, that is an
  additive settings change.

## 10. Risks & open questions / conflicts found

- **C-1 — `presentationIndex` base mismatch (spec ↔ domain doc).**
  `domain/tactical-training.md:155` still says the presentation index is
  **0-based**, while the Feature-013 spec §5, Feature 012's `types.ts:94` and the
  implemented `PuzzleAttemptRow`/repository use **1-based** (`presentationIndex
  === 1` is the first presentation). The spec's "Reconciliations applied" claims
  the domain doc was reconciled but this line was not. **This plan implements
  1-based** (spec/implementation win) and flags the domain-doc line for a small
  correction (not edited here).
- **C-2 — Stale `solvedWithHelp` comment.** `src/domain/training/types.ts:25`
  still says "solved using a hint **and/or after a wrong move**", but the
  implemented fail-once rule (and spec §9 / OD-3) means a wrong move always
  records `failed`; `solvedWithHelp` is hint-only. Non-functional comment
  conflict; the plan follows the implementation. Flag for a comment cleanup.
- **C-3 — No Skip seam exists yet.** `SolveScreen` has no Skip control and no
  `allowSkip` prop (`SolveScreen.tsx:92-115`), although `usePuzzleSolve` exposes
  `skip()` (`:386-397`). The spec requires a "small Feature-012 contract
  extension" (OD-4). Stage D adds it; this is in-scope per the spec, not a
  Feature-012 redesign.
- **C-4 — `PuzzlePoolFilters` undefined in the spec** (see R-2). The plan
  defines it; if the owner has a different intended field set, it is a localized
  change.
- **C-5 — Metric function location is a plan decision** (R-1) since the spec
  says "Feature 013 introduces the single shared function" but does not name a
  module. Feature 014 must be updated (its own plan) to import it; no Feature-014
  code is written here.
- **Risk — full-suite regression from the interim-host removal.** `PuzzlesPage`
  and its tests are deleted; confirm no other module imports it (grep
  `PuzzlesPage`/`practice:`) before Stage F lands.
- **Risk — game deletion while a session is open.** The cascade removes the
  puzzle/attempts; the host reconciles from persisted rows, skips missing rows
  and never crashes (spec Error cases). Covered by Stage D/G tests.
- **Risk — concurrent tabs on one cycle.** Natural-key first-write-wins makes
  duplicate writes idempotent; the host rebuilds the queue from persisted rows
  and reconciles (spec Error cases). Covered by Stage D/G tests.
- **Risk — large sets.** Metrics/resume are bounded by cycle puzzle count and
  use indexed reads; the pool/membership views paginate/virtualize. The plan
  records the measured budget rather than materializing aggregates (spec
  Performance).

## 11. Acceptance criteria (spec #1–15 → stage)

| # | Criterion | Covered in |
|---|-----------|------------|
| 1 | Create a set from a game and from the pool; name/configure; archive/unarchive; delete with confirmation; stored deterministic membership | Stage A (resolution) + C (services) + E (UI) |
| 2 | Starting a cycle snapshots membership/config, assigns the next 1-based number, presents in order through Feature 012 | Stage A (snapshot) + C (start) + D (host) |
| 3 | Exactly one immutable attempt row per presentation under real `cycleId`/`trainingSetId`, `presentationIndex` 1/2; no practice rows | Stage B (v9 repo) + D (host) + F (removal) |
| 4 | `retryFailed` `none`/`immediate`/`endOfCycle`; at most two presentations; re-failed retry terminal | Stage A + D + G |
| 5 | Skipped recorded, excluded from denominators, does not block completion; only when configured | Stage A + D + G |
| 6 | `completed` exactly when every snapshot puzzle terminal or missing; exit leaves `inProgress` and resumable; abandon terminal | Stage A + C + D + G |
| 7 | Resume reconstruction from persisted attempts deterministic/idempotent, no stored cursor | Stage A + C + D + G |
| 8 | Results show per-puzzle outcomes + canonical aggregates with sample sizes; `empty` not `0`; abandoned separate | Stage A (metrics) + C + F |
| 9 | Cross-cycle comparison same set/metric, measured deltas only, no causation, never mixed with game analysis | Stage A (comparison) + F |
| 10 | Puzzle may belong to multiple sets; per-set/cycle aggregates never double-count; set deletion removes cycles/attempts, not puzzles | Stage A + B + F |
| 11 | Game deletion removes puzzles/attempts and membership ids; no orphans; no crash | Stage B + D + G |
| 12 | No per-puzzle scheduling; no scheduling state on a Puzzle; no mutation/re-rating; no FSRS/scheduler dependency | Stages A–G invariants |
| 13 | Interim `/puzzles` practice host, in-memory recorder and `practice:*` ids removed; `/puzzles` served by the training home | Stage F |
| 14 | Set/cycle logic deterministic, fixture-testable, no engine/network/real IndexedDB; canonical metric shared with Feature 014 | Stage A (+G), R-1 |
| 15 | Essential actions keyboard/touch operable; status not colour-only; destructive actions confirmed | Stages D/E/F + G |

## 12. Verification commands

Narrow-first per stage, full gate at the end (AGENTS Execution policy;
`.opencode/skills/verify-gate/SKILL.md`):

```text
# Stage A — domain
npm run test -- src/domain/training src/domain/puzzle
npm run typecheck

# Stage B — persistence / migration / cascades
npm run test -- src/infrastructure/db
npm run typecheck

# Stage C — application services
npm run test -- src/infrastructure/training
npm run typecheck

# Stage D — host hook + Feature-012 skip seam
npm run test -- src/hooks/useCycleSession.test.ts src/components/puzzles/solve
npm run typecheck
npm run lint

# Stage E — set UI
npm run test -- src/pages/TrainingHomePage.test.tsx src/pages/SetEditorPage.test.tsx src/pages/SetDetailPage.test.tsx
npm run typecheck

# Stage F — cycle UI + interim-host removal + per-game hand-off
npm run test -- src/pages/CycleSessionPage.test.tsx src/pages/CycleResultsPage.test.tsx src/pages/GamePuzzlesPage.test.tsx
npm run typecheck
npm run lint

# Stage G — test closure
npm run test
npm run test:browser   # when Chromium is available (stubbed-engine e2e)

# Full gate (Stage H)
npm run lint
npm run typecheck
npm run format:check
npm run test
npm run build
npm run dev            # smoke: app boots, /puzzles serves the training home,
                       # no browser-console errors
npm run test:browser   # existing specs + the 013 e2e when Chromium is available
npm audit
```
