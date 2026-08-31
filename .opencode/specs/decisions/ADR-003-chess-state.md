# ADR-003: Chess State Management

## Status

Accepted

## Decision

Use `chess.js` for chess rules and legal move/state management.

Chessground is presentation/interaction infrastructure.

## Reason

Separating chess correctness from board rendering keeps domain logic
testable and prevents UI-specific chess logic.
