# Feature 013 — Tactical Training Cycles

## Purpose

Deliver the V1 **training lifecycle**: fixed **tactical training sets** and
repeated **training cycles** over them (Woodpecker-inspired; ADR-031). This
feature replaces the interim `/puzzles` practice host with the real cycle
host, owns set creation/management and the cycle start → resume → complete →
abandon → repeat lifecycle, and hosts Feature 012's solving screen and its
immutable `puzzleAttempts` rows under **real cycle ids**.

It answers the product question "What should I train next?" by turning the
user's own generated puzzles (Feature 011) into a deliberate, measurable
training artifact, and produces the set/cycle records Feature 014 aggregates
over and Feature 015 renders.

This feature:

- never schedules puzzles individually (no FSRS, no due/review state, no
  per-puzzle difficulty; ADR-031);
- never runs the engine and never touches the network (solving is Feature
  012; cycle metrics are pure domain functions over persisted rows);
- never modifies, re-rates or deletes an immutable `PuzzleRow`;
- never re-implements the Feature-012 solving interaction, hint content or
  outcome write;
- owns the two **auto-generated Woodpecker sets** and derives their membership
  from the puzzle pool at each cycle start (virtual membership, snapshotted per
  cycle);
- owns the canonical **puzzle-mastery** derivation (a legitimate first-try solve
  in 3 distinct cycles) shared with Feature 014, and the auto-set retirement it
  drives;
- never computes the Dashboard's statistics (Feature 014) or renders charts
  (Feature 015).

All domain behavior is deterministic for fixed inputs and a caller-supplied
`now`, and is independently testable with fixtures — no engine, network or
real IndexedDB required for domain tests.

---

## Scope

### In scope

1. **Set management** — create a set from a puzzle source/criteria, name and
   (re)configure it, select it for training, archive/unarchive it, delete it
   (with confirmation).
2. **Cycle lifecycle** — start a cycle over a set, present the set's puzzles
   in the cycle's order, record every attempt through Feature 012, handle
   wrong answers/hints/skips/retries per the configured behavior, resume an
   interrupted cycle, complete it, abandon it, and start the next cycle.
3. **Cycle configuration** — target size, ordering, retry-failed behavior,
   hint-level availability and threshold, completion rules (skip allowed),
   target accuracy, optional target solving time, planned number of cycles.
4. **Cycle results** — the read-only per-cycle results view and the canonical
   per-cycle aggregate metrics (shared with Feature 014).
5. **Persistence** — the `trainingSets` and `trainingCycles` tables (schema
   v10), their repositories, indexes, ownership and deletion cascade.
6. **Host contract** — the cycle session host that drives Feature 012's
   `SolveScreen`/`usePuzzleSolve`/`PuzzleAttemptRecorder` and replaces the
   interim practice host.
7. **Deterministic fixtures** for sets, cycles and attempt-driven aggregates.
8. **Auto-generated sets** — the two system-seeded sets (`allPuzzles`,
   `woodpeckerRandom`), their fixed presets, and the deterministic per-cycle
   membership derivation that snapshots them.
9. **Mastery & retirement** — the canonical 3-distinct-cycle legitimate
   first-try mastery derivation, its exclusion of mastered puzzles from
   auto-set membership (with backfill), and the read-only mastered-puzzles
   surface.
10. **Legitimate in-cycle solve rule** — the hint / wrong-move / restart
    disqualification and the immutable one-row-per-presentation guarantee that
    prevents re-rolling a clean first-try credit.

### Out of scope

- The solving interaction, hints, wrong-move handling, outcome derivation and
  the attempt-row write (Feature 012; consumed, never re-implemented).
- Puzzle generation, immutability and the per-game puzzle view (Feature 011;
  Feature 013 only consumes `PuzzleRow` and hands off the set-building entry
  point).
- Blunder-puzzle difficulty re-rating from solver data (deferred; see
  "No puzzle re-rating").
- Individual-puzzle scheduling / FSRS / due/retention state (ADR-031).
- Cross-game FEN dedup or transposition merging (Feature-011 V1 rule).
- Statistics aggregation, cross-cycle series and the Dashboard (Features
  014/015).
- Sync of sets/cycles/attempts as standalone values (Feature 016 tombstones
  only).
- Semantic tactical-motif taxonomy (V1; `domain/tactics.md`).
- User editing of auto-set membership or recipes: auto sets are system-managed
  and derived; manual/game/pool sets keep editable stored membership.
- An un-master action: mastery is monotonic and the mastered list is read-only
  in V1.
- Storing mastery, per-puzzle progress or scheduler state on a puzzle or any
  row: mastery is derived at read time (ADR-031).

---

## Relationship to other features

| Feature | Role |
|---|---|
| 003/004 | `chessops` game/domain types and local persistence primitives. |
| 006/008 | Shared analysis-board surface and stored `MoveAnalysis` (used by Feature 012, inherited through it). |
| 007 | Game Library and the canonical row/insight/action surface; set creation is reached from the per-game puzzle view. |
| 011 | Immutable `PuzzleRow` source (both origins); hands the set-building entry point to this feature. |
| 012 | The solving screen, hint/outcome rules and the immutable `puzzleAttempts` write; **Feature 013 hosts it** and consumes its outcomes. |
| 014 | Aggregates over the set/cycle records and attempts this feature owns; the canonical cycle metric **and mastery** functions are shared, never duplicated. |
| 015 | Dashboard, read-only consumer of Feature 014. |
| 016 | Deletion tombstones consistent with this feature's ownership rules. |

**Boundary with Feature 012.** Feature 012 is the solving experience; it
writes exactly one immutable attempt row per presentation and never computes
cycle aggregates. Feature 013 owns the ordered queue, set/cycle lifecycle,
retry passes, resume, completion and every cycle-level metric. Feature 013
never writes or mutates an attempt row itself — it drives the Feature-012
recorder and reads the rows.

**Feature-012 contract extension (restart disqualification).** The mastery
rule requires that a solve after a **restart** is not a clean first-try solve
(see "Legitimate in-cycle solves"). This is a small, explicit extension of the
Feature-012 solve contract, not a re-implementation: `PresentationCounters`
gains a `restartCount`, the immutable `PuzzleAttemptRow` persists it, and
`deriveResult` returns `solvedWithHelp` for a `solved` trigger when
`restartCount > 0` (in addition to the existing hint/wrong-move conditions).
Feature 013 consumes the persisted counter and never re-derives it.

---

## User-facing behavior

This feature owns the training surfaces under the existing `/puzzles` nav
entry and **removes the interim practice host** (see "Interim host
supersession"). Exact route paths are a plan decision; the required surfaces
and behaviors are:

### 1. Training home (`/puzzles`)

- Lists the user's **active** training sets with name, puzzle count, current
  cycle number/status, and last-activity date; archived sets are reachable
  behind an "Archived" affordance.
- Always shows the two **auto-generated sets** ("All puzzles", "Woodpecker
  random") by default. They are seeded idempotently on the training home (see
  "Auto-generated sets"), so a fresh install with generated puzzles has a set
  to train without any manual set creation.
- For auto sets the displayed puzzle count is the **derived** count for the
  next cycle (current pool minus mastered), never a stale stored count.
- Shows a link to the read-only **Mastered puzzles** list (see "Mastered
  puzzles list").
- Shows a **resume banner** when a cycle is `inProgress`, linking directly
  back into that cycle at the next unanswered puzzle.
- Offers **New set** and, when no sets exist, an explicit empty state that
  explains puzzles must first be generated from games (Feature 011) and
  links to the Game Library.
- Never shows a bare `0` for absent data (e.g. a set whose puzzles were all
  removed by game deletion shows an empty/archived state, not a fake count).

### 2. Set creation

- **From a game's puzzles** (primary hand-off): Feature 011's per-game puzzle
  view exposes a "Create training set" action. The set is seeded from that
  game's puzzles, optionally narrowed by origin/difficulty, honoring target
  size and ordering.
- **From the puzzle pool** (training home): a deterministic, filterable list
  of all persisted puzzles (origin, tactical objective, difficulty bucket,
  source game, platform, time-control category) with multi-select and
  "Create set from selection". The pool never runs the engine.
- **Manual selection** is the pool multi-select path; the set stores a
  human-readable `source` descriptor plus the resolved membership snapshot.
- **Auto sets are not created here.** The two auto-generated sets are seeded
  by the system (see "Auto-generated sets"); their membership is virtual and
  never user-resolved.
- Creation resolves membership **once** and stores it: a game/pool/manual set
  is a fixed collection, not a live query (domain rule). Auto sets are the one
  exception: their membership is re-derived at each cycle start and snapshotted
  onto the cycle (see Domain behavior §3a).

### 3. Set detail

- Rename, edit configuration, view membership (with per-puzzle origin,
  objective and difficulty bucket), view cycle history, and start/continue a
  cycle.
- Archive/unarchive and delete (destructive confirmation naming the set and
  its cycle/attempt counts).
- Starting a cycle shows the effective config snapshot and the puzzle count
  before committing.
- **Auto sets** show their derived membership and recipe read-only: no rename,
  no membership editing, no config editing, and (V1 default) no
  archive/delete — they are system-managed and re-seeded if removed. Their
  detail explains that mastered puzzles have been retired and that membership
  refreshes at each cycle start.

### 4. Cycle session

- Hosts Feature 012's `SolveScreen` for one presentation at a time, with the
  cycle's ordered queue and config snapshot.
- Session chrome shows progress ("Puzzle X of Y"), the set name, the current
  cycle number, an **Exit** control that leaves the cycle `inProgress`
  (resumable) and a **Skip** control when skipping is allowed.
- Does **not** show puzzle difficulty, cycle ordering rationale or any
  scheduling language (no "due", no "next review"; ADR-031).
- Advancing happens only after the attempt row is durably written (Feature
  012 guarantees this); an unwritten outcome keeps the result visible with an
  inline retry and the session does not advance.
- Leaving mid-presentation discards that presentation (no row) and the puzzle
  is re-presented as the next unanswered puzzle on resume (Feature 012 rule).

### 5. Cycle results

- Read-only view of a cycle: status, cycle number, start/completion times,
  per-puzzle outcomes (including retries/skips), and the canonical cycle
  aggregates.
- Completed cycles can be reviewed and compared with previous cycles of the
  **same set**; a comparison never claims the training method caused the
  change (same caveat as `domain/statistics.md`).
- "Start next cycle" (repeat) is offered from a completed or abandoned cycle.
- An `inProgress` cycle shows partial aggregates and a resume action; an
  `abandoned` cycle is shown separately and is never resumable.

### 6. Auto-generated sets

Two sets are seeded automatically and exist by default (deterministic ids,
idempotent ensure on training-home load and before cycle start):

| Set | Recipe | Selection | Order |
|---|---|---|---|
| **All puzzles** | `allPuzzles` | every pool puzzle not yet mastered | difficulty ascending |
| **Woodpecker random** | `woodpeckerRandom` (size 200) | a deterministic 200-puzzle random subset of the unmastered pool | difficulty ascending |

Both use goal accuracy **100%** (`targetAccuracy = 1`), hints enabled, retry
`endOfCycle`, ordering `difficultyAsc`. The recipe is stored in the existing
`source` field (`source.kind === 'auto'`); no user input is required. A user
who has generated no puzzles sees both sets as empty with the same
"generate puzzles first" empty state as a manual set.

Auto sets are **virtual membership** sets: their membership is re-derived from
the current puzzle pool and mastery at the **start of each cycle**, then
snapshotted onto that cycle. They are never mutated mid-cycle, and a set edit
is not offered. This is the one documented exception to "membership is stored
state" (see Domain behavior §3a).

### 7. Mastered puzzles list

A read-only surface under `/puzzles` lists every mastered puzzle (definition
in "Legitimate in-cycle solves"): puzzle id/provenance, source game, origin
and objective, difficulty bucket, and the distinct cycles that earned mastery
(count and dates). It has an explicit empty state and requires no un-master
action in V1 (mastery is monotonic). It is reachable from the training home
and never starts a solve.

### 8. Legitimate in-cycle solves (restart and re-entry)

Only a **legitimate in-cycle solve** may earn a clean first-try result or a
mastery credit. A `solvedFirstTry` is legitimate only when it is the **first
presentation** of the puzzle in a **real cycle** and records **no hint, no
wrong move and no restart**. Consequently:

- a hint solve is `solvedWithHelp` (never clean);
- a wrong move records `failed` immediately (never clean);
- **restarting/resetting** the puzzle disqualifies the presentation: a later
  clean line in the same presentation records `solvedWithHelp`
  (`restartCount > 0`), never `solvedFirstTry`;
- navigating away and back cannot launder a clean credit: an attempt row is
  immutable and first-write-wins on
  `[cycleId, puzzleId, presentationIndex]`, so re-entry can neither overwrite
  an existing row nor add a second clean credit for the same presentation; and
  a presentation abandoned after a hint or restart is recorded durably
  (V1 default: a `failed` row carrying the recorded counters, per the
  Feature-012 contract extension) so the cycle cannot later earn a clean
  first-try for it;
- a **retry presentation** (bounded, at most two per cycle) is a distinct row
  but the **same cycle**, so it never adds a distinct-cycle mastery credit;
  mastery counts the cycle's first presentation only.

Only real cycle ids produce attempts. The interim practice host is deleted (see
"Interim host supersession"); no `practice:*` pseudo ids and no non-persisting
recorder remain, so every attempt row belongs to a persisted `trainingCycles`
row.

### Interim host supersession

Before this feature ships, Feature 012 introduced a temporary `/puzzles`
practice host (`src/pages/PuzzlesPage.tsx`) with a non-persisting in-memory
recorder and ephemeral `practice:*` pseudo ids. When the real cycle host
lands, Feature 013 **replaces and removes** that page, its practice copy, its
`practice:*` ids and its in-memory recorder, and takes over the `/puzzles`
nav entry. The practice-host tests are replaced by the cycle-host tests.
Real sessions persist attempts under **real cycle ids** through the
Feature-012 `SolveScreen` + `PuzzleAttemptRecorderLike` contract.

---

## Domain behavior

All functions are pure, synchronous domain functions over already-loaded
inputs. The application service loads persisted rows; the domain module has
no React/Dexie/Worker imports.

### 1. Training set model

```ts
type TrainingSetStatus = 'active' | 'archived';
type OrderingPolicy = 'difficultyAsc' | 'sourcePly' | 'manual';
type RetryFailed = 'none' | 'endOfCycle' | 'immediate';

interface HintConfig {
  enabledLevels: readonly HintLevel[]; // subset of [1,2,3,4]
  firstHintLevel: HintLevel;           // first press reveals this level
}

interface CycleConfig {
  ordering: OrderingPolicy;
  retryFailed: RetryFailed;
  hints: HintConfig;
  allowSkip: boolean;
  targetAccuracy: number | null;       // 0..1, informational
  targetSolvingTimeMs: number | null;  // informational
  plannedCycles: number | null;        // informational
  configVersion: number;               // semantics version (ARCHITECTURE §9)
}

type AutoSetRecipe =
  | { kind: 'allPuzzles' }                          // every unmastered pool puzzle
  | { kind: 'woodpeckerRandom'; size: number };     // deterministic unmastered subset

type SetSource =
  | { kind: 'game'; gameId: string }
  | { kind: 'pool'; filters: PuzzlePoolFilters }
  | { kind: 'manual' }
  | { kind: 'auto'; recipe: AutoSetRecipe };        // system-seeded, virtual membership

interface TacticalTrainingSetRow {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  status: TrainingSetStatus;
  source: SetSource;              // provenance/recipe
  puzzleIds: readonly string[];   // fixed membership for game/pool/manual; [] for auto
  targetSize: number;             // creation target/cap (default 10); ignored for auto
  config: CycleConfig;            // current config; snapshotted per cycle
}
```

- For game/pool/manual sets, membership is **stored state**, not a live query;
  editing a set re-resolves membership explicitly.
- For `auto` sets, `puzzleIds` is **not authoritative** (stored empty): the
  effective membership is `deriveAutoSetMembership(recipe, pool, mastery, id)`
  and is snapshotted onto each cycle at start. `targetSize` is ignored (the
  recipe defines the cap/size). `config` is fixed by the recipe presets and is
  not user-editable.
- A puzzle may belong to zero, one or many sets; membership lives on the set,
  never on the `Puzzle` (ADR-031).
- `source` is provenance for game/pool/manual sets; for auto sets it carries
  the recipe. The authoritative membership is `puzzleIds` for game/pool/manual
  sets and the derived membership for auto sets.

### 2. Set creation and membership resolution

Resolution is a pure function of the persisted puzzles, the optional source
game summaries and the config:

- **game** source → the game's `puzzles` rows, optionally filtered by origin
  and/or difficulty bucket.
- **pool** source → all puzzles matching the pool filters.
- **manual** → the caller-provided id selection.
- **auto** source → not resolved at creation; resolved at **cycle start** by
  §3a (the set is seeded with empty `puzzleIds`).

Then, under the configured `ordering` (see §3), take at most `targetSize`
puzzles. If fewer exist, the set holds all of them. A set with zero resolved
puzzles is created empty with an explicit empty state (it is never silently
deleted). Membership ids are canonical `puzzleIdOf(sourceGameId, sourcePly)`
values; a missing puzzle row at training time is skipped (Feature 012 error
case). Auto sets are the documented exception to the create-time snapshot: they
are seeded, not created from a user selection, and their membership is derived
per cycle.

### 3. Ordering and target size

Allowed V1 orderings, all deterministic:

- `difficultyAsc` (default) — puzzle difficulty ascending, ties by puzzle id;
- `sourcePly` — by `sourceGameId` then `sourcePly` ascending;
- `manual` — the stored `puzzleIds` base order.

`targetSize` (default 10) is the creation target/cap applied when a source
resolves more puzzles than the target. It is not a hard runtime limit on an
existing set; the user may edit membership or raise the target. The exact
"first N under the ordering" selection rule is deterministic and fixture-
testable.

### 3a. Auto-set membership derivation (per cycle)

Auto-set membership is a pure function of the recipe, the current puzzle
**pool** (every persisted `PuzzleRow`), the derived **mastery** map, and the
set's deterministic seed (its id):

```text
deriveAutoSetMembership(recipe, pool, mastery, setSeed):
  eligible := [p | p in pool, not mastery.isMastered(p.id)]
  allPuzzles        -> eligible
  woodpeckerRandom  -> takeLowestPriority(eligible, recipe.size, setSeed)
  then apply the configured ordering (difficultyAsc; ties by puzzle id)
```

- **Determinism.** `woodpeckerRandom` ranks each eligible puzzle by a stable,
  dependency-free hash of `setSeed + "\u0000" + puzzleId` (e.g. FNV-1a) and
  takes the lowest `size`; ties break by puzzle id. The same eligible pool and
  seed therefore yield the same subset every cycle — no `Math.random`, no
  hidden clock, no new dependency.
- **Per-cycle refresh.** The host derives membership at **cycle start**, then
  writes it into `TrainingCycleRow.puzzleIds` (the ordered snapshot). The
  cycle never mutates its snapshot mid-cycle; the next cycle re-derives from
  the then-current pool and mastery. Newly generated puzzles are therefore
  eligible from the next cycle.
- **Mastery retirement and backfill.** Mastered puzzles are excluded from the
  eligible pool. "All puzzles" simply omits them; `woodpeckerRandom` backfills
  to `size` from the next-lowest-priority eligible puzzles when the eligible
  pool is at least `size`.
- **Stability.** For a fixed eligible pool the derived subset is identical
  across cycles (mastery departures are backfilled deterministically). A newly
  generated puzzle joins the next cycle when the eligible pool is below `size`
  or its priority ranks within the selected `size`; the owner's "only mastered
  departures cause replacements" holds for an unchanged pool, and the
  new-puzzle-displacement edge is called out in "Conflicts surfaced"/Owner
  decisions 13.
- **Empty derived membership** (all pool puzzles mastered, or no puzzles) is a
  real `empty` state: the auto set is shown as "all mastered"/"no puzzles" and
  cycle start is blocked with an explanation — never a fake count or an empty
  cycle.

### 3b. Mastery and retirement (canonical derivation)

Mastery is derived, monotonic and global per puzzle (across all sets/cycles):

```text
isLegitimateFirstTrySolve(row) :=
  row.presentationIndex === 1
  && row.result === 'solvedFirstTry'
  && row.hintCount === 0
  && row.wrongMoveCount === 0
  && row.restartCount === 0

masteryOf(puzzleId) :=
  distinct cycleIds among the puzzle's legitimate first-try rows
  mastered := distinctCycleCount >= 3
```

- **Three distinct cycles.** A puzzle is mastered when it has a legitimate
  first-try solve in **3 distinct cycles**. Multiple rows in one cycle count
  once; a retry presentation never adds a credit (only
  `presentationIndex === 1` counts). "Distinct cycle" is the persisted
  `cycleId` of a real `trainingCycles` row; orphaned rows are ignored.
- **Legitimate only.** Hints, wrong moves and restarts disqualify (see "8.
  Legitimate in-cycle solves"); a `solvedFirstTry` row that records any of
  them is not possible under the Feature-012 contract, and the derivation
  checks the counters defensively.
- **Monotonic.** Once the 3-cycle threshold is met it stays met for the
  retained history: a later failure never un-masters. Deleting the source game
  deletes the puzzle and its attempts (ownership rule), so mastery for that
  puzzle disappears with it.
- **Derived at read time.** No mastery flag, counter or scheduler state is
  stored on the puzzle or any row (ADR-031). `masteryOf` is the single
  canonical pure function, versioned by `MASTERY_VERSION`; Feature 013
  (auto-set membership) and Feature 014 (mastered counts) both call it and
  never re-implement it.
- **Auto-retirement only.** Mastery excludes a puzzle from **auto-set**
  membership. Manual/game/pool sets are never auto-retired: a mastered puzzle
  stays in them and remains trainable (so mastery can be earned in any set).
- **Mastered list.** The read-only `/puzzles` mastered list is the surfaced
  view of `masteryOf`; V1 has no un-master action.

### 4. Training cycle model

```ts
type TrainingCycleStatus = 'inProgress' | 'completed' | 'abandoned';

interface TrainingCycleRow {
  id: string;
  trainingSetId: string;
  cycleNumber: number;            // 1-based, per set
  status: TrainingCycleStatus;
  startedAt: number;
  completedAt: number | null;
  abandonedAt: number | null;
  puzzleIds: readonly string[];   // ordered snapshot at cycle start
  config: CycleConfig;            // snapshot at cycle start
  cycleMetricsVersion: number;    // aggregation-semantics version
}
```

- **Snapshot semantics.** A cycle snapshots the set's membership and config
  at start. Editing the set afterwards affects only future cycles; an
  in-progress or completed cycle keeps its snapshot (deterministic resume and
  results).
- **Cycle number** is `max(existing cycleNumber for the set) + 1`; the pair
  `[trainingSetId, cycleNumber]` is unique.
- **Repeat** means starting a **new** cycle over the same set (new
  `cycleNumber`, new snapshot). A completed/abandoned cycle is never reopened.
- Cycle-level aggregate metrics are **derived**, never authoritative stored
  state (see §8).

### 5. Presentation queue and retry semantics

The cycle's ordered queue is the snapshot order. Each puzzle is presented at
most **twice per cycle**:

- first pass — every puzzle in snapshot order;
- retry pass — puzzles whose first presentation was `failed`, re-presented
  per `retryFailed`:
  - `none` — no retry (one presentation per puzzle);
  - `immediate` — the failed puzzle is re-presented next (front of queue);
  - `endOfCycle` (default) — re-presented after all first-pass puzzles.

A puzzle re-presented in the retry pass that fails again is **terminal for
the cycle** and is revisited in the next cycle (it stays in the set). This
bounds each puzzle to at most two presentations per cycle and makes the cycle
always terminate; it is the resolution of the domain's retry wording.

Presentation context supplied to Feature 012:

- `SessionPuzzleContext.trainingSetId` = the set id;
- `SessionPuzzleContext.cycleId` = the cycle id;
- `SessionPuzzleContext.presentationIndex` = 1 for the first presentation, 2
  for the retry presentation (reconstructed from existing attempt rows on
  resume);
- `SolveHintConfig` derived from the cycle's `config.hints`.

Only `presentationIndex === 1` can earn a mastery credit. The host persists the
presentation's `restartCount` (Feature-012 contract extension) so a solve after
a restart is `solvedWithHelp`, and it records a presentation abandoned after a
hint or restart so a later re-entry cannot be a clean first-try (see "8.
Legitimate in-cycle solves"). A pristine presentation (no move, hint or
restart) may still be discarded with no row, per Feature 012.

A skipped puzzle is recorded (`skipped`) and is terminal for the cycle: it is
not retried and never enters an accuracy denominator. Skipping is available
only when `config.allowSkip` is true.

### 6. Completion and terminal states

A puzzle is **terminal** in a cycle when any of:

- any presentation was solved (`solvedFirstTry` / `solvedWithHelp`); or
- the last presentation was `skipped`; or
- it has reached the allowed presentation count under `retryFailed`
  (`1` for `none`, `2` for `immediate`/`endOfCycle`) and was not solved.

A cycle is **completed** when every puzzle in its snapshot is terminal, or
its puzzle row no longer exists (deleted source game). Skipped puzzles do not
block completion but are not counted as completed. A cycle with zero definite
puzzles completes with `empty` (not `0`) rate/time aggregates.

A cycle is **abandoned** only by explicit user action; it is terminal, keeps
its attempts, is reported separately from completed cycles, and is never
resumable. Exiting the session without completing leaves the cycle
`inProgress` and resumable.

### 7. Resume reconstruction

Resume is **derived**, with no stored cursor: load the cycle snapshot and its
attempt rows (via the `[cycleId+puzzleId]` index), then

- pending first-pass puzzles = snapshot puzzles with no attempt row, in order;
- pending immediate retries = puzzles with exactly one `failed` row when
  `retryFailed === 'immediate'`, in snapshot order, presented next;
- pending end-of-cycle retries = puzzles with exactly one `failed` row when
  `retryFailed === 'endOfCycle'`, appended after the first pass;
- when nothing is pending, the cycle is complete and is marked `completed`.

A missing puzzle row is skipped without an attempt (Feature 012 error case).
This makes resume deterministic and idempotent across reloads.

### 8. Cycle metrics (shared canonical resolution)

Cycle metrics are the canonical definitions of `domain/tactical-training.md`,
reconciled with Feature 012's **one-row-per-presentation** storage. The
per-puzzle cycle resolution and the cycle aggregates are the definitions
already stated in Feature 014 §8; Feature 013 introduces the **single shared
pure domain function** that computes them (needed for completion, results and
Feature 012/013 tests) and Feature 014 reuses it rather than re-deriving.
Duplicate implementations are forbidden.

Summary of the resolution (authoritative formulas live in the shared
function):

```text
presentations    = attempt rows of (cycleId, puzzleId) by presentationIndex
skipped          = presentations non-empty and all results 'skipped'
definite         = presentations with result != 'skipped'
firstTrySolved   = presentations[0].result === 'solvedFirstTry'
eventuallySolved = any presentation result ∈ { solvedFirstTry, solvedWithHelp }
wrongMoves       = Σ presentation.wrongMoveCount
hints            = Σ presentation.hintCount
solvingTimeMs    = Σ presentation.solvingTimeMs over definite presentations
```

Cycle aggregates (sample unit `puzzles` for rates): `puzzlesAttempted`,
`puzzlesCompleted`, `puzzlesSkipped`, `firstTryAccuracy`, `solveRate`,
`totalPresentations`, `totalWrongMoves`, `hintsUsed`,
`puzzlesRequiringHint`, `retries`, `puzzlesRequiringRetry`,
`solvingTime.totalMs/averageMs/medianMs`.

Rules:

- `skipped` is never in any accuracy/solve-rate denominator.
- `inProgress` cycles report partial aggregates; `abandoned` cycles are
  reported separately from completed ones.
- A cycle with zero definite puzzles yields `empty`, not `0`, for rate/time
  aggregates.
- Cross-cycle comparison uses the same set and the same metric definition and
  reports measured deltas only — never causation (ADR-031,
  `domain/tactical-training.md`, `domain/statistics.md`).
- Cycle metrics are never mixed with game-analysis metrics.

### 9. Wrong-move and hint semantics (adopted from Feature 012)

Feature 013 consumes the implemented Feature-012 outcome semantics and does
not reinterpret them:

- the first wrong move records a `failed` attempt immediately while the
  presentation stays open (fail-once keep-trying);
- a later in-presentation correct solve does **not** write a second row and
  the recorded result stays `failed`; `foundAfterFail` is presentation
  feedback only and is never persisted;
- `solvedWithHelp` is a hint-assisted solve with no wrong move;
- hints never fail a puzzle; the highest hint level reached is recorded on
  the attempt;
- a **restart** clears the line/hint reveal but keeps the counters and clock;
  the presentation records `restartCount > 0`, and a later clean line in the
  same presentation derives `solvedWithHelp`, not `solvedFirstTry` (Feature-012
  contract extension; see "8. Legitimate in-cycle solves").

Consequently a puzzle's cycle resolution is based on the **stored rows**
above; the retry pass is driven by a stored `failed` result regardless of a
later in-presentation solve. This replaced the domain's earlier looser
"retry step recorded"/"solvedWithHelp after retry" wording, which has been
reconciled (see "Reconciliations applied").

### 10. No puzzle re-rating

Feature 013 does **not** mutate, re-rate or delete a `PuzzleRow`. The
Feature-011 and `domain/puzzle-model.md` notes that previously said Feature 013
"may re-rate blunder puzzles from solver data" have been **reworded to defer
re-rating out of V1** (see "Reconciliations applied"): any per-puzzle
performance signal (repeatedly failed, mastered) is derived from attempts —
mastery by this feature's canonical `masteryOf` and consumed by Feature 014 as
an aggregate — and is never written onto the puzzle. This preserves puzzle
immutability and ADR-031's no-per-user-difficulty rule. Re-rating requires a
new ADR and is not V1 scope.

### 11. Ownership, archive and deletion

- A set is user data owned by the user. **Archive** sets `status: 'archived'`
  (hidden from the active list, history retained); unarchive restores it.
- **Auto sets** are system-managed: they are re-seeded idempotently if absent
  and are not archivable/deletable in V1 (deleting one would just re-create it).
  Their membership is derived; their cycles/attempts are ordinary set-owned
  data and follow the same cascade.
- **Delete set** removes the set, its cycles, and their attempt rows
  (via the `trainingSetId`/`cycleId` indexes). The puzzles themselves are
  untouched — they remain owned by their source games. This is the
  set/cycle-owned removal Feature 012 anticipated.
- **Game deletion cascade** (ARCHITECTURE §7, `domain/game-library.md` §8):
  deleting a game deletes its puzzles and their attempts (Feature 012); this
  feature additionally removes the deleted puzzle ids from every set's
  membership. In-progress cycle snapshots are immutable; a snapshot puzzle
  whose row no longer exists is skipped and treated as terminal.
- **Sync:** sets, cycles and attempts are local/derived data and are never
  synced as standalone values by this feature; Feature 016 syncs deletions as
  tombstones consistent with the ownership rule.

### 12. Determinism and versioning

- All functions are deterministic for fixed inputs and a caller-supplied
  `now`; no hidden clock or locale reads. Auto-set derivation and mastery
  derivation are pure and fixture-testable.
- `CycleConfig.configVersion` and `TrainingCycle.cycleMetricsVersion` follow
  ARCHITECTURE §9. A semantics change (completion rule, retry bound, ordering
  rule, metric denominators, hint mapping) bumps the relevant version; stored
  rows are never retroactively re-mapped.
- `MASTERY_VERSION` (domain constant, starting at `1`) versions the mastery
  derivation (threshold, legitimate-solve conditions, distinct-cycle rule) and
  is exposed with mastery reads; Feature 014 surfaces it in its version
  summary and bumps `STATISTICS_VERSION` when it changes. `AUTO_SET_VERSION`
  versions the auto-set recipes/selection (size, hash, ordering); a change to a
  recipe's semantics is a new recipe, not a silent mutation of stored rows.
- Attempt rows are never rewritten to change a result; a contract change is a
  new presentation or a new version, never an in-place edit.

---

## Data requirements

Additive persistence only; the immutable `puzzles` table and the schema-v9
`puzzleAttempts` table/indexes are unchanged.

**No schema bump for this extension (schema stays v10).** Confirmed by
inspection of the stored shapes:

- the auto-set recipe lives in the existing `TacticalTrainingSetRow.source`
  field (a plain JSON object) — the `trainingSets` table stores the row
  verbatim and needs no new column or index;
- the Feature-012 contract extension adds `restartCount` to the attempt row's
  plain object (`PresentationCounters`/`PuzzleAttemptRow`) — like the earlier
  `origin` addition to `puzzles`, an unindexed field needs no Dexie version
  bump;
- mastery is **derived**, never stored: no mastery column, table or index;
- auto sets are ordinary `trainingSets` rows; no new table.

If profiling later shows the mastery read needs an index, it is an **additive
v11** change (e.g. an index on `puzzleAttempts` such as `result` or a compound
`[puzzleId+result]`), never a rewrite of existing rows. That is not required
for V1: mastery reads scan the bounded attempts table through the existing
`puzzleId` index or a batched full read.

### New tables (schema v10, additive)

```text
trainingSets    &id, status, createdAt
trainingCycles  &id, &[trainingSetId+cycleNumber], trainingSetId, status
```

- `trainingSets` stores `TacticalTrainingSetRow` verbatim.
- `trainingCycles` stores `TrainingCycleRow` verbatim.
- Both tables start empty, so no migration backfill is required; bump
  `PERSISTENCE_SCHEMA_VERSION` to 10 in `src/config/app-config.ts` and add
  `schema/v10.ts` following the existing pattern.
- Exact index additions for the Feature-014 reads (e.g. `startedAt`) are a
  plan detail; the compound unique key `[trainingSetId+cycleNumber]` is
  required.

### Repositories

- `trainingSetsRepository` — `get`, `list({ status? })`, `create`, `update`
  (name/config/membership/status), `delete` (cascades cycles + attempts),
  `removePuzzleIds` (game-deletion cascade), `listContainingPuzzle(puzzleId)`,
  and `ensureAutoSets()` (idempotent seed of the two deterministic auto rows
  with their fixed presets — existing rows are left untouched).
- `trainingCyclesRepository` — `get`, `listForSet`, `getByNumber`, `create`,
  `updateStatus` (`completed`/`abandoned` timestamps), `deleteForSet`.
- The existing `attemptsRepository` reads (`listForCycle`,
  `listForCycleAndPuzzle`) and the `trainingSetId`/`cycleId` indexes serve
  Feature 013. The mastery read adds one read-only method — a batched
  `listAll()` (or `listForMastery()`) over `puzzleAttempts` grouped by
  `puzzleId`/`cycleId` — with **no schema change**; the auto-set pool read uses
  the existing `puzzlesRepository.listAll()`.
- `restartCount` is persisted through the existing `addAttempt` write path
  (the row is stored verbatim); the repository still exposes no update path.

### Deletion cascade

- Set deletion removes its cycles and attempt rows in one transaction.
- Game deletion (existing `deleteGames` transaction) additionally removes the
  deleted puzzle ids from all sets' `puzzleIds`; extend the cascade-ready
  dependent-kind list per the introducing milestone. Auto sets store no
  membership, so their derived membership simply reflects the smaller pool on
  the next cycle.
- No orphaned cycle or attempt may remain.

### Sync

- Feature 013 data is local user/derived data; this feature adds no sync.
  Feature 016 must tombstone set/cycle/attempt deletions consistently with the
  ownership rules and must not sync derived cycle aggregates.

---

## States

- **Set states**: `active`, `archived`, plus transient UI states (loading,
  empty membership, load error).
- **Auto-set states**: derived membership `ready` (≥1 eligible puzzle),
  `empty` (no puzzles), `allMastered` (pool non-empty but every puzzle
  mastered); recipe `allPuzzles`/`woodpeckerRandom`; seeded/absent (re-seeded).
- **Mastery states**: `unmastered` (0–2 distinct-cycle credits), `mastered`
  (≥3); always derived, never stored. The mastered list is read-only.
- **Cycle states**: `inProgress` (resumable; partial aggregates), `completed`
  (terminal; immutable snapshot), `abandoned` (terminal; reported
  separately).
- **Presentation states** (Feature 012, transient): `presenting`, `solving`,
  `outcome`, `postSolve`; attempt write `pending → written`, or `retryable`
  on failure.
- **Attempt results**: `solvedFirstTry`, `solvedWithHelp`, `failed`,
  `skipped`.
- **Queue states**: pending first pass, pending immediate retry, pending
  end-of-cycle retry, complete. The session shows which is active without
  exposing scheduling language.

---

## Error cases

The feature must never crash a consumer and must never fabricate data:

- **Set creation resolves zero puzzles** — the set is created empty with an
  explicit empty state; never a fake count.
- **Auto set with zero eligible puzzles** — derived membership is `empty` (no
  pool puzzles) or `allMastered` (all mastered); the set shows that state and
  cycle start is blocked with an explanation; never a fake count and never an
  empty cycle.
- **Unknown auto recipe / malformed `source`** (row written by a future
  build) — rejected on read with a typed error; never silently coerced or
  trained.
- **Mastery read with an orphaned attempt row** (no matching `trainingCycles`
  row, or no matching puzzle) — the row is ignored for mastery; it is not a
  crash and not a credit.
- **Legacy attempt row without `restartCount`** — normalized to `0` on read
  (consistent with the `origin` normalization); never `undefined` in the
  derivation.
- **Cycle start on an empty/fully-removed set** — blocked with an
  explanation and a link to edit membership; no empty cycle is created.
- **Puzzle row missing at presentation** (source game deleted between queue
  construction and presentation) — skipped with a notice, no attempt row, the
  session continues (Feature 012 rule).
- **Attempt write fails** — Feature 012 keeps the outcome visible with an
  inline retry and the session never advances; Feature 013 must not mark the
  cycle complete while a row is unwritten.
- **Cycle already `completed`/`abandoned`** — starting/resuming is rejected
  with a typed result; the UI offers "start next cycle" instead.
- **Concurrent sessions on one cycle** (two tabs) — the natural-key
  first-write-wins attempts repository makes duplicate writes idempotent; the
  resume reconstruction stays consistent and the UI reconciles to persisted
  rows.
- **Game deleted mid-session** — the cascade removes the puzzle/attempts; the
  host reconciles (skip missing rows, treat as terminal) and never crashes.
- **Set/cycle record missing during a session** (deleted in another tab) —
  the session ends with a notice and returns to the training home.
- **Invalid persisted config** (unknown enum/version from a future build) —
  rejected on read with a typed error; never silently coerced.

---

## Edge cases

- **A set that mixes tactical and blunder origins** — trains normally; only
  the objective label and accepted-move set differ (Feature 012).
- **A puzzle belonging to several sets** — its attempts are scoped by
  `cycleId`; aggregates per set/cycle never double-count across sets.
- **A puzzle failed across cycles** — remains in the set and is revisited;
  no removal by default.
- **A puzzle solved first-try in cycle 1 then failed in cycle 2** — remains
  in the set; mastery is monotonic (the earlier legitimate credit stands). It
  is retired from **auto sets** once 3 distinct-cycle legitimate credits exist,
  but stays in any manual/game/pool set.
- **Mastery earned across different sets** — a puzzle mastered in set A is
  globally mastered and retired from auto sets; `masteredPuzzleCountForSet(B)`
  still counts it if it is a member of B.
- **A new puzzle generated between cycles** — joins "All puzzles" on the next
  cycle; joins "Woodpecker random" on the next cycle when the eligible pool is
  below 200 or its deterministic priority ranks within the selected 200.
- **All pool puzzles mastered** — "All puzzles" is `allMastered`/empty;
  "Woodpecker random" is empty; both block cycle start with an explanation.
- **Restart then clean line** — the presentation derives `solvedWithHelp`
  (`restartCount > 0`); no clean first-try credit.
- **Hint/restart then leave and re-enter** — the abandoned presentation is
  recorded, so the cycle cannot later earn a clean first-try; an existing
  durable row is never overwritten (first-write-wins).
- **Clean solve on a retry presentation** — the row may be `solvedFirstTry`
  (presentation-scoped), but it is `presentationIndex === 2` and therefore
  adds **no** distinct-cycle mastery credit.
- **Two clean rows for one puzzle in one cycle** — impossible by the retry
  rules; if data ever held it, mastery still counts the cycle once.
- **All-skipped cycle** — completes; rate/time aggregates are `empty`.
- **Single-puzzle set** and **very large set** (hundreds of puzzles) — both
  supported; large sets rely on the performance rules below.
- **Re-presentation after a failed prior cycle** — each presentation is a
  fresh Feature-012 presentation with its own counters/timer.
- **Retry pass where the puzzle is solved on the second presentation** —
  resolution records `eventuallySolved`; the first-try accuracy still counts
  only the first presentation.
- **`retryFailed: 'none'`** — a failed first presentation is terminal for the
  cycle.
- **Ordering ties** — resolved deterministically by puzzle id.
- **`targetSize` smaller/larger than the source** — selection takes the first
  N under the ordering; fewer sources yield a smaller set.
- **Archived set with an `inProgress` cycle** — archiving does not abandon
  the cycle; the resume banner still surfaces it, and the set can be
  unarchived.
- **Deleting a source game** — membership and attempts shrink; historical
  cycle metrics are derived and therefore change (an accepted consequence of
  the ownership rule, ARCHITECTURE §7).
- **Clock/date display** — cycle times are stored as epoch millis and
  displayed in the user's local time zone; no date math beyond formatting.

---

## Accessibility requirements

- Every action (create/edit/archive/delete set, start/resume/abandon/repeat
  cycle, skip, exit session, start next cycle) is a real labelled control,
  reachable by keyboard and touch — never hover-only, never shortcut-only.
- Destructive actions (delete set, abandon cycle) require an explicit
  confirmation dialog that names the object and its consequences.
- Status is conveyed textually (active/archived, in progress/completed/
  abandoned, "Puzzle X of Y"), never by colour alone; cycle results spell out
  every value and its sample size.
- Session progress and completion are announced (`aria-live`) only when a
  real state change occurs; focus is managed on session start/exit and on
  landing in cycle results.
- The board interaction is Feature 012's (mouse + touch, promotion dialog,
  keyboard transport); Feature 013 adds no move-entry path.
- An unwritten attempt keeps the result visible with an accessible inline
  error and retry.
- Auto-set states ("all mastered", "no puzzles", derived count) and the
  mastered list (puzzle count, empty state) are exposed as text, never by
  colour or a bare `0`.
- A solve after a restart is labelled "Solved with hints" (Feature 012 result
  copy), so the disqualification is understandable, not a hidden rule; the
  mastered list explains the 3-distinct-cycle rule in text.

---

## Responsive / mobile requirements

- Deliberate mobile layouts: sets render as cards (not a shrunk table); set
  detail and cycle results stack; the solving screen uses Feature 012's
  mobile stacking.
- The session chrome (progress, exit, skip) stays reachable without scrolling
  past the board on small viewports.
- Set creation and pool selection support touch multi-select; no interaction
  requires hover or pointer precision.
- Large set membership lists paginate or virtualize on mobile rather than
  rendering thousands of rows; the mastered list does the same.
- Auto sets are cards like any other set and show their derived count/state
  without a layout shift when the pool or mastery changes.

---

## Performance constraints

- **No engine, no network.** Cycle lifecycle and metrics are pure domain
  computations over persisted rows; the session never starts Stockfish except
  Feature 012's opt-in post-finish engine.
- **Main thread is never blocked.** No single synchronous task may exceed the
  long-task threshold (≈50 ms). Loading a cycle's attempts, reconstructing
  resume state and computing results are bounded by the cycle's puzzle count
  (default 10; large sets allowed) and use indexed reads; large sets/results
  run in bounded batches or a worker.
- **Bounded reads.** Set lists read `trainingSets` by status; set detail
  reads only its cycles and membership; resume reads only the active cycle's
  attempts via `[cycleId+puzzleId]`; results read only that cycle's attempts.
  Per-row views never scan `puzzles`/`puzzleAttempts`.
- **Mastery/auto-set derivation is bounded and off the critical path.** The
  pool read uses `puzzlesRepository.listAll()` (one row per puzzle) and the
  mastery read is one batched pass over `puzzleAttempts` grouped by
  `puzzleId`/`cycleId`, run once per training-home load and once per cycle
  start (not per row and not per move). It is memoized by a data-version key
  and runs in a worker/bounded batches when the attempt table is large; no
  single synchronous task exceeds the long-task threshold.
- **Cascade cost.** Game deletion's membership cleanup scans the (small) set
  table; it is bounded by the number of sets, not puzzles.
- **Scale target.** Practical from a few to hundreds of puzzles per set and
  tens of thousands of attempts overall; the plan records the measured budget
  and the worker/batch strategy.
- **No materialized aggregates in V1.** Cycle metrics are derived; a future
  cache must be additive, derivable and versioned.

---

## Acceptance criteria

1. A user can create a set from a game's puzzles and from the puzzle pool,
   name/configure it, archive/unarchive it, and delete it with confirmation;
   membership is stored (not a live query) and deterministic under the chosen
   ordering and target size.
2. Starting a cycle snapshots membership and config, assigns the next 1-based
   cycle number, and presents the puzzles in the configured order through
   Feature 012's solving screen.
3. Each presentation is recorded as exactly one immutable `puzzleAttempts`
   row under the real `cycleId`/`trainingSetId` with the correct
   `presentationIndex` (1 for the first, 2 for the retry); no practice rows
   are written.
4. `retryFailed` `none`/`immediate`/`endOfCycle` behave as specified, each
   puzzle is presented at most twice per cycle, and a re-failed retry is
   terminal for the cycle and revisited in the next cycle.
5. A skipped puzzle is recorded, excluded from accuracy/solve-rate
   denominators, and does not block completion; skipping is available only
   when configured.
6. A cycle is `completed` exactly when every snapshot puzzle is terminal or
   missing; exiting early leaves it `inProgress` and resumable from the next
   unanswered puzzle; abandoning is terminal and keeps its attempts.
7. Resume reconstruction from persisted attempts is deterministic and
   idempotent (reload mid-cycle returns to the same next presentation and
   `presentationIndex`), with no stored cursor.
8. Cycle results show per-puzzle outcomes and the canonical aggregates with
   their sample sizes; a cycle with zero definite puzzles reports `empty`,
   not `0`; abandoned cycles are reported separately.
9. Cross-cycle comparison uses the same set and metric definition and reports
   measured deltas only; it never claims causation and never mixes
   game-analysis metrics.
10. A puzzle may belong to multiple sets; per-set/cycle aggregates never
    double-count across sets; deleting a set removes its cycles and attempt
    rows but never its puzzles.
11. Deleting a source game removes its puzzles/attempts and the deleted puzzle
    ids from every set's membership; no orphaned cycle or attempt remains and
    no session crashes.
12. Feature 013 never schedules puzzles individually, stores no scheduling
    state on a `Puzzle`, and never mutates/re-rates a `PuzzleRow`; no FSRS or
    scheduler dependency is introduced.
13. The interim `/puzzles` practice host, its in-memory recorder and its
    `practice:*` ids are removed; the `/puzzles` nav entry is served by the
    training home.
14. Set/cycle domain logic is deterministic and fully testable with fixtures
    and no engine, network or real IndexedDB; the canonical cycle metric
    function is shared with Feature 014 (no duplicate implementation).
15. All essential set/cycle/session actions are keyboard- and touch-operable,
    status is never colour-only, and destructive actions are confirmed.
16. The two auto sets ("All puzzles", "Woodpecker random", size 200) exist by
    default (seeded idempotently with deterministic ids) and use goal accuracy
    100%, hints enabled, retry `endOfCycle` and `difficultyAsc` ordering; their
    membership/recipe is not user-editable.
17. Auto-set membership is virtual: it is re-derived from the current pool
    minus mastered puzzles at each cycle start and snapshotted onto that cycle
    (fixed within the cycle, never mutated mid-cycle). Game/pool/manual sets
    keep stored fixed membership and are unchanged.
18. `woodpeckerRandom` selection is deterministic from the set id: the same
    eligible pool yields the same subset across cycles, mastered departures are
    backfilled to 200, and newly generated puzzles are eligible from the next
    cycle (entering when the pool is below size or their priority ranks within
    the selection). `allPuzzles` includes every unmastered pool puzzle.
19. A puzzle is mastered exactly when it has a legitimate first-try solve in
    **3 distinct cycles** (global across sets); mastery is monotonic and
    derived at read time (no stored scheduler/mastery state; ADR-031). Mastered
    puzzles are excluded from auto-set membership only; manual/game/pool sets
    are never auto-retired.
20. Only legitimate in-cycle solves count: a `solvedFirstTry` requires no hint,
    no wrong move, no restart, the cycle's first presentation, and a real
    cycle id. A restart disqualifies a later clean line (`solvedWithHelp`);
    navigating away and back cannot overwrite an existing row or add a second
    clean credit; a retry presentation adds no distinct-cycle mastery credit;
    the interim practice host and its `practice:*` ids are gone.
21. The mastered-puzzles list under `/puzzles` is read-only and shows mastered
    puzzles with their qualifying cycles; there is no un-master action in V1.
22. The extension adds no persisted table, index or stored mastery state
    (schema stays v10); the auto recipe lives in `source` and `restartCount`
    is a plain attempt-row field. No FSRS or scheduler dependency is
    introduced.

---

## Testing requirements

### Deterministic fixtures

Fixtures are separated from production data, run without engine/network and
cover at least:

- **Sets** — active, archived, empty membership, single-puzzle, mixed-origin
  (tactical + blunder), multi-set membership, and a set with all puzzles
  removed by a simulated game deletion.
- **Cycles** — `inProgress` (partial), `completed`, `abandoned`; multiple
  cycles per set with known metric deltas; a cycle snapshotted before a set
  edit; a cycle whose snapshot contains a since-deleted puzzle.
- **Attempts** — every result; a puzzle re-presented in-cycle (retry); a
  puzzle failed across ≥ 2 cycles; hints/retries/skips; varied solve times
  (including median/average cases); both puzzle origins; a restarted
  presentation (`restartCount > 0`) and a legacy row without the field.
- **Auto sets** — each recipe with pool sizes below/at/above 200; a pool with
  no puzzles and a fully-mastered pool; mastered departures with backfill to
  200; a new puzzle generated between cycles; a fixed pool proving the
  deterministic subset is stable across cycles; the two deterministic set ids.
- **Mastery** — 0/1/2/3 distinct-cycle credits; multiple rows in one cycle
  counting once; a retry-presentation clean row adding no credit; a
  hint/wrong-move/restart row adding no credit; credits earned across
  different sets; monotonic after a later failure; an orphaned attempt row
  ignored.
- **Config** — each ordering, each `retryFailed`, skip enabled/disabled,
  hint-level availability/threshold variants, set/unset targets; the fixed
  auto-set presets.
- **Persistence** — schema-v10 migration on an empty and a populated v9 DB;
  the extension adds no v11 migration.

### Test cases

- **Domain (pure):** membership resolution and target-size/ordering selection;
  `deriveAutoSetMembership` for each recipe (determinism, mastery exclusion,
  random backfill, new-puzzle eligibility, empty/all-mastered); `masteryOf`
  (distinct-cycle counting, legitimate-solve predicate, retry/hint/wrong/
  restart exclusion, monotonicity, cross-set credits, orphaned rows);
  cycle snapshot and cycle-number assignment; terminal/completion predicate
  for every `retryFailed` mode; retry bound (max two presentations); skip
  handling; resume reconstruction (fresh, mid-first-pass, pending immediate,
  pending end-of-cycle, complete); per-puzzle cycle resolution; all cycle
  aggregates and empty states; config/hint mapping to `SolveHintConfig`;
  `restartCount` outcome derivation; version stamping.
- **Repository (infrastructure):** `trainingSets`/`trainingCycles` create/get/
  list/update/delete; the unique `[trainingSetId+cycleNumber]` key; status
  filters; `ensureAutoSets()` idempotence (existing rows untouched, missing
  rows seeded with deterministic ids/presets); the mastery `listAll` read;
  set-deletion cascade over cycles and attempts; game-deletion membership
  cleanup; no orphans.
- **Service/application:** create set from a game and from the pool; seed auto
  sets; start a cycle (including the auto-set derive-then-snapshot path and the
  empty/all-mastered block); drive a full session over fixtures through the
  Feature-012 host contract (order, retries, skips, completion); a restart
  during a presentation; abandon-after-hint/restart then re-enter; resume after
  reload; abandon; repeat; results computation; mastery read and mastered-list
  assembly; write-failure containment (no advance while a row is unwritten).
- **Component:** training home (sets/empty/resume banner + the two auto sets and
  their derived counts), set detail (config/membership/history, read-only auto
  membership), mastered list (populated/empty), cycle session chrome
  (progress/exit/skip), cycle results (per-puzzle outcomes + aggregates +
  cross-cycle comparison), archive/delete confirmations, keyboard/AT behavior,
  mobile layout; the interim practice host is gone.
- **End-to-end:** auto set → cycle (derive + snapshot) → solve (via Feature
  012, including a restart-disqualified attempt) → attempt rows → cycle
  completion → next cycle re-derives membership → results/mastered list, using
  the real persistence layer and the Feature-012 screen with a stubbed engine.

---

## Dependencies

Feature 013 depends on:

- Feature 011 — immutable `PuzzleRow` source (both origins) and the
  set-building hand-off from the per-game puzzle view;
- Feature 012 — `SolveScreen`/`usePuzzleSolve`, `SolveHintConfig`,
  `SessionPuzzleContext`, `PuzzleAttemptRecorderLike`, and the immutable
  `puzzleAttempts` rows (the host contract);
- Feature 007 — the Game Library/per-game puzzle surfaces used for set
  creation entry;
- `domain/tactical-training.md` — the canonical cycle model and metrics;
- `ARCHITECTURE.md` §7/§9/§10 — ownership/deletion, versioning, performance.

Feature 013 output is consumed by:

- Feature 014 — training sets/cycles and the canonical cycle metric function
  (reused, never re-derived);
- Feature 015 — Dashboard, via Feature 014;
- the Game Library `masteredPuzzleCount` insight (via Feature 014);
- Feature 016 — deletion tombstones.

---

## Owner decisions to confirm

These are resolved in this rewrite with a recommended default so planning can
proceed. The owner may override any of them; each override is a small,
localized change:

1. **Retry bound** — at most one retry presentation per puzzle per cycle
   (max two presentations), so a cycle always terminates (default). The
   alternative (unbounded immediate retry until solved) is rejected: it
   cannot complete and conflicts with resume semantics.
2. **Retry driven by stored result** — a puzzle recorded `failed` is
   re-presented even if the user later found the move in the same
   presentation (default, consistent with Feature 012's immutable fail-once
   row). Alternative: treat `foundAfterFail` as solved and skip the retry
   (would require a Feature-012 contract change).
3. **`solvedWithHelp` semantics** — adopt Feature 012's implemented
   semantics (hint solve with no wrong move); `domain/tactical-training.md`'s
   "and/or after a retry" wording is reconciled to the implemented model.
   Alternative: distinguish "solved after wrong move" as its own result
   (requires a Feature-012 domain change and a schema/value review).
4. **Skip affordance** — the cycle host owns a Skip control (when allowed)
   and Feature 012's `SolveScreen` exposes the seam (small Feature-012
   contract extension). Alternative: no skip in V1 (removes the `skipped`
   result from the cycle flow).
5. **Target size** — default 10 applied as a creation cap, overridable to
   large sets (default). Alternative: a hard cap.
6. **Set sources** — V1 supports game, filtered pool, manual selection and the
   system-seeded `auto` sets (default). Alternative: only the per-game
   hand-off in V1.
7. **Ordering options** — `difficultyAsc` (default), `sourcePly`, `manual`.
   A `random` **ordering** remains deferred; deterministic seeded randomness
   now exists only as the `woodpeckerRandom` auto-set **selection** (§3a), and
   every auto set still presents in `difficultyAsc` order.
8. **Blunder re-rating** — deferred out of V1 (default; no mutation of
   immutable puzzles; per-puzzle signals stay derived — Feature 013 mastery,
   Feature 014 aggregates). Alternative: a separate derived per-user rating
   (needs a new ADR; not V1).
9. **Aggregate persistence** — cycle metrics are derived, not stored
   (default; matches Feature 014's no-materialization rule and the ownership
   cascade). Alternative: persist a versioned completion snapshot for stable
   history after source-game deletion.
10. **Cycle deletion** — deleting a set removes its cycles/attempts (default);
    standalone cycle deletion is not offered in V1 (abandon covers the user
    intent).
11. **Auto-set presets** — goal accuracy 100%, hints enabled, retry
    `endOfCycle`, ordering `difficultyAsc`; `woodpeckerRandom` size 200
    (default). These are deliberate product deviations from the Woodpecker
    method (which has no 100% gate and no retirement), justified in
    `research/cycle-training.md`.
12. **Auto sets are system-managed and always present** — idempotent
    `ensureAutoSets()`; not archivable/deletable/renamable and membership/
    recipe not editable in V1 (default). Alternative: allow archive/hide.
13. **Random stability** — deterministic per-puzzle priority hash of
    `setSeed + puzzleId`, lowest `size` selected (default). This makes the
    subset stable for a fixed eligible pool and backfills mastered departures;
    a newly generated puzzle can enter (and displace the lowest-priority
    member) when its priority ranks within the selection. If the owner wants
    new puzzles to *never* displace an existing member, the selection must be
    persisted/sticky — a different rule that conflicts with virtual/derived
    membership.
14. **Mastery scope** — global per puzzle across all sets/cycles, threshold 3
    distinct cycles (default); not per-set. Auto-retirement applies to auto
    sets only.
15. **Restart representation** — `restartCount` on `PresentationCounters` and
    the attempt row; `deriveResult` treats a solve after a restart as
    `solvedWithHelp` (default; no schema bump). Alternative: a new
    `restarted` result value (larger Feature-012 change).
16. **Abandon-after-hint/restart** — the presentation is recorded durably
    (not silently discarded) so re-entry cannot launder a clean first-try for
    the cycle (default; Feature-012 contract extension). A pristine
    presentation may still be discarded with no row.
17. **No un-master action** — the mastered list is read-only in V1 (default);
    mastery is monotonic.

### Reconciliations applied

These specification-consistency edits outside this feature spec were required
before implementation and have now landed; they do not change the model above:

- **`domain/tactical-training.md`** — reconciled the `PuzzleAttempt`/`Retries`
  prose with Feature 012's one-row-per-presentation, fail-once semantics and
  this feature's retry bound (at most one retry presentation per puzzle per
  cycle); `solvedWithHelp` is hint-only with no wrong move; cycle aggregates are
  a derived read model, not stored fields; one shared canonical cycle-metric
  function with Feature 014.
- **`features/011-puzzle-generation.md`** and **`domain/puzzle-model.md`** —
  reworded the note that "Feature 013 may re-rate blunder puzzles" to defer
  solver-calibrated re-rating out of V1 (per decision 8), noting that any future
  rating is a derived, non-authoritative store outside the immutable row.
- **`domain/tactical-training.md`** — added the auto-set source/recipe and
  virtual per-cycle membership, the `restartCount` attempt counter and the
  restart-disqualifying result rule, and the canonical 3-distinct-cycle
  legitimate-first-try mastery derivation shared with Feature 014.
- **`features/014-game-history-statistics.md` §11** — reconciled the mastered
  definition from "≥1 `solvedFirstTry`" to the canonical 3-distinct-cycle rule
  (the statistics read model reuses the Feature-013/domain function and
  `MASTERY_VERSION`); the version bump and tests were updated to match.
- **`research/cycle-training.md`** — appended the Woodpecker evidence digest
  (set sizes, cycle ladder, no 100% gate/no retirement in the method, first
  cycle 60–75%) and marked the 100% goal + auto-retirement + auto-refresh as
  deliberate product deviations.
- **`features/012-puzzle-training.md`** — the restart section, Outcomes table,
  attempt-row columns and acceptance criteria must gain the `restartCount`
  field and the "solve after restart is `solvedWithHelp`" rule; until that
  edit lands the Feature-012 spec's restart/outcome wording conflicts with the
  canonical rule in `domain/tactical-training.md` (see "Conflicts surfaced").
  This is a required consistency edit, not a scope change.

---

## Conflicts surfaced

These are surfaced rather than silently resolved; each needs an explicit owner
or follow-up spec decision:

1. **Feature 012 restart/outcome conflict (must be reconciled).** The canonical
   `domain/tactical-training.md` now says a solve after a restart is
   `solvedWithHelp`, but `features/012-puzzle-training.md` currently states
   "restart … does not reset the wrong-move count, hint counters or the solving
   clock" and the Outcomes table gives `solvedFirstTry` for "no hint and no
   wrong move" (no restart condition). Feature 012's `deriveResult` in code
   matches the old wording. The restart disqualification requires the
   Feature-012 spec/code extension described above (`restartCount`,
   `deriveResult`, attempt-row column, outcomes, acceptance criteria). Until
   that edit lands, the two specs contradict; this feature spec does not edit
   Feature 012 (it was outside the requested file set).
2. **Random stability vs "newly generated puzzles join the next cycle".** The
   owner wants both virtual per-cycle refresh (new puzzles eligible) and "only
   mastered departures cause replacements". A deterministic priority sample
   satisfies the first and, for a fixed pool, the second; a newly generated
   puzzle with a high priority can displace the current lowest-priority member.
   Strictly never displacing an existing member would require a persisted/
   sticky selection, which conflicts with virtual/derived membership (owner
   decision 13).
3. **Abandon-after-hint/restart representation.** To stop re-entry laundering a
   clean credit, the default is to record the abandoned presentation durably
   (as `failed` with its counters). Feature 012 currently discards a left
   presentation with no row. A lighter alternative is a dedicated
   `abandoned`/`discarded` result value excluded from denominators; this is a
   Feature-012 contract choice (owner decision 16).
4. **Auto-set lifecycle not specified by the owner.** Archivable/deletable/
   renamable were not stated; the default is always-present and
   non-editable (owner decision 12). Confirm or relax.
5. **Retry credit interpretation.** "a retry presentation … does not add a
   distinct-cycle mastery credit" is implemented as: only
   `presentationIndex === 1` can earn a mastery credit, so a clean retry solve
   never credits a cycle (even when the cycle has no other clean solve). If a
   clean retry solve should count the cycle, the mastery predicate changes to
   "the cycle has any legitimate clean solve" (owner decision 14/§3b).

## ADR assessment

No new ADR is required for the auto-set/mastery extension. It is consistent
with the current decisions:

- **ADR-031** — mastery and auto-retirement are a derived, monotonic read
  model. There is no due date, interval, stability or per-puzzle stored state,
  no FSRS/scheduler dependency, and the immutable `Puzzle` is unchanged; the
  model stays open to a future individual scheduler.
- **ADR-025** — auto-set ordering reuses the deterministic `difficultyAsc`
  order over the immutable static difficulty; no puzzle is re-rated.
- **ADR-001 / ARCHITECTURE §7** — auto sets are ordinary local `trainingSets`
  rows; no new persistence architecture or table.
- The auto-set recipes (size 200, 100% goal, hints/retry/ordering presets) and
  the 3-distinct-cycle mastery threshold are **product parameters** recorded as
  owner decisions, not architectural decisions; changing them is a versioned
  spec change (`MASTERY_VERSION`/`AUTO_SET_VERSION`), not a new ADR.

---

## Context

Required reading (see `.opencode/CONTEXT-MAP.md`):

- Architecture/decisions: `ARCHITECTURE.md` §7/§9/§10;
  `decisions/ADR-031`, `decisions/ADR-025` (difficulty ordering default);
  optional `history/ADR-007/011/021/022` (history only)
- Domain: `domain/tactical-training.md`, `domain/puzzle-model.md`,
  `domain/game-library.md`, `domain/statistics.md`
- Research: `research/cycle-training.md`; optional
  `research/fsrs-implementation.md` (deferred future scheduler)

Feature dependencies: Feature 011 (puzzle source), Feature 012 (solve
interaction + attempt rows); consumers Features 014/015 (and Feature 016 for
deletion tombstones). Feature 013 owns the canonical cycle metric function
that Feature 014 reuses.
