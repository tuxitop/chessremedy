/**
 * Tactical objective classification (Feature 010, Stage 2).
 *
 * Classifies the objective a candidate line reaches for its mover, per
 * `specs/research/tactical-detection.md` §3 step 3 and ADR-026. Pure and
 * deterministic: every branch is a plain-number test over the inputs, so the
 * line walker feeds this module precomputed line statistics (see `line.ts`)
 * and integration needs no shared state.
 *
 * Conventions (documented input contract):
 * - All evaluations and WDLs are expressed from the mover's perspective — the
 *   side to move at the candidate position — matching the `MoveAnalysis`
 *   convention; the caller re-expresses engine-native values (negate/swap
 *   across a parity change) before calling.
 * - `endEvalMate` is signed: positive = the mover mates. The mate distance is
 *   an inclusive cap (`FORCING_MATE_MAX_DISTANCE`) in engine mate units.
 * - `lineMaterialDelta` is positive when the mover is up at the end of the
 *   line (same convention as `materialDelta` in `line.ts`).
 * - Win percentages for `decisive_advantage` come from the mover-perspective
 *   centipawn evals at the line start and end, so the branch needs a numeric
 *   `startEvalCp` and `endEvalCp`; a mate-only end has no centipawn eval and
 *   is handled by the `forcing_mate` branch instead.
 *
 * Precedence is fixed (research lists `decisive_advantage` as "and not
 * winning material or mate"): `winning_material`, then `forcing_mate`, then
 * `neutralizing_threat`, then `decisive_advantage`. `neutralizing_threat`
 * precedes `decisive_advantage` because a defensive resource that escapes a
 * forced loss is characterised by the before-state, not by the size of the
 * win-percentage swing it produces.
 *
 * Threshold changes must bump `DETECTION_VERSION` (ADR-026 / ARCHITECTURE.md
 * §9) and require a spec/ADR review; the constants below carry their source.
 */

import { winPercentFromCp } from '@/domain/chess';
import type { Wdl } from '@/domain/chess';
import type { TacticalObjective } from './types';

/** Minimum net material gain, in piece-value units (queen = 9), that makes a
 * line `winning_material` (research §3 step 3). */
export const WINNING_MATERIAL_MIN_DELTA = 3;

/** Longest end-of-line mate distance (mover to mate) still classified
 * `forcing_mate` (research §3 step 3). */
export const FORCING_MATE_MAX_DISTANCE = 8;

/** Win-percentage swing between the line start and end, in points, that makes
 * a remaining line `decisive_advantage` (research §3 step 3). */
export const DECISIVE_WP_SWING = 30;

/** Mover losing share (per-mille) at the candidate position at or above which
 * the position counts as a forced loss for `neutralizing_threat`. Calibration
 * constant; ADR-026 threshold changes bump `DETECTION_VERSION`. */
export const NEUTRALIZING_LOST_BEFORE_WDL_L = 800;

/** Mover centipawn evaluation at the candidate position at or below which the
 * position counts as a forced loss for `neutralizing_threat` when `wdlBefore`
 * is unavailable. Calibration constant. */
export const NEUTRALIZING_LOST_BEFORE_CP = -800;

/** Mover losing share (per-mille) at the end of the line at or below which the
 * mover is "fine" (the threat is removed) for `neutralizing_threat`.
 * Calibration constant. */
export const NEUTRALIZING_FINE_END_WDL_L = 300;

/** Mover centipawn evaluation at the end of the line at or above which the
 * mover is "fine" (the threat is removed) for `neutralizing_threat` when
 * `endWdl` is unavailable. Calibration constant. */
export const NEUTRALIZING_FINE_END_CP = -200;

/** Plain-number inputs to `classifyObjective`. See the module header for the
 * mover-perspective conventions. */
export interface ObjectiveInputs {
  /** Net material gained by the mover from line start to end, in piece-value
   * units (queen = 9); positive = the mover is up. */
  readonly lineMaterialDelta: number;
  /** Mover-perspective centipawn evaluation of the candidate position (before
   * the mover's first move); `null` when the engine reported a mate instead. */
  readonly startEvalCp: number | null;
  /** Mover-perspective centipawn evaluation at the end of the line; `null`
   * when the engine reported a mate instead. */
  readonly endEvalCp: number | null;
  /** End-of-line mate evaluation, mover perspective: positive distance = the
   * mover mates; `null` when the line does not carry a mate evaluation. */
  readonly endEvalMate: number | null;
  /** Mover-perspective WDL (per-mille) at the end of the line; `null` when
   * unavailable (e.g. `fast` profile). */
  readonly endWdl: Wdl | null;
  /** Mover-perspective WDL (per-mille) before the mover's first move; `null`
   * when unavailable. */
  readonly wdlBefore: Wdl | null;
}

function moverIsForcedLost(inputs: ObjectiveInputs): boolean {
  const { wdlBefore, startEvalCp } = inputs;
  if (wdlBefore !== null) {
    return wdlBefore.l >= NEUTRALIZING_LOST_BEFORE_WDL_L;
  }
  return startEvalCp !== null && startEvalCp <= NEUTRALIZING_LOST_BEFORE_CP;
}

function moverEndsFine(inputs: ObjectiveInputs): boolean {
  const { endEvalMate, endWdl, endEvalCp } = inputs;
  if (endEvalMate !== null && endEvalMate < 0) {
    return false;
  }
  if (endWdl !== null) {
    return endWdl.l <= NEUTRALIZING_FINE_END_WDL_L;
  }
  return endEvalCp !== null && endEvalCp >= NEUTRALIZING_FINE_END_CP;
}

function hasDecisiveSwing(inputs: ObjectiveInputs): boolean {
  const { startEvalCp, endEvalCp } = inputs;
  if (startEvalCp === null || endEvalCp === null) {
    return false;
  }
  return Math.abs(winPercentFromCp(endEvalCp) - winPercentFromCp(startEvalCp)) >= DECISIVE_WP_SWING;
}

/**
 * Classify the tactical objective a candidate line reaches for its mover, or
 * `null` when the line reaches none (research §3 step 3). See the module
 * header for the mover-perspective input conventions and the fixed precedence.
 */
export function classifyObjective(inputs: ObjectiveInputs): TacticalObjective | null {
  if (inputs.lineMaterialDelta >= WINNING_MATERIAL_MIN_DELTA) {
    return 'winning_material';
  }
  const { endEvalMate } = inputs;
  if (endEvalMate !== null && endEvalMate > 0 && endEvalMate <= FORCING_MATE_MAX_DISTANCE) {
    return 'forcing_mate';
  }
  if (moverIsForcedLost(inputs) && moverEndsFine(inputs)) {
    return 'neutralizing_threat';
  }
  if (hasDecisiveSwing(inputs)) {
    return 'decisive_advantage';
  }
  return null;
}
