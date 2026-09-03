# ADR-022: FSRS Puzzle Rating Mapping

## Status

Superseded by ADR-031.

## Decision

~~V1 maps the four ChessRemedy puzzle-review outcomes to the four
`ts-fsrs` ratings.~~

V1 records puzzle outcomes directly (per attempt and aggregated per
cycle) instead of mapping them onto an FSRS rating scale. A mapping to
individual-scheduler ratings is only relevant if a scheduler is added
in the future.

The outcome categories recorded per puzzle attempt in V1 are defined in
`specs/domain/tactical-training.md`:

| V1 outcome (per attempt) | Meaning                                                            |
|--------------------------|--------------------------------------------------------------------|
| solvedFirstTry           | Solved on the first attempt without a hint                          |
| solvedWithHelp           | Solved, but a hint was used and/or the user needed a retry          |
| failed                   | Not solved when the attempt ended                                   |
| skipped                  | Left the puzzle without solving it (no result)                      |

An **abandoned** puzzle/cycle is recorded separately from a **failed**
one so that later analytics can distinguish "attempted and missed" from
"never attempted".

## Reasons

~~- The four FSRS ratings are designed for flashcards where the learner
  reports self-assessed difficulty. Mapping ChessRemedy's objective
  outcomes (solved / not solved / hints used / response time) onto
  those four buckets produces a smooth schedule without inventing a
  custom scheduler.
- "Again" must always mean "the user did not solve the puzzle".
- "Easy" must be reachable but earned, not the default.
- Skipping from the queue without interaction is not a learning event.~~

The product measures cycle-level improvement directly from outcomes,
times, hints and retries; translating outcomes into a hidden rating
scale adds indirection and is unnecessary until an individual scheduler
exists.

## Supersession note

ADR-031 replaces this decision. The earlier outcome-to-FSRS-rating
table (Again/Hard/Good/Easy with the 30-second "fast" threshold) is
retained only as historical context inside
`specs/research/fsrs-implementation.md` (Open Question 2) and must not
be treated as a V1 requirement.

## Sources

- `specs/research/fsrs-implementation.md` (Open Question 2)
- ADR-031 (Cycle-Based Tactical Training)
