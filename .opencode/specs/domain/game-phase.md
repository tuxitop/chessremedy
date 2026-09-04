# Game Phase

Canonical per-position game-phase rule for ChessRemedy. Feature 008
assigns a phase to every analyzed move/position while producing
`MoveAnalysis`; ADR-023's `fast`-profile fallback, statistics
(Feature 014) and the dashboard (Feature 015) consume the persisted
phase. No feature defines its own phase algorithm.

## Values

- `opening`
- `middlegame`
- `endgame`

## Rule (V1)

Deterministic, evaluated from the position's move number (full moves,
counting from move 1) and the material on the board:

| Phase      | Condition                                                              |
|------------|------------------------------------------------------------------------|
| Opening    | `moveNumber ≤ 12` (first 12 full moves)                                |
| Middlegame | After the opening, while either side has `≥ 4` minor pieces or `≥ 1` queen |
| Endgame    | Both sides have `≤ 3` minor pieces and no queen                          |

The phase is recorded per analyzed move; the opening boundary uses the
full-move count of the position being classified.

## Versioning

The phase rule is deterministic and versioned for reproducibility. If
the rule changes, a `gamePhaseVersion` increments and stored records
retain their original value (ARCHITECTURE.md §9 conventions).
