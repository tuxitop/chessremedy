# ADR-002: Chessboard Library

## Status

Accepted

## Decision

Use:

`@lichess-org/chessground` (10.x — the exact version pin is governed by
ADR-014 and `AGENTS.md` "Mandatory chessboard dependency").

## Reasons

ChessRemedy requires:

- responsive board interaction
- arrows
- highlights
- touch support
- orientation
- board interaction suitable for training

## Constraint

Do not replace the library without a new ADR. Chessground must be used
through a reusable wrapper component, not scattered through the UI
(`ARCHITECTURE.md` §4).
