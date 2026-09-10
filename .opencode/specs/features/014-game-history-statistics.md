# Feature 014 — Game Analysis History & Statistics

## Purpose

Provide the **domain statistics and history layer** for ChessRemedy: the
single authoritative source that turns persisted analysis, detection and
training data into meaningful, dimension-aware aggregates and time series.

The feature answers the product's progress questions ("What mistakes am I
repeatedly making?", "Am I improving?", "What should I train next?") by
returning **values plus their sample size, their reliability state and their
analysis-version provenance** — never by rendering charts.

This feature:

- calculates and exposes statistics;
- never renders charts or dashboard UI (Feature 015 does);
- never recalculates engine analysis, classification, accuracy or
  detection — it consumes persisted results through the canonical domain
  functions;
- never starts Stockfish and never touches the network.

All statistics are computed locally from persisted data, are deterministic
for a fixed input and a caller-supplied `now`, and are independently
testable with fixtures.

---

## Scope

### In scope

1. Analyzed-game history (per-game read model with its analysis identity).
2. Move-classification aggregates (inaccuracy / mistake / blunder).
3. Missed-tactic aggregates (Feature-010 `missedTactic`, absent-vs-zero).
4. Accuracy aggregates (ADR-024, move-weighted across games).
5. Game-phase aggregates (opening / middlegame / endgame).
6. Time-control-separated and platform-separated aggregation.
7. Rating/Elo history per platform and time control.
8. Period trends (day / ISO week / month) with explicit empty periods.
9. Sample-size metadata and a canonical reliability state for every value.
10. Statistics query/filtering over the canonical dimensions.
11. Tactical-training statistics: per-set and per-cycle aggregates,
    cross-cycle comparisons, weakest tactical categories, repeatedly failed
    puzzles and the mastered-puzzle aggregate.
12. A statistics-aggregation version and contributing-version provenance.

### Out of scope

- Chart rendering, layout, colour, tooltips (Feature 015).
- Any engine work, re-analysis, detection or puzzle generation.
- Per-game row insights production (accuracy, classification counts and
  missed-tactic counts shown in Game Library rows are produced by the
  analysis/detection pipeline and persisted as the per-analysis summary —
  see "Game Library integration").
- Individual-puzzle scheduling, "due"/retention concepts (ADR-031).
- Statistical-significance claims, rating conversion between platforms, or
  any cross-platform rating combination.
- Persisted/materialized statistics tables in V1 (see Performance and Data
  requirements). V1 keeps the analyzed game data as the single source of
  truth.
- Semantic tactical-motif taxonomy (out of scope for V1, `domain/tactics.md`).
  "Weakest tactical categories" uses the stored `TacticalObjective` and the
  puzzle `origin` only.

---

## Relationship to other features

| Feature | Role |
|---|---|
| 003 | `Game`, `Player.rating`, `GameOutcome`, `TimeControlCategory` source types. |
| 004/007 | Persistence and the canonical Library filter/date model. |
| 008 | Produces persisted `MoveAnalysis` (evaluation, classification, game phase, clocks) and analysis jobs/status. |
| 009 | Canonical classification summary and ADR-024 accuracy functions (reused, never duplicated). |
| 010 | Per-analysis summary + detection state + `missedTactic` annotations; the Game Library insights milestone. |
| 011 | Immutable `PuzzleRow` (origin, objective, difficulty) consumed by training statistics. |
| 012 | Writes immutable `puzzleAttempts` rows. |
| 013 | Owns training-set/cycle lifecycle and records; **provides the sets/cycles Feature 014 aggregates over**. |
| 015 | The sole UI consumer of this feature; renders read-only. |

Statistics never calculate a value the Dashboard could calculate, and the
Dashboard never calculates a value this feature exposes.

---

## User-facing behavior

This feature has **no page of its own**. Its user-visible effect is the
correctness and honesty of the Dashboard (Feature 015) and of the Game
Library's mastered-puzzle insight. The contract that makes those surfaces
user-facing and honest:

- every returned value is accompanied by its `n` (sample size) and a typed
  reliability state, so the UI can always render "n = X" or an explicit
  "insufficient data" placeholder instead of a bare number;
- absent data (`empty`) and un-run detection (`notDetected`) are returned as
  such, so the UI never renders them as a literal zero;
- time-control and platform dimensions are returned separately, so the UI
  can label a mixed view and never present one by default;
- rating series are returned per platform and per time control, so the UI
  can never average Chess.com and Lichess ratings;
- trend points carry their period boundaries and state, so the UI can render
  gaps (no games) distinctly from zeros (real zero values).

Feature 014 defines no accessibility or responsive UI requirements of its
own; it guarantees the data contract that lets Feature 015 satisfy them (see
Accessibility and Responsive/mobile).

---

## Domain behavior

All functions are pure, synchronous domain functions over already-loaded
inputs. The application service (see Data requirements) is responsible for
loading persisted rows and may run the aggregation in a worker.

### 1. Query model and dimensions

A statistics query reuses the canonical dimension value types — it does
**not** reuse the Game Library UI filter object and never includes `search`
or selection:

```ts
interface StatisticsQuery {
  platform: 'all' | GameSource;          // GameSource = lichess | chesscom | local | fixture
  timeControl: 'all' | TimeControlCategory; // ADR-013 six categories
  side: 'all' | Color;                   // Game.userColor
  result: 'all' | GameOutcome;           // via outcomeOf(Game.result)
  dateRange: StatisticsDateRange;        // resolved local calendar-day boundaries
  now: number;                           // caller-supplied epoch ms (preset resolution + determinism)
}
```

- `StatisticsDateRange` is the canonical date model of
  `domain/game-library.md` §3 (presets resolved backwards from `now` in
  whole local calendar days/months/years, custom `yyyy-mm-dd` `from ≤ to`,
  inclusive start-of-day / end-of-day in the user's local time zone).
  Date-range resolution is shared, never re-implemented.
- `platform` includes `local`; `fixture` is test-only and must never appear
  in a production statistics result. The canonical presentation order is
  **Lichess, Chess.com** (`domain/game-library.md`); additional sources
  follow, `fixture` excluded.
- `result` uses the canonical `GameOutcome` (`whiteWins` / `blackWins` /
  `draw` / `unknown`) via `outcomeOf`. A user-perspective win/draw/loss
  label is presentation, not a new domain dimension.
- Dimensions combine with AND, single-select in V1 (multi-select can be
  added without redesign).

**Anti-combination rule.** When `platform` and/or `timeControl` is `'all'`,
the service returns **dimensioned results** — one result per concrete
`(platform, timeControl)` combination that has observations — rather than a
single merged value. A merged/combined series is only produced when a caller
explicitly requests it and must carry a `combined: true` label. Pure activity
counts (`gamesPlayed`, `gamesAnalyzed`) may be combined when explicitly
requested; speed-sensitive metrics (accuracy, blunders/game, mistakes/game,
missed tactics/game) may never be silently combined across time-control
categories. `unknown` and `correspondence` are their own categories and are
never merged into bullet/blitz/rapid/classical.

### 2. Eligible analysis per game

Every game contributes **at most once** to analysis-derived aggregates, via
its **eligible analysis**:

```text
eligibleAnalysis(game) :=
  latestCompletedJob(jobs of game)              // Feature-008 canonical derivation
    where a persisted AnalysisSummaryRow exists for that analysisId
```

- The selection rule is the Feature-008 canonical one
  (`latestCompletedJob`): the most recently completed run by `updatedAt`,
  any analysis identity. It matches the Game Library's "latest completed
  analysis" rule; there is no second definition.
- Eligibility is the **existence of an eligible analysis**, independent of
  the current Library status: a game whose only completed run has been
  superseded by a newer queued/in-progress run still contributes its
  eligible analysis. This keeps history stable instead of blanking the
  Dashboard during a batch re-analysis. (Deliberate divergence from the
  Library row strip, which hides during re-analysis.)
- A game whose latest completed analysis has no persisted summary is
  **excluded** from analysis-derived aggregates and counted in
  `games.missingSummary`. The application service may request the existing
  Feature-010 lazy-summary backfill before computing so the Dashboard is
  complete; Feature 014 itself does not write summaries.
- A queued/in-progress re-analysis does **not** remove the game's previous
  completed analysis from statistics; the count of games with an active
  run is surfaced as `games.pendingAnalysis` so the Dashboard can label it.
- The Library's `analysis` filter population (`analysisLibraryStatus`
  `completed`/`outdated`) equals the eligible set only when no newer run is
  active; the two must not be conflated.
- An `outdated` analysis (stale classification/game-phase version or a
  different engine identity) still contributes; the aggregate's version
  provenance is exposed instead (see §12).
- Training statistics do **not** use this rule: they aggregate over persisted
  puzzles/attempts/cycles regardless of analysis freshness, because a puzzle
  is an immutable artifact of its provenance.

### 3. Metric result contract

Every scalar aggregate uses one contract:

```ts
type MetricState = 'ok' | 'insufficient' | 'empty' | 'notDetected';

interface Sample {
  unit: 'games' | 'moves' | 'puzzles' | 'cycles';
  n: number;
}

interface Aggregate {
  value: number | null;   // null for 'empty' and 'notDetected'
  state: MetricState;
  sample: Sample;
}
```

- `MIN_SAMPLE_SIZE = 5` is the canonical threshold (`domain/statistics.md`,
  ADR-013). It is a domain constant, not a Dashboard constant.
- `state` semantics:
  - `ok` — value computed and `sample.n >= MIN_SAMPLE_SIZE`;
  - `insufficient` — value computed but `0 < sample.n < MIN_SAMPLE_SIZE`
    (the value is returned so tests can assert it; the Dashboard hides it
    behind the "insufficient data" placeholder);
  - `empty` — no applicable observations; `value` is `null`;
  - `notDetected` — a missed-tactic metric where no eligible analysis has a
    **current** completed detection pass; `value` is `null` (absent ≠ zero).
- `value` is always raw/full-precision; rounding is a presentation concern
  (accuracy to one decimal via the Feature-009 helper, counts integers,
  times in ms). The domain never rounds.
- A completed detection pass that found nothing is a real `0` (`state: ok`
  or `insufficient` by `n`), never `notDetected`.
- Each aggregate's `sample.unit` is documented per metric below. `n = 0`
  always implies `empty` (or `notDetected` for missed tactics).

### 4. Game-analysis metrics

The per-game **history entry** is the read model that makes aggregates
traceable to individual games (and enables Dashboard drill-down):

```ts
interface GameHistoryEntry {
  gameId: GameId;
  playedAt: string | null;
  source: GameSource;
  normalizedTimeControl: TimeControlCategory;
  userColor: Color;
  outcome: GameOutcome;               // via outcomeOf(Game.result)
  userRating: number | null;          // the user's Player.rating
  analysisId: string | null;          // eligible analysis identity
  analysisStatus: GameAnalysisStatus; // Feature-008 derivation
  accuracy: number | null;            // persisted summary (ADR-024)
  accuracyMoves: number;
  classificationCounts: ClassificationCounts | null; // user side
  missedTactics: number | null;       // null until a current completed pass
}
```

Denominators (canonical, and distinct):

- `games.total` — all games matching the query dimensions.
- `games.analyzed` — games with an eligible analysis.
- `games.detected` — eligible analyses whose detection pass is `completed`
  at the current `DETECTION_VERSION` (`domain/tactics.md` freshness gate).
- `games.missingSummary`, `games.pendingAnalysis`, `games.undated`
  (no `playedAt`, excluded from date windows) — diagnostics, never errors.

Classification counts (user side only, from the per-analysis summary's
`classificationCounts`; canonical Feature-009 function):

| Metric | Definition | Sample unit |
|---|---|---|
| `inaccuracies` | Σ user inaccuracies | games (`analyzed`) |
| `mistakes` | Σ user mistakes | games (`analyzed`) |
| `blunders` | Σ user blunders | games (`analyzed`) |

Per-game rates and shares (user side):

| Metric | Definition | Sample unit |
|---|---|---|
| `inaccuraciesPerGame` | `inaccuracies / analyzedGames` | games |
| `mistakesPerGame` | `mistakes / analyzedGames` | games |
| `blundersPerGame` | `blunders / analyzedGames` | games |
| `medianBlundersPerGame` | median of per-game blunder counts | games |
| `medianMistakesPerGame` | median of per-game mistake counts | games |
| `gamesWithBlunderShare` | games with ≥1 user blunder / `analyzedGames` | games |
| `gamesWithMistakeShare` | games with ≥1 user mistake / `analyzedGames` | games |

Missed tactics (user side, `missedTactic` annotations; only detected games
contribute):

| Metric | Definition | Sample unit |
|---|---|---|
| `missedTactics` | Σ user missed tactics over detected games | games (`detected`) |
| `missedTacticsPerGame` | `missedTactics / detectedGames` | games (`detected`) |
| `gamesWithMissedTacticShare` | detected games with ≥1 / `detectedGames` | games (`detected`) |

- If `detectedGames === 0`, the missed-tactic metrics are `notDetected`.
- `opponent` counts are never aggregated; they remain Game Review context.
- `best`/`good` counts are available on the per-game history entry for
  completeness but are not part of the error metrics.

Accuracy (ADR-024, never re-implemented):

- **Per-game accuracy** is the persisted summary's `accuracy` (the canonical
  Feature-009/ADR-024 `gameAccuracy` over the user's usable moves); `null`
  when no usable user move exists.
- **Aggregate accuracy** is the ADR-024 **move-weighted mean**:
  `Σ(gameAccuracy_i × accuracyMoves_i) / Σ(accuracyMoves_i)` over games with
  a non-null accuracy.
- `sample.unit = 'games'`, `sample.n` = number of games with a non-null
  accuracy (the reliability sample); `weightMoves = Σ accuracyMoves` is
  exposed as the weighting denominator.
- Accuracy series are always separated by time-control category and platform;
  a cross-time-control accuracy series is never produced.

### 5. Game-phase metrics

Each analyzed move carries a canonical `gamePhase`
(`domain/game-phase.md`); Feature 014 never re-derives phase. Per phase
(opening / middlegame / endgame), for the user's moves in eligible analyses:

- `inaccuracies`, `mistakes`, `blunders` counts by phase;
- `missedTactics` by phase, only over analyses with a current completed
  detection pass (`notDetected` otherwise);
- normalized rate `errorsPer100Moves = count / userMovesInPhase × 100` for
  each negative class and for missed tactics.

Denominator rules:

- `userMovesInPhase` = the user's moves whose eligible `MoveAnalysis`
  `gamePhase` equals the phase. For missed-tactic metrics it is restricted
  to moves in analyses with a current completed detection pass, so a
  not-yet-scanned analysis never dilutes the denominator.
- The phase rate's `sample.unit = 'moves'`, `n = userMovesInPhase`; the
  count's `sample.unit = 'games'`, `n = analyzedGames` (detected games for
  missed tactics).
- Absolute counts are never presented as directly comparable across phases
  when the move exposure differs; the normalized rate is the comparable
  metric.

Phase aggregates are computed from persisted `MoveAnalysis` records (the
per-analysis summary has no phase breakdown), read for the eligible analysis
of each game via the compound `[gameId + analysisId]` index. Feature 014
owns a canonical pure `summarizeByPhase(records, userColor)` that groups the
canonical classification counts and missed-tactic annotations by
`record.gamePhase`; it never recomputes classification, accuracy or phase.

### 6. Rating history

- Rating points come from the stored `Player.rating` of the user's side
  (`Game.userColor`) on each game; `null` ratings produce no point. There is
  **no separate rating-history store** (the current wording "must be stored"
  is superseded — ratings are derived from games).
- A rating history is always scoped to **one platform and one time-control
  category** (PRODUCT §6). When the query is `'all'`, the service returns one
  history per concrete `(platform, timeControl)` pair with rated games; it
  never averages or converts ratings across platforms and never produces a
  single cross-time-control rating line.
- Only sources that supply ratings (Lichess, Chess.com) yield points; local
  games with `rating: null` yield none.
- `points` are chronological `{ gameId, playedAt, rating }`; `playedAt`
  `null` games are excluded (counted in `games.undated`).
- A period's rating is the rating of the latest rated game **within that
  period**; periods without a rated game are `empty` (no carry-forward in
  V1). The chosen point's `playedAt` is exposed so the UI can date it.

### 7. Trend / period model

```ts
type TrendGranularity = 'day' | 'week' | 'month';
```

- `day` — the user's local calendar day `yyyy-mm-dd`.
- `week` — the **ISO-8601 week** (Monday start; week 1 contains the first
  Thursday) in the user's local time zone; period key `yyyy-Www` (e.g.
  `2026-W34`). Weeks may span calendar years (e.g. `2026-W01` starts in
  December 2025); week 53 exists when the ISO rule produces it.
- `month` — the user's local calendar month `yyyy-mm`.
- Period boundaries are derived from the resolved query date range in the
  user's local time zone, consistent with `domain/game-library.md` §3.
- A `TrendSeries` contains **every period in the requested range**, in
  ascending order. A period with no observations is emitted with
  `state: 'empty'`, `value: null`, `sample.n = 0` — an explicit gap, never a
  fabricated zero. A period with observations follows the §3 state rules.
- Each `TrendPoint` carries `periodKey`, inclusive local `periodStart` /
  `periodEnd`, `value`, `state` and `sample`.
- Each series carries its `metric`, `granularity`, concrete `platform`,
  concrete `timeControl`, `statisticsVersion` and version provenance.
- Supported trend metrics: `gamesPlayed`, `gamesAnalyzed`, `accuracy`,
  `rating`, `inaccuraciesPerGame`, `mistakesPerGame`, `blundersPerGame`,
  `missedTacticsPerGame`, and the absolute error/missed-tactic counts.
- Weekly aggregation is the default granularity for the Dashboard; day and
  month are supported without changing the model.

### 8. Training-set and cycle metrics

Training statistics are computed from persisted `PuzzleRow`, `PuzzleAttempt`
and Feature-013 set/cycle records, per `domain/tactical-training.md`. They
are **never mixed** with game-analysis aggregates.

**Per-puzzle cycle resolution (reconciles Feature 012's row-per-presentation
storage with the domain's per-puzzle metrics).** For a cycle and a puzzle,
let `presentations` be the attempt rows ordered by `presentationIndex`:

```text
skipped          := presentations is non-empty and every result is 'skipped'
definite         := presentations with result != 'skipped'
firstTrySolved   := presentations[0].result === 'solvedFirstTry'
eventuallySolved := any presentation result ∈ { solvedFirstTry, solvedWithHelp }
lastResult       := last definite presentation's result (or 'skipped')
wrongMoves       := Σ presentation.wrongMoveCount
hints            := Σ presentation.hintCount
solvingTimeMs    := Σ presentation.solvingTimeMs over definite presentations
```

Per-cycle aggregates (`sample.unit = 'puzzles'` for rate metrics):

| Metric | Definition |
|---|---|
| `puzzlesAttempted` | distinct puzzles with ≥1 row |
| `puzzlesCompleted` | distinct puzzles with ≥1 definite presentation (the accuracy/solve-rate denominator) |
| `puzzlesSkipped` | distinct puzzles whose only result is `skipped` |
| `firstTryAccuracy` | `count(firstTrySolved) / puzzlesCompleted` |
| `solveRate` | `count(eventuallySolved) / puzzlesCompleted` |
| `totalPresentations` | total attempt rows |
| `totalWrongMoves` | Σ `wrongMoves` |
| `hintsUsed` | Σ `hints` |
| `puzzlesRequiringHint` | distinct puzzles with any `hintCount > 0` |
| `retries` | rows with `presentationIndex > 1` |
| `puzzlesRequiringRetry` | distinct puzzles with any `presentationIndex > 1` |
| `solvingTime.totalMs` | Σ `solvingTimeMs` |
| `solvingTime.averageMs` | `totalMs / puzzlesCompleted` |
| `solvingTime.medianMs` | median of per-puzzle `solvingTimeMs` |

- `skipped` is never in any accuracy/solve-rate denominator.
- `inProgress` cycles report partial aggregates; `abandoned` cycles are kept
  distinct and reported separately from completed cycles.
- A cycle with zero definite puzzles yields `empty` for its rate/time
  aggregates, not `0`.
- Per training set, expose `active`/`archived` status, `puzzleCount`, and the
  set's cycles in cycle-number order, plus the **current** cycle reference.
- Cross-cycle comparison uses the **same set and the same metric
  definition**; it reports `current`, `previous`, `absoluteDelta` and
  (only when mathematically appropriate and `previous !== 0`)
  `relativeDelta`. It never labels a change as proven improvement or
  causation (`domain/tactical-training.md`, `domain/statistics.md`).
- **Mastery** reuses the same per-puzzle cycle resolution: a cycle credits a
  puzzle when `firstTrySolved` holds for its first presentation and that row
  records no hint, wrong move or restart; mastered = ≥3 distinct cycles (§11,
  canonical `domain/tactical-training.md` "Mastery").
- **Training aggregates do not take the game-analysis filters**
  (platform/time-control/date-range). A training set is a deliberate user
  artifact; the Dashboard labels training charts as set-scoped.

### 9. Weakest tactical categories

- The category of a puzzle is `puzzle.tacticalObjective`
  (`winning_material` / `forcing_mate` / `decisive_advantage` /
  `neutralizing_threat`) for tactical-origin rows, or `'blunder'` for
  blunder-origin rows (which have no objective). No motif taxonomy is
  introduced (V1).
- Per category, over the set's attempts: `puzzleCount`,
  `definiteAttempts`, `solved`, `firstTryAccuracy`, `solveRate`, each with
  its §3 sample and state.
- The **weakest** ranking is deterministic: ascending `solveRate`, then
  ascending category key; only categories with `sample.n >= MIN_SAMPLE_SIZE`
  enter the ranking. Producing a "weakest" label is presentation; Feature 014
  returns the ordered aggregate list.

### 10. Repeatedly failed puzzles

- A puzzle is **repeatedly failed** when it has a `failed` attempt in **≥ 2
  distinct cycles** of the same set.
- The read model exposes `puzzleId`, `sourceGameId`, `failureCount`
  (number of `failed` rows), `cycleCount` (distinct cycles with a failure)
  and `lastFailedAt`; ordered by `failureCount` descending, then `puzzleId`
  ascending.
- This is a training-progress signal only; it does not schedule or remove
  the puzzle (ADR-031).

### 11. Mastered puzzle count

- A puzzle is **mastered** when it has a **legitimate first-try solve in 3
  distinct cycles** (the canonical rule of `domain/tactical-training.md`
  "Mastery"): the cycle's first presentation (`presentationIndex === 1`) is
  `solvedFirstTry` with **no hint, no wrong move and no restart**. A retry
  presentation never adds a credit; multiple rows in one cycle count once.
  Mastery is **global** per puzzle (across all sets/cycles) and monotonic: once
  the 3-cycle threshold is met, a later failure does not un-master it.
- This is the same derivation Feature 013 uses for the derived pool (mastered
  puzzles are outside the pool by definition). Mastery is **informational**:
  it retires nothing, mutates no row, and does not remove a puzzle from an
  existing block. Feature 014 **reuses the canonical pure `masteryOf`
  function** (no second implementation) and carries `MASTERY_VERSION` in its
  version summary; a change to the threshold/conditions bumps both
  `MASTERY_VERSION` and `STATISTICS_VERSION` (§12).
- `masteredPuzzleCountForGame(gameId)` counts distinct mastered puzzles whose
  `sourceGameId` is that game (the Game Library insight, read-only).
- `masteredPuzzleCountForSet(setId)` counts distinct mastered puzzles in the
  set's stored membership (a block's frozen snapshot or a custom set's
  membership, independent of which set earned the mastery).
- `sample.unit = 'puzzles'`; absent attempts yield `empty`, never a fake `0`.
- This definition is a product decision (see Owner decisions to confirm).

### Game Library integration

- Feature 014 is **not** the producer of the per-game row strip values
  (accuracy, classification counts, missed-tactic count). Those are produced
  by the analysis/detection pipeline and persisted as the game-scoped
  per-analysis summary (canonical Feature-009 functions; ADR-024 accuracy;
  Feature-010 detection state), and the Library reads them read-only.
- Feature 014 **owns** the aggregate/history statistics computed over those
  summaries and over puzzles/attempts/cycles — including the
  `masteredPuzzleCount` definition (§11) the Library renders as a
  read-only insight.
- Per-game puzzle counts and mastered-from-game totals remain the data of
  the puzzle/training features; Feature 014 supplies the mastered aggregate
  only, never a second per-game accuracy or count.
- Date-range filtering across the Library, statistics queries and the
  Dashboard uses the single canonical local-time-zone calendar-day model in
  `domain/game-library.md` §3.

### 12. Determinism, precision and versioning

- All functions are deterministic for fixed inputs, a fixed `now` and a
  fixed time zone; no hidden clock or locale reads.
- `STATISTICS_VERSION` (starting at `1`) is returned with every result and
  bumped when aggregation semantics change (denominators, period rules,
  accuracy aggregation, phase grouping, mastered/repeatedly-failed
  definitions, category mapping, state thresholds). It is recorded per
  `ARCHITECTURE.md` §9. The mastered definition also carries the canonical
  `MASTERY_VERSION` (Feature 013/domain), surfaced in the version summary.
- Every result carries a `VersionSummary` of the contributing analyses:
  distinct `analysisVersion`, `classificationVersion`, `gamePhaseVersion`,
  `detectionVersion`, engine identities (`name version build`) and the
  `statisticsVersion`, plus `mixedEngineVersions` /
  `mixedClassificationVersions` flags. ADR-020 requires mixed-engine
  aggregates to be hidden or explicitly labeled; V1 **labels** them via this
  metadata (never silently mixes).
- Precision: raw values only; rounding is presentation.

### Owner decisions to confirm

These are resolved in this rewrite with a recommended default so planning can
proceed. The owner may override any of them; each override is a small,
localized change:

1. **Week definition** — ISO-8601 weeks in the local time zone (default).
2. **Mastered** — a legitimate first-try solve in **3 distinct cycles**
   (canonical `domain/tactical-training.md` "Mastery"; the earlier "ever
   `solvedFirstTry`" wording is superseded). Alternative: the latest definite
   attempt is a solve.
3. **Repeatedly failed** — failed in ≥ 2 distinct cycles (default).
4. **Training aggregates ignore game filters** — yes (default).
5. **Pending re-analysis** — use the latest completed analysis and surface
   `games.pendingAnalysis` (default); alternative: exclude to match the
   Library strip.
6. **Weekly rating** — latest rated game within the period, no carry-forward
   (default); alternative: carry the last known rating.
7. **Phase rate denominator** — user moves in the phase (default).
8. **Mixed engine/classification versions** — include and label (default);
   alternative: exclude stale-version analyses.
9. **Median metrics** — include for per-game blunder/mistake distributions
   and cycle solving time (default).

---

## Data requirements

- **No new persisted table in V1.** Statistics are derived on demand from
  persisted data; analyzed game data remains the single authoritative source
  of truth. A future materialized cache must be additive, derivable and
  carry `STATISTICS_VERSION`; it is not a V1 requirement.
- Read sources (existing, unless noted):
  - `games` — query dimensions, `playedAt`, ratings, `userColor`, result;
  - `analysisJobs` — eligible-analysis/status derivation;
  - `analysisSummaries` — per-analysis classification counts, accuracy,
    `userMoves`/`accuracyMoves`, detection state/version and missed-tactic
    count;
  - `analyses` (`MoveAnalysis`) — phase grouping and phase missed tactics,
    read by the `[gameId + analysisId]` compound index for eligible
    analyses only;
  - `puzzles` — origin, `tacticalObjective`, provenance;
  - `puzzleAttempts` — per-cycle/per-puzzle resolution (indexes `cycleId`,
    `puzzleId`, `trainingSetId`, `[cycleId+puzzleId]`);
  - Feature-013 training-set/cycle records — as defined by Feature 013
    (`TacticalTrainingSet`, `TrainingCycle`); Feature 014 depends on the
    domain model, not on a table shape.
- New pure domain module(s) under `src/domain/statistics/`; a new
  application service that loads persisted rows and orchestrates the
  aggregation (optionally in a worker). No React/Dexie/Worker imports in the
  domain module.
- Repository additions, if any, are read-only and use existing indexes
  (e.g. a batched `listForGameAndAnalyses` using the compound index); no
  schema change.
- Per-analysis summaries are read, never written, by this feature. The
  existing Feature-010 lazy-summary backfill may be invoked by the
  application service before computing.
- Statistics are never synced as standalone values (Feature 016 syncs source
  games/derived rows per the ownership rule); derived statistics are
  recomputable and are never synced.

---

## States

- **Metric states**: `ok`, `insufficient`, `empty`, `notDetected` (§3). These
  are returned, not inferred by the UI.
- **Detection freshness**: a missed-tactic value exists only for an eligible
  analysis whose detection pass `completed` at the current
  `DETECTION_VERSION`; an older completed pass is `notDetected` (outdated),
  never a number (`domain/tactics.md` freshness gate).
- **Analysis availability**: `unanalyzed` / `queued` / `inProgress` /
  `failed` / `cancelled` games contribute no analysis metrics;
  `completed`/`outdated` games contribute via their eligible analysis.
- **Game coverage**: "no games", "games but no analysis", "one analyzed
  game", "only one platform", "only one time control", "missing rating",
  "missing/unknown time control" are all first-class states distinguishable
  from a real zero.
- **Cycle states**: `inProgress` (partial aggregates), `completed`,
  `abandoned` (reported separately).
- **Attempt result states**: `solvedFirstTry`, `solvedWithHelp`, `failed`,
  `skipped` (skipped excluded from accuracy/solve-rate denominators).

---

## Error cases

The statistics layer is read-only and must never crash a consumer:

- **Invalid query** (malformed date, `from > to`) — a typed validation error
  is returned/raised; the query is never silently widened or ignored.
- **Unrecognized `normalizedTimeControl`** — bucketed as `unknown` (never
  dropped, never merged into another category) and counted in diagnostics.
- **Summary without a matching game** (or orphaned attempt) — excluded from
  aggregates and counted in a diagnostics set; the cascade should prevent it.
- **Missing summary for the latest completed analysis** — game excluded from
  analysis metrics (`games.missingSummary`); not an error.
- **Detection pass `failed`/`queued`/`inProgress`/`absent`** — missed-tactic
  metrics are `notDetected`, never zero.
- **Missing `playedAt`** — excluded from date/trend windows and counted in
  `games.undated`; never assigned to an arbitrary period.
- **Missing rating** — no rating point (not `0`, not a carry-forward).
- **Zero definite puzzles in a cycle** — rate/time aggregates are `empty`.
- **Deleted game/puzzle mid-read** — the query operates on a consistent
  snapshot and excludes vanished rows; no partial-row fabrication.
- **Mixed analysis/engine versions** — never an error; surfaced via
  `VersionSummary` and the `mixed*` flags so the UI can label it.
- **Large dataset** — bounded/paged reads; the service yields or runs in a
  worker; no unbounded synchronous scan.

---

## Edge cases

- **Local time zone / DST**: day boundaries follow `domain/game-library.md`
  §3; DST-transition days are still whole local days. Tests pin `TZ`.
- **ISO week/year boundary**: a week may span two calendar years; week 1 is
  defined by the ISO rule; week 53 is handled when present.
- **Month/year boundary** and inclusive end-of-day boundaries.
- **Games exactly at a period boundary** belong to exactly one period.
- **Game with zero blunders** vs **game with multiple blunders** (median and
  share behavior).
- **Game with no analyzed moves** (empty `MoveAnalysis` set) — accuracy
  `empty`, no phase moves.
- **Multiple completed analyses per game** — only the latest completed is
  eligible.
- **Re-analysis completes between reads** — the snapshot is internally
  consistent; versions reflect the snapshot.
- **`wdl === null` (fast profile)** — classification already accounts for it;
  statistics consume the persisted classification and never read WDL.
- **Book moves / `inBook`** — no special statistics treatment in V1 beyond
  what classification already persisted.
- **Puzzle re-presented within a cycle** (retry pass) and **across cycles** —
  handled by the per-puzzle cycle resolution (§8).
- **Puzzle with no objective** (blunder origin) — category `'blunder'`.
- **Training set with a single puzzle / all-skipped cycle / in-progress
  cycle / abandoned cycle**.
- **Puzzle from a game with an outdated analysis** — training statistics
  still count it (the puzzle is immutable provenance); game-analysis
  freshness does not gate training stats.
- **Fixture source** — excluded from production results; allowed in tests.

---

## Accessibility requirements

Feature 014 has no UI. It must return the data that lets Feature 015 be
accessible:

- every value carries `n` and a typed `state`, so the UI can render a text
  equivalent (`n = 12`, "Insufficient data (n = 3)", "No data", "Tactics not
  scanned") for screen readers — colour is never the only signal;
- states and labels are typed/enumerated domain values, not
  pre-localized/coloured strings, so the UI controls the accessible text;
- period points carry `periodKey` and boundaries, so the UI can announce a
  human-readable period;
- rating series are separate per platform/time control, so the UI can label
  each series accessibly rather than relying on colour or position.

---

## Responsive / mobile requirements

Feature 014 has no UI. Its data contract must not force a desktop-only
Dashboard:

- queries accept a bounded date range and a metric subset, so mobile can
  request less;
- when `platform`/`timeControl` is `'all'`, the service returns separate
  dimensioned results (not one large merged blob), so mobile can render one
  series at a time;
- aggregation runs off the main thread or in bounded chunks (Performance),
  so a mid-range phone does not freeze while the Dashboard loads;
- the service never requires hover, pointer precision or a wide viewport.

---

## Performance constraints

- **No engine, no network.** Statistics are computed only from persisted
  data (ARCHITECTURE §10/§11); the Dashboard never triggers Stockfish.
- **Main thread is never blocked.** No single synchronous task may exceed the
  long-task threshold (≈50 ms). Aggregation over large datasets runs in a
  worker (consistent with ARCHITECTURE §10) or yields between batches; the
  plan must measure and record the budget.
- **Bounded reads.** Only the query's date window and the eligible analyses
  are read. Summary-level metrics read `analysisSummaries` (one row per
  eligible game); phase metrics read `MoveAnalysis` only for the eligible
  analyses and only when phase metrics are requested; training metrics read
  only the requested sets/cycles.
- **Memoization.** Results may be memoized by a data-version key
  (e.g. row counts/`updatedAt` high-water marks per source table) so repeated
  Dashboard queries over an unchanged dataset avoid recomputation. The cache
  key contract is part of the plan; correctness must never depend on it.
- **No materialization in V1.** If profiling later shows a materialized
  cache is required, it is additive, derivable, versioned and never the
  source of truth.
- **Scale target.** The model must stay practical from a few to thousands of
  analyzed games and tens of thousands of attempts; the plan defines the
  measured thresholds and the worker/deferred-phase strategy.

---

## Acceptance criteria

1. Statistics can be computed from deterministic analyzed fixtures with no
   Chess.com/Lichess/Stockfish access.
2. Blunders, mistakes, inaccuracies and missed tactics aggregate per game and
   per period.
3. All six ADR-013 time-control categories remain separate; no two are
   silently combined; mixed views are dimensioned and explicitly labeled.
4. Chess.com and Lichess rating histories remain separate per time control;
   no conversion or averaging occurs.
5. Game-phase statistics distinguish opening, middlegame and endgame with
   correct per-move denominators and normalized rates.
6. Every value exposes its sample size and one of `ok` / `insufficient` /
   `empty` / `notDetected`; below `MIN_SAMPLE_SIZE` the value is flagged
   insufficient (not hidden by the domain).
7. Empty data, un-run detection and real zeros are distinguishable
   (`empty`/`notDetected` vs `ok` with `0`).
8. Trend series cover every period in range; empty periods are explicit gaps,
   never zeros; ISO week boundaries (including year-spanning weeks) are
   correct under a pinned `TZ`.
9. Rating history derives from stored game ratings; missing ratings produce
   no point.
10. Training statistics provide per-set/per-cycle aggregates, cross-cycle
    deltas, weakest tactical categories, repeatedly failed puzzles and
    mastered counts (3 distinct legitimate first-try cycles, via the canonical
    `masteryOf`), and never mix with game-analysis metrics.
11. Each result carries `STATISTICS_VERSION` and the contributing-version
    summary, including mixed-engine/classification flags (ADR-020).
12. The Dashboard performs no domain/statistical calculations; every value it
    renders comes from this feature.
13. All aggregation behavior is covered by automated deterministic-fixture
    tests; the feature is demonstrable locally with fixtures and no real
    imports.
14. No new persisted table is required for V1 statistics.

---

## Testing requirements

### Deterministic fixtures

Fixtures are separated from production data, run without engine/network, and
cover at least:

- **Empty dataset** — zero games.
- **Games but no analysis** — games with no eligible analysis.
- **Small dataset** — one analyzed rapid game with known counts/accuracy.
- **Mixed time controls** — rapid, blitz, bullet, classical,
  correspondence, unknown (all six).
- **Mixed platforms** — Lichess and Chess.com (ratings separate).
- **Multiple periods** — ≥ 4 weeks including an ISO year-spanning week and a
  month/year boundary.
- **Game phases** — user mistakes/blunders/missed tactics in each phase,
  with differing move exposure to exercise normalized rates.
- **Detection states** — `absent`, `queued`, `inProgress`, `failed`,
  `completed` at the current version and `completed` at an older version
  (freshness gate), including a completed pass with a real `0`.
- **Missing data** — missing rating, missing `playedAt`, unknown time
  control, game with no analyzed moves.
- **Version provenance** — games analyzed under different engine identities
  and classification versions (mixed-version flags).
- **Training** — one set with a completed cycle (known per-puzzle outcomes);
  multiple cycles with known accuracy/time deltas; an `inProgress` and an
  `abandoned` cycle; attempts with hints, retries, skips and varied solve
  times; a puzzle re-presented within a cycle; a puzzle failed across ≥ 2
  cycles; tactical and blunder origins; a mastered puzzle with legitimate
  first-try solves in 3 distinct cycles (including across two sets) and a
  non-mastered puzzle with 1–2 credits; a restart-disqualified row
  (`restartCount > 0`) and a clean retry row that earns no credit.

### Test cases

- **Aggregation**: totals, averages, medians, shares and sample sizes match
  hand-computed fixture values.
- **Time control**: rapid/blitz/bullet/classical/correspondence/unknown
  remain separate; no silent merge; `'all'` returns dimensioned results.
- **Platform**: Lichess and Chess.com ratings never combine.
- **Accuracy**: aggregate is the ADR-024 move-weighted mean; per-game
  accuracy is read, not recomputed.
- **Phase**: counts and `errorsPer100Moves` use the correct per-phase user
  move denominator; missed tactics by phase honor detection state.
- **Trends**: correct period assignment (pinned `TZ`), ISO week/edge cases,
  explicit empty periods, deterministic ordering.
- **States**: `ok`/`insufficient`/`empty`/`notDetected` at the
  `MIN_SAMPLE_SIZE` boundary; no data is never rendered as zero.
- **Eligible analysis**: latest completed wins; missing summary excluded;
  pending re-analysis does not remove history; mixed versions flagged.
- **Training**: per-puzzle cycle resolution (skips, retries, re-presentation),
  first-try accuracy and solve-rate denominators, median/average solving
  time, cross-cycle deltas use the same set/metric, weakest-category ranking,
  repeatedly-failed and the canonical mastered definition (3 distinct
  legitimate first-try cycles; hint/wrong-move/restart disqualify; retry rows
  never credit; `masteryOf` is reused, not re-derived).
- **Determinism**: identical inputs + `now` produce byte-identical results.
- **Performance shape**: a large synthetic dataset (e.g. 1,000+ analyzed
  games) aggregates without blocking and within the plan's measured budget
  (worker/chunk path exercised; may be a non-CI benchmark).

---

## Dependencies

Feature 014 depends on:

- Feature 008 — persisted `MoveAnalysis`, analysis jobs/status, game phase;
- Feature 009 — canonical classification summary and ADR-024 accuracy
  functions;
- Feature 010 — per-analysis summary, detection state/version and
  `missedTactic` annotations;
- Feature 011 — immutable puzzles (origin, objective, difficulty);
- Feature 012 — immutable `puzzleAttempts`;
- Feature 013 — training sets and cycles (the training aggregate source);
- Feature 004/007 — persistence and the canonical Library date/filter model.

Feature 014 output is consumed by:

- Feature 015 — Dashboard (sole read-only UI consumer);
- the Game Library's `masteredPuzzleCount` insight (read-only aggregate).

---

## Context

Required reading (see `.opencode/CONTEXT-MAP.md`):

- Architecture/decisions: `ARCHITECTURE.md` §6a/§7/§9/§10;
  `decisions/ADR-013`, `decisions/ADR-019`, `decisions/ADR-020`,
  `decisions/ADR-023`, `decisions/ADR-024`, `decisions/ADR-031`
- Domain: `domain/statistics.md`, `domain/game-model.md`,
  `domain/analysis-model.md`, `domain/classification.md`,
  `domain/game-phase.md`, `domain/time-control.md`,
  `domain/tactical-training.md`, `domain/puzzle-model.md`,
  `domain/tactics.md`, `domain/game-library.md`
- Research: `research/move-accuracy.md`, `research/move-classification.md`

Feature dependencies: Features 008/009/010 (game data), 011/012/013
(puzzles, attempts, sets/cycles); output consumed by Feature 015 and by the
Game Library `masteredPuzzleCount` insight.
