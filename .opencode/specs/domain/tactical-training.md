# Tactical Training (Cycle-Based)

This specification defines the V1 training model: puzzles are gathered
into fixed **Tactical Training Sets** and practised in repeated
**Training Cycles**. Every puzzle **presentation** in a cycle produces a
**Puzzle Attempt** (a puzzle may be presented more than once when retries
are enabled); cycles aggregate attempts into cycle-level metrics computed
at read time. This is
a ChessRemedy adaptation of the Woodpecker method's core idea —
repeatedly cycling through a fixed set — and does not reproduce any
particular published protocol. See ADR-031 and
`specs/research/cycle-training.md`.

Sets may be **user-authored** (game/pool/manual) or **auto-generated**
(`auto`: "All puzzles" and "Woodpecker random"). Auto-set membership is
**virtual**: it is derived from the puzzle pool and the derived
**mastery** state at each cycle start and snapshotted onto the cycle;
user-authored sets keep fixed stored membership. A puzzle is **mastered**
after a legitimate first-try solve in 3 distinct cycles and is then
retired from auto-set membership only.

V1 does not schedule puzzles individually. FSRS or another individual
scheduler is deferred; the model below must not prevent one from being
added later. Mastery is a derived, monotonic read-model property, not a
scheduler state: it has no due date, interval or stability and is never
written onto the puzzle (ADR-031).

## Puzzle

A `Puzzle` is the immutable definition of a tactical exercise:

- id
- source game / source ply (provenance, `specs/domain/puzzle-model.md`)
- starting FEN
- side to move
- expected solution (may be multi-move)
- tactical objective
- difficulty metadata (static score, ADR-025)
- engine verification metadata
- generation version

A `Puzzle` contains **no scheduling state**: no due date, no review
interval, no stability, no per-user difficulty, and no stored mastery
flag. A puzzle may belong to zero, one or many `TacticalTrainingSet`s.
Membership is tracked by the set (or derived for auto sets), not stored
on the puzzle; mastery is derived from attempt history at read time.

Puzzles are owned by their source game. Deleting a game removes its
puzzles and, transitively, their attempts and set membership per the
ownership rule (`ARCHITECTURE.md` §7, `domain/game-library.md`), so
training aggregates never reference orphaned puzzles.

## TacticalTrainingSet

A `TacticalTrainingSet` is a fixed collection of puzzles intended to be
trained together:

- id
- name
- creation date
- source/criteria (e.g. "blunders from games imported on 2026-06-01",
  "missed tactical opportunities, classical time control", a manual
  selection, or an `auto` recipe — see below)
- puzzle IDs (the set membership, in the set's base order; **empty and
  non-authoritative for `auto` sets**)
- ordering policy (see Configuration)
- target size (ignored for `auto` sets; the recipe defines the size)
- status (e.g. `active`, `archived`)
- configuration/version (the training-configuration snapshot the set
  was created or last edited with; fixed for `auto` sets)

A set is created by the user or generated from a puzzle source
(Feature 011 output, game-review selections) or seeded by the system
(`auto`). User-authored sets are deterministic and reproducible for
testing; their membership and order are stored state, not derived from
mutable query results. `auto` sets are deterministic functions of the
pool, mastery and their seed (see Auto-generated sets).

## Auto-generated sets

Two sets are seeded by the system with deterministic ids and exist by
default:

| Recipe | Membership | Order |
|---|---|---|
| `allPuzzles` | every unmastered pool puzzle | difficulty ascending |
| `woodpeckerRandom` | a deterministic `size`-puzzle subset of the unmastered pool (V1 `size = 200`) | difficulty ascending |

Fixed presets: goal accuracy 100% (`targetAccuracy = 1`), hints enabled,
retry-failed `endOfCycle`, ordering `difficultyAsc`. These are deliberate
product choices, not part of any published protocol
(`specs/research/cycle-training.md`).

Membership is **virtual**:

- it is derived at **cycle start** from the current puzzle pool minus
  mastered puzzles, then snapshotted onto the cycle (`TrainingCycle.puzzleIds`);
  it is fixed for the cycle and never mutated mid-cycle;
- `woodpeckerRandom` selects deterministically: rank each eligible puzzle by a
  stable, dependency-free hash of `setId + "\u0000" + puzzleId` and take the
  lowest `size` (ties by puzzle id). The same eligible pool and set id yield
  the same subset every cycle; mastered departures are backfilled to `size`;
- newly generated puzzles are eligible from the next cycle (they enter
  `allPuzzles` always, and `woodpeckerRandom` when the eligible pool is below
  `size` or their priority ranks within the selection);
- an empty derived membership (no puzzles, or all mastered) is a real `empty`
  state and blocks cycle start, never a fake count;
- auto sets are system-managed and idempotently re-seeded; they are not
  user-editable in V1.

User-authored sets never use this path: their membership is stored and is
never auto-retired.

## TrainingCycle

A `TrainingCycle` is one pass through the puzzles of a set:

- id
- training set id
- cycle number (1-based, per set)
- start time
- completion time (null while in progress)
- duration (computed from start/completion time, or accumulated while
  in progress)
- number of puzzles (the set size at cycle start)
- puzzles completed
- puzzles skipped
- accuracy
- total attempts
- hints used
- retries
- aggregate solving time
- completion status

The identity/snapshot fields (`id`, training set id, cycle number,
start/completion time, number of puzzles, completion status) are stored
on the cycle; the aggregate fields (puzzles completed/skipped, accuracy,
total attempts, hints used, retries, aggregate solving time) are a
**derived read model**, computed from the cycle's attempt rows and the set
snapshot (see Metrics) — they are never authoritative stored state.

Status values:

- `inProgress` — started, not yet finished (resumable)
- `completed` — the completion condition (§ Completion) was met
- `abandoned` — the user discarded the cycle without completing it

### Completion

A cycle is **completed** when every non-skipped puzzle in the cycle has
a definite result (solved or failed) and, when the configured
retry-failed behavior is `endOfCycle`, the retry pass (if any) has been
resolved. Skipped puzzles do not block completion, but they are not
counted as completed puzzles. The retry pass is **bounded**: a puzzle is
presented at most twice per cycle (its initial presentation plus at most
one retry presentation), so a cycle always terminates.

### Lifecycle rules

The following behaviors are defined explicitly and are configurable
where noted:

- **Completes every puzzle**: the cycle ends as `completed` when the
  completion condition above is met.
- **Exit before completing the set**: the cycle is stored as
  `inProgress` and can be resumed later from the next unanswered
  puzzle. The user may instead discard the cycle, which marks it
  `abandoned`; a new cycle can then be started from the set.
- **Skip a puzzle**: the puzzle is recorded as skipped (`PuzzleAttempt`
  result `skipped`), excluded from accuracy and solving-time aggregates,
  and is not marked completed. Skipping does not remove the puzzle from
  the set or from future cycles.
- **Wrong answer**: the **first** wrong move records a `failed` attempt
  row immediately (one row per presentation) and does **not** remove the
  puzzle from the current cycle by default. The presentation stays open
  and the user may keep trying; a later correct move in the same
  presentation is confirmed in the UI but writes **no** second row (the
  attempt row is immutable). The configured retry-failed behavior decides
  whether the puzzle is offered a new presentation within the same cycle
  (`endOfCycle`), never (`none`), or immediately (`immediate`).
- **Hints**: using a hint never marks a puzzle as failed. A solve with a
  hint and **no wrong move** is recorded as `solvedWithHelp` and is
  excluded from first-try-no-hint accuracy. A wrong move always records
  `failed` regardless of hints used. The hint level reached is recorded.
- **Retries**: retrying a move within a presentation (after a wrong move)
  is counted on that presentation's row (`number of attempts` /
  wrong-move count) and does **not** create an extra row. A *retry
  presentation* — offering the puzzle again within the same cycle per the
  retry-failed behavior — is a separate `PuzzleAttempt` row with an
  incremented presentation index, capped at one per puzzle per cycle so
  that "required retries" is measurable and the cycle always terminates.

A puzzle that is still failing at the end of a completed cycle remains
in the set and is revisited in the next cycle.

## PuzzleAttempt

A `PuzzleAttempt` records one puzzle **presentation**'s outcome within a
cycle:

- puzzle id
- training set id
- cycle id
- presentation index (1-based per `[cycleId, puzzleId]`; incremented for a
  retry presentation)
- timestamp
- result
- solving time
- number of attempts (wrong moves / retries within this puzzle)
- restart count (presentation restarts; see below)
- hints used (count and highest level reached)
- whether the puzzle was eventually solved

Result values:

- `solvedFirstTry` — solved on the first attempt without any hint,
  without a wrong move and **without a restart**
- `solvedWithHelp` — solved using a hint, and/or after a restart (with no
  wrong move)
- `failed` — a wrong move was made (recorded immediately), or the
  presentation ended without solving; a presentation whose first wrong
  move is later corrected still records `failed`
- `skipped` — left without solving (no result)

**Restart disqualification.** A presentation-scoped restart clears the
played line and any revealed hint content but keeps the counters and the
clock; it does not create a new attempt. The presentation's `restartCount`
is persisted, and a solve after a restart derives `solvedWithHelp` (a
restart means the clean first-try line was reset), never `solvedFirstTry`.
A presentation abandoned after a hint or restart is recorded durably so
re-entry cannot launder a clean first-try credit; attempt rows are
immutable and first-write-wins on
`[cycleId, puzzleId, presentationIndex]`. Only a real cycle presentation
produces an attempt (there is no ad-hoc/practice host).

Attempt records are the atomic training data. Every cycle-level metric
is derived from attempt records at read time (never stored as
authoritative cycle state); attempts are never aggregated on the puzzle.
Feature 013 and Feature 014 share one canonical cycle-metric function and
one canonical mastery function so the definitions cannot drift.

## Mastery

A puzzle is **mastered** when it has a legitimate first-try solve in
**3 distinct cycles**:

```text
isLegitimateFirstTrySolve(attempt) :=
  attempt.presentationIndex === 1
  && attempt.result === 'solvedFirstTry'
  && attempt.hintCount === 0
  && attempt.wrongMoveCount === 0
  && attempt.restartCount === 0

masteryOf(puzzleId) :=
  mastered when distinctCycleCount(legitimate first-try rows) >= 3
```

- Only the cycle's **first presentation** can earn a credit; a retry
  presentation (same cycle, `presentationIndex === 2`) never adds a
  distinct-cycle credit even if its row is `solvedFirstTry`.
- Hints, wrong moves and restarts disqualify; a `solvedFirstTry` row with
  any of them is not produced by the result rules above, and the
  derivation checks the counters defensively.
- Mastery is **global** per puzzle (across all sets/cycles), **monotonic**
  (a later failure never un-masters the retained history) and **derived at
  read time** (no stored flag, no scheduler state; ADR-031). Deleting the
  source game deletes the puzzle and its attempts, so mastery disappears
  with it.
- Mastery is versioned by `MASTERY_VERSION`; Feature 013 (auto-set
  membership) and Feature 014 (mastered counts) both call the single
  canonical function.
- Mastered puzzles are excluded from **auto-set** membership only;
  user-authored sets are never auto-retired.

## Cycle configuration

Cycle behavior is configuration, not hidden constants. Configuration
lives on the training set and applies to cycles started from it.
Configurable fields:

- set size / target size
- ordering
- retry-failed behavior (`none` | `endOfCycle` | `immediate`)
- hint-level availability (which of the four hint levels are enabled)
- completion rules (e.g. whether skipping is allowed)
- target accuracy
- optional target solving time
- number of cycles (informational target for a training plan)

V1 defaults (product decisions; revisable without an ADR only when the
change is a default-value change):

- target size: 10 puzzles per set
- ordering: by difficulty ascending (ties by puzzle id) — deterministic
- retry-failed: `endOfCycle`
- hint-level availability: levels 1–4 enabled, first-hint level at the
  set's configured threshold
- completion rules: skipping allowed; a skipped puzzle is not completed
- target accuracy / target solving time: optional, unset by default
- number of cycles: unset (open-ended) by default

Auto-set configuration is fixed (not user-editable): goal accuracy 100%
(`targetAccuracy = 1`), hints enabled, retry-failed `endOfCycle`, ordering
`difficultyAsc`; the effective size is the recipe's (`allPuzzles`
unbounded, `woodpeckerRandom` 200).

These defaults are not derived from any specific Woodpecker protocol;
they are ChessRemedy's initial product choices (ADR-031), and the
auto-set 100% goal and retirement are deliberate deviations from the
Woodpecker method documented in `specs/research/cycle-training.md`.

## Metrics

Metrics are defined at two levels and the two must never be conflated.

### Puzzle-level metrics (per attempt)

- outcome (result above)
- solving time
- number of attempts
- hints used / highest hint level
- solved yes/no

### Cycle-level aggregates

For a completed (or in-progress, partial) cycle:

- puzzles completed: attempts with a definite result (solved or failed)
- puzzles skipped: attempts with result `skipped`
- **first-try accuracy**: `solvedFirstTry / definite attempts`
- **solve rate**: `(solvedFirstTry + solvedWithHelp) / definite attempts`
- total attempts
- hints used (total and count of puzzles requiring a hint)
- retries (total and count of puzzles requiring a retry)
- aggregate solving time
- average puzzle solving time
- median puzzle solving time where useful

"Skipped" is never in any accuracy denominator. Abandoned cycles are
kept distinct and are reported separately from completed ones.

### Improvement across cycles

The system may compare metrics across cycles of the same set, e.g.:

```text
Cycle 1   Accuracy: 72%   Time: 31:42
Cycle 2   Accuracy: 84%   Time: 24:15
Cycle 3   Accuracy: 91%   Time: 19:08
```

Comparisons must use the same set, the same metric definition, and
comparable sample sizes. The system must not claim that an improvement
proves the training method caused it; it reports measured deltas only
(same caveats as `specs/domain/statistics.md`).

## Future scheduling

The immutable `Puzzle`, the `TacticalTrainingSet` membership (stored or
auto-derived), the attempt/cycle history and the derived mastery state
are the entire V1 training data surface. A future individual scheduler
(e.g. FSRS) can be layered on top of attempt history without changing the
puzzle definition or discarding V1 data; mastery is derived and adds no
scheduling state.
No scheduler abstraction is introduced in V1 beyond this boundary:

```text
Puzzle
  ↓
Training Strategy
  ├── Cycle Training (V1)
  └── Individual Scheduler (future)
```
