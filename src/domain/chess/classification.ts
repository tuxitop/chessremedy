/**
 * Move classification — canonical algorithm (ADR-023, specs/domain/classification.md).
 *
 * Feature 008 applies this while producing `MoveAnalysis`; Features 009/010/014
 * consume the persisted result. No later feature redefines these rules. The
 * algorithm is deterministic for a fixed input tuple and every output record
 * carries `classificationVersion` (V1 = 1).
 *
 * Inputs arrive from the Feature-008 pipeline: for a move from `positionFen`,
 * `evalBefore` is the engine's best evaluation from the mover's perspective and
 * `evalAfter` is the evaluation of the position after the played move,
 * re-expressed from the mover's perspective.
 */

import type { GamePhase, EvalCpMate, MoveClassification, PlayedMove, Wdl } from './analysis';

export const CLASSIFICATION_VERSION = 1;

/** WDL-path win-percentage-loss thresholds (ADR-023). */
export const WPLOSS_GOOD = 2;
export const WPLOSS_INACCURACY = 10;
export const WPLOSS_MISTAKE = 20;

/** Best-move-tie delta in centipawns (ADR-023 special case). */
export const BEST_TIE_CP = 5;

/** Centipawn evaluation used when an evaluation is a forced mate (ADR-023). */
const MATE_CP = 10_000;

/**
 * The Chess.com phase-dependent centipawn thresholds used by the `fast`
 * fallback path (no WDL). Column order: inaccuracy / mistake / blunder.
 */
const CP_THRESHOLDS: Readonly<Record<GamePhase, readonly [number, number, number]>> = {
  opening: [50, 100, 200],
  middlegame: [80, 150, 300],
  endgame: [50, 100, 200],
};

export interface ClassificationInputs {
  readonly evalBefore: EvalCpMate | null;
  readonly evalAfter: EvalCpMate | null;
  readonly bestMove: PlayedMove | null;
  readonly playedMove: PlayedMove | null;
  readonly legalMovesCount: number;
  /** `null` for the `fast` profile (selects the centipawn fallback path). */
  readonly wdlBefore: Wdl | null;
  readonly wdlAfter: Wdl | null;
  readonly gamePhase: GamePhase;
  /** Reserved book/opening tagging; V1 passes `false` for every move. */
  readonly inBook: boolean;
  /** Top-line evaluations as centipawns, best first (MultiPV), for the tie rule. */
  readonly topCpValues: readonly number[];
}

/**
 * Centipawn value of an evaluation for classification math: a mate distance is
 * treated as ±10000 (ADR-023); a missing cp falls back to 0.
 */
export function cpValueOf(evaluation: EvalCpMate): number {
  if (evaluation.mate !== null) {
    return evaluation.mate > 0 ? MATE_CP : -MATE_CP;
  }
  return evaluation.cp ?? 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Lichess logistic win-percentage curve (ADR-023), clamped to `[0, 100]`.
 * Centipawns are from the side to move.
 */
export function winPercentFromCp(cp: number): number {
  const win = 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
  return clamp(win, 0, 100);
}

function sameMove(a: PlayedMove | null, b: PlayedMove | null): boolean {
  if (!a || !b) {
    return false;
  }
  return a.uci === b.uci || a.san === b.san;
}

/**
 * True when the engine reports a "best-move tie": at least two distinct lines
 * are within `BEST_TIE_CP` of the top (ADR-023 special case). Requires the
 * MultiPV evaluations; a single-line result reports no tie.
 */
export function isBestMoveTie(topCpValues: readonly number[]): boolean {
  if (topCpValues.length < 2) {
    return false;
  }
  return Math.abs(topCpValues[0]! - topCpValues[1]!) <= BEST_TIE_CP;
}

/**
 * Classify one move deterministically (ADR-023 / specs/domain/classification.md).
 *
 * Returns `best` when the played move is the engine's top choice and there is
 * no best-move tie; otherwise buckets `wpLoss` (WDL path) or raw centipawn
 * loss (fast fallback). Special cases override the table: mate-sign flip ⇒
 * `blunder`; a forced move (`legalMovesCount === 1`) can never exceed
 * `mistake`; a best-move tie downgrades `best` to `good`.
 */
export function classifyMove(inputs: ClassificationInputs): MoveClassification {
  if (inputs.inBook) {
    return 'good';
  }
  const { playedMove, bestMove, evalBefore, evalAfter } = inputs;
  if (!playedMove || !bestMove || !evalBefore || !evalAfter) {
    return 'good';
  }

  // Mate-sign flip: a non-mating position before, then the played move allows
  // the opponent to mate (evalAfter carries a negative mate for the mover).
  if (evalBefore.mate === null && evalAfter.mate !== null && evalAfter.mate < 0) {
    return 'blunder';
  }

  const playedBest = sameMove(playedMove, bestMove);
  if (playedBest) {
    return isBestMoveTie(inputs.topCpValues) ? 'good' : 'best';
  }

  const before = cpValueOf(evalBefore);
  const after = cpValueOf(evalAfter);
  const loss = before - after;

  if (inputs.wdlBefore !== null && inputs.wdlAfter !== null) {
    const wpLoss = clamp(winPercentFromCp(before) - winPercentFromCp(after), 0, 100);
    return classifyWpLoss(wpLoss, inputs.legalMovesCount);
  }

  return classifyCpLoss(loss, inputs.gamePhase, inputs.legalMovesCount);
}

function classifyWpLoss(wpLoss: number, legalMovesCount: number): MoveClassification {
  if (wpLoss >= WPLOSS_MISTAKE) {
    return legalMovesCount === 1 ? 'mistake' : 'blunder';
  }
  if (wpLoss >= WPLOSS_INACCURACY) {
    return 'mistake';
  }
  if (wpLoss >= WPLOSS_GOOD) {
    return 'inaccuracy';
  }
  return 'good';
}

function classifyCpLoss(
  cpLoss: number,
  phase: GamePhase,
  legalMovesCount: number,
): MoveClassification {
  const [inaccuracy, mistake, blunder] = CP_THRESHOLDS[phase];
  if (cpLoss >= blunder) {
    return legalMovesCount === 1 ? 'mistake' : 'blunder';
  }
  if (cpLoss >= mistake) {
    return 'mistake';
  }
  if (cpLoss >= inaccuracy) {
    return 'inaccuracy';
  }
  return 'good';
}
