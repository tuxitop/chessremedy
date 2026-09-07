# ADR-026: Tactical Verification Pipeline

## Status

Accepted

## Decision

V1 implements tactical detection as a **two-stage pipeline** that
runs after the per-game analysis (Feature 008) has been completed.

### Stage 1 — Candidate generation (cheap, no new engine work)

For each analyzed ply *p* in a game:

1. Read `MoveAnalysis[p]` (already produced by the bulk analysis).
2. Compute `wpLoss = wpBefore - wpAfterUserMove` (see
   `specs/research/move-classification.md`).
3. If `wpLoss ≥ 10` (mistake-or-worse band, ADR-023) AND
   `playedMove != bestMove` AND the position is not a book
   position, emit a raw `puzzleCandidate` tagged with the
   source game, ply, FEN, best move, best PV, and the metadata
   needed by Stage 2.

This stage does no new engine work — every blunder and mistake in
the user's games is already represented in `MoveAnalysis[]`.

### Stage 2 — Verification (one tactical-profile run per candidate)

For each raw candidate:

1. Look up the position-keyed analysis cache (ADR-018). If a
   `(startingFen, profile=tactical, engineName, engineVersion,
   engineBuild)` entry exists, reuse it.
2. Otherwise, run the **tactical profile** (ADR-012: depth 22,
   MultiPV 5, 128 MB hash, WDL on) from the starting position.
3. For each candidate move in the MultiPV result, walk the
   engine's principal variation until the tactical objective is
   reached, the depth exceeds 8 plies, or the position
   stabilises. Compute forcingness
   `(checks + captures) / (2 * L)` for the line.
4. Classify the tactical objective as one of `winning_material`,
   `forcing_mate`, `decisive_advantage`, `neutralizing_threat`
   per `specs/research/tactical-detection.md` §3.
5. Apply the false-positive guards:
   - Reject if no candidate move achieves a tactical objective.
   - Reject if the tactical objective is reachable by a
     non-forcing alternative (the "only one good move" guard).
   - Reject if the WDL at the end of the line does not match the
     classified objective.
   - Reject if the line requires > 8 plies.
   - Reject if the difficulty estimate (ADR-025) is below 15.

### Stage 2 fast path — verification from stored decisive analysis

A candidate whose position the game's **own stored analysis** already shows
as a decisive **forcing mate** is verified without a fresh tactical-profile
run. Because checkmate is a deterministic board-state fact, the stored best
line is authoritative when **all** of these hold (`detectionVersion` 2):

- the stored record was produced by the same engine
  (name/version/build) that would run the tactical search, at a depth
  at least `FAST_PATH_MIN_STORED_DEPTH`;
- the stored root evaluation is a mate for the mover, whose UCI mate
  value `m` implies a complete mate PV of exactly `2m − 1` plies that
  the stored best PV matches, is within the ≤ 8-ply tactic window, and
  legally walks from the candidate's starting position to checkmate
  delivered by the starting mover.

This path deliberately does **not** apply the MultiPV-dependent guards
(alternative-move reachability, difficulty floor) or the end-line WDL guard:
a full-PV board checkmate is a stronger and complete verdict, and those
guards need a fresh MultiPV/WDL search. Verification provenance records the
stored line's engine, the stored analysis's own `analysisVersion` and its
depth (never a fabricated tactical depth). Any candidate that does not meet
every condition falls back to the tactical-profile run above unchanged.

A candidate that survives all guards becomes a `puzzleCandidate`
passed to Feature 011. Unverified raw candidates are discarded
after the run.

### Output

A verified candidate is persisted with the schema defined in
`specs/research/tactical-detection.md` §10, including the engine
metadata used for verification (`engineName`, `engineVersion`,
`engineBuild`, `analysisVersion`, `verificationDepth`,
`verificationTimestamp`, `wdlAfterBestLine`).

### Failure modes

- Engine failure during Stage 2 (worker crash, network drop in
  sync context). The raw candidate is retained as
  `verificationStatus: 'failed'` and retried on the next
  verification job. Feature 011 does not see the candidate until
  verification succeeds.
- Engine-version change (ADR-020). Existing verified candidates
  remain valid for the engine that verified them. A future
  re-verification pass may upgrade them; this is opt-in, not
  automatic.

## Reasons

- The two-stage split keeps the cheap filter cheap: most analyzed
  plies never reach Stage 2 because `wpLoss < 10` already rejects the
  trivial moves.
- The tactical profile (ADR-012) is the right depth/MultiPV combo
  (deeper than `normal`, cheaper than `deep`), and ADR-018's
  position-keyed cache absorbs redundant Stage 2 runs when the same
  position arises in multiple games (transpositions are common in
  openings).
- The false-positive guards keep the candidate-to-puzzle ratio
  bounded, so puzzle database growth stays predictable.

Full evaluation: `specs/research/tactical-detection.md`.

## Consequences

- Stage 1 is fast (it is just a filter on existing data). It runs
  immediately after Feature 008 finishes a game.
- Stage 2 is the dominant cost. Per game with ~5 candidates, expect
  ~5 × 15 s = ~75 s of tactical-profile analysis on a desktop, more
  on mobile.
- The pipeline depends on Feature 005 (Stockfish), Feature 008
  (game analysis), and ADR-018 (cache). It cannot run before those
  exist.
- The `detectionVersion` field is incremented whenever the pipeline
  thresholds, guards or verification sources change. Existing candidates
  retain their original detection version. Version 2 introduced the
  stored-analysis fast path above; candidates verified from stored
  analysis carry `verificationSource: 'stored-analysis'` (fresh tactical
  runs carry `'tactical-search'`).

## Sources

- `specs/PRODUCT.md` §5, §8
- `specs/ARCHITECTURE.md` §6
- `specs/domain/tactics.md`
- `specs/domain/analysis-model.md`
- `specs/domain/puzzle-model.md`
- `specs/features/010-tactical-detection.md`
- `specs/features/011-puzzle-generation.md`
- `specs/research/tactical-detection.md`
- `specs/research/puzzle-generation.md`
- `specs/research/browser-stockfish.md`
- ADR-005, ADR-006, ADR-012, ADR-018, ADR-019, ADR-020, ADR-023, ADR-025
