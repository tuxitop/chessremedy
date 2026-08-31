# ADR-021: FSRS Fuzz Policy

## Status

Accepted

## Decision

V1 enables **FSRS fuzz** (`enable_fuzz: true`) on the `ts-fsrs`
scheduler for all ChessRemedy puzzle scheduling.

The fuzzy interval bounds documented in `ts-fsrs` (minimum 0.95× the
nominal interval, maximum 1.05×) are accepted as the V1 jitter band.
No custom fuzz implementation is introduced.

## Reasons

- Without fuzz, batches of puzzles scheduled together produce
  synchronized review spikes: a user who completes 20 puzzles in one
  session will be reminded of all 20 on the same future day, which
  makes the due queue noisy and unpleasant to use.
- `ts-fsrs` ships fuzz support out of the box (`enable_fuzz`), backed
  by the same fsrs-rs project that defines the FSRS algorithm.
- The jitter magnitude (≈ ±5 %) is invisible to users in practice and
  does not change the long-term retention characteristics of the
  schedule.
- ADR-011 already commits to `ts-fsrs` 5.x; fuzz is a parameter on
  that library, not a new dependency.

## Consequences

- The `fsrs` constructor in ChessRemedy must be called with
  `{ enable_fuzz: true }`.
- Tests that exercise scheduler output should allow the fuzz band
  rather than asserting on exact intervals.
- Fuzz does not change the algorithm version. Algorithm-version
  changes are tracked separately by ADR-011 and the FSRS library's
  own version field.

## Sources

- `specs/research/fsrs-implementation.md` (Open Question 4)
- `specs/ARCHITECTURE.md` §6a (analytics) and §7 (storage)
- ADR-011 (FSRS Implementation)
- ADR-022 (FSRS Puzzle Rating Mapping)
