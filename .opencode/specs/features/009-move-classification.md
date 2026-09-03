# Feature 009 — Move Classification

## Goal

Classify analyzed moves.

## Categories

- best
- good
- inaccuracy
- mistake
- blunder

Also identify potential missed tactical opportunities (the
`missedTactic` flag; see Feature 010). The `missedTactic` flag is
owned by Feature 010 (Tactical Detection).

## Requirements

Use the approved methodology in:

- `specs/domain/classification.md`
- `specs/research/move-classification.md`
- ADR-023 (Move Classification Thresholds)

## Acceptance Criteria

Classification is deterministic for identical versioned analysis.

Classification version is stored.

---

## Context

Required reading (see `.opencode/CONTEXT-MAP.md`):

- Architecture/decisions: `decisions/ADR-005`, `decisions/ADR-019`,
  `decisions/ADR-023`, `decisions/ADR-026`
- Domain: `domain/classification.md`, `domain/analysis-model.md`
- Research: `research/move-classification.md`,
  `research/move-accuracy.md`

Feature dependencies: Feature 008 (input `MoveAnalysis[]`); output
consumed by Features 008/014.
