# ADR-031: Cycle-Based Tactical Training (V1)

## Status

Accepted

## Supersedes

- ADR-007 (Spaced Repetition)
- ADR-011 (FSRS Implementation)
- ADR-021 (FSRS Fuzz Policy)
- ADR-022 (FSRS Puzzle Rating Mapping)

## Context

ChessRemedy turns the user's own mistakes and missed tactics into
personalized puzzles and practises them repeatedly. The earlier decision
(ADR-007, refined by ADR-011/021/022) scheduled each puzzle individually
with FSRS — a flashcard-style scheduler that hides per-puzzle schedule
state (`due`, `stability`, per-user `difficulty`) inside the puzzle data
and needs scheduling parameters tuned before a body of solving data
exists.

## Decision

V1 trains **fixed sets of puzzles in repeated training cycles**, an
approach inspired by the Woodpecker method (not bound to any author's
exact protocol). The full model — Tactical Training Set, Training Cycle,
Puzzle Attempt, lifecycle rules, configuration and V1 defaults — is
defined in `specs/domain/tactical-training.md`; the evidence and
adaptation notes are in `specs/research/cycle-training.md`.

- **No FSRS implementation is used in V1.** No scheduler library is a
  V1 dependency and no general scheduling framework is built.
- The Puzzle model must not carry scheduling state (no `due`,
  `stability`, interval). Attempt/cycle history is recorded so a future
  scheduler can be layered on without changing the puzzle model.

## Rationale

- Puzzles come from the user's own mistakes; cycling through the same
  fixed set targets pattern recognition for exactly the ideas missed.
- Fixed-set cycles make progress measurable within a bounded, comparable
  workload (accuracy, time, hints, retries are comparable across cycles
  over the same puzzles).
- Simpler and more transparent than an individual scheduling algorithm
  at this stage; no algorithm dependency needing puzzle-specific tuning.
- Naturally supports the accuracy and speed measurements the product
  wants to show.

## Alternatives considered

- **FSRS / individual spaced repetition** — proven for flashcards,
  layerable later, but requires scheduling state and tuning before V1
  data exists. Rejected for V1.
- **Simple fixed intervals** — no improvement signal, still per-puzzle
  state. Rejected.
- **Random puzzle repetition** — no fixed set, no structured progress.
  Rejected.
- **Woodpecker-style cycle training** — repeated passes over a fixed set
  with measured outcomes; configurable rather than bound to one
  protocol. Chosen.

## Consequences

- Simpler V1: deterministic in-domain cycle logic, no scheduler
  dependency (see `ARCHITECTURE.md` §2).
- Strong cycle-level analytics (Feature 014) and dashboard surfaces
  (Feature 015).
- Fixed training sets; no per-puzzle "next review" concept in V1.
- FSRS-only settings (retention, interval modifiers, stability/
  difficulty tuning) are not introduced; cycle configuration is defined
  in `specs/domain/tactical-training.md` and Feature 013.
- A future individual scheduler remains possible without data migration
  (immutable Puzzle + attempt/cycle history).

## Sources

- `specs/PRODUCT.md` §11
- `specs/ARCHITECTURE.md` §2, §7
- `specs/domain/tactical-training.md`
- `specs/research/cycle-training.md`
- `specs/features/013-tactical-training-cycles.md`
- `history/ADR-007`, `history/ADR-011`, `history/ADR-021`,
  `history/ADR-022` (superseded)
