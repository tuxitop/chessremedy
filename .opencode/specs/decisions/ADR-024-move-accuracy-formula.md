# ADR-024: Move Accuracy Formula

## Status

Accepted

## Decision

V1 computes per-move and per-game accuracy using the **Lichess
accuracy formula**, derived from the centipawn evaluation through a
logistic win-percentage curve.

### Per-move accuracy

```text
winPercent(cp) = 50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)

wpLoss         = clamp(0, 100, winPercent(evalCpBefore) - winPercent(evalCpAfterMove))

accuracy       = clamp(0, 100,
                  103.1668 * exp(-0.04354 * wpLoss) - 3.1669)
```

- `evalCpBefore` and `evalCpAfterMove` are side-to-move centipawn
  evaluations.
- When `evalMate != null`, treat `cp = +10000` for a mate for the
  mover or `cp = -10000` for mate against the mover. This makes
  mating sequences register as `wpLoss = 100` and accuracy 0.
- The formula is identical for `wdl != null` and `wdl == null`,
  because the formula uses only `evalCp`. WDL is consumed by
  classification (ADR-023), not by accuracy.

### Game-level accuracy

Per-game accuracy is the **unweighted arithmetic mean** of the
player's per-move accuracies within that game. Book moves and
moves without an analysis record are excluded from the average.

### Aggregate accuracy across games

When the statistics layer combines multiple games into a single
accuracy number, it uses a **move-weighted mean**:

```text
aggregateAccuracy = sum(accuracy_i * moveCount_i)
                  / sum(moveCount_i)
```

This treats each move equally. A naive mean of per-game accuracy
treats each game equally and overweights short games; the move-
weighted mean is the documented behaviour of the Lichess "Accuracy"
display and is adopted here.

## Reasons

- The Lichess formula is the only published, crowdsourced accuracy
  metric in widespread use. Its constants are fitted, not guessed,
  and produce results that agree with player intuition.
- It is engine-independent: any centipawn-producing engine can
  compute it. ChessRemedy's adoption does not lock the project to
  Stockfish beyond the existing ADR-012 pin.
- It composes with ADR-023 (classification): both metrics use the
  same `wpLoss`/centipawn inputs, so the statistics layer can
  produce consistent accuracy + classification displays from a
  single pipeline.

## Consequences

- Accuracy is always reported alongside its sample size
  (`n = <moveCount>` or `n = <gameCount>`). Per `specs/domain/
  statistics.md`, aggregates below the V1 minimum sample size of
  5 must be replaced with an "insufficient data" placeholder.
- Aggregates must respect `specs/AGENTS.md` separation rules:
  accuracy for bullet, blitz, rapid and classical must be reported
  as separate series. Mixed-platform or mixed-time-control views
  must be explicitly labeled and are never the default.
- A future change to the accuracy constants must bump the
  `accuracyVersion` field on every stored accuracy aggregate, and
  must be recorded in a new ADR. (V1 starts at version 1.)
- Book moves and the first 8 plies of any opening are excluded
  from the average; this is configurable but defaults to "exclude
  book moves" because engine noise in the opening distorts accuracy.

## Sources

- `specs/PRODUCT.md` §12 (Dashboard)
- `specs/ARCHITECTURE.md` §6a (Analytics Layer)
- `specs/domain/statistics.md`
- `specs/research/move-accuracy.md`
- ADR-013, ADR-023
