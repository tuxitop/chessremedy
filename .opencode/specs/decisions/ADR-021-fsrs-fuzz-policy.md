# ADR-021: FSRS Fuzz Policy

## Status

Superseded by ADR-031.

## Decision

~~V1 enables FSRS fuzz (`enable_fuzz: true`) on the `ts-fsrs`
scheduler for all ChessRemedy puzzle scheduling.~~

V1 has no scheduler and no fuzz policy. Puzzle repetition is organized
by cycle training, not by algorithmically scheduled intervals.

## Reasons

~~- Without fuzz, batches of puzzles scheduled together produce
  synchronized review spikes: a user who completes 20 puzzles in one
  session will be reminded of all 20 on the same future day, which
  makes the due queue noisy and unpleasant to use.
- `ts-fsrs` ships fuzz support out of the box (`enable_fuzz`), backed
  by the same fsrs-rs project that defines the FSRS algorithm.
- The jitter magnitude (≈ ±5 %) is invisible to users in practice and
  does not change the long-term retention characteristics of the
  schedule.
- ADR-011 already commits to `ts-fsrs` 5.x; fuzz is a parameter on
  that library, not a new dependency.~~

The "no synchronized review spikes" concern is specific to individual
scheduling; if a scheduler is added in the future, its fuzz/jitter
policy must be re-decided at that time.

## Supersession note

ADR-031 replaces this decision. See ADR-031 (Alternatives considered)
for why individual scheduling is deferred.

## Sources

- `specs/research/fsrs-implementation.md` (Open Question 4)
- ADR-011 (FSRS Implementation)
- ADR-022 (FSRS Puzzle Rating Mapping)
