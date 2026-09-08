# Tactical Detection Research

## Question

How can ChessRemedy detect **missed tactical opportunities** in
analyzed games — positions where the player had a forcing
continuation that produced a meaningful tactical objective but did
not find it?

## Sources

1. Stockfish wiki, "MultiPV and Tactical Detection" — the canonical
   use of MultiPV > 1 for finding hidden resources.
2. Lichess puzzle generator source
   (`lila/modules/puzzle/src/main/PuzzleGenerator.scala`).
3. ChessBase "Finding missed tactics" articles (Markus Gatter).
4. Regan, "Detecting Tactic Misses in Human Play" — academic
   treatment of tactical blindness.
5. `specs/research/browser-stockfish.md` (UCI options, profile
   definitions).
6. `specs/research/puzzle-generation.md` (downstream consumer).
7. ADR-005, ADR-006, ADR-012, ADR-018, ADR-019, ADR-020.

**Plan-013 algorithm sources (provenance).** The position-centric
Stage-1 model and the Stage-2 unicity threshold port the candidate
rules of the open-source generators below. These repos are used as
**references only** (facts and thresholds are not copyrightable
expression; the re-implementation in `src/domain/tactics/` is
original and none of their code is vendored):

- `ornicar/lichess-puzzler` (AGPL-3.0): candidate keying on the eval
  swing of the move just played, both-sides scanning, mate handling
  and the "winning move beats the second move by ≥ 0.7 win-chance"
  unicity gate.
- `JakimPL/Chess-Tactic-Finder` (no license — reference only, do not
  copy): per-ply tactic search with solver/defender variation trees;
  rejected for V1 cost (one MultiPV-5 engine search per ply).
- `vitogit/pgn-tactics-generator` (MIT): cheap swing prefilter then
  best-move-clarity rejection.

ChessRemedy's own product choice keeps the mined tactics **on the
user's turns only** and V1 stays **missed-only** (the user's own
successful tactics are a recorded Feature-011 follow-up, not built
here).

## Findings

### 1. Definition (V1)

A **missed tactical opportunity** at ply *p* is a position where:

1. The position is reachable by legal play.
2. There exists a forcing move `t` (a check, a capture, or a
   direct threat against a hanging piece) from the side to move at
   ply *p* that, after a short forced sequence, achieves one of the
   `specs/PRODUCT.md` §8 tactical objectives (winning material,
   forcing mate, obtaining a decisive advantage, or neutralizing a
   tactical threat).
3. The player did not play `t`.
4. The tactical objective is **not trivially achievable** by any
   alternative move at the same ply (otherwise the position was
   not a "miss" — the player could have reached the same outcome
   another way).

The output is a `puzzleCandidate` linked to the source game.

### 2. The signal: MultiPV divergence

Tactical opportunities are characterised by **divergence between
the engine's top line and the user's move**. Concretely, when the
engine reports:

- `evalCpBest` (after the best move) is significantly better than
  `evalCpAfterUserMove`, AND
- `bestMove != playedMove`, AND
- the best line is short (≤ 8 plies) and forcing (≥ 70 % of the
  moves in the best line are checks or captures), THEN
- the position is a candidate.

This is the standard approach used by Lichess and by Stockfish
tutorial trainers.

### 3. Two-stage pipeline

Per ADR-005 / ADR-006 / `specs/features/010-tactical-detection.md`,
tactical detection has two stages:

**Stage 1 — Candidate generation** (Feature 010, runs on every
analyzed game).

Stage 1 v2 (plan 013) is **position-centric**: it keys on positions
where a tactic was *available on the user's turn*, not only on user
errors. The model ports the lichess-puzzler generator's candidate
method (position keying + unicity, see §5; `ornicar/lichess-puzzler`
is AGPL-3.0 — used as a **reference only**; its method and thresholds
are re-implemented, none of its code is vendored). For each analyzed
user ply *p*:

1. Read `MoveAnalysis[p]` from the bulk analysis (Feature 008) and the
   opponent's immediately-previous ply `MoveAnalysis[p − 1]`.
2. Compute `wpLoss = wpBefore - wpAfterUserMove` (see
   `move-accuracy.md`).
3. Emit a raw candidate when `playedMove != bestMove` (the position is
   not a book position and both evaluations exist) and **any** of:
   - `wpLoss ≥ 5` (the ADR-023 inaccuracy band; today's rule);
   - the opponent's previous ply **conceded a swing** to the user —
     its own mover-perspective win-% dropped ≥ 25 points (≈ 0.25
     win-chance), so a tactic was available that a quiet reply failed
     to punish;
   - the user's `evalBefore` was **already decisive** — a user forced
     mate within 8 plies or a user-perspective edge ≥ +300 cp — so
     the best (mate/forcing) move was missed even though the played
     move kept a decent evaluation;
   - a **quiet / small-loss miss**: `wpLoss` in `[1, 5)` and the
     engine's best first move is forcing (a check or a capture).
4. Tag each candidate with `sourceGameId`, `sourcePly`, `startingFen`,
   `bestMove`, `bestPv`, `wpLoss`, `evalCpBefore`, `evalCpAfterUserMove`
   and `candidateGenerationVersion`.

The emitted set is **capped per game** (`MAX_CANDIDATES_PER_GAME = 16`)
and ordered by the swing magnitude (biggest first) so the verification
pass always finishes in bounded engine time and verifies the biggest
moments first.

This is the cheap "first pass" filter. It runs over the existing
bulk analysis with no new engine work; most raw candidates are not
actually tactical (the engine's best line may be a quiet
improvement), so they still need Stage-2 filtering.

**Stage 2 — Verification** (Feature 010, on each raw candidate).

For each raw candidate:

1. Run a `tactical`-profile analysis (ADR-012: depth 22, MultiPV 5,
   128 MB hash, WDL on) from the *starting position* — that is,
   the position before the user's move, with the side to move
   restored. This produces the canonical best line and any
   alternative lines.
2. For each candidate move in the MultiPV result, walk the engine's
   principal variation until either:
   - the tactical objective is reached,
   - or the depth exceeds 8 plies,
   - or the position stabilises (no checks, no captures, evalCp
     delta < 30 over two consecutive plies).

   From `detectionVersion` 8 the stabilisation stop is **narrowly
   relaxed** — it does not truncate the material-retention scan when the
   mover had already captured before the quiet pair. The exact rule is
   guard 1 in §5 (single source).
3. Classify the tactical objective:
   - `winning_material` if material delta from start to end of the
     line ≥ 2 (in piece-value units, queen = 9; owner decision — a
     won exchange/quiet fork that nets two points is a genuine miss).
   - `forcing_mate` if `evalMate != null` and mate distance ≤ 8 at
     the end of the line.
   - `decisive_advantage` if `|wpEnd - wpStart| ≥ 30` and not
     winning material or mate.
   - `neutralizing_threat` if the position before the user's move
     had a forced loss against the player and the tactical move
     removes it.
4. Reject the candidate if:
   - no candidate move achieves a tactical objective,
   - or the tactical objective is trivially reachable by a
     non-forcing move (the "alternative-move" check; see §5),
   - or the WDL at the end of the line does not match the
     objective,
   - or the line requires > 8 plies.

A candidate that survives all four checks is a **verified
candidate**. It is handed off to Feature 011 (puzzle generation),
which extends it with alternatives, opponent responses, difficulty
and persistence.

### 4. Forcingness metric

The pipeline uses a **forcingness** metric to distinguish "true
tactics" from "quiet improvements" (positional improvements that
do not have a forcing continuation). For a candidate line of
length `L` plies:

```text
forcingness = (checks + captures) / (2 * L)
```

clamped to `[0, 1]`. The line is "forcing" if `forcingness ≥ 0.5`,
i.e. at least half the plies are checks or captures. This is
slightly stricter than Lichess' default (≥ 0.4) and intentionally
so — we only want to ship puzzles that *train* tactics, not quiet
positional improvements.

### 5. False-positive guards

Stage 2 rejects a raw candidate when (guards run in this order):

1. **No candidate move reaches an objective** (`no-objective` /
   `>8-plies`) — the best line may be a quiet improvement. From
   `detectionVersion` 8 the stabilisation stop is relaxed **narrowly**
   (plan 14 §B1): when the mover had already captured at or before a quiet
   defender pair, material retention is scanned across the full ≤8-ply
   window, so a fork/pin whose gain is collected a couple of plies after a
   quiet reply still verifies (`winning_material`). Purely quiet lines keep
   the strict stop.
2. **An alternative first move reaches the same objective** by a
   non-forcing line (`non-forcing-alternative-reaches-objective`) —
   the "only one good move" guard.
3. **The end WDL contradicts the objective** (`wdl-inconsistent`). From
   `detectionVersion` 8 the veto applies only to objectives claimed at the
   engine line's terminal prefix; an interior-prefix retained
   `winning_material` (line continues past the tactic) is not vetoed by a
   terminal WDL that reflects an already-lost surrounding game.

There is **no unicity / "best-move-not-unique" guard** (the plan-013 W2
gate was removed in `detectionVersion` 7): a tactic the user missed is a
miss even when a second move is nearly as good. Near-equal alternatives
only raise the ADR-025 difficulty input and join the accepted solving
moves.

The ADR-025 difficulty estimate is computed and persisted on every
verified candidate (Feature-011 follow-up) but is **not** a rejection
floor for detection (`detectionVersion` 5): a tactic the user genuinely
missed surfaces however easy a puzzle it would make. Puzzle-quality
thresholding (if any) belongs to Feature 011 when it builds training
puzzles.

The older accuracy-phrased wording ("require an alternative to score
≥ 80 % of the best move") is superseded by the guards above.

Two further V1 scope notes: **non-forcing tactical themes** (zugzwang,
positional sacrifices) stay outside the `missedTactic` flag because they
are not detectable as forcing misses, and the number of engine searches
per game is bounded by the Stage-1 candidate cap (`MAX_CANDIDATES_PER_GAME`
= 16) so long scans stay resumable and cancellable.

### 6. Engine profile and depth

- Stage 1 (candidate generation) consumes the existing bulk
  analysis from Feature 008. No additional engine work is needed
  for the first pass — every blunder/mistake from the user's games
  is already in `MoveAnalysis[]`.
- Stage 2 (verification) requires a fresh engine run at the
  `tactical` profile (ADR-012). This is the most expensive
  operation in the pipeline.

Total engine work per missed tactic: one `tactical`-profile analysis
of the starting position. At depth 22, MultiPV 5, this is ~10–30
seconds per candidate on a desktop and ~30–90 seconds on a phone.

A future iteration may use the `fast` profile as a pre-filter
("is there *any* candidate line that achieves a tactical objective
at depth 14?") before committing to the full tactical profile. V1
does not implement this optimisation.

### 7. Caching and re-use

- Stage 1 does not require new engine work; it reads from
  `MoveAnalysis[]`.
- Stage 2 is exactly the kind of position-keyed analysis that the
  ADR-018 cache is designed for. The starting FEN, profile
  (`tactical`), engine name/version/build form the cache key. If
  the cache hits, no engine work is done.

### 8. Edge cases

- **Game-end positions.** Skip the candidate if the position is
  terminal (mate, stalemate, no legal moves). The classifier will
  already have flagged this as `best` for the final move if it
  delivers mate.
- **Book positions.** Skip the candidate if `inBook == true` on
  the previous move. Engines are noisy in the opening; missed
  tactics in book positions are not training material.
- **Three-fold repetition / 50-move rule draws.** Skip the
  candidate if the tactical line crosses a draw rule. Tactical
  puzzles must lead to a concrete outcome, not a drawn line.

### 9. What this does NOT detect (V1 limitations)

- **Positional sacrifices** (a non-forcing exchange that creates a
  long-term advantage). Detection requires deeper positional
  evaluation than V1 supports.
- **Defensive tactics** where the user is being attacked and has a
  forcing resource to escape. These are detected only if the user's
  resource produces a `neutralizing_threat` outcome from a candidate
  emitted by the Stage-1 rules (the inaccuracy band, a conceded
  swing, or a decisive/mate position); quiet defensive only-moves
  below those triggers are not flagged.
- **Tactics requiring > 8 plies.** Capped by the verification
  stage.
- **Transpositions.** A tactic reachable by a different move order
  is treated as a separate puzzle (per the V1 dedup rule in
  `puzzle-generation.md` §7).

### 10. Output schema

A verified tactical candidate is persisted with:

```ts
{
  id: string,
  sourceGameId: string,
  sourcePly: number,
  startingFen: string,
  userMovePlayed: string,
  bestMove: string,
  bestPv: string[],            // SAN or UCI; V1 uses UCI
  tacticalObjective: 'winning_material'
                     | 'forcing_mate'
                     | 'decisive_advantage'
                     | 'neutralizing_threat',
  candidateSolutionLength: number,
  verificationMetadata: {
    engineName: string,
    engineVersion: string,
    engineBuild: string,
    analysisVersion: number,
    verificationDepth: number,
    verificationTimestamp: number,
    wdlAfterBestLine: Wdl | null,
  },
  detectionVersion: number,
  createdAt: number,
}
```

The `puzzleId` is added by Feature 011 when the candidate is
extended into a full puzzle.

## Limitations

- The pipeline is biased toward *forcing* tactics. Quiet
  improvements are excluded by design.
- The 8-ply cap and the difficulty-≥-15 cap will silently drop
  legitimate but hard-to-classify missed tactics. They will still
  be classified as `mistake` / `blunder` by Feature 009; only the
  missed-tactic flag is dropped.
- The `tactical`-profile depth (22) is sufficient for most
  tactical vision at human level but may miss deep positional
  sacrifices. The `deep`-profile verification step
  (`puzzle-generation.md` §6) catches most of these.

## Recommendation

Implement the V1 tactical-detection pipeline as described. Pair it
with the puzzle-generation pipeline in Feature 011. Persist the
detection version on every candidate so the pipeline is
reproducible across engine upgrades (ADR-020). See ADR-026 (Tactical
Verification Pipeline).

## Sources

- `specs/PRODUCT.md` §5, §8
- `specs/ARCHITECTURE.md` §6
- `specs/domain/tactics.md`
- `specs/domain/analysis-model.md`
- `specs/research/move-classification.md`
- `specs/research/puzzle-generation.md`
- `specs/research/browser-stockfish.md`
- ADR-005, ADR-006, ADR-012, ADR-018, ADR-019, ADR-020
