# Move Classification

Canonical move-classification rules for ChessRemedy. Feature 008 applies
this algorithm while producing `MoveAnalysis`; Features 009/010/014
consume the persisted results. Feature 008 never invents separate
thresholds, and no later feature defines these rules.

## Categories

Every analyzed non-book move is classified into exactly one of:

- best
- good
- inaccuracy
- mistake
- blunder

Book moves (engine evaluation unreliable — hash-table noise) are tagged
`good` with `inBook: true` for the statistics layer.

## Primary rule (WDL path)

Uses the WDL-derived `wpLoss` metric:

| Category     | Condition                                                      |
|--------------|----------------------------------------------------------------|
| `best`       | `playedMove == bestMove`                                       |
| `good`       | `wpLoss < 2`                                                   |
| `inaccuracy` | `2 ≤ wpLoss < 10`                                              |
| `mistake`    | `10 ≤ wpLoss < 20`                                             |
| `blunder`    | `wpLoss ≥ 20`                                                  |

`wpLoss = wpBefore − wpAfter(playedMove)`, derived from centipawns via
the Lichess logistic curve and clamped to `[0, 100]`; `evalMate` is
treated as `cp = ±10000`. Threshold values and their rationale are
recorded in ADR-023 (single source of truth for the numbers).

Special cases override the table:

- **Mate sign flip** (non-mating before → mating against the mover
  after): always `blunder`.
- **Forced move** (`legalMovesCount == 1`): cannot exceed `mistake`.
- **Best-move tie** (played move within `≤ 5 cp` of the engine's top
  choice): `good`, not `best`.

## Centipawn fallback (fast profile)

Analyses from the `fast` profile carry `wdl: null` (ADR-019). Those
records fall back to scaled centipawn loss with the Chess.com
phase-dependent thresholds, using the canonical game phase
(`specs/domain/game-phase.md`):

| Phase      | Inaccuracy | Mistake | Blunder |
|------------|-----------:|--------:|--------:|
| Opening    |       50   |   100   |   200   |
| Middlegame |       80   |   150   |   300   |
| Endgame    |       50   |   100   |   200   |

Aggregates must distinguish WDL-classified moves from
fallback-classified moves (ADR-023).

## Missed tactical opportunities

`missedTactic` is **not** a classification category and does not replace
one. It is a separate boolean attribute on `MoveAnalysis`, reserved in
the schema from Feature 008 onward and populated by Feature 010
(tactical detection, ADR-026) from the persisted analysis — a move may
carry `missedTactic: true` while also being `blunder`/`mistake`.

## Determinism and versioning

Classification must be deterministic for a fixed input tuple
`(evalCpBefore, evalCpAfter, bestMove, playedMove, legalMovesCount,
wdlBefore, wdlAfter, phase, inBook)`. Every output record carries a
`classificationVersion` (initial V1 value `1`); any algorithm/threshold
change increments it and stored records retain their original version
(ADR-020, ARCHITECTURE.md §9).
