# Review Scheduling

The domain rules for **individual review scheduling** (post-V1): the
scheduler abstraction, grade mapping, schedule projection, due queue and
the separation from cycle training. Introduced by ADR-035 and realized by
Feature 020.

This document is authoritative for the review-scheduling rules; Feature 020
defines the user-facing behaviour and persistence.

## Scheduler abstraction

A pure, deterministic domain interface (no React, Dexie, engine, network or
hidden clock):

```text
Scheduler (domain interface, pure)
  initialState(now): ScheduleState
  preview(state, now): Record<Grade, ScheduleState>   // optional UI hints
  next(state, grade, now): ScheduleState
  retrievability(state, now): number                  // recall probability
```

- `Grade = 'again' | 'hard' | 'good' | 'easy'`.
- `ScheduleState` is **serializable** (timestamps as epoch millis, no `Date`
  instances) so it can be stored and passed across the worker/UI boundary.
- A single **adapter** maps `ScheduleState` ⇄ the library's card type and is
  the only module that imports the scheduler library (ADR-035).
- The scheduler is **swappable**: replacing the adapter must not change the
  projection schema, the grade mapping or the review UI.

## Grade mapping

Deterministic from the immutable attempt fields plus an injected latency;
versioned by `GRADE_MAPPING_VERSION`.

- `failed` → `again`; `solvedWithHelp` → `hard`.
- `solvedFirstTry` → `easy` when the presentation was clean
  (`hintCount === 0`, `wrongMoveCount === 0`, `restartCount === 0`) and
  `solvingTimeMs <= EASY_SOLVE_MS` (`EASY_SOLVE_MS = 10_000`); otherwise
  `good`.
- Defensive: a `solvedFirstTry` row carrying any hint/wrong-move/restart
  counter is downgraded to `hard` (mirrors the mastery legitimacy rule).
- `skipped` (and a discarded presentation) produces **no grade**.
- Latency only modulates the `solvedFirstTry` case; it never upgrades a
  helped or failed outcome.

## Schedule projection

- `scheduleFromHistory(attempts)` folds a puzzle's **gradeable** attempts
  (`result !== 'skipped'`) in chronological order (by `endedAt`, then
  `presentationIndex`) from `initialState` through `next`, producing the
  puzzle's `ScheduleState`. A puzzle with no gradeable attempt has **no**
  schedule row (it stays new/due).
- `applyGrade(state, grade, now)` is the incremental path used at solve
  time and must equal the corresponding fold step.
- The schedule is **global per puzzle** (across all sets and cycles),
  exactly like mastery.
- The schedule is a **derived projection**: it may be dropped at any time
  and rebuilt from `puzzleAttempts`. It is never authoritative and never
  mutates a `Puzzle` or an attempt row.
- A stored row whose `scheduleVersion` or `schedulerParamsVersion` differs
  from the current constants is **stale** and rebuilt lazily from history.

## Due queue

`dueQueue({ schedules, puzzles, now, caps, dayUsage })` returns the ordered
review-session snapshot:

1. **due reviews** — scheduled puzzles with `dueAt <= now`, ordered by
   `dueAt` ascending (ties by difficulty ascending, then `puzzleId`),
   capped by the remaining daily review allowance;
2. **new intake** — puzzles with no schedule row, drawn from the canonical
   `derivePool` (unmastered, not in the open block) in `difficultyAsc` order
   (ties by `sourcePly`, then `puzzleId`), capped by the remaining daily new
   allowance.

- `dayUsage` is derived at read time from the current local day's review
  sessions: a puzzle presented today counts as **new** when it had no
  schedule row before that session, otherwise as a **review**. No extra
  table.
- A due review that later becomes mastered is **still reviewed**; mastery
  affects only new intake (via `derivePool`).
- `dayKey(now)` is the local calendar day (Feature 013/019 semantics).

## Daily caps

- `review.dailyNewCap` (default `20`) and `review.dailyReviewCap`
  (default `100`), reset per local calendar day; `0` pauses a category.
- Caps bound the session snapshot only; they never mutate schedules.

## Mastery & statistics separation

- Review sessions run under the reserved sentinel `REVIEW_SET_ID`
  (`'__review__'`), distinct from `QUICK_TRAIN_SET_ID`, with **no**
  `trainingSets` row (the Quick-train pattern).
- Review-sentinel cycles are **excluded from mastery** exactly like
  Quick-train cycles: `masteryOf` / `masteredPuzzleIds` must not credit
  review cycles, so V1 mastery semantics are unchanged.
- Review attempts are **excluded from cycle/set statistics** (Feature 014)
  for this feature; review has its own session summary and entry card.
- Cycle training remains the only path that produces mastery; individual
  scheduling and mastery are independent read models over the same
  immutable attempt log.

## Invariants

1. `Puzzle` and `PuzzleAttemptRow` remain immutable and scheduling-free.
2. `puzzleSchedules` is always reconstructible from `puzzleAttempts`.
3. Incremental `applyGrade` equals a full `scheduleFromHistory` fold.
4. Review never changes cycle training, mastery or cycle statistics.
5. Schedule rows are owned by their puzzle and cascade-deleted with it.

## Sources

- `specs/decisions/ADR-035-individual-review-scheduling.md`
- `specs/features/020-individual-review-scheduling.md`
- `specs/domain/tactical-training.md`, `specs/domain/puzzle-model.md`
- `specs/decisions/ADR-018`, `ADR-031`
- `specs/research/fsrs-implementation.md`
