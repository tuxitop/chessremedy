# ADR-012: Stockfish WASM Build

## Status

Accepted

## Decision

ChessRemedy uses the `stockfish` npm package (nmrugg/stockfish.js)
with progressive enhancement for browser-based analysis.

Exact npm version follows the **Dependency policy in `AGENTS.md`**
(latest stable by default). The underlying Stockfish chess engine
release is tracked independently of the npm version and is reported
in `engineVersion` on every analysis record (per ARCHITECTURE.md §9
and ADR-020).

Default build: `{stockfishVersion}-lite-single.wasm` (~7 MB).
Enhanced build: `{stockfishVersion}-lite.wasm` (~7 MB, multi-threaded).
Optional build: `{stockfishVersion}.wasm` (~100 MB, full strength).

The actual file names are resolved at install time from the published
package; the WASM/JS pair is loaded via:

```ts
new Worker(
  new URL(`/stockfish/stockfish-{stockfishVersion}-lite-single.js`,
    import.meta.url),
);
```

## Reasons

- Tracks official Stockfish releases, is Chess.com-sponsored for
  long-term maintenance, and has the highest weekly download volume of
  the Stockfish WASM packages.
- Full UCI protocol support (MultiPV, WDL, Hash, Threads, stop); the
  single-threaded lite build requires no SharedArrayBuffer and runs on
  iOS Safari 16+ without COOP/COEP headers, while the multi-threaded
  build is available when those headers are present.
- GPLv3 license.

Full evaluation: `specs/research/browser-stockfish.md`.

## Consequences

- Default to single-threaded lite build for maximum mobile
  compatibility. Detect SharedArrayBuffer at runtime and upgrade to
  the multi-threaded build when available.
- Full-strength build (~100 MB) is optional and slow to load. Use
  only for deep puzzle verification if the lite build proves
  insufficient.
- WASM and JS files are placed in `public/stockfish/` at install
  time. The exact path includes the resolved Stockfish version; the
  engine service reads the version from the package and constructs
  the URL.
- Engine service must support loading different WASM builds based
  on browser capability detection.
- Hash size capped at 64 MB on mobile, 256 MB on desktop.
- **Thread cap.** The global engine thread budget is
  `B = canMultiThread ? max(1, min(hardwareConcurrency, MAX_THREADS_CAP)) : 1`,
  with `MAX_THREADS_CAP = 8`. The hard ceiling is 8 rather than the
  previous 2 so multi-core desktops can use the engine fully, while
  staying bounded: the `lite` build's hash (128 MB for `tactical`,
  64 MB for `normal`) is shared across threads and every extra thread
  costs memory and CPU, so an unbounded `hardwareConcurrency` is never
  requested. The `Threads` UCI option is set **only on the
  multi-threaded `lite` build**; `lite-single` (no cross-origin
  isolation, no `SharedArrayBuffer`) always uses exactly 1 thread. The
  global budget is split across engine instances (ADR-034): the
  verification engine uses 1 thread, so the analysis engine's
  user-selectable cap is `max(1, B - 1)` and the two engines never run
  at maximum together.
- **Profile depth is a default.** The `tactical` profile's depth (22)
  is the default for the user-tunable Feature-010 verification depth
  (ADR-026); MultiPV, hash and WDL remain profile-authoritative.
- Analysis profiles map directly to UCI option configurations:

  | Profile        | Depth | Hash   | MultiPV |
  |----------------|-------|--------|---------|
  | Fast Bulk      | 10    | 16 MB  | 1       |
  | Normal         | 20    | 64 MB  | 1       |
  | Tactical       | 22    | 128 MB | 5       |
  | Deep Verify    | 30    | 256 MB | 3       |

## Source

`specs/research/browser-stockfish.md`
