/**
 * Evaluation helpers for the live analysis board (Feature 006).
 *
 * Pure, deterministic functions mapping an engine evaluation to the
 * representation shown on the evaluation bar and in the header eval text.
 *
 * Engine results are reported from the side-to-move perspective (ADR-019 /
 * UCI `score cp`). The evaluation bar is rendered from the perspective of the
 * *bottom* player (the board orientation), so an evaluation must be sign
 * flipped when the side to move is not the bottom player.
 */

import type { EngineEvaluation } from '@/infrastructure/engine/types';

export type PlayerColor = 'white' | 'black';

/** Centipawn value of an evaluation from a given perspective (mate → ±10 000). */
export function evaluationCp(
  evaluation: EngineEvaluation,
  fromPerspective: PlayerColor,
  sideToMove: PlayerColor,
): number {
  const raw = 'mate' in evaluation ? (evaluation.mate > 0 ? 10_000 : -10_000) : evaluation.cp;
  // UCI reports from the side-to-move perspective; flip to a fixed color.
  const whitePerspective = sideToMove === 'white' ? raw : -raw;
  return fromPerspective === 'white' ? whitePerspective : -whitePerspective;
}

/**
 * Fraction of the bar occupied by the bottom player's advantage, in `[0,1]`.
 * 0.5 == equal. A mating advantage pins the bar to the relevant end. Uses a
 * logistic scale so large centipawn advantages saturate toward 1/0.
 */
export function bottomAdvantageFraction(
  evaluation: EngineEvaluation,
  bottomColor: PlayerColor,
  sideToMove: PlayerColor,
): number {
  const cp = evaluationCp(evaluation, bottomColor, sideToMove);
  if (cp <= -10_000) return 0;
  if (cp >= 10_000) return 1;
  const raw = 1 / (1 + Math.exp(-cp / 400));
  const clipped = Math.min(0.995, Math.max(0.005, raw));
  return clipped;
}

/**
 * Re-express an evaluation (reported from the side-to-move perspective) from
 * the perspective of the bottom player, so header text and bar agree with the
 * board orientation.
 */
export function evaluationFromBottom(
  evaluation: EngineEvaluation,
  bottomColor: PlayerColor,
  sideToMove: PlayerColor,
): EngineEvaluation {
  if (bottomColor === sideToMove) {
    return evaluation;
  }
  if ('mate' in evaluation) {
    return { mate: -evaluation.mate };
  }
  return { cp: -evaluation.cp };
}
