# ADR-011: FSRS Implementation

## Status

Accepted

## Decision

ChessRemedy V1 uses `ts-fsrs` for puzzle scheduling.

Exact version follows the **Dependency policy in `AGENTS.md`**
(latest stable by default). The `package.json` caret range and the
lockfile are the source of truth.

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
- Implements the current FSRS algorithm. Default parameters work
  well without requiring user-specific optimization.
- Backed by the open-spaced-repetition organization.

## Consequences

- Requires a thin adapter between `ts-fsrs` Card objects (which use
  `Date` instances) and IndexedDB storage (which uses timestamps).
- Default parameters are used initially. Personalized tuning requires
  accumulated review data and is a future iteration.
- `enable_fuzz` should be enabled to prevent synchronized review
  spikes when many puzzles are scheduled together (ADR-021).
- Bundle contribution is small.

## Why not the alternatives

- `@squeakyrobot/fsrs`: too new (v1.0.0 at the time of the
  research). Missing rollback, forget, reschedule helpers. Not
  listed in awesome-fsrs.
- `fsrs-browser`: large WASM binary unjustified for scheduler-only
  use. BSD-3-Clause license differs from ChessRemedy's MIT.

## Source

`specs/research/fsrs-implementation.md`
