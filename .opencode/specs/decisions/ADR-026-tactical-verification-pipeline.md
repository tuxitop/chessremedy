# ADR-026: Tactical Verification Pipeline

## Status

Accepted

## Decision

V1 implements tactical detection as a **two-stage pipeline** that
runs after the per-game analysis (Feature 008) has been completed.

### Stage 1 — Candidate generation (cheap, no new engine work)

Stage 1 runs over the persisted `MoveAnalysis` records of a completed
run (Feature 008). **Version 2** of the candidate rules (plan 013) uses a
**position-centric** model ported from the lichess-puzzler generator
(method + thresholds only; the AGPL/no-license sources are references — no
code is copied, see `specs/research/tactical-detection.md`). For each user
ply *p*, a raw candidate is emitted when `playedMove != bestMove`, the
ply is not a book position, both evaluations exist, and **any** of:

1. **Today's rule (kept).** `wpLoss ≥ 5` (the ADR-023 inaccuracy band —
   `WPLOSS_INACCURACY`; the pre-v2 ADR wording of `≥ 10` is superseded by
   the implemented band).
2. **Opponent-conceded swing.** The opponent's immediately-previous ply
   dropped its own mover-perspective win-% by ≥ 25 points to the user
   (mover-normalized): the opponent just handed the user a tactic that a
   quiet non-best reply failed to punish.
3. **Missed decisive / missed mate.** The user's `evalBefore` is already
   decisive for the user — a user forced mate within 8 plies, or a
   user-perspective centipawn edge ≥ +300 — yet the best move was not
   played. (Lichess excludes these from its public DB as trivial; personal
   training wants exactly "I missed the win".)
4. **Quiet / small-loss miss.** The played move lost `[1, 5)` win-% but the
   engine's best first move is forcing (a check or capture), so a real
   tactic existed despite the small swing.

The emitted set is capped at `MAX_CANDIDATES_PER_GAME` (16) and ordered by
the swing magnitude, so verification runs the biggest moments first and an
error-heavy game never triggers an unbounded engine load. The candidate
rule change is versioned via `CANDIDATE_GENERATION_VERSION` (1 → 2).

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

   The plan-014 owner decisions (`detectionVersion` 8) relax two guards so
   threat-based recalls surface: a **narrow stabilisation relaxation** (a
   quiet defender reply does not truncate material retention when the mover
   had already captured) and the **WDL veto scoped to terminal-prefix
   objectives** (an interior-prefix retained `winning_material` is not vetoed
   by an end-of-line WDL that reflects an already-lost surrounding game).
   Full guard mechanics: `research/tactical-detection.md` §5.

   There is **no unicity / "best-move-not-unique" rejection** (the plan-013
   W2 gate was removed by the owner in `detectionVersion` 7): a tactic the
   user missed is still surfaced even when a second move is nearly as good —
   ambiguity only raises the ADR-025 difficulty input (its candidate count)
   and adds the near-equal move to the accepted solving moves.

   The ADR-025 difficulty estimate is **computed and persisted** on every
   verified candidate but is **not** a rejection floor: a tactic the user
   genuinely missed surfaces regardless of how easy a puzzle it would make
   (`detectionVersion` 5; the old `≥ 15` floor was in practice unreachable
   and was dropped by the owner). Feature 011 may still apply its own
   quality threshold when it turns a candidate into a training puzzle.

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
(alternative-move reachability) or the end-line WDL guard:
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
  sync context). The candidate is retried in the same pass up to
  `MAX_ENGINE_ATTEMPTS_PER_CANDIDATE` (2). A transient failure that
  clears is absorbed; a candidate that still fails is **deferred**:
  the rest of the game's candidates keep verifying, the deferred
  candidate's row is left `failed`, and the pass ends `failed` so the
  next scan retries it (verified rows are reused and searched
  positions are ADR-018-cached, so a retry is cheap and one flaky
  position never repeatedly fails a whole long game). Feature 011 does
  not see the candidate until verification succeeds.
- Slow searches are bounded: every tactical verification is capped at
  `VERIFY_MOVETIME_MS` (45 s) alongside the depth limit (engine stops
  at whichever comes first), and the engine-service stall watchdog
  asks a silent engine to `stop` and return its current best move
  before it ever fails a healthy-but-slow search. Verification can
  therefore return a shallower result instead of timing out (this is
  part of `detectionVersion` 4).
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
  on mobile. Plan 013 bounds the cost per game with
  `MAX_CANDIDATES_PER_GAME` (16) and orders candidates by swing so the
  biggest moments verify first; each tactical search is additionally
  time-bounded by `VERIFY_MOVETIME_MS` (detectionVersion 4), so no
  single candidate — nor a whole long game's scan — can run unbounded.
- Detection passes persist live **scan progress** (`scanProgress
  { done, total }` on the per-analysis summary, plan 013 W3) as each
  Stage-2 candidate settles (verified or rejected/failed by a guard;
  engine-failed candidates stay pending). The UI shows the numeric bar
  only while the pass is genuinely running in the session — an
  interrupted pass never claims progress. Writing progress is one
  small IndexedDB put per settled candidate (≤ the 16-candidate cap).
- The pipeline depends on Feature 005 (Stockfish), Feature 008
  (game analysis), and ADR-018 (cache). It cannot run before those
  exist.
- The `detectionVersion` field is incremented whenever the pipeline
  thresholds, guards or verification sources change. Existing candidates
  retain their original detection version — but since version 9 that
  persisted version is the **freshness key** (plan 015, owner decision):
  a `completed` result whose version no longer equals the current
  `DETECTION_VERSION` is *outdated*, is suppressed in Review/Library
  (no markers, count or filter match) and is wiped and re-derived on the
  next scan of its analysis, so a stale marker can never survive a
  re-scan. Version 9 itself carries no rule change. Version 10 (plan 015,
  owner decision) adds a rule change: the **lost-position material floor** —
  `winning_material` is suppressed when the mover's start position is
  already decisively lost (`startEvalCp < WINNING_MATERIAL_MAX_LOST_START_CP`,
  currently −350). The retention delta is relative to the walk window, so a
  dead-lost mover can net two points inside it while remaining dead lost
  before and after; at such depths the engine's "best" losing line is one of
  many near-equivalent continuations and the apparent gain is
  engine-resistance noise, not a tactic the user missed. Because an interior
  `winning_material` is never vetoed by the terminal WDL (v8), the mover's
  start evaluation is the discriminator that keeps that surfacing honest.
  Forced mate and the defensive objectives still surface from lost
  positions; genuine recall forks from slightly-lost starts (≈ −200cp) still
  verify. Version 2 introduced the
  stored-analysis fast path above; candidates verified from stored
  analysis carry `verificationSource: 'stored-analysis'` (fresh tactical
  runs carry `'tactical-search'`). Version 3 added the Stage-2 **unicity
  gate**, and Version 7 **removed** it again (owner decision: ambiguity is
  not a rejection — see Stage 2 above). Version 5 dropped the ADR-025
  difficulty rejection floor; Version 6 lowered `winning_material` to a
  2-point floor; the candidate-rule change of plan 013 is versioned
   separately by `CANDIDATE_GENERATION_VERSION` (now 2). Version 4
   time-bounds each tactical search (`VERIFY_MOVETIME_MS`) and defers
   engine-failing candidates after a bounded retry (plan-013 fixes A/C),
   so a verification may settle with a shallower result instead of
   failing the game's whole scan. Version 8 (plan 14, owner decision)
   relaxes the stabilisation stop (narrow) and scopes the WDL veto to
   terminal-prefix objectives — see Stage 2 above and
   `research/tactical-detection.md` §5.

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
