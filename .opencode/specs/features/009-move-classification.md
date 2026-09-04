# Feature 009 — Move Classification (post-008 tooling)

## Goal

Provide classification **presentation and accuracy tooling** over the
analyses that Feature 008 persists. Feature 009 runs after Feature 008
and never gates it.

The canonical classifier is a chess-domain rule (implemented as a
domain function) that Feature 008 applies while producing `MoveAnalysis`
records (ADR-023, `specs/domain/classification.md`). Feature 009 does
**not** define or duplicate the classification algorithm, and Feature
008 does **not** depend on Feature 009.

## Scope

- Glyph rendering utilities (ADR-023 `?? ? ?! ! !!`) consumed by Game
  Review polish and Live Analysis preview.
- Per-move / per-game accuracy (ADR-024) computed from persisted
  `MoveAnalysis` records.
- Classification summary/count helpers used by review UI and statistics
  (Features 008/014).
- Deterministic fixtures and tests over persisted analyses.

Missed tactical opportunities remain the separate `missedTactic`
attribute on `MoveAnalysis`, owned by Feature 010.

## Categories

Consumed (never re-defined): `best`, `good`, `inaccuracy`, `mistake`,
`blunder`.

## Acceptance Criteria

Glyph/accuracy helpers produce the same results as Feature 008's
persisted classifications for identical records.

Classification version is preserved from the persisted records.

All tooling is deterministic over persisted `MoveAnalysis` fixtures.

---

## Context

Required reading (see `.opencode/CONTEXT-MAP.md`):

- Architecture/decisions: `decisions/ADR-005`, `decisions/ADR-019`,
  `decisions/ADR-023`, `decisions/ADR-024`, `decisions/ADR-026`
- Domain: `domain/classification.md`, `domain/analysis-model.md`,
  `domain/game-phase.md`
- Research: `research/move-classification.md`,
  `research/move-accuracy.md`

Feature dependencies: Feature 008 (persisted `MoveAnalysis[]` input).
Output consumed by Features 008 (review polish)/014/015.
