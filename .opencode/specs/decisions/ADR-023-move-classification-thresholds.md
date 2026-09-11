# ADR-023: Move Classification Thresholds

## Status

Accepted — **revised (V2)** 2026-09-06 after Lichess-source verification
(commit 5013970). Prior text derived bands 2/10/20 by inverting the accuracy
curve; that was not Lichess's published behaviour and over-produced
inaccuracies while under-producing blunders. The reasons for the V1 decision
(use a win-percentage-loss signal, not raw centipawns) are unchanged.
**Amended 2026-09-11 — missed-tactic exclusivity (see below).**

## Decision

V1 classifies every analyzed move into one of:

- `best`
- `good`
- `inaccuracy`
- `mistake`
- `blunder`

using a **win-percentage-loss (`wpLoss`) metric** derived from the centipawn
evaluation through the Lichess logistic curve, with a centipawn fallback for
analyses produced by the `fast` profile (which has `wdl: null`).

The thresholds follow Lichess (`lila` `modules/tree/src/main/Advice.scala`,
`winningChanceJudgements`), which buckets a move by the mover's
**winning-chance loss ≥ 0.10 / 0.20 / 0.30** on the `[−1, 1]` logistic scale
(win-percentage points: 5 / 10 / 15). Lichess annotates nothing below 0.10
(V1 keeps those moves as `good`):

| Category     | Condition                                                      |
|--------------|----------------------------------------------------------------|
| `best`       | `playedMove == bestMove`                                       |
| `good`       | `wpLoss < 5`                                                   |
| `inaccuracy` | `5 ≤ wpLoss < 10`                                              |
| `mistake`    | `10 ≤ wpLoss < 15`                                             |
| `blunder`    | `wpLoss ≥ 15`                                                  |

Special cases override the table:

- **Mate transitions (Lichess-faithful).** Mate scores are not run through
  the logistic. Verified against Lichess (`modules/tree/src/main/Advice.scala`
  `MateAdvice`/`MateSequence`, commit 5013970), Lichess grades mate moves
  **only** for these sign transitions between the before- and after-move
  evaluations:

  | Transition (before → after) | Lichess verdict |
  |-----------------------------|-----------------|
  | cp → Mate(neg) — `MateCreated` | `blunder`, unless before-cp ≤ −700 ⇒ `mistake`, ≤ −1000 ⇒ `inaccuracy` |
  | Mate(pos) → cp — `MateLost` | after-cp ≥ 1000 ⇒ `inaccuracy`; 701–999 ⇒ `mistake`; ≤ 700 ⇒ `blunder` |
  | Mate(pos) → Mate(neg) — `MateLost` | `blunder` |
  | mover already being mated (before Mate(neg)) | matched by **no** case — **unannotated (silent)** |

  V2 keeps ChessRemedy's existing rule for the sign flip — a
  position-before non-mating, position-after mating against the mover
  (`evalMate` flips to a negative mate distance from the side-to-move
  perspective) is always `blunder`, which matches Lichess's default
  `MateCreated` verdict. A move played while the mover is **already**
  being mated (before Mate(neg)) is matched by no Lichess case and is
  **unannotated**; ChessRemedy's classifier already matches that silence —
  mate clamps to ±1000 win%, so the best defence reads `best`/`good` (this
  was the intent of the plan's "mate while already being mated ⇒
  inaccuracy" clause, which misread the anchors and is **closed**).
- **Deferred mate anchors.** The two cp-anchor refinements above —
  `MateCreated` before-cp ≤ −700 / ≤ −1000 (mistake / inaccuracy) and
  `MateLost` residual after-cp (≥ 1000 / 701–999 / ≤ 700) — are **not**
  adopted in V2: they would change current classifications. They are
  recorded here and deferred to a potential future **`CLASSIFICATION_VERSION
  3`**; the version stays **2** until then.
- **Forced move.** A move with `legalMovesCount == 1` cannot exceed
  `mistake` (a "forced blunder" is meaningless because the player had no
  choice).
- **Best-move tie.** If `evalCpBestDelta ≤ 5 cp` (multiple moves within 5 cp
  of the engine's top choice) and the played move is one of them, the move is
  `good`, not `best`.

`wpLoss` is computed from the centipawn evaluation via the Lichess logistic
curve (`winPercent(cp) = 50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)`)
and clamped to `[0, 100]`. **cp is clamped to ±1000 before the conversion**
(`scalachess eval.scala` `Eval.Cp.CEILING`); a forced mate behaves like
±1000. `evalMate` is treated as `cp = ±10000` for raw centipawn math.

When `wdl` is `null` (the `fast` profile), the classifier falls back to
scaled centipawn loss and uses the Chess.com phase-dependent thresholds:

| Phase        | Inaccuracy | Mistake | Blunder |
|--------------|-----------:|--------:|--------:|
| Opening      |       50   |    100  |    200  |
| Middlegame   |       80   |    150  |    300  |
| Endgame      |       50   |    100  |    200  |

The classification algorithm carries a `classificationVersion` field on every
output record. **V2** is the current version (`CLASSIFICATION_VERSION = 2`).
Stored records retain their version; a completed run below the current
version reads `outdated` and is re-analyzed on request. Any change to the
algorithm or thresholds increments the version (ARCHITECTURE.md §9).

## Amendment — Missed-tactic exclusivity (2026-09-11)

A ply whose analysis carries a **current-version verified missed tactic** — a
`MoveAnalysis` with `missedTactic === true` and `detectionVersion ===
DETECTION_VERSION`, or equivalently a `verified` puzzle candidate for the same
`[analysisId, sourcePly]` at the current `DETECTION_VERSION` — is **exclusive**:
it is not additionally an `inaccuracy`, `mistake` or `blunder` for any
user-visible or derived purpose.

- The persisted `MoveAnalysis.classification` produced by this classifier is
  **retained unchanged** as raw classifier provenance. The classifier runs in
  Feature 008, before tactical detection exists, and must stay pure; the
  exclusivity is applied downstream by consumers.
- The ply's **effective classification** is the derived state
  `missedTactic` — a presentation/statistics state, **not** a sixth
  `MoveClassification` and **not** a `classificationVersion` change.
- Exactly one annotation renders: the canonical missed-tactic marker (NAG 9).
  The negative-classification glyph, colour, board chip and square highlight
  are suppressed for the ply.
- Feature-009 classification counts and Feature-014 error aggregates **exclude**
  the ply (it is counted only as a missed tactic). Feature 014's per-phase
  `userMovesInPhase`/`detectedUserMovesInPhase` move-exposure denominators keep
  the ply; only the error numerators exclude it.
- The ADR-024 accuracy formula is **not** changed by this amendment: accuracy
  stays evaluation-based and includes the ply. Accuracy is a quality metric, not
  a classification count, and making it depend on detection would require an
  ADR-024 amendment and a `MOVE_ACCURACY_VERSION` bump. *(Owner-confirmable —
  see `features/009-move-classification.md` and
  `features/014-game-history-statistics.md`; the
  alternative is to exclude the ply from the `accuracyMoves` weight.)*
- Exclusivity is gated by the Feature-010 freshness rule: a marker written by an
  older `detectionVersion` is suppressed and the ply falls back to its raw
  ADR-023 classification (and, for puzzle generation, to the Feature-011
  blunder origin if it is a blunder).
- Feature-011 puzzle generation is unchanged in row output — a current-version
  verified candidate already wins over the blunder origin by the
  `[sourceGameId, sourcePly]` natural key — but the blunder-origin input set
  now **excludes** plies owned by a current-version verified candidate, so a
  missed tactic yields exactly one puzzle and the pass settles the ply once.

This supersedes the V2 consequence statement that `missedTactic` "is *not* a
replacement classification" for the **current-version verified** case: a
verified miss now replaces the classification in every consumer.
`CLASSIFICATION_VERSION` stays **2** (the classifier algorithm and thresholds
are unchanged). Because the derived per-analysis summary and error aggregates
change, the detection pipeline bumps `DETECTION_VERSION` (10 → 11) so existing
summaries re-derive under the rule through the Feature-010 freshness gate, and
Feature 014 bumps `STATISTICS_VERSION` for the changed error-aggregation
semantics (the next value after the ADR-013 v11 time-control mapping bump; see
Feature 014 §12). `MOVE_ACCURACY_VERSION` and `PUZZLE_GENERATOR_VERSION` are
unchanged.

## Reasons

- Raw centipawn loss under-weights endgames and ignores mating sequences; the
  WDL-derived `wpLoss` metric is unitless and handles both gracefully.
- The bands now **match Lichess's actual classifier** (`Advice.scala`), the
  reference the product compares itself against. V1's 2/10/20 bands were
  invented by inverting the accuracy curve and disagreed with Lichess by a
  factor of ~2.5 at the inaccuracy floor and ~33% at the blunder floor,
  inflating inaccuracy counts and deflating blunders on real games.
- The Chess.com phase-dependent centipawn fallback keeps the classifier
  usable on the `fast` profile (which emits no WDL).
- The special cases (mate flip, forced move, best-move tie) cover the three
  highest-impact false-positive / false-negative cases observed in published
  classification systems.

## Consequences

- Every `MoveAnalysis` produced by the `normal`, `tactical` or `deep`
  profile carries `wdl` (ADR-019) and is classified by the primary WDL path.
- Every `MoveAnalysis` produced by the `fast` profile is classified by the
  centipawn fallback. Statistics that aggregate across profiles must
  distinguish them (or only include WDL-classified moves).
- The `missedTactic: boolean` flag is set by Feature 010 independently of the
  classification. It is *not* a replacement classification **except** for the
  current-version verified case defined by the amendment above, where it is
  exclusive (the raw classifier label is retained but suppressed from
  presentation and from classification/error counts).
- Changing the bands re-keys completed jobs (`outdated`), so users are
  offered a one-time re-analysis to refresh stored counts.
- Phase-dependent fallback thresholds are documented here. They are *not*
  applied to the WDL path; the WDL path is phase-invariant by design.

## Sources

- Lichess source: `modules/tree/src/main/Advice.scala` (`CpAdvice`,
  `MateAdvice`), `modules/analyse/src/main/AccuracyPercent.scala`;
  `scalachess/core/src/main/scala/eval.scala` (`WinPercent`, commit 5013970).
- `specs/domain/classification.md`
- `specs/research/move-classification.md`
- `specs/research/move-accuracy.md`
- ADR-005, ADR-019, ADR-020, ADR-024
