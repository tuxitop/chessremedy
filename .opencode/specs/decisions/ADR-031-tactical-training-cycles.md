# ADR-031: Cycle-Based Tactical Training (V1)

## Status

Accepted

## Supersedes

- ADR-007 (Spaced Repetition)
- ADR-011 (FSRS Implementation)
- ADR-021 (FSRS Fuzz Policy)
- ADR-022 (FSRS Puzzle Rating Mapping)

## Context

ChessRemedy creates personalized tactical puzzles from the user's own
mistakes, blunders and missed tactical opportunities. Practising these
puzzles repeatedly is the core training loop, and the product must
measure whether the user is improving across practice sessions.

The earlier decision (ADR-007, refined by ADR-011/021/022) was to treat
every puzzle as an independently scheduled item managed by the FSRS
spaced-repetition algorithm. FSRS is designed for flashcard review, where
each item is scheduled individually and recall is the measured outcome.
That model is one valid option, but it couples V1 to a scheduling
algorithm and hides per-puzzle schedule state (`due`, `stability`,
`difficulty`) inside the puzzle data.

## Decision

V1 trains **fixed sets of puzzles in repeated training cycles**, an
approach inspired by the Woodpecker method. ChessRemedy does not
reproduce any particular author's protocol; it adopts the general
principle of cycling repeatedly through a fixed set while measuring
accuracy, solving time, hints and retries across cycles.

- A **Tactical Training Set** is a fixed, ordered collection of puzzles
  with a defined source/criteria and configuration.
- A **Training Cycle** is one pass through the puzzles of a set. Every
  puzzle in a cycle produces a **Puzzle Attempt**; the cycle aggregates
  attempts into cycle-level metrics.
- A cycle has explicit, configurable rules for skipping, exiting
  mid-cycle, wrong answers, hints and retries (see
  `specs/domain/tactical-training.md`). Wrong answers do not silently
  remove a puzzle from the set.
- **No FSRS implementation is used in V1.** No scheduler library is a
  V1 dependency, and no general scheduling framework is built.

The puzzle model must not carry V1 scheduling state (no `due`,
`stability`, per-user `difficulty`, or interval). Attempt and cycle
history is recorded without making a future scheduler impossible.

## Rationale

- Puzzles are derived from the user's own mistakes. Revisiting the same
  fixed set repeatedly targets pattern recognition for exactly the
  tactical ideas the user missed.
- Fixed-set cycles make progress measurable within a bounded, comparable
  workload: accuracy, solve time, hints and retries are directly
  comparable across cycles over the same puzzles.
- It is simpler and more transparent than introducing an individual
  scheduling algorithm at this stage, and it keeps V1 free of an
  algorithmic dependency whose parameters would need tuning against
  puzzle-specific data.
- The model naturally supports the accuracy and speed measurements the
  product wants to show.

## Alternatives considered

- **FSRS / individual spaced repetition** (ADR-007/011/021/022): proven
  for flashcards; can be layered on later. Rejected for V1 because it
  requires scheduling parameters and per-puzzle schedule state before a
  body of puzzle-solving data exists, and because fixed-set cycling is a
  better fit for measuring whole-set improvement.
- **Simple fixed intervals**: resurface each puzzle after a constant
  interval. Rejected: no improvement signal, still per-puzzle state,
  and no better than cycles for V1 goals.
- **Random puzzle repetition**: no fixed set and no structured progress.
  Rejected: cannot show cycle-level improvement and does not match the
  mistake-derived, set-based training model.
- **Woodpecker-style cycle training** (chosen): repeated passes over a
  fixed set with measured outcomes, configurable rather than bound to a
  single published protocol.

## Consequences

- Simpler V1 implementation: cycle logic is deterministic domain logic
  with no scheduler dependency.
- Strong cycle-level analytics: accuracy, time, hints, retries and
  completion are available per cycle and across cycles.
- Fixed training sets: puzzles are trained as a group rather than as
  independently scheduled items.
- Less individualized pacing than FSRS in V1; there is no per-puzzle
  "next review" concept.
- A future individual scheduler (FSRS or another) remains possible: the
  immutable puzzle definition and the attempt/cycle history do not
  prevent layering a scheduler on top.
- Settings that only make sense for FSRS (desired retention, interval
  modifiers, stability/difficulty tuning) are not introduced. Cycle
  configuration (set size, ordering, retry behavior, hint availability,
  completion rules, optional targets) is defined in
  `specs/domain/tactical-training.md` and Feature 013.

## Sources

- `specs/PRODUCT.md` §11
- `specs/ARCHITECTURE.md` §2, §3, §7
- `specs/domain/tactical-training.md`
- `specs/research/cycle-training.md`
- `specs/features/013-tactical-training-cycles.md`
