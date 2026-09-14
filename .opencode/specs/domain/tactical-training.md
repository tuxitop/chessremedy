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

Sets may be **user-authored** (game/pool/manual) or one-click
**Woodpecker blocks** (`auto` recipe). The app never creates a set or block
on its own: a block is formed only by an explicit user action and is a
**fixed snapshot** of the derived **pool** (unmastered puzzles not in the
open block). A puzzle is **mastered** after a legitimate first-try solve in
3 distinct cycles; mastery is informational and retires nothing.

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
Membership is tracked by the set; the derived **pool** is a view, not a
stored set; mastery is derived from attempt history at read time.

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
  selection, or an `auto` block recipe — see below)
- puzzle IDs (the set membership, in the set's base order; **frozen** for a
  Woodpecker block)
- ordering policy (see Configuration)
- target size (for a block, the recipe size; a block takes all of the pool
  when it is smaller than the size)
- status (`active` = open block, at most one; `archived` = closed or hidden)
- configuration/version (the training-configuration snapshot the set
  was created or last edited with; fixed for a block)

A set is created explicitly by the user: either a custom set from a puzzle
source (Feature 011 output, game-review selections) or a one-click
**Woodpecker block** from the derived pool. The app never seeds or
auto-creates a set. Every set's membership and order are stored state, not
derived from mutable query results; a block's membership is frozen at
creation.

A block's lifecycle is **close or delete**. **Finish**/**Abandon** archive it
(`status: 'archived'`) and preserve its cycle history, while **delete** removes
the set row and cascades its cycles and attempts (the puzzles themselves are
untouched). Deletion is row removal, not a third status. Block detection
requires `source.kind === 'auto'` **and** `recipe.kind === 'woodpeckerBlock'` so
a pre-block-model legacy auto row can never be read as the open block.

## Pool, Woodpecker block and Quick train

The training model has three related concepts; none is created without an
explicit user action.

**Pool** — the derived set of every puzzle the user owns that is **not
mastered** and **not a member of the currently-open block**:

- it is computed at read time from `Puzzle`s, the derived mastery state and
  the open block; it is never stored as a set and there is no "pool set";
- it grows as games are analyzed and puzzles are generated;
- it is trained either through a **Woodpecker block** (a fixed snapshot) or
  **Quick train** (ad-hoc).

**Woodpecker block** — a fixed, difficulty-ascending snapshot formed from the
pool by one click:

- the user presses **Create Woodpecker block**; the app selects up to `N`
  pool puzzles (default `N = 200`; `100`/`400` behind an "Advanced"
  disclosure) in difficulty-ascending order (ties by `sourcePly` then
  `puzzleId`) and stores them as the block's frozen membership;
- if the pool is smaller than `N`, the block holds all of it;
- membership is **fixed**: new puzzles are not added mid-plan and the block is
  not re-derived per cycle (this supersedes the former virtual/per-cycle
  membership);
- only **one block is open at a time**; finishing or abandoning it closes it
  and returns its still-unmastered members to the pool, and the next block is
  formed from the remaining pool plus new puzzles;
- a block may also be **deleted** entirely (open or closed): the block row, its
  cycles and their attempts are removed; its puzzles are untouched and its
  members return to the pool because they were never removed from `Puzzle`.
  Closing preserves history; deleting discards it;
- guidance copy recommends **200–400** puzzles and warns that below about
  **100** later cycles risk memorising diagrams; the order is never shuffled
  (same easy→hard order every cycle).

**Quick train** — an ad-hoc, non-stored session over the whole pool for a
brand-new user (or any time) who wants to practise before committing a block:

- it creates no `trainingSets` row;
- it snapshots the pool into a real ad-hoc `TrainingCycle` row under a
  reserved sentinel `trainingSetId` and writes ordinary immutable attempts;
- the sentinel is excluded from set-scoped reads and set deletion.

**Legacy auto sets.** Rows from the pre-block-model auto sets
(`auto:all-puzzles`, `auto:woodpecker-random`) are dead data; a one-time,
idempotent startup cleanup removes them and their cycles/attempts. It is
remediation, not a creation path: the app still never creates a set or block on
its own.

There is **no 100% accuracy gate** and no automatic retirement. Success is
speed and automaticity: cycle results track total solving time against the
previous cycle (target: beat half of it), suggest an optional ~6-cycle plan,
surface the 60–75% first-cycle first-try band as guidance, and nudge when a
new cycle starts on the same local calendar day as the previous cycle ended.
None of these is enforced.

Fixed presets for a block: hints enabled, retry-failed `endOfCycle`, ordering
`difficultyAsc`; `targetAccuracy` is unset (informational only). These are
ChessRemedy product choices, not part of any published protocol
(`specs/research/cycle-training.md`).

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
- **Single in-progress cycle per set**: a set has at most one
  `inProgress` cycle at a time. When a set's history holds more than one
  (a legacy or raced duplicate), the active pass is kept — the one with
  the most recent attempt, else the latest started, else the lowest
  cycle number — and every other `inProgress` cycle is abandoned, so the
  cycle history never shows two in-progress rows. Starting, resuming or
  opening the set reconciles such duplicates.
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

## Training session

A **training session** is an ephemeral, time-boxed solving run over a cycle's
queue. It is a focus wrapper, not a stored artifact:

- it has no id and is never persisted; the **cycle remains the source of
  truth** and stays resumable, so a cycle may span several sessions;
- it writes nothing of its own: the attempt rows it produces are ordinary
  cycle attempts, and there is **no attempt-row schema change**;
- its summary (first-try / help / failed / skipped counts, first-try accuracy,
  time used, average time per puzzle, remaining puzzles) is derived at session
  end from the cycle's attempt rows written during the session window (same
  `cycleId`, `endedAt >= sessionStart`) and is discarded when the user leaves;
- it adds a **per-puzzle timer threshold** concept: the presentation clock is
  revealed (red) once the presentation's wall-clock elapsed time reaches the
  configured threshold, even when the clock is otherwise hidden. The threshold
  is display-only and never ends, fails or alters a presentation.

Session length, the session warning threshold and the puzzle timer threshold
are user settings (Feature 019); none changes the cycle or attempt model.

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
- Mastery is versioned by `MASTERY_VERSION`; Feature 013 (pool membership)
  and Feature 014 (mastered counts) both call the single canonical function.
- Mastery is **informational**: it performs no automatic action and mutates no
  row. A mastered puzzle is outside the **pool** by definition (so it is not
  selected into a future block), but it stays in any existing block and in any
  custom set; nothing is retired or archived.

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

- target size: 10 puzzles per custom set; a Woodpecker block defaults to 200
  (100/200/400)
- ordering: by difficulty ascending (ties by `sourcePly` then `puzzleId`) —
  deterministic
- retry-failed: `endOfCycle`
- hint-level availability: levels 1–4 enabled, first-hint level at the
  set's configured threshold
- completion rules: skipping allowed; a skipped puzzle is not completed
- target accuracy / target solving time: optional, unset by default; target
  accuracy is informational only and is never a gate
- number of cycles: unset (open-ended) by default; ~6 suggested as guidance

Woodpecker-block configuration is fixed (not user-editable): hints enabled,
retry-failed `endOfCycle`, ordering `difficultyAsc`, no accuracy gate; the
effective size is the recipe's (default 200).

These defaults are not derived from any specific Woodpecker protocol; they are
ChessRemedy's initial product choices (ADR-031). The time-halving goal, the
~6-cycle plan, the 60–75% first-cycle band and the same-local-calendar-day
spacing nudge are guidance aligned with the method, not enforced gates
(`specs/research/cycle-training.md`).

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

The immutable `Puzzle`, the `TacticalTrainingSet` membership (custom stored
or block-frozen), the derived pool, the attempt/cycle history and the derived
mastery state are the entire V1 training data surface. An individual review
scheduler (`ts-fsrs`) is layered on top of attempt history without changing
the puzzle definition or discarding V1 data; mastery is derived and adds no
scheduling state. The scheduler lives behind a pure domain interface and its
state is a derived, rebuildable projection (ADR-035;
`specs/domain/review-scheduling.md`).
No scheduler abstraction is introduced in V1 beyond this boundary:

```text
Puzzle
  ↓
Training Strategy
  ├── Cycle Training (V1)
  └── Individual Scheduler (ADR-035)
```
