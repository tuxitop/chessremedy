# Move Classification Research

## Question

How should ChessRemedy classify each analyzed move into one of:

- good
- inaccuracy
- mistake
- blunder

and how should it identify **missed tactical opportunities** as a
separate classification attribute?

## Sources

1. Lichess blog post on accuracy and classification
   (<https://lichess.org/page/accuracy>).
2. Lichess source — `lila/modules/analyse/src/main/Accuracy.scala`,
   thresholds and edge cases.
3. Chess.com "Game Review" article documenting centipawn thresholds per
   phase (<https://www.chess.com/article/view/chess-com-accuracy>).
4. ChessBase / Frederic Friedel, "What is a blunder?" (2014) — the
   classic "200 cp = blunder" heuristic, and its limitations.
5. Regnier (2014), "Measuring Chess Players' Decision Making Accuracy".
6. `specs/research/move-accuracy.md` (per-move WP-loss function).
7. `specs/research/tactical-detection.md` (the tactical-opportunity
   flag, defined separately).
8. ADR-005, ADR-013, ADR-019, ADR-020 — pre-committed constraints.

## Findings

### 1. Why raw centipawn loss is insufficient

`specs/domain/classification.md` and ADR-005 require the classifier to
be contextual. Three reasons dominate:

1. **Endgame under-weighting.** A 200 cp swing in an equal K+Q vs K
   endgame is already lost; the same swing in a 6-piece middlegame may
   still be defendable. Pure CPL under-penalises endgames.
2. **Mating-line blind spot.** A move that walks into mate (`evalMate
   = -N`) is far worse than the cp number suggests. `evalCp` collapses
   in the presence of mate.
3. **Position context.** A 150 cp swing from a clearly won position
   may not change the outcome; the same swing from a balanced
   position may lose the game.

The chosen unit for classification is therefore the same `wpLoss` (win
percentage loss) used by `move-accuracy.md`. It already encodes
endgame scaling, mate-distance, and position context.

### 2. Lichess' published thresholds (win percentage loss)

Lichess does not publish exact centipawn thresholds; what it does
publish (blog + source) is the per-move accuracy curve, from which the
buckets can be derived:

| Classification | wpLoss (percentage points) | Notes                                |
|----------------|--------------------------:|--------------------------------------|
| Best move      |                       0   | `wpLoss == 0` AND `playedMove == bestMove` |
| Good           |                     ≤ 2   | Below this the curve is essentially flat at 100 % |
| Inaccuracy     |                  2 – 10  | Lichess bands "inaccuracy" at ~2-10 wpLoss |
| Mistake        |                 10 – 20  | A clear error that swings the position |
| Blunder        |                    > 20  | A decisive error: usually a piece or worse |

These bands are extracted from the inverse of the Lichess accuracy
curve (`accuracy = 103.1668 * exp(-0.04354 * wpLoss) - 3.1669`):

- `wpLoss = 2` → accuracy ≈ 96.5 (the "good / inaccuracy" crossover
  Lichess uses for colour-coding the move marker)
- `wpLoss = 10` → accuracy ≈ 67.7 (the "inaccuracy / mistake"
  crossover)
- `wpLoss = 20` → accuracy ≈ 36.4 (the "mistake / blunder" crossover)

The numeric thresholds themselves are not magic; they are the result
of fitting the curve and the Lichess UI's qualitative labelling.

### 3. Chess.com's published thresholds (centipawn, phase-dependent)

Chess.com's classification is documented in centipawn units, with
phase-dependent thresholds:

| Phase        | Inaccuracy | Mistake | Blunder |
|--------------|-----------:|--------:|--------:|
| Opening      |       50   |    100  |    200  |
| Middlegame   |       80   |    150  |    300  |
| Endgame      |       50   |    100  |    200  |

These are guidelines published in the Chess.com help centre and
confirmed by independent observation of reviewed games. They are not
subject to phase weighting inside the classifier (only thresholds
change).

### 4. Synthesizing the V1 classifier

Two reasonable models exist. V1 picks the **WDL-based** model because:

- ADR-005 commits ChessRemedy to contextual classification.
- ADR-019 makes `wdl` available on every `MoveAnalysis` produced by
  `normal`, `tactical`, and `deep` profiles.
- The WDL model is unitless and therefore immune to phase scaling
  bugs.
- It agrees qualitatively with the Chess.com centipawn model for
  most positions and disagrees only at the endgame boundary — where
  the centipawn model is empirically wrong.

### 5. Proposed V1 thresholds

The V1 classifier maps `wpLoss` (percentage points, derived from
ADR-019 WDL) to a category as follows:

| Category   | Condition                                              |
|------------|--------------------------------------------------------|
| `best`     | `playedMove == bestMove`                               |
| `good`     | `wpLoss < 2`                                           |
| `inaccuracy` | `2 ≤ wpLoss < 10`                                    |
| `mistake`  | `10 ≤ wpLoss < 20`                                     |
| `blunder`  | `wpLoss ≥ 20`                                          |

Special cases:

- **`evalMate` change of sign.** If the position before the move is
  not mate and the position after the move *is* mate against the
  player (`evalMate` flips to a negative mate distance from the
  side-to-move perspective), the move is classified as `blunder`
  regardless of `wpLoss`.
- **Forced moves.** If `legalMovesCount == 1`, the move is `good`
  unless `wpLoss ≥ 20`, in which case `mistake` is the worst
  classification reachable (a "forced blunder"). A forced move cannot
  be a `blunder` in V1 because the player had no choice.
- **Best-move tie.** If multiple moves are within `evalCpBestDelta
  ≤ 5 cp` of the engine's top choice (a "best-move tie"), and the
  played move is one of them, the move is `good` (not `best`), even
  if it is not literally the engine's first choice. This avoids
  penalising the player for engine multi-PV noise.

### 6. Missed tactical opportunities

A *missed tactical opportunity* is defined separately
(`specs/domain/tactics.md`, `specs/research/tactical-detection.md`).
For classification purposes:

- The `MoveAnalysis` record carries a `missedTactic: boolean` flag
  populated by Feature 009.
- If `missedTactic == true`, the move's classification is **not**
  downgraded (a missed tactic may already be a `blunder` or
  `mistake`); the flag is an additional attribute, not a replacement
  classification.
- `puzzleId` on the move links the missed tactic to its corresponding
  puzzle candidate.

### 7. Game phase tagging

Game phase is recorded per analyzed move (`specs/domain/analysis-
model.md`). The classifier does not use phase to change thresholds —
the WDL model handles phase implicitly. Phase is reported alongside
classification in the statistics layer.

Phase definitions for V1:

| Phase      | Condition (counts in plies from move 1)                              |
|------------|----------------------------------------------------------------------|
| Opening    | `moveNumber ≤ 12` (first 12 full moves)                              |
| Middlegame | After opening, while either side has ≥ 4 minor pieces or ≥ 1 queen  |
| Endgame    | Both sides have ≤ 3 minor pieces and no queen                        |

These thresholds are an implementation decision; they may be tuned
once V1 has analyzed games to compare against.

### 8. Determinism and versioning

The classifier must be deterministic for identical
`(evalCpBefore, evalCpAfter, bestMove, playedMove, legalMovesCount,
wdlBefore, wdlAfter)` inputs. The WDL inputs are nullable; if `wdl` is
`null` (the `fast` profile), the classifier falls back to scaled
centipawn loss (`cp * materialScale`) with the Chess.com thresholds.

The classifier carries a `classificationVersion` field on every output
record. The version is a monotonic integer; bumping the algorithm or
thresholds increments the version. Stored records retain their
original version (ADR-020 + ARCHITECTURE.md §9).

### 9. Worked example

Position: equal middlegame, `evalCpBefore = +30`, `evalCpAfter = -120`,
`bestMove = Nxd5`, `playedMove = Bxe6?`, `wpBefore = 53`,
`wpAfter = 38`, `legalMovesCount = 28`, `evalMate = null`.

- `wpLoss = 53 - 38 = 15` → `mistake` (10–20 band).
- `playedMove != bestMove` → not `best`.
- `legalMovesCount > 1` → not forced.
- No mate change → no special-case override.

Final classification: `mistake`. Missed-tactic flag set separately by
Feature 009.

### 10. Edge cases and what V1 does not classify

The classifier does not assign a category to:

- Book moves (where the engine's evaluation may be unreliable due to
  hash-table noise). V1 keeps book moves as `good` and tags them with
  `inBook: true` for the statistics layer.
- Positions under time-forfeit (the game ends before the analysis job
  finishes; the analysis is `cancelled` and no classification is
  emitted).

## Limitations

- The Lichess curve is empirically fitted, not theoretically
  derived. Thresholds may need re-tuning after V1 collects a corpus
  of analysed games.
- Forcing detection (`legalMovesCount == 1`) requires pre-computed
  move lists. The engine service must emit them on every analysis
  job that goes through the classifier; this is a small additional
  cost (one extra `go` query is not needed; the move list can be
  derived from the existing analysis by replaying the engine's
  dests).
- The "missed tactical opportunity" flag is owned by Feature 009 and
  cannot be set until Feature 009 is implemented. Until then,
  `missedTactic` defaults to `false`.

## Recommendation

Adopt the WDL-based `wpLoss` classifier with the five thresholds
above as the V1 classification algorithm. Persist a
`classificationVersion` on every output. See ADR-023 (Move
Classification Thresholds).

## Sources

- `specs/PRODUCT.md` §5 (Move Classification)
- `specs/ARCHITECTURE.md` §9 (Versioning)
- `specs/domain/analysis-model.md`
- `specs/domain/classification.md`
- `specs/domain/tactics.md`
- `specs/research/move-accuracy.md`
- `specs/research/tactical-detection.md`
- ADR-005 (Analysis and Move Classification)
- ADR-013 (Time Control Categories)
- ADR-019 (WDL Storage)
- ADR-020 (Engine Version Upgrade Policy)
