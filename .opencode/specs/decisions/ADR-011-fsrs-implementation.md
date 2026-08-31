# ADR-011: FSRS Implementation

## Status

Accepted

## Decision

Use ts-fsrs 5.x for ChessRemedy V1 puzzle scheduling.

## Reasons

- Most complete API surface: `repeat()` for previewing all rating
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
- 93k weekly npm downloads, 769 GitHub stars, 74 published versions.
- Backed by the open-spaced-repetition organization.
- Implements FSRS v6 (latest algorithm). Default parameters work
  well without user-specific optimization.

## Consequences

- Requires a thin adapter between ts-fsrs Card objects (which use
  `Date` instances) and IndexedDB storage (which uses timestamps).
- Default v6 parameters are used initially. Personalized tuning
  requires accumulated review data and is a future iteration.
- `enable_fuzz` should be enabled to prevent synchronized review
  spikes when many puzzles are scheduled together.
- Bundle contribution is less than 5 kB gzipped.

## Why not the alternatives

- @squeakyrobot/fsrs: Too new (v1.0.0, 3 stars). Missing rollback,
  forget, reschedule helpers. Not listed in awesome-fsrs.
- fsrs-browser: 378 kB WASM binary unjustified for scheduler-only
  use. BSD-3-Clause license differs from ChessRemedy's MIT.

## Source

`specs/research/fsrs-implementation.md`
