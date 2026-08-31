# ADR-004: Local Stockfish

## Status

Accepted

## Decision

Run Stockfish WASM locally in Web Workers.

## Reasons

- offline analysis
- privacy
- no server cost
- user-controlled analysis
- scalable local computation

## Requirements

The engine service must support configurable analysis profiles and must not
block the main UI thread.
