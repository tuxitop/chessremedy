# ADR-012: Stockfish WASM Build

## Status

Accepted

## Decision

Use `stockfish` (nmrugg/stockfish.js) 18.x with progressive
enhancement for browser-based analysis.

Default build: `stockfish-18-lite-single.wasm` (~7 MB).
Enhanced build: `stockfish-18-lite.wasm` (~7 MB, multi-threaded).
Optional build: `stockfish-18.wasm` (~100 MB, full strength).

## Reasons

- Tracks official Stockfish releases (currently Stockfish 18).
- Chess.com sponsored, ensuring long-term maintenance.
- Full UCI protocol support: MultiPV, WDL, Hash, Threads, stop.
- Single-threaded build requires no SharedArrayBuffer and works on
  iOS Safari 16+ without COOP/COEP headers.
- Multi-threaded build available when COOP/COEP headers are present.
- 27k weekly npm downloads (most popular Stockfish WASM package).
- GPLv3 license.

## Consequences

- Default to single-threaded lite build for maximum mobile
  compatibility. Detect SharedArrayBuffer at runtime and upgrade
  to multi-threaded build when available.
- Full-strength build (~100 MB) is optional and slow to load.
  Use only for deep puzzle verification if the lite build proves
  insufficient.
- WASM and JS files are placed in `public/stockfish/`. Loaded via
  `new Worker(new URL('/stockfish/stockfish-18-lite-single.js',
  import.meta.url))`.
- Engine service must support loading different WASM builds based
  on browser capability detection.
- Hash size capped at 64 MB on mobile, 256 MB on desktop.
- Analysis profiles map directly to UCI option configurations:

  | Profile | Depth | Hash | MultiPV |
  |---------|-------|------|---------|
  | Fast Bulk | 10 | 16 MB | 1 |
  | Normal | 20 | 64 MB | 1 |
  | Tactical | 22 | 128 MB | 5 |
  | Deep Verify | 30 | 256 MB | 3 |

## Version strategy

Pin to `stockfish@18.x` for V1. Track Stockfish major versions
(19, 20...) for upgrades. Test new versions before upgrading.

## Source

`specs/research/browser-stockfish.md`
