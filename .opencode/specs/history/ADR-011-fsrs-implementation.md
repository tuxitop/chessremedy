# ADR-011: FSRS Implementation

## Status

Superseded by ADR-031.

## Decision

~~ChessRemedy V1 uses `ts-fsrs` for puzzle scheduling.~~

No FSRS library is used in V1. Puzzle training uses deterministic
cycle-based domain logic with no scheduler dependency.

## Reasons

~~- Most complete API surface: `repeat()` for previewing all rating
  outcomes, `next()` for applying ratings, `get_retrievability()`
  for retention metrics, `rollback()`, `forget()`, and `reschedule()`
  for history import and corrections.
- `afterHandler` parameter enables efficient one-pass conversion
  of Card objects to IndexedDB-storable timestamps.
- Pure TypeScript with zero runtime dependencies. No Node-only
  imports. Official browser example provided.
- All Card and ReviewLog types are serializable plain objects.
  Storage-agnostic: no coupling to any persistence layer.
- MIT license.
- Implements the current FSRS algorithm. Default parameters work
  well without requiring user-specific optimization.
- Backed by the open-spaced-repetition organization.~~

V1 requires no scheduler library. The `ts-fsrs` evaluation recorded in
`specs/research/fsrs-implementation.md` is retained for a future
individual-puzzle scheduler and is not a V1 decision.

## Supersession note

ADR-031 replaces this decision. If a future scheduler is introduced,
its implementation choice must be re-evaluated against the latest
stable candidates at that time (see the Dependency policy in
`AGENTS.md`); ADR-011 is not resurrected by reference.

## Source

`specs/research/fsrs-implementation.md`
