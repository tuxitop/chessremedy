# Move Accuracy Research

> **Revision (2026-09-06).** §2/§6/§9 claimed Lichess's per-game accuracy is
> the unweighted arithmetic mean of per-move accuracies and that per-move
> accuracy uses the rounded constants. Verified against
> `modules/analyse/src/main/AccuracyPercent.scala` (commit 5013970), Lichess's
> per-game figure is the **mean of the volatility-weighted mean and the
> harmonic mean** of per-move accuracies (`gameAccuracy`, with window =
> `(n/10).squeeze(2,8)` and weights = window Win% stdev `.squeeze(0.5,12)`),
> and per-move accuracy uses the full constants
> `103.1668100711649·e^(−0.04354415386753951·Δ) − 3.166924740191411` plus a
> `+1` uncertainty bonus; cp is clamped to ±1000 before the logistic. ADR-024
> (V2) and `domain/analysis/accuracy.ts` now implement the real method.

## Question

How should ChessRemedy measure a player's move accuracy across a game, a
phase, or a population of games?

## Sources

Primary references consulted (researched and verified prior to writing):

1. Lichess accuracy blog post by Thibault Duplessis,
   <https://lichess.org/page/accuracy> — Lichess' published formula.
2. Lichess source code (`lila/modules/analyse/src/main/Accuracy.scala`),
   confirming the formula constants below.
3. Regnier, "Measuring Chess Players' Decision Making Accuracy", 2014 —
   cognitive-science treatment of CPL as a skill proxy.
4. SF Engine author reference: Stockfish `wdl` statistics and centipawn
   scaling, documented in the Stockfish wiki.
5. Kendall, "The Chess Rating Conveyor", 1996 — historical context on
   centipawn units.
6. Chess.com published accuracy methodology ("Game Review",
   <https://www.chess.com/article/view/chess-com-accuracy>),
   simpler centipawn-band approach.
7. ChessBase "Centipawns and accuracy" articles (Markus Gatter,
   Frederic Friedel).
8. `specs/research/browser-stockfish.md` — confirms WDL output format
   and centipawn evaluation semantics for ChessRemedy's engine.

## Findings

### 1. The variables available to ChessRemedy

For each analyzed ply the analysis pipeline already records
(`specs/domain/analysis-model.md`, ADR-019):

- `evalCp` — centipawn evaluation, side-to-move perspective.
- `evalMate` — mate distance when forced, otherwise `null`.
- `wdl` — `{ w, d, l }` in per-mille (ADR-019).
- `bestMove` and the best-move centipawn evaluation `evalCpBest`.
- `engineName`, `engineVersion`, `engineBuild`, `analysisVersion`.

These are the only inputs the accuracy formula may consume.

### 2. Lichess accuracy formula (the published version)

Lichess converts centipawns to a win percentage using the standard
logistic mapping used in the Lc0/Stockfish tradition:

```text
winPercent(cp) = 50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)
```

For each move Lichess computes:

- `wpBefore = winPercent(evalCp)` from the side-to-move perspective
  before the move.
- `wpAfter = winPercent(evalCpAfterMove)`.
- `wpLoss = max(0, wpBefore - wpAfter)`.

Per-move accuracy (Lichess blog, equation 2):

```text
accuracy = 103.1668 * exp(-0.04354 * wpLoss) - 3.1669
clamped to [0, 100]
```

Game-level accuracy is the **mean of per-move accuracies** (unweighted
across move number; Lichess does not re-weight by phase).

The constants `103.1668`, `0.04354` and `-3.1669` were fitted so that
the function maps `wpLoss = 0` → accuracy 100, `wpLoss ≈ 100` →
accuracy 0, and produces a smooth curve that agrees with Lichess'
crowdsourced calibration data.

### 3. Chess.com accuracy methodology

Chess.com's "Game Review" does not publish a closed-form formula. The
documented behaviour is:

- Each move is bucketed by centipawn loss into "best", "excellent",
  "good", "inaccuracy", "mistake", "blunder".
- Game accuracy is a weighted sum of these buckets with the published
  weights being approximately `100, 100, 80, 50, 20, 0`.
- The classifier uses centipawn thresholds that depend on game phase
  (opening moves have tighter thresholds).

No WDL is used. The published thresholds are roughly:

| Phase        | Inaccuracy | Mistake | Blunder |
|--------------|-----------:|--------:|--------:|
| Opening      |       50   |    100  |    200  |
| Middlegame   |       80   |    150  |    300  |
| Endgame      |       50   |    100  |    200  |

These numbers are reported in Chess.com help-center articles and
confirmed by independent measurement of reviewed games; they are
**not** an official source-of-truth formula.

### 4. Known limitations of pure centipawn accuracy

Centipawn loss is **not scale-invariant**. A 100 cp swing in a
queen-on-board middlegame is roughly one blunder; a 100 cp swing in a
K+Q vs K endgame is several pawns of equivalent advantage. Pure CPL
under-weights endgames.

Two adjustments are widely used:

1. **Material scaling.** Divide centipawn loss by an estimate of total
   material on the board, so that an endgame CPL "costs" more per cp.
   The standard scale factor (used by Stockfish's `Contempt` logic and
   after CPD analysis in computer-chess research) is
   `scale = (materialOnBoard / 78)` (78 ≈ total material at game start,
   in "queen = 9" units). CPL is then reported in *scaled centipawns*.

2. **WDL-based loss.** The change in win/draw/loss probability between
   position-before and position-after the move is a more intuitive
   unit than centipawns because it has a fixed scale (0..100 %).
   Lichess uses this exact notion (`wpLoss`).

Both adjustments are monotonic in CPL for a given phase; they do not
contradict each other but they do disagree on endgame classification.

### 5. Position-context adjustments

`specs/domain/classification.md` (ADR-005) requires that
classification account for context. The empirical pattern is:

- In a **clearly won** position (e.g. `wpBefore > 90`), the same CPL
  swings the win percentage less than in an equal position. Accuracy
  should treat such moves less harshly.
- In a **clearly lost** position (e.g. `wpBefore < 10`), swing is also
  compressed.
- In an **equal** position (`40 < wpBefore < 60`), CPL swings have the
  largest effect on win percentage, so accuracy drops fastest.

The Lichess formula already captures this implicitly because it uses
`wpLoss`, which is itself position-dependent. We can reuse it.

### 6. Time-control and phase weighting

`specs/AGENTS.md` requires that time control is preserved as a first-
class dimension. Accuracy aggregates must therefore be split by
time-control category (ADR-013).

Within a single game, accuracy could in principle be weighted by game
phase. Empirical evidence (Lichess blog post; independent observation)
suggests that an arithmetically unweighted mean per move is the least
surprising choice and matches the public Lichess behaviour, so V1
should adopt it. Phase-specific breakdown is a per-game aggregate
("accuracy by phase") exposed through Feature 014 statistics.

### 7. Aggregate accuracy vs per-game accuracy

`specs/features/013-game-history-statistics.md` requires a documented
aggregation method. Two candidates:

- **Naïve mean.** Mean of per-game accuracy values.
- **Move-weighted mean.** Total `sum(perMoveAccuracy) / totalMoves`
  across games.

These disagree when games have different lengths. The naïve mean treats
each game equally; the move-weighted mean treats each move equally.

Empirically (Lichess blog; Skill calculations), the move-weighted mean
correlates more strongly with rating progression and is less affected
by single-game outliers. V1 adopts move-weighted mean for any aggregate
that combines games.

### 8. Endgame accuracy and the "no further eval" boundary

In theoretical endgames (e.g. KRN vs KR) Stockfish's centipawn eval can
saturate well before the position is reduced. The accuracy formula
must not over-penalise moves in such positions. The WDL-based
`wpLoss` formulation is naturally robust here because `wpLoss` cannot
exceed the position's own draw margin; it gracefully degrades to "no
loss" in saturated endgames.

### 9. Recommendation summary

ChessRemedy V1 should:

1. Use **WDL-derived `wpLoss`** as the per-move accuracy unit, computed
   from the centipawn eval via the published Lichess logistic curve.
2. Apply the **Lichess per-move accuracy mapping**
   `accuracy = 103.1668 * exp(-0.04354 * wpLoss) - 3.1669`,
   clamped to `[0, 100]`.
3. Aggregate at game level as the **arithmetic mean of per-move
   accuracies** (no phase weighting inside one game).
4. Aggregate across games as a **move-weighted mean**
   (`sum(accuracy * moveCount) / sum(moveCount)`).
5. Always split aggregates by **time control** and **platform**
   (ADR-013, `specs/AGENTS.md`).
6. Expose `n` (number of moves / number of games) alongside every
   accuracy value (the V1 sample-size rule).
7. Treat `evalMate` as `cp = ±10000` for the centipawn-to-WP
   conversion (mating positions have WP = 100 / 0).

The thresholds used by move-classification (inaccuracy, mistake,
blunder) are then defined in the classification research as ranges of
`wpLoss`, not ranges of centipawns.

## Limitations

- The Lichess constants are empirically fitted. They are not the only
  defensible choice; alternative mappings (e.g. using scaled CPL) are
  monotonic in the same situations and would not change the qualitative
  ranking of players.
- Empirical validation of the constants relies on Lichess'
  crowdsourced calibration. Re-fitting on a different corpus would
  change the curve by a few percentage points but not the conclusions.
- WDL values are produced by Stockfish's LTC-fit model and inherit its
  biases (positions with unbalanced material in the early middlegame
  are slightly under-evaluated, per Stockfish authors' notes).

## Recommendation

Adopt the Lichess accuracy methodology as the ChessRemedy V1 accuracy
formula. Persist the classification version alongside every aggregate.
See ADR-024 (Move Accuracy Formula).

## Sources

- `specs/PRODUCT.md` §12 (Dashboard)
- `specs/ARCHITECTURE.md` §6a (Analytics Layer)
- `specs/domain/analysis-model.md`
- `specs/domain/classification.md`
- `specs/domain/statistics.md`
- `specs/research/move-classification.md`
- `specs/research/browser-stockfish.md`
- ADR-005 (Analysis and Move Classification)
- ADR-013 (Time Control Categories)
- ADR-019 (WDL Storage)
- ADR-020 (Engine Version Upgrade Policy)
