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

---

## Relationship to other features

| Feature | Role |
|---|---|
| 003/004 | `chessops` game/domain types and local persistence primitives. |
| 006/008 | Shared analysis-board surface and stored `MoveAnalysis` (used by Feature 012, inherited through it). |
| 007 | Game Library and the canonical row/insight/action surface; set creation is reached from the per-game puzzle view. |
| 011 | Immutable `PuzzleRow` source (both origins); hands the set-building entry point to this feature. |
| 012 | The solving screen, hint/outcome rules and the immutable `puzzleAttempts` write; **Feature 013 hosts it** and consumes its outcomes. |
| 014 | Aggregates over the set/cycle records and attempts this feature owns; the canonical cycle metric function is shared, never duplicated. |
| 015 | Dashboard, read-only consumer of Feature 014. |
| 016 | Deletion tombstones consistent with this feature's ownership rules. |

**Boundary with Feature 012.** Feature 012 is the solving experience; it
writes exactly one immutable attempt row per presentation and never computes
cycle aggregates. Feature 013 owns the ordered queue, set/cycle lifecycle,
retry passes, resume, completion and every cycle-level metric. Feature 013
never writes or mutates an attempt row itself — it drives the Feature-012
recorder and reads the rows.

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
- Creation resolves membership **once** and stores it: the set is a fixed
  collection, not a live query (domain rule).

### 3. Set detail

- Rename, edit configuration, view membership (with per-puzzle origin,
  objective and difficulty bucket), view cycle history, and start/continue a
  cycle.
- Archive/unarchive and delete (destructive confirmation naming the set and
  its cycle/attempt counts).
- Starting a cycle shows the effective config snapshot and the puzzle count
  before committing.

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

type SetSource =
  | { kind: 'game'; gameId: string }
  | { kind: 'pool'; filters: PuzzlePoolFilters }
  | { kind: 'manual' };

interface TacticalTrainingSetRow {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  status: TrainingSetStatus;
  source: SetSource;              // provenance/display only
  puzzleIds: readonly string[];   // resolved membership, base/manual order
  targetSize: number;             // creation target/cap (default 10)
  config: CycleConfig;            // current config; snapshotted per cycle
}
```

- Membership is **stored state**, not a live query; editing a set re-resolves
  membership explicitly.
- A puzzle may belong to zero, one or many sets; membership lives on the set,
  never on the `Puzzle` (ADR-031).
- `source` is provenance; the authoritative membership is `puzzleIds`.

### 2. Set creation and membership resolution

Resolution is a pure function of the persisted puzzles, the optional source
game summaries and the config:

- **game** source → the game's `puzzles` rows, optionally filtered by origin
  and/or difficulty bucket.
- **pool** source → all puzzles matching the pool filters.
- **manual** → the caller-provided id selection.

Then, under the configured `ordering` (see §3), take at most `targetSize`
puzzles. If fewer exist, the set holds all of them. A set with zero resolved
puzzles is created empty with an explicit empty state (it is never silently
deleted). Membership ids are canonical `puzzleIdOf(sourceGameId, sourcePly)`
values; a missing puzzle row at training time is skipped (Feature 012 error
case).

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
  the attempt.

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
performance signal (repeatedly failed, mastered) is a Feature-014 aggregate
derived from attempts and is never written onto the puzzle. This preserves
puzzle immutability and ADR-031's no-per-user-difficulty rule. Re-rating
requires a new ADR and is not V1 scope.

### 11. Ownership, archive and deletion

- A set is user data owned by the user. **Archive** sets `status: 'archived'`
  (hidden from the active list, history retained); unarchive restores it.
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
  `now`; no hidden clock or locale reads.
- `CycleConfig.configVersion` and `TrainingCycle.cycleMetricsVersion` follow
  ARCHITECTURE §9. A semantics change (completion rule, retry bound, ordering
  rule, metric denominators, hint mapping) bumps the relevant version; stored
  rows are never retroactively re-mapped.

---

## Data requirements

Additive persistence only; the immutable `puzzles` table and the schema-v9
`puzzleAttempts` table are unchanged.

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
  `removePuzzleIds` (game-deletion cascade), `listContainingPuzzle(puzzleId)`.
- `trainingCyclesRepository` — `get`, `listForSet`, `getByNumber`, `create`,
  `updateStatus` (`completed`/`abandoned` timestamps), `deleteForSet`.
- The existing `attemptsRepository` reads (`listForCycle`,
  `listForCycleAndPuzzle`) and the `trainingSetId`/`cycleId` indexes serve
  Feature 013; no change to the attempts schema.

### Deletion cascade

- Set deletion removes its cycles and attempt rows in one transaction.
- Game deletion (existing `deleteGames` transaction) additionally removes the
  deleted puzzle ids from all sets' `puzzleIds`; extend the cascade-ready
  dependent-kind list per the introducing milestone.
- No orphaned cycle or attempt may remain.

### Sync

- Feature 013 data is local user/derived data; this feature adds no sync.
  Feature 016 must tombstone set/cycle/attempt deletions consistently with the
  ownership rules and must not sync derived cycle aggregates.

---

## States

- **Set states**: `active`, `archived`, plus transient UI states (loading,
  empty membership, load error).
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
  in the set; mastery is Feature 014's monotonic definition over all attempts.
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
  rendering thousands of rows.

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
  No full-table scans of `puzzles`/`puzzleAttempts` per row.
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
  (including median/average cases); both puzzle origins.
- **Config** — each ordering, each `retryFailed`, skip enabled/disabled,
  hint-level availability/threshold variants, set/unset targets.
- **Persistence** — schema-v10 migration on an empty and a populated v9 DB.

### Test cases

- **Domain (pure):** membership resolution and target-size/ordering selection;
  cycle snapshot and cycle-number assignment; terminal/completion predicate
  for every `retryFailed` mode; retry bound (max two presentations); skip
  handling; resume reconstruction (fresh, mid-first-pass, pending immediate,
  pending end-of-cycle, complete); per-puzzle cycle resolution; all cycle
  aggregates and empty states; config/hint mapping to `SolveHintConfig`;
  version stamping.
- **Repository (infrastructure):** `trainingSets`/`trainingCycles` create/get/
  list/update/delete; the unique `[trainingSetId+cycleNumber]` key; status
  filters; set-deletion cascade over cycles and attempts; game-deletion
  membership cleanup; no orphans.
- **Service/application:** create set from a game and from the pool; start a
  cycle; drive a full session over fixtures through the Feature-012 host
  contract (order, retries, skips, completion); resume after reload; abandon;
  repeat; results computation; write-failure containment (no advance while a
  row is unwritten).
- **Component:** training home (sets/empty/resume banner), set detail
  (config/membership/history), cycle session chrome (progress/exit/skip),
  cycle results (per-puzzle outcomes + aggregates + cross-cycle comparison),
  archive/delete confirmations, keyboard/AT behavior, mobile layout; the
  interim practice host is gone.
- **End-to-end:** set → cycle → solve (via Feature 012) → attempt rows →
  cycle completion → next cycle → results, using the real persistence layer
  and the Feature-012 screen with a stubbed engine.

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
6. **Set sources** — V1 supports game, filtered pool and manual selection
   (default). Alternative: only the per-game hand-off in V1.
7. **Ordering options** — `difficultyAsc` (default), `sourcePly`, `manual`.
   `random` (seeded) is deferred.
8. **Blunder re-rating** — deferred out of V1 (default; no mutation of
   immutable puzzles; per-puzzle signals stay Feature-014 aggregates).
   Alternative: a separate derived per-user rating (needs a new ADR; not
   V1).
9. **Aggregate persistence** — cycle metrics are derived, not stored
   (default; matches Feature 014's no-materialization rule and the ownership
   cascade). Alternative: persist a versioned completion snapshot for stable
   history after source-game deletion.
10. **Cycle deletion** — deleting a set removes its cycles/attempts (default);
    standalone cycle deletion is not offered in V1 (abandon covers the user
    intent).

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
