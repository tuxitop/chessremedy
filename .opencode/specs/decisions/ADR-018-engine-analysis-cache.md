# ADR-018: Engine Analysis Cache

## Status

Accepted

## Decision

V1 persists Stockfish analysis results in a **position-keyed IndexedDB
cache** keyed by the position FEN (including side-to-move, castling
rights, en-passant square, halfmove clock and fullmove number).

The cache lives in a dedicated Dexie table (`positionAnalysisCache`,
or equivalent) with the following columns:

| Column          | Type    | Notes                                          |
|-----------------|---------|------------------------------------------------|
| `positionKey`   | string  | FEN of the position (cache primary key)        |
| `analysis`      | object  | The full MoveAnalysis / engine response        |
| `profile`       | string  | Profile used (`fast`, `normal`, `tactical`, `deep`) |
| `engineName`    | string  | e.g. `stockfish`                               |
| `engineVersion` | string  | e.g. `18.0.8`                                  |
| `engineBuild`   | string  | e.g. `stockfish-18-lite-single`                |
| `analyzedAt`    | number  | Unix epoch millis                              |

## Lookup policy

1. Before starting an analysis job, the engine service computes the
   position key from the FEN.
2. It looks up the cache for an entry whose `(positionKey, profile,
   engineName, engineVersion, engineBuild)` tuple matches exactly.
3. If a match is found and the result is still relevant (see
   invalidation below), the cached `analysis` is returned without
   contacting the worker.
4. Otherwise the job is enqueued, run, and stored on completion.

## Invalidation

Cached entries are **invalidated** when any of the following changes:

- the engine version (Stockfish major or minor version)
- the engine build (`lite-single`, `lite`, `full`)
- the analysis profile (`fast`, `normal`, `tactical`, `deep`)

Entries are **not** invalidated by analysis-version or
classification-version changes — those are pure domain transformations
applied on top of cached engine results and are themselves versioned
per ARCHITECTURE.md §9.

## Reasons

- The same position is analyzed multiple times across the lifetime of a
  game: once during initial bulk analysis (Feature 008), again during
  tactical detection (Feature 010), and again during puzzle generation
  and review.
- Stockfish WASM evaluation is the most expensive operation in
  ChessRemedy. Re-running it for an unchanged position wastes both CPU
  time and battery on mobile.
- A FEN-keyed cache is the simplest correct cache: deterministic, small
  (~1 kB per entry) and trivially debuggable.
- Versioning the cache key by `(profile, engineName, engineVersion,
  engineBuild)` preserves correctness across engine upgrades without
  requiring eager re-analysis (see ADR-020).

## Consequences

- The cache is a secondary IndexedDB table. It is treated as a
  performance optimization, not as the source of truth. The source of
  truth for completed analyses is the `analyses` table (ARCHITECTURE.md
  §7).
- On engine upgrade the existing cache rows become unreachable but are
  not automatically deleted. A migration step in Dexie may prune them
  to reclaim space.
- The cache must not be exposed in the application UI; it is an
  implementation detail of the engine service.
- Sync (Feature 016) must not sync the cache. It is derived state and
  is regenerated cheaply on each device.

## Sources

- `specs/research/browser-stockfish.md` (Open Question 3)
- `specs/ARCHITECTURE.md` §5, §7, §9
- ADR-012 (Stockfish WASM build)
- ADR-020 (Engine version upgrade policy)
