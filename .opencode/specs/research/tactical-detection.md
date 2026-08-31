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

Per ADR-005 / ADR-006 / `specs/features/009-tactical-detection.md`,
tactical detection has two stages:

**Stage 1 — Candidate generation** (Feature 010, runs on every
analyzed game).

For each analyzed ply *p* in the user's games:

1. Read `MoveAnalysis[p]` from the bulk analysis (Feature 008).
2. Compute `wpLoss = wpBefore - wpAfterUserMove` (see
   `move-accuracy.md`).
3. If `wpLoss ≥ 10` (the "mistake" or worse band, per
   `move-classification.md`) AND `playedMove != bestMove`, emit a
   raw candidate tagged with:
   - `sourceGameId`
   - `sourcePly`
   - `startingFen`
   - `bestMove`, `bestPv`
   - `wpLoss`, `evalCpBefore`, `evalCpAfterUserMove`
   - `candidateGenerationVersion`

This is the cheap "first pass" filter. It runs over the existing
bulk analysis and produces raw candidates for almost every
mistake/blunder. Most of these are not actually tactical (the
engine's best line may be a quiet improvement), so they need to be
filtered.

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
3. Classify the tactical objective:
   - `winning_material` if material delta from start to end of the
     line ≥ 3 (in piece-value units, queen = 9).
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

The two largest sources of false positives in V1 are:

1. **"Best move is the only good move anyway"** — the user's move
   is not a tactical miss, just a quieter alternative that still
   loses slowly. Guard: require at least one alternative move to
   score ≥ 80 % of the best move's accuracy contribution; if no
   alternative does, the position is "only one good move" and is
   rejected.
2. **"The tactical line requires deep calculation humans cannot
   reasonably do"** — the engine finds a 7-ply tactic that no
   human would spot. Guard: difficulty score (ADR-025) must be ≥
   15 (the "easy" bucket minimum). Below this, the candidate is
   rejected. This is a quality filter, not a content filter.

A third potential issue is **non-forcing tactical themes** (zugzwang,
positional sacrifices). V1 explicitly excludes these from the
`missedTactic` flag because they are not detectable as forcing
misses. They are still classified as `mistake` or `blunder` if
their evaluation loss is large.

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
  forcing resource to escape. These are detected only if the
  classification `wpLoss ≥ 10` puts the position in the
  mistake-or-worse band AND the user's resource produces a
  `neutralizing_threat` outcome. Quiet defensive moves are not
  flagged.
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
