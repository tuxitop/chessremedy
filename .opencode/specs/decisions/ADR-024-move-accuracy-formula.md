# ADR-024: Move Accuracy Formula

## Status

Accepted — **revised (V2)** 2026-09-06 after Lichess-source verification
(commit 5013970). Prior text claimed per-game accuracy is the unweighted
arithmetic mean "of the Lichess Accuracy display"; Lichess's actual per-game
figure is a volatility-weighted/harmonic blend (see below) and the cp input
is clamped to ±1000. Both are corrected here.

## Decision

V1 computes per-move and per-game accuracy following Lichess
(`modules/analyse/src/main/AccuracyPercent.scala`, `scalachess eval.scala`),
derived from the centipawn evaluation through a logistic win-percentage curve.

### Per-move accuracy

```text
winPercent(cp) = 50 + 50 * (2 / (1 + exp(-0.00368208 * clamp(cp, ±1000))) - 1)

wpLoss         = clamp(0, 100, winPercent(evalCpBefore) - winPercent(evalCpAfterMove))

accuracy       = 100                                       if wpLoss == 0
              = clamp(0, 100,
                  103.1668100711649 * exp(-0.04354415386753951 * wpLoss)
                    - 3.166924740191411 + 1)               otherwise
```

- `evalCpBefore` and `evalCpAfterMove` are side-to-move centipawn
  evaluations. cp is clamped to **±1000** before the logistic
  (`Eval.Cp.CEILING`), so a mate behaves like ±1000.
- The `+1` is Lichess's "uncertainty bonus (due to imperfect analysis)".
- The formula is identical for `wdl != null` and `wdl == null`, because it
  uses only `evalCp`. WDL is consumed by classification (ADR-023), not by
  accuracy.

### Game-level accuracy

Per-game accuracy is **Lichess's `gameAccuracy`**, not the arithmetic mean:
the **mean of the volatility-weighted mean and the harmonic mean** of the
player's per-move accuracies.

```text
windowSize  = clamp(floor(plies / 10), 2, 8)
weight(ply) = clamp(stddev(Win% over ply's window), 0.5, 12)   // no weight when stddev == 0
volatilityWeightedMean = Σ(accuracyᵢ · weightᵢ) / Σ(weightᵢ)
harmonicMean           = n / Σ(1 / accuracyᵢ)
gameAccuracy           = (volatilityWeightedMean + harmonicMean) / 2
```

A move that swings the evaluation sharply (a big `wpLoss`) sits in a volatile
window and therefore dominates the weighted mean, matching Lichess's
"accuracy over a volatile game is driven by the critical moves". When no
window has volatility, ChessRemedy falls back to the harmonic mean alone
(Lichess returns no value in that case); a normal analysed game always has
volatility.

### Aggregate accuracy across games

When the statistics layer combines multiple games into a single accuracy
number, it uses a **move-weighted mean**:

```text
aggregateAccuracy = sum(accuracy_i * moveCount_i) / sum(moveCount_i)
```

This treats each move equally (Feature 014, unchanged).

## Reasons

- The Lichess method is the only published, crowdsourced accuracy metric in
  widespread use; its constants are fitted, not guessed, and its per-game
  blend is what Lichess actually displays. V1 reproduces it so ChessRemedy's
  per-game accuracy matches the reference the user sees on lichess.org.
- It is engine-independent: any centipawn-producing engine can compute it.
- It composes with ADR-023 (classification): both metrics use the same
  `wpLoss`/centipawn inputs, so the statistics layer can produce consistent
  accuracy + classification displays from a single pipeline.

## Consequences

- Accuracy is always reported alongside its sample size (`n = <moveCount>` or
  `n = <gameCount>`). Per `specs/domain/statistics.md`, aggregates below the
  V1 minimum sample size of 5 must be replaced with an "insufficient data"
  placeholder.
- Aggregates must respect `specs/AGENTS.md` separation rules: accuracy for
  bullet, blitz, rapid and classical must be reported as separate series.
  Mixed-platform or mixed-time-control views must be explicitly labeled and
  are never the default.
- A future change to the accuracy constants/algorithm must bump the
  `accuracyVersion` field on every stored accuracy aggregate and be recorded
  in a new ADR. **V2** is the current version
  (`MOVE_ACCURACY_VERSION = 2`).
- Book moves and the first 8 plies of any opening are excluded from the
  average; this is configurable but defaults to "exclude book moves" because
  engine noise in the opening distorts accuracy. (V1 stores no book tags, so
  this is inert today.)

## Sources

- Lichess source: `modules/analyse/src/main/AccuracyPercent.scala` (commit
  5013970); `scalachess/core/src/main/scala/eval.scala` (`WinPercent`,
  `Eval.Cp.CEILING`); lichess.org/page/accuracy.
- `specs/domain/statistics.md`
- `specs/research/move-accuracy.md`
- ADR-013, ADR-019, ADR-023
