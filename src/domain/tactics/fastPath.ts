/**
 * Stage-2 verification fast path (Feature 010 plan 012, WP-C).
 *
 * Pure, deterministic, engine-free verification of a raw candidate against the
 * game's **own stored analysis** of `candidate.startingFen`. Many missed
 * tactics are forcing mates whose decisive stored best line already reaches
 * checkmate within `MAX_TACTIC_PLIES`; a checkmate is a board-state fact, so
 * re-running the engine for them is pure waste. When the stored record shows a
 * genuine forced mate (root mate evaluation, a best PV of exactly that mate
 * distance that walks to checkmate, searched at or above a depth floor), the
 * candidate is verified **without** the `tactical`-profile engine run and
 * without the MultiPV- / WDL-dependent guards (alternative-move reachability,
 * difficulty floor, end-WDL consistency) — those need a fresh MultiPV + WDL
 * search and only apply to the engine fallback (ADR-026; DETECTION_VERSION is
 * bumped because candidates can now verify from stored analysis alone).
 *
 * Everything that is *not* a deterministic stored mate falls back to the
 * engine search unchanged (`null` is returned — never a weaker verification).
 *
 * ## Mate-determinism conditions (all must hold)
 *
 * - The stored record was produced by the same engine (name/version/build) that
 *   would run the tactical search — the provenance the candidate will record
 *   (checked by the service before this module is called).
 * - The stored top line reached at least `FAST_PATH_MIN_STORED_DEPTH`.
 * - The stored root evaluation is a mate for the mover. `evalMate` is the
 *   engine's UCI mate value, whose complete PV runs to the mating move in
 *   `P = 2 * evalMate - 1` plies (the mover delivers mate on an odd-length
 *   full PV; Stockfish never emits a truncated mate PV). The stored best PV
 *   must be exactly those `P` plies and `P <= MAX_TACTIC_PLIES`.
 * - The PV walks (legally) from `candidate.startingFen` to an actual board
 *   checkmate delivered by the starting mover (an odd `P` guarantees this once
 *   the equality holds; the parity is checked explicitly).
 */

import { walkLine } from './line';
import { forcingness, materialDelta } from './line';
import { estimateDifficulty } from './difficulty';
import { MAX_TACTIC_PLIES } from './verify';
import type { RawCandidate, VerifiedTacticalCandidate } from './types';
import { DETECTION_VERSION } from './types';

/** Depth floor for a stored line to seed the mate fast path. */
export const FAST_PATH_MIN_STORED_DEPTH = 18;

/** The stored-analysis facts a candidate's MoveAnalysis row must supply. */
export interface StoredLineSource {
  readonly engine: {
    readonly engineName: string;
    readonly engineVersion: string;
    readonly engineBuild: string;
  };
  /** Search depth the stored top line reached (top line `depth`). */
  readonly depth: number;
  /**
   * Root evaluation of the analysed position, mover perspective: the engine's
   * UCI mate value when it saw a forced mate (`null`/non-positive otherwise).
   * The complete mate PV has `2 * evalMate - 1` plies.
   */
  readonly evalMate: number | null;
  /** Best principal variation as UCI tokens from `candidate.startingFen`. */
  readonly bestPv: readonly string[];
  /** The stored analysis's own pipeline version (provenance). */
  readonly analysisVersion: number;
}

/**
 * Verify `candidate` from a decisive stored mate line, or return `null` to fall
 * back to the engine search. Pure and deterministic; never throws.
 */
export function fastPathVerifiedCandidate(
  candidate: RawCandidate,
  source: StoredLineSource,
  now: number,
): VerifiedTacticalCandidate | null {
  if (source.depth < FAST_PATH_MIN_STORED_DEPTH) {
    return null;
  }
  const mateValue = source.evalMate;
  if (mateValue === null || mateValue <= 0 || !Number.isInteger(mateValue)) {
    return null;
  }
  // A complete Stockfish mate PV is 2*m - 1 plies (the mover mates on an odd
  // ply); anything longer than the tactic window is a >8-plies tactic.
  const matePlies = 2 * mateValue - 1;
  if (matePlies > MAX_TACTIC_PLIES) {
    return null;
  }
  const pv = source.bestPv;
  if (pv.length !== matePlies) {
    return null;
  }
  // Parity guard: the starting mover must deliver the mate. An odd full PV
  // makes the final ply the starting mover's — stated explicitly rather than
  // relying on the engine's mate-value convention alone.
  if (pv.length % 2 !== 1) {
    return null;
  }
  const walk = walkLine(candidate.startingFen, pv);
  if (!walk.ok) {
    return null;
  }
  // The whole stored PV is the mate line: the walked end is checkmate (a
  // checkmate is a terminal board fact, so the mover delivered it — an engine
  // PV never continues past mate).
  if (!walk.walk.final.position.isCheckmate()) {
    return null;
  }

  const bestMove = pv[0] ?? candidate.bestMove;
  // ADR-025 difficulty for the stored-mate line, at the depth the mate was
  // actually verified (the stored line's depth). The solver wins by mate, so
  // the eval swing is at its maximum; no MultiPV alternatives exist on this
  // path, so the solving-move count is 1.
  const difficulty = estimateDifficulty({
    lineLength: pv.length,
    candidateFirstMoves: 1,
    forcingness: forcingness(walk.walk) * 100,
    evalSwing: Math.abs(10_000 - (candidate.evalCpBefore ?? 0)),
    material: materialDelta(walk.walk),
    depth: source.depth,
  });
  return {
    ...candidate,
    bestMove,
    bestPv: pv,
    tacticalObjective: 'forcing_mate',
    candidateSolutionLength: pv.length,
    verificationMetadata: {
      engineName: source.engine.engineName,
      engineVersion: source.engine.engineVersion,
      engineBuild: source.engine.engineBuild,
      // Provenance: the pipeline version whose stored analysis seeded this
      // verification (not the current compile-time constant) and the stored
      // line's depth — never a fabricated tactical-profile depth.
      analysisVersion: source.analysisVersion,
      verificationDepth: source.depth,
      verificationTimestamp: now,
      wdlAfterBestLine: null,
    },
    detectionVersion: DETECTION_VERSION,
    verificationSource: 'stored-analysis',
    verificationStatus: 'verified',
    // Feature-011 follow-up: a forced mate has no alternative solving move on
    // the stored line, so only the mating move is accepted.
    difficulty,
    acceptedFirstMoves: [bestMove],
  };
}
