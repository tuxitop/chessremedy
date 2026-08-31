# ADR-023: Move Classification Thresholds

## Status

Accepted

## Decision

V1 classifies every analyzed move into one of:

- `best`
- `good`
- `inaccuracy`
- `mistake`
- `blunder`

using a **WDL-derived `wpLoss` (win-percentage loss) metric** as the
primary signal, with a centipawn fallback for analyses produced by
the `fast` profile (which has `wdl: null`).

The thresholds are:

| Category     | Condition                                                      |
|--------------|----------------------------------------------------------------|
| `best`       | `playedMove == bestMove`                                       |
| `good`       | `wpLoss < 2`                                                   |
| `inaccuracy` | `2 ≤ wpLoss < 10`                                              |
| `mistake`    | `10 ≤ wpLoss < 20`                                             |
| `blunder`    | `wpLoss ≥ 20`                                                  |

Special cases override the table:

- **Mate sign flip.** A position-before non-mating, position-after
  mating against the mover (`evalMate` flips to a negative mate
  distance from the side-to-move perspective) is always `blunder`.
- **Forced move.** A move with `legalMovesCount == 1` cannot exceed
  `mistake` (a "forced blunder" is meaningless because the player
  had no choice).
- **Best-move tie.** If `evalCpBestDelta ≤ 5 cp` (multiple moves
  within 5 cp of the engine's top choice) and the played move is
  one of them, the move is `good`, not `best`.

`wpLoss` is computed from the centipawn evaluation via the Lichess
logistic curve (`winPercent(cp) = 50 + 50 * (2 / (1 + exp(-0.00368208
* cp)) - 1)`) and clamped to `[0, 100]`. `evalMate` is treated as
`cp = ±10000` for this conversion.

When `wdl` is `null` (the `fast` profile), the classifier falls
back to scaled centipawn loss and uses the Chess.com phase-dependent
thresholds:

| Phase        | Inaccuracy | Mistake | Blunder |
|--------------|-----------:|--------:|--------:|
| Opening      |       50   |    100  |    200  |
| Middlegame   |       80   |    150  |    300  |
| Endgame      |       50   |    100  |    200  |

The classification algorithm carries a `classificationVersion`
field on every output record. The initial V1 version is `1`. Any
change to the algorithm or thresholds increments the version
(ARCHITECTURE.md §9).

## Reasons

- Raw centipawn loss under-weights endgames and ignores mating
  sequences. The WDL-based `wpLoss` metric is unitless and handles
  both gracefully (`specs/research/move-classification.md`).
- The Lichess `wpLoss` thresholds (2 / 10 / 20) are derived from the
  inverse of Lichess' published accuracy curve and are empirically
  the most defensible thresholds in current chess analysis tooling.
- The Chess.com centipawn fallback keeps the classifier usable on
  the cheap `fast` profile that does not emit WDL.
- The special cases (mate flip, forced move, best-move tie) cover
  the three highest-impact false-positive / false-negative cases
  observed in published classification systems.

## Consequences

- Every `MoveAnalysis` produced by the `normal`, `tactical` or
  `deep` profile carries `wdl` (ADR-019) and can be classified by
  the primary WDL path.
- Every `MoveAnalysis` produced by the `fast` profile is
  classified by the centipawn fallback. Statistics that aggregate
  across profiles must distinguish them (or only include WDL-
  classified moves).
- The `missedTactic: boolean` flag is set by Feature 009
  independently of the classification. It is *not* a replacement
  classification.
- Phase-dependent fallback thresholds are documented here. They
  are *not* applied to the WDL path; the WDL path is phase-
  invariant by design.

## Sources

- `specs/domain/classification.md`
- `specs/research/move-classification.md`
- `specs/research/move-accuracy.md`
- `specs/research/tactical-detection.md`
- ADR-005, ADR-019, ADR-020
