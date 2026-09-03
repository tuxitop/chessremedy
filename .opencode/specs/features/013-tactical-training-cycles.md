# Feature 013 — Tactical Training Cycles

## Goal

Organize personalized puzzles into fixed **tactical training sets** and
drive repeated **training cycles** over them (Woodpecker-inspired cycle
training, ADR-031). This feature owns the set/cycle lifecycle and the
recording of attempts and cycle results; it does not schedule puzzles
individually (no FSRS, no per-puzzle due/review state).

The model is defined in `specs/domain/tactical-training.md`.

## Requirements

- Training-set management:
  - create a set from a puzzle source/criteria (e.g. generated puzzles
    from Feature 011, or a manual selection)
  - name and (re)configure a set
  - select an existing set for training
  - archive/delete a set
- Cycle lifecycle:
  - start a cycle over a set
  - solve the set's puzzles sequentially (the interaction is Feature
    012)
  - record every attempt (result, time, attempts, hints, retries)
  - handle wrong answers, hints, retries and skips per the rules in
    `specs/domain/tactical-training.md`
  - retry failed puzzles per the configured retry-failed behavior
  - complete a cycle
  - abandon a cycle (discard) or leave it in progress (resumable)
  - start the next cycle
  - review previous cycle results
  - restart/repeat a cycle where appropriate
- Configurable behavior (stored on the set): target size, ordering,
  retry-failed behavior, hint-level availability, completion rules,
  target accuracy, optional target solving time, number of cycles.
- Deterministic fixtures for sets/cycles/attempts so later features
  (014 statistics, 015 dashboard) can be developed without solving real
  puzzles.
- No FSRS dependency; no scheduling state on the Puzzle model.

## Cycle semantics (summary)

- Completing the set finishes the cycle (`completed`).
- Exiting early leaves the cycle `inProgress` (resumable) unless the
  user discards it (`abandoned`).
- A skipped puzzle is recorded but not completed and never counts
  toward accuracy.
- A wrong answer does not remove the puzzle from the cycle by default;
  retry-failed behavior is configurable.
- A puzzle still failing at cycle end remains in the set for the next
  cycle.
- Cycle accuracy/time/hints/retries/completion are derived from attempt
  records.

## Acceptance Criteria

1. A user can create/select a training set, start a cycle and solve its
   puzzles in order.
2. Each puzzle interaction records a `PuzzleAttempt` with result, solve
   time, attempts, hints and retries.
3. A failed puzzle is handled according to the configured retry-failed
   behavior and reappears in the next cycle.
4. A cycle that is exited early can be resumed, discarded, or restarted.
5. Completing a cycle stores a `TrainingCycle` with its aggregate
   metrics and the user can start the next cycle or review previous
   cycle results.
6. Cycle and attempt fixtures are deterministic and require no engine,
   network or IndexedDB to run domain tests.
7. No puzzle review event depends on an individual scheduler; no
   scheduling state is stored on a Puzzle.

---

## Context

Required reading (see `.opencode/CONTEXT-MAP.md`):

- Architecture/decisions: `decisions/ADR-031`, `decisions/ADR-025`;
  optional `history/ADR-007/011/021/022` (history only)
- Domain: `domain/tactical-training.md`, `domain/puzzle-model.md`
- Research: `research/cycle-training.md`; optional
  `research/fsrs-implementation.md` (deferred future scheduler)

Feature dependencies: Feature 011 (puzzle source), Feature 012 (solve
interaction); consumers Features 014/015.
