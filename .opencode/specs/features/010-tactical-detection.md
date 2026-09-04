# Feature 010 — Tactical Detection

## Goal

Identify meaningful missed tactical opportunities.

## Pipeline

Candidate generation
→ engine verification
→ tactical objective
→ candidate quality

## Requirements

Avoid simple "best move" extraction.

Support multi-move tactical sequences.

Reject weak/ambiguous candidates.

Tactical-motif labeling (forks, pins, skewers, etc.) is **not** a V1
requirement. See `specs/domain/tactics.md`.

The two-stage candidate-generation + verification pipeline is
defined in:

- `specs/research/tactical-detection.md`
- ADR-026 (Tactical Verification Pipeline)

## Game Library integration

Once games are analyzed, this feature contributes a per-game
`missedTactic` count to the Game Library insights region
(`domain/game-library.md`). Detection remains owned here; the Library
only renders the value.

## Acceptance Criteria

Verified candidates contain:

- starting position
- original move
- solution
- tactical objective
- verification metadata
- `detectionVersion`

---

## Context

Required reading (see `.opencode/CONTEXT-MAP.md`):

- Architecture/decisions: `decisions/ADR-026`, `decisions/ADR-023`,
  `decisions/ADR-025`, `decisions/ADR-012`, `decisions/ADR-018`,
  `decisions/ADR-019`, `decisions/ADR-020`
- Domain: `domain/tactics.md`, `domain/analysis-model.md`,
  `domain/puzzle-model.md`, `domain/game-library.md`
- Research: `research/tactical-detection.md`,
  `research/move-classification.md`

Feature dependencies: Features 008, 005; output consumed by Feature
011.
