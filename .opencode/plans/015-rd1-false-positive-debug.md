# Plan 015 — Handoff: "why is 28.Rd1 flagged as a missed tactic?" (false-positive debug)

Status: **open investigation**. Owner (White) asks why `28.Rd1` (sourcePly 54)
is treated as a missed tactic: they can see the wpLoss/blunder angle, but there
is no visible mate, no +2 material gain, and no tactic that fits the
algorithm. This file hands the investigation to a fresh session.

Conventions: follow `AGENTS.md` context discipline + Execution policy + Output
discipline (offload exploration to the `explore`/`research` subtask commands;
return deltas, not whole files). Do **not** commit scratch `tests/e2e/zz-*`
probes. Current HEAD: `b89c1c2` (clean tree assumed when read).

---

## 0. What we already proved (deterministic, no engine needed for the core claim)

- **The move**: White's 28th = `28.Rd1` (`f1d1`), sourcePly 54. Position before
  it (replayed from the PGN):
  `7r/3k2pp/4bp2/1p6/1p2N3/2P5/1r1p1PPP/5RK1 w - - 0 28`
- **The position is already lost for White**: material White 12 vs Black 19
  (−7: down a rook + a bishop). Real-engine (depth-20, asm build) best line:
  `Nc5+` ≈ **−735 cp, WDL 0/0/1000** (mover loses ~100%). `Rd1` ≈ **−890 cp**.
- **wpLoss ≈ 2.6 win-%** (winPercentFromCp: −735 → 6.26 %, −890 → 3.64 %),
  i.e. **below the 5 % inaccuracy floor** — Stage-1 Rule 1 does NOT fire.
- **Which Stage-1 rule fires**: Rule 4, the **quiet / small-loss miss**
  (`src/domain/tactics/stage1.ts`): `wpLoss ∈ [1, 5)` AND the engine's best
  first move is forcing. `Nc5+` is a check → `bestFirstMoveForcing(...) === true`.
- **Stage-2 would reject it**: `verifyCandidate` on the engine top line
  (`Nc5+ Ke7 cxb4 …`) returns **`no-objective`** — no mate, no retained +2,
  nothing reachable in ≤8 plies. So as a *tactic* it is a **false positive**:
  Rule 4 misreads a desperation check in a lost position as evidence of a
  tactic.

Open sub-fact (needs the app DB, engine-run dependent): whether a candidate row
at sourcePly 54 currently exists and in what state (`raw`/`failed`/`verified`)
in the owner's latest scan, and — if the owner sees it *rendered* as a miss —
which surface shows it (Review NAG-9 marker comes only from `verified` rows).

---

## 1. The problem restated

Owner expects "missed tactic" to mean: a forcing continuation that achieves a
meaningful objective (win material ≥ 2, mate, decisive edge, neutralize a
threat) which they failed to play. For `28.Rd1` no such continuation exists —
White is lost whatever they play, and `Nc5+` merely checks. Yet the pipeline
emits a candidate (and/or the owner sees a miss marker). We need to decide
**whether Rule 4's "best move is forcing ⇒ tactic" inference should be
suppressed when the user's position is already lost**, and whether any other
rule can also produce such lost-position noise.

## 2. Candidate hypotheses (test in order)

1. **Rule-4 lost-position noise (primary).** `generateCandidates` fires Rule 4
   whenever `wpLoss ∈ [1,5)` and best-first-move is forcing, with no
   pre-check that the user's position is not already lost (no
   `evalBefore`-based "position still playable / not hopeless" gate). In a
   position at −735 cp the "best move" is often a defensive check/capture, so
   Rule 4 invents tactics in lost positions.
   - Candidate fixes (product decision needed): gate Rule 4 on the user being
     at worst slightly worse (e.g. `userCpBefore > −X`), or require the
     forcing best move to be a *capture* that actually gains material, or let
     Stage 2 alone filter (it already returns no-objective) and only fix the
     *surface* that shows raw candidates.
2. **Surface leak.** Confirm where the owner sees "28.Rd1 is a miss": if a
   candidate row at sourcePly 54 is `raw`/`failed`, it must NOT be rendered as
   a missed tactic anywhere. Review NAG-9 / summary counts come from
   `annotateVerifiedMisses` (verified rows only) — verify no other surface
   (Library row insights, scan-report leftovers, candidate debug) leaks
   non-verified rows. Note: the Review scan-report block was removed in
   `c214b51`, but confirm nothing else reads `puzzleCandidates` wholesale.
3. **Engine-line run variance.** Different bulk/verification engine runs can
   change whether sourcePly 54 even gets a candidate and whether the tactical
   search finds an objective (the earlier probes saw engine-line variance at
   plies 24/26/28). If the owner's latest scan *verified* sourcePly 54 (not
   just emitted it), that is a different, more serious bug (Stage 2 accepting a
   lost-position line) — re-establish ground truth first.
4. **Blunder-classification confusion.** The move is legitimately a *blunder*
   by ADR-023 classification (wpLoss vs best). Confirm the owner is not
   reading the blunder label as "missed tactic" (different features: Feature
   009 vs Feature 010).

## 3. Investigation/debug steps for the next session

1. Re-establish ground truth (§0 open sub-fact): recreate the throwaway probe
   (`tests/e2e/zz-*.spec.ts`; delete before commit) — import the PGN (White =
   `chessremedy`), analyze **fast**, let the scan settle, then dump the
   `puzzleCandidates` rows for sourcePly 54: `{verificationStatus,
   rejectionReason, objective, wpLoss, evalCpBefore, evalCpAfterUserMove,
   bestMove, bestPv}`. Also open Review and record which move(s) carry the
   NAG-9 marker / what the summary `Missed tactics` count is. This tells us
   raw-vs-verified and which surface the owner saw.
2. Run `generateCandidates` (unit level, no engine) over the ply-54
   `MoveAnalysis` shape to confirm Rule 4 fires and Rule 1 does not (use the
   real stored evals if the probe captured them; otherwise the §0 estimates).
   Add a regression unit test that pins Rule 4 *not* firing in an
   already-lost position (FEN54, evalBefore ≈ −735) — this is the desired
   outcome candidate.
3. Decide the product rule (§2.1) with the owner; if adopted, implement +
   bump `CANDIDATE_GENERATION_VERSION` (2 → 3) + update ADR-026 Stage 1 /
   research §3 / Feature 010, mirroring how the v8 recall work updated docs.
4. If instead the surface leaked non-verified rows, fix that surface (find all
   readers of `puzzleCandidates`; the removed scan-report is gone, verify
   nothing else remains).
5. Re-run the probe after any fix and confirm sourcePly 54 no longer shows as
   a miss (raw or not rendered) while genuine plies (e.g. 24, verified in the
   v8 probe) still do.

## 4. Deterministic unit tests to add

- `stage1.test`: candidate at a user ply with `evalCpBefore ≈ −735`,
  `wpLoss ≈ 2.6`, best move `Nc5+` (forcing check) → **no candidate** under
  the adopted lost-position gate; and a control case (equal position, small
  wpLoss, forcing best) still emits (Rule 4 preserved where it is valid).
- `stage1.test`: assert Rule 1 still fires at `wpLoss ≥ 5` on the same shape
  (blunder classification is separate from tactic detection).
- `annotate`/Review surface test only if a leak is found.

## 5. Housekeeping

- Scratch `tests/e2e/zz-*` probes are throwaway — never commit.
- If a gate is added, bump `CANDIDATE_GENERATION_VERSION` and update
  ADR-026 / `research/tactical-detection.md` §3 / Feature 010 (keep research
  §5 as single source for guard mechanics, per the recent de-dup).
- Verification: focused `npx vitest run src/domain/tactics`, then the full
  `AGENTS.md` gate (load the `verify-gate` skill), then `npm run
  test:browser -- game-analysis-review` if Chromium is available. Real-engine
  probes need `npm run build` first (Playwright previews built `dist`).
- Report the ply-54 verdict (raw/verified/no-objective) and which surface the
  owner saw, with the engine PV, before declaring the false positive resolved.
