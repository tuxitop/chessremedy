# Feature 008 — Move Classification

## Goal

Classify analyzed moves.

## Categories

- best
- good
- inaccuracy
- mistake
- blunder

Also identify potential missed tactical opportunities (the
`missedTactic` flag; see Feature 009).

## Requirements

Use the approved methodology in:

- `specs/domain/classification.md`
- `specs/research/move-classification.md`
- ADR-023 (Move Classification Thresholds)

## Acceptance Criteria

Classification is deterministic for identical versioned analysis.

Classification version is stored.
