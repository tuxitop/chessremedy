/**
 * Per-move and per-game accuracy (ADR-024, specs/research/move-accuracy.md).
 *
 * Pure domain helpers over persisted `MoveAnalysis` records. The Lichess
 * formula consumes only centipawn evaluations (WDL feeds classification,
 * never accuracy). Per-move accuracy uses the logistic win-percentage
 * curve; per-game accuracy is the unweighted arithmetic mean over the
 * player's analyzed moves, excluding book moves by default and any record
 * without a usable evaluation pair.
 *
 * Deterministic and framework-free. No aggregate is stored here — the
 * `MOVE_ACCURACY_VERSION` constant is prepared for Feature-014 aggregate
 * storage (ARCHITECTURE.md §9).
 */

import type { Color } from 'chessops/types';
import type { EvalCpMate, MoveAnalysis } from '@/domain/chess';
import { cpValueOf, winPercentFromCp } from '@/domain/chess/classification';

/** Version of the ADR-024 accuracy formula (V1; bump only with a new ADR). */
export const MOVE_ACCURACY_VERSION = 1;

/** Whether an evaluation carries no usable centipawn/mate signal. */
function isMissing(evaluation: EvalCpMate): boolean {
  return evaluation.cp === null && evaluation.mate === null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Per-move accuracy in `[0, 100]` for one move's evaluation pair
 * (ADR-024). `evalBefore` is the mover's win expectation before the move,
 * `evalAfter` the mover's expectation after it; a forced mate is treated
 * as `cp = ±10000`. Returns `null` when either evaluation is missing.
 */
export function moveAccuracy(
  evalBefore: EvalCpMate | null | undefined,
  evalAfter: EvalCpMate | null | undefined,
): number | null {
  if (!evalBefore || !evalAfter || isMissing(evalBefore) || isMissing(evalAfter)) {
    return null;
  }
  const before = cpValueOf(evalBefore);
  const after = cpValueOf(evalAfter);
  const wpLoss = clamp(winPercentFromCp(before) - winPercentFromCp(after), 0, 100);
  return clamp(103.1668 * Math.exp(-0.04354 * wpLoss) - 3.1669, 0, 100);
}

export interface GameAccuracy {
  /**
   * Mean per-move accuracy over the included moves, or `null` when no
   * usable user move exists (empty, all excluded, or no eval pairs).
   */
  readonly accuracy: number | null;
  /** Number of user moves included in the mean (the sample size). */
  readonly moves: number;
}

export interface GameAccuracyOptions {
  /**
   * Exclude book moves from the mean (ADR-024). Defaults to `true`. V1
   * leaves every `inBook` flag `false` (reserved), so the exclusion is
   * inert today but correct for future tagging.
   */
  readonly excludeBook?: boolean;
}

/**
 * Per-game accuracy for one player: the unweighted mean of that player's
 * analyzed per-move accuracies (ADR-024). Book moves and records without
 * a usable evaluation pair are excluded. Always reports the sample size;
 * `accuracy` is `null` when `moves === 0`.
 */
export function gameAccuracy(
  records: readonly MoveAnalysis[],
  userColor: Color,
  options: GameAccuracyOptions = {},
): GameAccuracy {
  const excludeBook = options.excludeBook ?? true;
  let total = 0;
  let moves = 0;
  for (const record of records) {
    if (record.side !== userColor) {
      continue;
    }
    if (excludeBook && record.inBook) {
      continue;
    }
    const accuracy = moveAccuracy(record.evalBefore, record.evalAfter);
    if (accuracy === null) {
      continue;
    }
    total += accuracy;
    moves += 1;
  }
  return { accuracy: moves === 0 ? null : total / moves, moves };
}
