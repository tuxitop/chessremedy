# ADR-005: Analysis and Move Classification

## Status

Accepted

## Decision

ChessRemedy will use contextual engine analysis rather than a single
centipawn-loss threshold.

Classification considers:

- evaluation change
- WDL where useful
- position context
- forcing moves
- tactical opportunities
- game phase
- time-control context

## Reason

Raw centipawn loss does not adequately distinguish all meaningful chess errors.

The detailed methodology belongs in `specs/domain/classification.md`.
