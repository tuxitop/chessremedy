# ADR-003: Chess State Management

## Status

Superseded by ADR-028.

## Decision

~~Use `chess.js` for chess rules and legal move/state management.~~

Chessground is presentation/interaction infrastructure.

## Reason

Separating chess correctness from board rendering keeps domain logic
testable and prevents UI-specific chess logic.

## Supersession note

ADR-028 replaces this decision with `chessops@^0.15.1`. See ADR-028
for the rationale (PGN tree support, license alignment with
ChessRemedy's GPL-3.0-or-later posture, immutable API, no
chess.js ↔ chessops adapter required).
