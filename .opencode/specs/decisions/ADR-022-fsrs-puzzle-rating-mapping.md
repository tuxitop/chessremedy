# ADR-022: FSRS Puzzle Rating Mapping

## Status

Accepted

## Decision

V1 maps the four ChessRemedy puzzle-review outcomes to the four
`ts-fsrs` ratings as follows:

| FSRS Rating | ts-fsrs Value | ChessRemedy outcome                                                       |
|-------------|---------------|---------------------------------------------------------------------------|
| Again       | `1`           | Incorrect move played, puzzle not solved                                 |
| Hard        | `2`           | Solved correctly, but a hint or a retry was used, or > 1 incorrect attempt |
| Good        | `3`           | Solved correctly on the first attempt without using any hint              |
| Easy        | `4`           | Solved correctly on the first attempt, no hint, response time below the user's configured "fast" threshold |

A puzzle that is **abandoned** (returned without attempting a final
solution) is recorded as `Again` for FSRS purposes.

A puzzle that is **skipped from the queue without interaction** does
not produce a review event and therefore does not update FSRS state.
The puzzle remains due and is rescheduled.

## Reasons

- The four FSRS ratings are designed for flashcards where the learner
  reports self-assessed difficulty. Mapping ChessRemedy's objective
  outcomes (solved / not solved / hints used / response time) onto
  those four buckets produces a smooth schedule without inventing a
  custom scheduler.
- "Again" must always mean "the user did not solve the puzzle". A
  partial correct sequence that fails before the tactical objective is
  resolved counts as Again.
- "Easy" must be reachable but earned, not the default. A response-time
  threshold prevents trivially-easy puzzles from accumulating low
  retention estimates.
- Skipping from the queue without interaction is not a learning event.
  Treating it as a failure would distort the schedule.

## Configurable thresholds

The "fast" response-time threshold that separates `Good` from `Easy`
is a user setting. Its default is **30 seconds** per puzzle.

The "hard" thresholds (hint used, retry used, more than one incorrect
attempt) are defined here as policy and are not user-configurable in
V1.

## Consequences

- Feature 012 (Puzzle Training) and Feature 013 (Spaced Repetition) must
  agree on the per-outcome counts recorded in `ReviewLog`:
  `attempts`, `hintsUsed`, `responseTimeMs`, `solved`.
- The spaced-repetition service computes the FSRS rating from the
  outcome + recorded metadata at the moment the puzzle is marked
  complete.
- Future iterations may add a fifth rating (e.g., "Hesitated" between
  Hard and Good). Adding a fifth rating is a content change, not a
  scheduling change, because `ts-fsrs` supports an extensible rating
  enum.

## Sources

- `specs/research/fsrs-implementation.md` (Open Question 2)
- `specs/PRODUCT.md` §11
- `specs/ARCHITECTURE.md` §3 (Domain)
- ADR-011 (FSRS Implementation)
- ADR-021 (FSRS Fuzz Policy)
