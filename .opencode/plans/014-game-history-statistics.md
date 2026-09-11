# Plan — Feature 014: Game Analysis History & Statistics

> Source of truth: `.opencode/specs/features/014-game-history-statistics.md`.
> Required context per `.opencode/CONTEXT-MAP.md`: `ARCHITECTURE.md`
> §6a/§7/§9/§10; ADRs `decisions/ADR-013`, `decisions/ADR-019`,
> `decisions/ADR-020`, `decisions/ADR-023`, `decisions/ADR-024`,
> `decisions/ADR-031`; domain `domain/statistics.md`, `domain/game-model.md`,
> `domain/analysis-model.md`, `domain/classification.md`,
> `domain/game-phase.md`, `domain/time-control.md`,
> `domain/tactical-training.md`, `domain/puzzle-model.md`, `domain/tactics.md`,
> `domain/game-library.md`; research `research/move-accuracy.md`,
> `research/move-classification.md`.
>
> Feature 014 is the **domain statistics + history layer**: pure, deterministic
> aggregations over persisted data plus one application service that loads rows.
> It renders no charts (Feature 015), starts no engine, touches no network, and
> writes no new tables. It owns the canonical `masteredPuzzleCount` aggregate the
> Game Library renders read-only, and reuses Feature 013's canonical cycle-metric
> and mastery functions verbatim.
>
> This plan is organized as stages A–F (domain contracts → game aggregates →
> training aggregates → application service/worker → Game Library mastered
> insight → test closure + full gate). Stages are dependency-ordered; each lands
> with its own tests and a narrow gate; the full gate runs at the end.

---

## 1. Objective

Deliver the Feature-014 slice per the spec:

1. **Domain (pure, deterministic, `now`-injected, no React/Dexie/Worker)** — the
   statistics query/dimension model; the canonical metric result contract
   (`ok | insufficient | empty | notDetected`, `n`, `MIN_SAMPLE_SIZE = 5`);
   eligible-analysis selection (`latestCompletedJob` + persisted summary);
   game-history read model; classification/accuracy/missed-tactic aggregates;
   game-phase aggregates; rating histories; the day/ISO-week/month period model
   with explicit empty periods; training set/cycle aggregates, weakest
   categories, repeatedly-failed puzzles and the canonical mastery counts; the
   aggregation version and contributing-version summary.
2. **Application service** — loads only the query window and eligible analyses
   through existing repositories, orchestrates the pure aggregation, may run it
   in a Worker above a measured threshold, memoizes behind a non-authoritative
   data-version key, and returns typed validation errors instead of throwing.
3. **Game Library integration** — supply the read-only `masteredPuzzleCount`
   insight (domain aggregate + service method + row overlay + strip item).
4. **Deterministic fixtures** for every aggregate; no engine, network, or real
   user data in tests.

No new runtime or dev dependency (Dependency policy: none added).

---

## 2. Scope

### In scope

- Domain statistics module (`src/domain/statistics/`): query/dimensions,
  metric contract, eligibility, game aggregates, phase aggregates, rating
  history, period/trend model, training aggregates, version summary, diagnostics.
- Application service + Worker path (`src/infrastructure/statistics/`).
- One read-only repository addition: batched `analyses` read by `analysisId`.
- The `masteredPuzzleCount` aggregate + Game Library row overlay/strip item.
- Tests: domain fixture tests, service tests on `fake-indexeddb`, Worker
  protocol test, Library strip test, a bounded performance benchmark.

### Out of scope (restated from the spec; owned elsewhere)

- Chart rendering, layout, colour, tooltips (Feature 015).
- Any engine work, re-analysis, detection or puzzle generation.
- Per-game row-strip values other than `masteredPuzzleCount` — accuracy,
  classification counts and missed-tactic counts remain produced by
  Features 008/009/010 and read-only in the Library.
- Individual-puzzle scheduling / "due" / retention / FSRS (ADR-031).
- Statistical-significance claims, cross-platform rating conversion or
  combination.
- Persisted/materialized statistics tables in V1 (no schema change).
- Semantic tactical-motif taxonomy (`domain/tactics.md`); "weakest categories"
  uses stored `TacticalObjective` and puzzle `origin` only.
- Sync of derived statistics (Feature 016 recomputes/tombstones source rows).

---

## 3. Existing code to reuse (verified anchors)

### Metric math — reuse, never re-implement

- `src/domain/analysis/status.ts:56-60` — `latestCompletedJob(jobs)` is the
  canonical eligible-analysis selector (most recently completed by
  `updatedAt`).
- `src/domain/analysis/status.ts:34-50` — `analysisStatusOf(jobs)` for the
  history entry's `analysisStatus`.
- `src/domain/analysis/summary.ts:51-79` — `summarizeAnalysis(records,
  userColor)` (user/opponent `ClassificationCounts`, `userMoves`,
  `userMissedTactics`).
- `src/domain/analysis/accuracy.ts:131-228` — `gameAccuracy(records,
  userColor)` (ADR-024) and `MOVE_ACCURACY_VERSION`; `formatAccuracy` in
  `src/domain/analysis/classificationMeta.ts` is presentation-only (not used
  by the domain).
- `src/domain/analysis/summaryDerivation.ts:104-154` — persisted
  `PerAnalysisSummary` shape (`accuracy`, `accuracyMoves`,
  `classificationCounts`, `detectionState`, `missedTacticCount`,
  `detectionVersion`).
- `src/domain/tactics/types.ts:71` — `DETECTION_VERSION` (freshness gate:
  `detectionState === 'completed' && detectionVersion === DETECTION_VERSION`).
- `src/domain/chess/analysis.ts:15-16,90-133` — `GamePhase`, `MoveAnalysis`
  (`gamePhase`, `side`, `classification`, `missedTactic`, `engine`,
  `classificationVersion`, `gamePhaseVersion`, `analysisVersion`).
- `src/domain/chess/game.ts:50-61` — `outcomeOf(result)`; `Player.rating`.
- `src/domain/chess/gameSource.ts` — `GameSource` and canonical source order;
  `fixture` must be excluded from production results.
- `src/domain/chess/timeControl.ts:26-35` — `TimeControlCategory` (ADR-013).

### Training aggregates — reuse the canonical Feature-013 functions

- `src/domain/training/cycleMetrics.ts:71-143` — `computeCycleMetrics(input)`
  (the single shared cycle-metric function).
- `src/domain/training/cycleMetrics.ts:219-238` — `compareCycleMetrics`.
- `src/domain/training/mastery.ts:37-99` — `isLegitimateFirstTry`,
  `masteryOf`, `masteredPuzzleIds`, `MASTERY_VERSION`.
- `src/domain/training/cycle.ts` — `resolvePuzzleCycle(puzzleId, rows)`.
- `src/domain/training/cycleTypes.ts:123-169` — `TacticalTrainingSetRow`,
  `TrainingCycleRow`, `TrainingCycleStatus`.
- `src/domain/training/types.ts:95-122` — immutable `PuzzleAttemptRow`.
- `src/domain/puzzle/types.ts:52-121` — `PuzzleOrigin`, `PuzzleRow`
  (`tacticalObjective`, `origin`, `difficulty`).
- `src/domain/tactics/types.ts:11-12` — `TacticalObjective`.

### Date model — reuse, never re-implement

- `src/domain/gameLibrary/timeframe.ts` — `TimeFrame`, `resolveTimeFrame`,
  `TimeWindow`, `playedAtInWindow`, `startOfLocalDayMs`, `localDateToMs`,
  `isValidIsoDate`, `MS_PER_DAY`. `StatisticsDateRange` is an alias of the
  canonical `TimeFrame`; resolution is `resolveTimeFrame(range, now)`.

### Persistence reads (existing; no schema change)

- `src/infrastructure/db/games-repository.ts:212-220` —
  `listGameSummaries(query)` with pushdown on `ids` / `source` /
  `normalizedTimeControl` / `playedAt` window.
- `src/infrastructure/db/analysis-jobs-repository.ts:45-55` —
  `listByGames(gameIds)`.
- `src/infrastructure/db/summaries-repository.ts:136-154` —
  `listForGames` / `listForAnalysisIds` / `listAll`.
- `src/infrastructure/db/analysis-repository.ts:20-56` — `listForGame`,
  `listForGameAndAnalysis` (compound `[gameId+analysisId]` index).
- `src/infrastructure/db/puzzles-repository.ts:39-63,96-116` —
  `listAll`, `listForGame`, `getPuzzles`, `countForGames`.
- `src/infrastructure/db/attempts-repository.ts:113-134` — `listAll`,
  `listForCycle`, `listForPuzzle`, `listForCycleAndPuzzle`.
- `src/infrastructure/db/training-sets-repository.ts:87-95` — `get`, `list`.
- `src/infrastructure/db/training-cycles-repository.ts:67-81` — `get`,
  `listForSet`, `getByNumber`.

### Application patterns to mirror

- `src/infrastructure/training/cycle-service.ts:180-435` — injectable
  repositories, typed `ok`/`reason` results, no hidden clock.
- `src/infrastructure/tactics/browser.ts` — lazy browser-service assembly.
- `src/infrastructure/analysis/analysisService.ts:340-355` —
  `ensureSummariesForRows(gameIds)` (the optional lazy-summary backfill).
- `src/domain/gameLibrary/rowView.ts:127-133` — the existing
  `masteredPuzzleCount?` insight field (currently unproduced).
- `src/components/games/library/GameLibrary.tsx:1026-1199` —
  `rowInsightItemsFor` (where the mastered item is added).

---

## 4. Files/modules to create or modify

### New — domain (`src/domain/statistics/`)

| File | Responsibility |
| --- | --- |
| `types.ts` | `StatisticsQuery`, `StatisticsDateRange` (= `TimeFrame`), dimension types, `MetricState`, `Sample`, `Aggregate`, `AccuracyAggregate`, `MIN_SAMPLE_SIZE`, `STATISTICS_VERSION`, `GameHistoryEntry`, `VersionSummary`, `StatisticsDiagnostics`, `TrendGranularity`, `TrendMetric`, `TrendPoint`, `TrendSeries`, `RatingPoint`, `RatingHistory`, `GameMetrics`, `PhaseMetrics`, partition types, `StatisticsQueryError`. |
| `aggregate.ts` | `aggregateOf(value, n, unit, opts)`, `rate`, `share`, `median`, state derivation at the `MIN_SAMPLE_SIZE` boundary, `notDetected` helper; raw values only (never rounds). |
| `query.ts` | `validateStatisticsQuery`, `resolveStatisticsQuery(query)`, `matchesStatisticsDimensions(row, query)`, `partitionGames(rows, query)` (anti-combination), `PRODUCTION_PLATFORMS` (fixture excluded), `combineAllowed(metricClass)`. |
| `eligibility.ts` | `eligibleAnalysisOf(gameId, jobs, summaries)`, `detectionIsCurrent(summary)`, `groupJobsByGame`/`groupSummariesByGame` reuse, diagnostics counters. |
| `history.ts` | `buildGameHistoryEntries(...)` → `GameHistoryEntry[]` (per-game read model). |
| `gameMetrics.ts` | Classification counts/rates/medians/shares, missed-tactic aggregates, move-weighted accuracy; `gameMetricsFor(entries, analyses)`. |
| `phase.ts` | `summarizeByPhase(records, userColor, currentDetectionAnalysisIds)` and `phaseMetricsFor(...)` with per-phase move denominators. |
| `periods.ts` | Local calendar day, ISO-8601 week (Monday start, week 1 contains the first Thursday, week 53 when produced), and month keys/bounds; `periodKeyOf`, `periodBoundsOf`, `enumeratePeriods`, `assignToPeriod`; DST-safe local-date arithmetic. |
| `trends.ts` | `buildTrendSeries(metric, granularity, points, query, versionSummary)` — every period in range, explicit `empty` gaps, ascending. |
| `rating.ts` | `ratingHistories(rows, query)` (one per concrete platform + time control, `playedAt`-chronological, no carry-forward), `ratingTrendSeries(...)`. |
| `training.ts` | `cycleStatsFor(set, cycles, attemptsByCycle, puzzles)`, `weakestCategories`, `repeatedlyFailedPuzzles`, `masteredPuzzleCountForGame/Set`, `masteredPuzzleCountsForGames`, `crossCycleComparison` (reuse `compareCycleMetrics`). |
| `version.ts` | `buildVersionSummary(eligibleJobs, summaries, records?)`, `mixedEngineVersions` / `mixedClassificationVersions`, `MASTERY_VERSION` surfacing. |
| `index.ts` | Barrel. |
| `fixtures/` | Deterministic builders + fixture scenarios (games/jobs/summaries/analyses/puzzles/attempts/cycles/sets) and `fixtures/*.test.ts`. |

### New — infrastructure (`src/infrastructure/statistics/`)

| File | Responsibility |
| --- | --- |
| `statistics-service.ts` | `StatisticsService` — loads rows, orchestrates domain aggregation, optional Worker offload, memoization, optional summary backfill; typed `ok`/`reason` results; injectable repositories, `now`, id/worker factory. |
| `worker-protocol.ts` | `StatisticsComputeRequest` / `StatisticsComputeResponse` (plain structured-cloneable rows + metric subset) and the `StatisticsCompute` interface. |
| `statistics-worker.ts` | Worker entry: receives the loaded snapshot, calls the pure domain modules, posts the result. Imports only `@/domain/statistics/*`. |
| `worker-client.ts` | Lazily creates `new Worker(new URL('./statistics-worker.ts', import.meta.url), { type: 'module' })`, request/response correlation, termination, inline fallback. |
| `browser.ts` | Singleton assembly over Dexie repositories + optional `analysisService` backfill. |
| `index.ts` | Barrel. |

### Modified

| File | Change |
| --- | --- |
| `src/infrastructure/db/analysis-repository.ts` | Add read-only `listForAnalyses(analysisIds)` using the existing `analysisId` index (single query, no schema change); add to `AnalysisRepository` interface + Dexie impl + tests. |
| `src/infrastructure/db/analysis-result-query.ts` | Extend `analysisInsightsForGame` with an optional `masteredCountsByGame` parameter that exposes `masteredPuzzleCount` only when present. |
| `src/hooks/useGameLibrary.ts` | Load mastered counts for the listed game ids via the statistics service and thread them into `analysisInsightsForGame`. |
| `src/components/games/library/GameLibrary.tsx` | Add a `row-insights-mastered` item to `rowInsightItemsFor` when `row.masteredPuzzleCount` is a number (absent ≠ zero). |
| `src/components/games/library/GameLibrary.test.tsx` | Cover the mastered item present/absent and the real-zero case. |
| `src/domain/chess/index.ts` / `src/domain/analysis/index.ts` | No change expected; add exports only if a needed helper is not already public (prefer direct module imports). |

### Explicitly not modified

- `src/pages/DashboardPage.tsx` — stays the Feature-015 placeholder.
- `src/infrastructure/db/database.ts` and `src/infrastructure/db/schema/*` —
  no new table, no version bump.
- `src/config/app-config.ts` — `PERSISTENCE_SCHEMA_VERSION` stays `10`.

---

## 5. Domain/data changes

### 5.1 Query model and dimensions

```ts
type StatisticsDateRange = TimeFrame; // canonical game-library.md §3 model

interface StatisticsQuery {
  platform: 'all' | GameSource;            // fixture never appears in production output
  timeControl: 'all' | TimeControlCategory;
  side: 'all' | Color;                      // Game.userColor
  result: 'all' | GameOutcome;              // via outcomeOf(Game.result)
  dateRange: StatisticsDateRange;           // resolved local calendar-day boundaries
  now: number;                              // caller-supplied epoch ms
  combine?: boolean;                        // explicit merge request (default false)
}
```

- `validateStatisticsQuery` rejects malformed dates and `from > to` with a
  typed `{ ok: false, reason: 'invalid-date-range'; message }` — never a silent
  widening.
- `resolveStatisticsQuery` produces `{ window: TimeWindow, ... }` via
  `resolveTimeFrame`.
- `partitionGames` returns concrete `(platform, timeControl)` partitions when
  either dimension is `'all'`. A merged value is produced only when
  `combine === true` and `combineAllowed(metricClass)` is true; it carries
  `combined: true`. Speed-sensitive metrics (accuracy, per-game error rates,
  missed tactics) are never silently combined; pure activity counts
  (`gamesPlayed`, `gamesAnalyzed`) may be. `unknown` and `correspondence` are
  always their own categories.
- `fixture` rows are excluded by the application service unless a test-only
  `includeFixtureSources` option is set; the domain functions stay source-agnostic.

### 5.2 Metric contract

```ts
type MetricState = 'ok' | 'insufficient' | 'empty' | 'notDetected';
interface Sample { unit: 'games' | 'moves' | 'puzzles' | 'cycles'; n: number }
interface Aggregate { value: number | null; state: MetricState; sample: Sample }
interface AccuracyAggregate extends Aggregate { weightMoves: number }
```

- `MIN_SAMPLE_SIZE = 5` (domain constant).
- `state`: `ok` when `n >= 5`; `insufficient` when `0 < n < 5` (value still
  returned); `empty` when `n === 0` (`value: null`); `notDetected` only for
  missed-tactic metrics when `detectedGames === 0` (`value: null`).
- A completed detection that found nothing is a real `0` (`ok`/`insufficient`).
- Values are raw/full precision; rounding is presentation.

### 5.3 Eligible analysis

```text
eligibleAnalysis(game) := latestCompletedJob(jobs of game)
  where an AnalysisSummaryRow exists for that analysisId
```

- Independent of the current Library status: a queued/in-progress re-analysis
  does not remove the previous completed analysis; `pendingAnalysis` is
  surfaced as a diagnostic.
- Games whose latest completed analysis has no persisted summary are excluded
  from analysis metrics and counted in `missingSummary`; the service may invoke
  `analysisService.ensureSummariesForRows` before computing (opt-in; Feature 014
  never writes summaries).
- Training statistics ignore analysis freshness entirely (a puzzle is immutable
  provenance).

### 5.4 Game history and metrics

`GameHistoryEntry` per §4 of the spec (gameId, playedAt, source,
normalizedTimeControl, userColor, outcome, userRating, analysisId,
analysisStatus, accuracy, accuracyMoves, classificationCounts, missedTactics).

`GameMetrics` groups:
- `games.{total, analyzed, detected, missingSummary, pendingAnalysis, undated}`;
- `classification.{inaccuracies, mistakes, blunders, inaccuraciesPerGame,
  mistakesPerGame, blundersPerGame, medianBlundersPerGame,
  medianMistakesPerGame, gamesWithBlunderShare, gamesWithMistakeShare}`;
- `missedTactics.{missedTactics, missedTacticsPerGame,
  gamesWithMissedTacticShare}` (sample unit `games`, `detected`);
- `accuracy` (move-weighted `Σ(accuracy_i × accuracyMoves_i) /
  Σ(accuracyMoves_i)`, `sample.unit = 'games'`, `n` = games with non-null
  accuracy, `weightMoves` exposed).

Diagnostics (never errors): `missingSummary`, `pendingAnalysis`, `undated`,
`orphanedSummaries`, `orphanedAttempts`, `unrecognizedTimeControls`.

### 5.5 Phase metrics

`summarizeByPhase(records, userColor, currentDetectionAnalysisIds)` groups the
user's persisted `MoveAnalysis` by `record.gamePhase` (never re-derived):
counts per negative class, `userMovesInPhase`, and a detection-restricted
`detectedUserMovesInPhase` + `missedTactics`. `errorsPer100Moves =
count / denominator × 100`; count samples are `games` (`analyzed`, or
`detected` for missed tactics), rate samples are `moves`.

### 5.6 Rating history

`ratingHistories(rows, query)` returns one `RatingHistory` per concrete
`(platform, timeControl)` with rated games: chronological
`{ gameId, playedAt, rating }` from the user's `Player.rating`, `playedAt`
non-null only, no carry-forward, no cross-platform/time-control combination.
Missing rating yields no point. Rating trend points use the latest rated game
within the period; empty periods are `empty`.

### 5.7 Period / trend model

`day` = local `yyyy-mm-dd`; `week` = ISO-8601 `yyyy-Www` (Monday start, week 1
contains the first Thursday, local time, year-spanning and week-53 correct);
`month` = local `yyyy-mm`. Every period in the requested range is emitted in
ascending order; no-observation periods are `empty` (`value: null`, `n: 0`).
`all` derives the range from observed `playedAt` min/max; no observations ⇒
empty series. Supported metrics: `gamesPlayed`, `gamesAnalyzed`, `accuracy`,
`rating`, `inaccuraciesPerGame`, `mistakesPerGame`, `blundersPerGame`,
`missedTacticsPerGame`, and the absolute error/missed-tactic counts. Weekly is
the default granularity.

### 5.8 Training aggregates

- Per-cycle: reuse `computeCycleMetrics`; per-puzzle resolution reuse
  `resolvePuzzleCycle`. `skipped` never enters an accuracy/solve-rate
  denominator; zero definite puzzles ⇒ rate/time aggregates `empty`;
  `inProgress` reports partial, `abandoned` reported separately.
- Per set: `active`/`archived`, `puzzleCount`, cycles in cycle-number order,
  current cycle reference; cross-cycle comparison via `compareCycleMetrics`
  (same set, same metric; `absoluteDelta`/`relativeDelta`; no causation claim).
- Weakest categories: category = `puzzle.tacticalObjective` for tactical rows,
  `'blunder'` for blunder-origin rows; per category `puzzleCount`,
  `definiteAttempts`, `solved`, `firstTryAccuracy`, `solveRate` with §5.2
  samples/states; deterministic order ascending `solveRate` then ascending
  category key, only `n >= MIN_SAMPLE_SIZE` enters the ranking.
- Repeatedly failed: `failed` in ≥ 2 distinct cycles of the same set; expose
  `puzzleId`, `sourceGameId`, `failureCount`, `cycleCount`, `lastFailedAt`;
  ordered `failureCount` desc then `puzzleId` asc.
- Mastery: reuse `masteryOf` / `masteredPuzzleIds` (never re-derived);
  `masteredPuzzleCountForGame`, `masteredPuzzleCountForSet`, global total;
  `MASTERY_VERSION` surfaced in the version summary.
- Training aggregates never take the game-analysis platform/time-control/date
  filters.

### 5.9 Versioning and determinism

`STATISTICS_VERSION = 1`, returned with every result and bumped on aggregation
semantics changes. `VersionSummary` carries distinct `analysisVersion`,
`classificationVersion`, `gamePhaseVersion`, `detectionVersion`, engine
identities (`name version build`), `statisticsVersion`, `masteryVersion`, and
`mixedEngineVersions` / `mixedClassificationVersions` (ADR-020: label, never
silently mix). All functions are deterministic for fixed inputs, `now`, and
time zone; no hidden clock or locale reads.

---

## 6. UI changes

Feature 014 has no page. The only user-visible change is the read-only Game
Library mastered-puzzle insight:

- `rowInsightItemsFor` (`GameLibrary.tsx:1026`) gains a `Mastered N` item
  (`data-testid="row-insights-mastered"`) rendered only when
  `row.masteredPuzzleCount` is a number; `0` is a real zero (shown), absent is
  not rendered as zero. Spoken text spells the value out (accessibility:
  colour is never the only signal).
- `DashboardPage.tsx` is untouched (Feature 015).
- No new route, nav item, chart or layout change.

---

## 7. Infrastructure changes

- `StatisticsService` loads only what a query needs: game summaries pushed down
  by the query window/dimensions; jobs + summaries for the listed games;
  `MoveAnalysis` only for requested phase metrics and only for eligible
  analyses (`listForAnalyses`); puzzles/attempts/cycles only for requested
  training reads. No unbounded synchronous scan.
- Optional Worker path (`statistics-worker.ts` + `worker-client.ts`): the
  service computes inline for small snapshots and offloads the pure
  aggregation to a Worker above a measured threshold. Tests exercise the inline
  path and a fake worker; the real Worker path is smoke-checked in
  `npm run dev`/`test:browser`.
- Memoization: an in-memory `Map` keyed by `(queryKey, dataVersionKey)`. The key
  contract is `dataVersionKey` supplied by the caller/assembler; when absent,
  no caching. **Correctness never depends on the cache** — a miss recomputes.
- Optional lazy-summary backfill via an injected `{ ensureSummariesForRows }`
  (defaults to the browser `analysisService`); failures are swallowed and never
  block a read.
- No IndexedDB table, no Dexie version bump, no `PERSISTENCE_SCHEMA_VERSION`
  change, no sync payload change.

### Performance budget (to measure and record during implementation)

- No single synchronous task on the main thread exceeds ~50 ms.
- Inline path used below `STATISTICS_WORKER_ROW_THRESHOLD` (initial value
  2,000 loaded rows); above it the Worker path is used.
- Benchmark: a synthetic dataset of ≥ 1,000 analyzed games and ≥ 10,000
  attempts aggregates a full query within a recorded budget (initial target
  < 1,500 ms in the inline path under `fake-indexeddb`, non-CI via
  `STATS_BENCH=1`). The actual measured numbers and the final threshold are
  recorded in the test file and this plan at implementation time.

---

## 8. Dependencies

- **None added.** No date library, chart library, scheduler or statistics
  library. ISO-week/period math is implemented deterministically in
  `periods.ts` (no dependency). Recharts remains Feature 015's concern.
- Reuses existing runtime deps only (`chessops`, `dexie`).

---

## 9. Tests

### Domain (`src/domain/statistics/`, fixtures separated)

Deterministic fixtures must cover (spec "Testing requirements"): empty dataset;
games with no analysis; one analyzed game; all six time-control categories;
Lichess + Chess.com with separate ratings; ≥ 4 weeks incl. an ISO year-spanning
week and a month/year boundary; each phase with differing move exposure;
detection `absent`/`queued`/`inProgress`/`failed`/`completed` current/older
(freshness) incl. a completed real `0`; missing rating/`playedAt`/unknown time
control/no analyzed moves; mixed engine/classification versions; training
fixtures (completed/in-progress/abandoned cycles, hints/retries/skips/times,
re-presented puzzle, failed across ≥ 2 cycles, tactical + blunder origins,
mastered in 3 cycles incl. across two sets, restart-disqualified row, clean
retry row that earns no credit).

Test cases:
- Aggregation totals/averages/medians/shares/`n` against hand-computed values.
- Time control: six categories separate; `'all'` returns dimensioned results;
  no silent merge; combined only with explicit `combine`.
- Platform: Lichess/Chess.com ratings never combine.
- Accuracy: move-weighted mean; per-game accuracy read, never recomputed.
- Phase: counts and `errorsPer100Moves` use correct per-phase denominators;
  missed tactics honor detection state.
- Trends: pinned `TZ` (mirroring
  `src/domain/gameLibrary/gameLibrary.test.ts:26-33`), ISO week/year edges,
  explicit empty periods, deterministic ordering.
- States: `ok`/`insufficient`/`empty`/`notDetected` at the `MIN_SAMPLE_SIZE`
  boundary; no data is never rendered as zero.
- Eligible analysis: latest completed wins; missing summary excluded; pending
  re-analysis keeps history; mixed versions flagged.
- Training: per-puzzle cycle resolution, denominators, median/average solving
  time, same-set cross-cycle deltas, weakest-category ranking, repeatedly
  failed, canonical mastery (`masteryOf` reused, retries never credit).
- Determinism: identical inputs + `now` produce identical results.
- Query validation: malformed date and `from > to` return the typed error.

### Repository / service

- `analysis-repository.test.ts` — `listForAnalyses` batching, ordering,
  empty-input no-op.
- `statistics-service.test.ts` on `fake-indexeddb` (mirroring
  `cycle-service.test.ts`): seeded games/jobs/summaries/analyses/puzzles/
  attempts/sets/cycles; eligible selection; fixture exclusion; diagnostics;
  partitions; trend/rating/training methods; memo hit/miss; backfill injection;
  Worker-vs-inline seam with a fake compute.
- `worker-protocol.test.ts` — request/response round-trip and inline fallback.

### Component

- `GameLibrary.test.tsx` — mastered item shown when present, hidden when absent,
  `Mastered 0` real zero, screen-reader text.

### Performance

- `statistics.perf.test.ts` — bounded synthetic benchmark, guarded by
  `STATS_BENCH=1` (non-CI), asserting completion within the recorded budget.

---

## 10. Migration considerations

- **No migration.** No new table, no index change, no Dexie version bump;
  `PERSISTENCE_SCHEMA_VERSION` stays `10`. Existing `analysisId` index supports
  the only repository addition.
- Compatibility with existing data: summaries without `detectionVersion`/
  puzzle fields read as not-current/absent; attempts without `restartCount`
  read `?? 0` (mastery already does); puzzles without `origin` read
  `'tactical'`; games without `moveCount`/`termination` are irrelevant here.
- Orphaned summaries/attempts (cascade gaps) are excluded from aggregates and
  counted in diagnostics, never fabricated.
- No sync change: derived statistics are recomputable and never synced as
  standalone values.

---

## 11. Risks

- **ISO-week / DST correctness** in local time is the highest-risk pure logic;
  mitigate with pinned-`TZ` fixtures plus year-spanning/week-53 cases.
- **Duplicate math drift**: accuracy/classification/phase/cycle/mastery must be
  imported, not copied; a review check must confirm no re-implementation.
- **Worker cloning overhead** could exceed the inline cost for medium datasets;
  mitigate with a measured threshold and inline fallback.
- **Performance on thousands of games** (notably `attempts.listAll()` for
  global mastery); mitigate by bounding reads to requested sets/games where
  possible, chunking/yielding, and the benchmark.
- **`notDetected` vs `empty` vs real `0`** is subtle; centralize in
  `aggregate.ts` and test the boundary.
- **Fixture leakage** into production results; the service excludes
  `fixture` unless a test-only option is set, with a test.
- **`all` date range** could produce an unbounded trend series; cap the
  enumeration or derive bounds from observations, and test.
- **Mixed versions** must be labeled, never silently averaged (ADR-020); test
  the flags.
- **Cache correctness**: memoization must be a pure optimization; a test must
  show a cache miss recomputes identically.
- **Cross-feature coupling**: reusing `CycleService`-owned semantics via the
  domain function keeps a single source; avoid importing the application
  `CycleService` from the domain.

---

## 12. Acceptance criteria

Feature-014 spec acceptance criteria (1–14) are the contract; the plan adds:

1. Statistics compute from deterministic analyzed fixtures with no
   Chess.com/Lichess/Stockfish access.
2. Blunders/mistakes/inaccuracies/missed tactics aggregate per game and per
   period.
3. All six ADR-013 categories stay separate; `'all'` is dimensioned; a combined
   value is explicit and labeled.
4. Lichess/Chess.com rating histories stay separate per time control.
5. Phase stats distinguish opening/middlegame/endgame with correct per-move
   denominators and normalized rates.
6. Every value exposes `n` and one of `ok`/`insufficient`/`empty`/`notDetected`;
   below `MIN_SAMPLE_SIZE` the value is flagged `insufficient`.
7. `empty`/`notDetected` and real zeros are distinguishable.
8. Trend series cover every period in range with explicit empty gaps; ISO week
   boundaries (incl. year-spanning) are correct under a pinned `TZ`.
9. Rating history derives from stored game ratings; missing ratings yield no
   point.
10. Training stats provide per-set/per-cycle aggregates, cross-cycle deltas,
    weakest categories, repeatedly-failed puzzles and mastered counts via the
    canonical `masteryOf`; never mixed with game-analysis metrics.
11. Each result carries `STATISTICS_VERSION` and the contributing-version
    summary incl. mixed-engine/classification flags.
12. No domain/statistical calculation lives in the Dashboard or Library; the
    Library renders the `masteredPuzzleCount` aggregate read-only.
13. All aggregation is covered by automated deterministic-fixture tests and is
    demonstrable locally with no real imports.
14. No new persisted table is required for V1.
15. The implementation adds no dependency and does not re-implement accuracy,
    classification, phase, cycle-metric or mastery math.
16. The measured performance budget and worker threshold are recorded.

---

## 13. Verification commands

Narrow-first (during implementation):

```
npm run typecheck
npm run test -- src/domain/statistics
npm run test -- src/infrastructure/statistics
npm run test -- src/infrastructure/db/analysis-repository.test.ts
npm run test -- src/components/games/library/GameLibrary.test.tsx
STATS_BENCH=1 npm run test -- src/infrastructure/statistics/statistics.perf.test.ts
```

Then the full gate per `AGENTS.md` "Execution policy" (load the `verify-gate`
skill for the runbook):

```
npm run lint
npm run typecheck
npm run format:check
npm run test
npm run build
npm run dev          # smoke run, no browser-console errors
npm run test:browser # when Chromium is available
npm audit
```

Tests that depend on the local calendar must run with a pinned `TZ` (in-file
`process.env.TZ` like `src/domain/gameLibrary/gameLibrary.test.ts:26-33`).

---

## 14. Staged implementation sequence

- **Stage A — Domain contracts + game aggregates.** `types.ts`,
  `aggregate.ts`, `query.ts`, `eligibility.ts`, `history.ts`, `gameMetrics.ts`,
  `version.ts`, fixtures; tests. No repository/service change.
- **Stage B — Phase, periods, trends, rating.** `phase.ts`, `periods.ts`,
  `trends.ts`, `rating.ts`; pinned-`TZ` tests.
- **Stage C — Training aggregates.** `training.ts` reusing
  `computeCycleMetrics`/`compareCycleMetrics`/`masteryOf`/`resolvePuzzleCycle`;
  fixtures + tests.
- **Stage D — Application service + Worker + repository addition.**
  `listForAnalyses`; `statistics-service.ts`, `worker-protocol.ts`,
  `statistics-worker.ts`, `worker-client.ts`, `browser.ts`, `index.ts`;
  `fake-indexeddb` service tests; benchmark.
- **Stage E — Game Library mastered insight.** Overlay parameter in
  `analysis-result-query.ts`, `useGameLibrary.ts`, `GameLibrary.tsx` strip item
  and component tests.
- **Stage F — Test closure + full gate.** Fill remaining fixture scenarios,
  confirm no duplicated math, record the measured budget/threshold, run the
  full gate and update this plan's performance section with actual numbers.
