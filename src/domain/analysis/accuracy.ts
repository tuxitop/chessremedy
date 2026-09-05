/**
 * Per-move and per-game accuracy (ADR-024, specs/research/move-accuracy.md).
 *
 * Pure domain helpers over persisted `MoveAnalysis` records, ported from
 * Lichess (`lila` `modules/analyse/src/main/AccuracyPercent.scala`, commit
 * 5013970). Per-move accuracy consumes only the logistic win-percentage
 * curve (WDL feeds classification, never accuracy); the cp input is clamped
 * to ±1000 first (`scalachess eval.scala` `Eval.Cp.CEILING`), so a forced
 * mate behaves like ±1000.
 *
 * Per-game accuracy reproduces Lichess's `gameAccuracy`: the mean of the
 * (volatility-weighted mean, harmonic mean) over the player's per-move
 * accuracies, where each move is weighted by the standard deviation of the
 * win-percentage series in its window (clamped to [0.5, 12]); a window with
 * no volatility contributes no weight. Unlike Lichess (which returns no value
 * when no weighted mean exists), V1 falls back to the harmonic mean so a
 * normal analysed game always yields a figure.
 *
 * Deterministic and framework-free. No aggregate is stored here — the
 * `MOVE_ACCURACY_VERSION` constant is prepared for Feature-014 aggregate
 * storage (ARCHITECTURE.md §9).
 */

import type { Color } from 'chessops/types';
import type { EvalCpMate, MoveAnalysis } from '@/domain/chess';
import { cpValueOf, winPercentFromCp } from '@/domain/chess/classification';

/** Version of the ADR-024 accuracy formula (V2 = Lichess AccuracyPercent port). */
export const MOVE_ACCURACY_VERSION = 2;

/** Lichess `AccuracyPercent.fromWinPercents` fitted constants (unrounded). */
const ACCURACY_A = 103.1668100711649;
const ACCURACY_K = 0.04354415386753951;
const ACCURACY_B = -3.166924740191411;

/** Whether an evaluation carries no usable centipawn/mate signal. */
function isMissing(evaluation: EvalCpMate): boolean {
  return evaluation.cp === null && evaluation.mate === null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Per-move accuracy from two win-percentage values (Lichess
 * `AccuracyPercent.fromWinPercents`): 100 when the move did not lose winning
 * chances, else `A·e^(−K·Δ) + B`, plus the `+1` "uncertainty bonus", clamped
 * to `[0, 100]`.
 */
export function accuracyFromWinPercents(beforePercent: number, afterPercent: number): number {
  if (afterPercent >= beforePercent) {
    return 100;
  }
  const winDiff = beforePercent - afterPercent;
  const raw = ACCURACY_A * Math.exp(-ACCURACY_K * winDiff) + ACCURACY_B + 1;
  return clamp(raw, 0, 100);
}

/**
 * Per-move accuracy in `[0, 100]` for one move's evaluation pair (ADR-024).
 * `evalBefore` is the mover's win expectation before the move, `evalAfter`
 * the mover's expectation after it. Returns `null` when either evaluation is
 * missing.
 */
export function moveAccuracy(
  evalBefore: EvalCpMate | null | undefined,
  evalAfter: EvalCpMate | null | undefined,
): number | null {
  if (!evalBefore || !evalAfter || isMissing(evalBefore) || isMissing(evalAfter)) {
    return null;
  }
  const before = winPercentFromCp(cpValueOf(evalBefore));
  const after = winPercentFromCp(cpValueOf(evalAfter));
  return accuracyFromWinPercents(before, after);
}

export interface GameAccuracy {
  /**
   * Per-game accuracy for the player, or `null` when no usable move exists
   * (empty, all excluded, or no eval pairs).
   */
  readonly accuracy: number | null;
  /** Number of the player's moves included in the figure (the sample size). */
  readonly moves: number;
}

export interface GameAccuracyOptions {
  /**
   * Exclude book moves from the mean (ADR-024). Defaults to `true`. V1
   * leaves every `inBook` flag `false` (reserved), so the exclusion is inert
   * today but correct for future tagging.
   */
  readonly excludeBook?: boolean;
}

/** Sample standard deviation of a non-empty numeric window. */
function standardDeviation(values: readonly number[]): number {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / values.length;
  return Math.sqrt(variance);
}

/** Standard deviation of a window, or `null` when any position lacks an eval. */
function windowDeviation(window: readonly (number | undefined)[]): number | null {
  const values: number[] = [];
  for (const value of window) {
    if (value === undefined) {
      return null;
    }
    values.push(value);
  }
  return standardDeviation(values);
}

interface PlyAccuracy {
  readonly color: Color;
  readonly accuracy: number | null;
  /** Lichess volatility weight for this ply, or `null` when it has none. */
  weight: number | null;
}

/**
 * Per-game accuracy for one player (ADR-024 / Lichess `gameAccuracy`): mean of
 * the volatility-weighted mean and the harmonic mean of that player's per-move
 * accuracies. Requires the full ordered ply list (both colours) so the
 * win-percentage series used for volatility is contiguous. Returns
 * `{ accuracy, moves }`; `accuracy` is `null` when no usable move exists.
 */
export function gameAccuracy(
  records: readonly MoveAnalysis[],
  userColor: Color,
  options: GameAccuracyOptions = {},
): GameAccuracy {
  const excludeBook = options.excludeBook ?? true;
  const ordered = [...records]
    .filter((record) => !(excludeBook && record.inBook))
    .sort((a, b) => a.ply - b.ply);
  if (ordered.length === 0) {
    return { accuracy: null, moves: 0 };
  }

  // Per-ply mover win-percentage before/after (mover perspective), plus the
  // White-perspective win percentage of each position 0..m (m = ply count).
  const plies: PlyAccuracy[] = [];
  const whiteWin: (number | undefined)[] = new Array(ordered.length + 1).fill(undefined);
  for (let i = 0; i < ordered.length; i += 1) {
    const record = ordered[i]!;
    const moverBefore = isMissing(record.evalBefore)
      ? null
      : winPercentFromCp(cpValueOf(record.evalBefore));
    const moverAfter = isMissing(record.evalAfter)
      ? null
      : winPercentFromCp(cpValueOf(record.evalAfter));
    whiteWin[i] = moverBefore !== null ? whiteWinPercent(moverBefore, record.side) : whiteWin[i];
    whiteWin[i + 1] =
      moverAfter !== null ? whiteWinPercent(moverAfter, record.side) : whiteWin[i + 1];
    plies.push({
      color: record.side,
      accuracy:
        moverBefore !== null && moverAfter !== null
          ? accuracyFromWinPercents(moverBefore, moverAfter)
          : null,
      weight: null,
    });
  }
  // Seed the initial position with the standard opening evaluation when the
  // first ply lacks a before-eval.
  if (whiteWin[0] === undefined) {
    whiteWin[0] = winPercentFromCp(15);
  }

  // Lichess windows: pad the leading plies with the first window, then slide.
  const size = whiteWin.length;
  let windowSize = Math.floor(ordered.length / 10);
  windowSize = clamp(windowSize, 2, 8);
  const windows: (readonly (number | undefined)[])[] = [];
  const leadingCount = Math.max(0, Math.min(windowSize, size) - 2);
  for (let i = 0; i < leadingCount; i += 1) {
    windows.push(whiteWin.slice(0, windowSize));
  }
  for (let start = 0; start + windowSize <= size; start += 1) {
    windows.push(whiteWin.slice(start, start + windowSize));
  }

  // Only plies that have a corresponding window participate (matches the
  // Lichess zip); typical games have one window per ply.
  const counted = Math.min(plies.length, windows.length);
  for (let i = 0; i < counted; i += 1) {
    const deviation = windowDeviation(windows[i]!);
    if (deviation !== null && deviation > 0) {
      plies[i]!.weight = clamp(deviation, 0.5, 12);
    }
  }

  const userPlies = plies.filter((ply) => ply.color === userColor && ply.accuracy !== null);
  const moves = userPlies.length;
  if (moves === 0) {
    return { accuracy: null, moves: 0 };
  }

  let weightedSum = 0;
  let weightTotal = 0;
  for (const ply of userPlies) {
    if (ply.weight !== null) {
      weightedSum += ply.weight * ply.accuracy!;
      weightTotal += ply.weight;
    }
  }
  const weightedMean = weightTotal > 0 ? weightedSum / weightTotal : null;

  let reciprocalSum = 0;
  let zeroAccuracy = false;
  for (const ply of userPlies) {
    if (ply.accuracy === 0) {
      zeroAccuracy = true;
    } else {
      reciprocalSum += 1 / ply.accuracy!;
    }
  }
  const harmonicMean = zeroAccuracy ? 0 : moves / reciprocalSum;

  if (weightedMean === null) {
    return { accuracy: harmonicMean, moves };
  }
  return { accuracy: (weightedMean + harmonicMean) / 2, moves };
}

/**
 * Win percentage (White-perspective) corresponding to a mover's win
 * percentage: for a Black mover the White figure is the complement.
 */
function whiteWinPercent(moverWinPercent: number, mover: Color): number {
  return mover === 'white' ? moverWinPercent : 100 - moverWinPercent;
}
