# Feature 004 — Stockfish

## Goal

Run Stockfish locally without blocking the UI.

## Requirements

- Stockfish WASM
- Web Worker
- engine service
- job queue
- cancellation
- progress
- failure handling
- analysis profiles

Profiles:

- fast
- deep
- tactical verification

## Acceptance Criteria

A position can be analyzed without freezing the UI.

The engine can be cancelled.

The result contains engine/version metadata.
