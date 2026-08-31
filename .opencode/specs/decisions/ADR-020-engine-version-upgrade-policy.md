# ADR-020: Engine Version Upgrade Policy

## Status

Accepted

## Decision

V1 follows a **lazy, opt-in, user-controlled re-analysis** policy when
the Stockfish engine is upgraded.

Specifically:

1. The application continues to use the currently installed engine
   version for all new and resumed analysis jobs.
2. Existing analyses persist unchanged and remain associated with the
   `engineName` / `engineVersion` / `engineBuild` that produced them.
3. The dashboard does **not** automatically re-analyze games after
   an engine upgrade.
4. The user may explicitly trigger a re-analysis of selected games or
   of all analyzed games. Re-analysis is opt-in.
5. The analysis cache (ADR-018) is keyed by engine version and build,
   so cache lookups for the old version remain valid for the lifetime
   of that version.

## Reasons

- Stockfish strength and evaluation behavior can change between minor
  versions. Existing analyses remain trustworthy for the engine that
  produced them and should not be silently invalidated.
- Re-running analysis for every game after every Stockfish release is
  impractical: a user with 10,000 analyzed games would wait hours or
  days, and the engine would monopolize the device.
- ARCHITECTURE.md §9 already requires every persisted record to carry
  the engine name, version and build, which is the prerequisite for
  lazy re-analysis.
- An opt-in re-analysis respects user intent and device capability
  (battery, time of day, etc.).

## Consequences

- Re-analysis jobs are first-class application use cases. They share
  the same engine queue, cancellation and progress semantics as
  first-time analysis (Feature 005).
- After a re-analysis completes, the older analysis version is
  retained unless the user explicitly chooses to delete it. This
  preserves the option to roll back if a newer engine version is
  later found to mis-evaluate a class of positions.
- Statistics (Feature 013) must continue to distinguish analyses by
  engine version. Aggregates that mix engine versions must be either
  hidden or explicitly labeled.

## Migration of cache entries

When the engine version changes, cache entries keyed on the previous
version remain in IndexedDB but are unreachable by the lookup policy
in ADR-018. A future Dexie migration may prune them; this is not
required for V1 correctness.

## Sources

- `specs/research/browser-stockfish.md` (Open Question 6, Version
  strategy)
- `specs/ARCHITECTURE.md` §9
- ADR-012 (Stockfish WASM build)
- ADR-018 (Engine analysis cache)
