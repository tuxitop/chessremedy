/**
 * Feature 013 — canonical cycle metrics (domain, pure).
 *
 * The **single shared** cycle-metric function Feature 014 reuses (spec §8;
 * AC #14): per-puzzle resolutions and the per-cycle aggregates, plus same-set
 * cross-cycle deltas. Cycle metrics are always derived from the immutable
 * `PuzzleAttemptRow`s, never stored; `null` means `empty` (zero definite
 * puzzles), never a fabricated `0`. The comparison reports measured deltas
 * only and never claims causation.
 */

import { resolvePuzzleCycle, type CycleResolution } from './cycle';
import type { TrainingCycleRow } from './cycleTypes';
import type { PuzzleAttemptRow } from './types';

/** Aggregate solving time over a cycle's completed puzzles. */
export interface SolvingTimeMetrics {
  /** Σ `solvingTimeMs` over definite presentations. */
  readonly totalMs: number;
  /** `totalMs / puzzlesCompleted`, or `null` when no puzzle is definite. */
  readonly averageMs: number | null;
  /** Median per-completed-puzzle solving time, or `null` when none. */
  readonly medianMs: number | null;
}

/** The canonical per-cycle aggregate metrics (sample unit `puzzles`). */
export interface CycleMetrics {
  /** Distinct puzzles with at least one attempt row. */
  readonly puzzlesAttempted: number;
  /** Distinct puzzles with at least one definite presentation. */
  readonly puzzlesCompleted: number;
  /** Distinct puzzles whose only result is `skipped`. */
  readonly puzzlesSkipped: number;
  /** `firstTrySolved / puzzlesCompleted`, or `null` when empty. */
  readonly firstTryAccuracy: number | null;
  /** `eventuallySolved / puzzlesCompleted`, or `null` when empty. */
  readonly solveRate: number | null;
  /** Total attempt rows. */
  readonly totalPresentations: number;
  /** Σ wrong moves over all presentations. */
  readonly totalWrongMoves: number;
  /** Σ hint presses over all presentations. */
  readonly hintsUsed: number;
  /** Distinct puzzles with any hint press. */
  readonly puzzlesRequiringHint: number;
  /** Attempt rows with `presentationIndex > 1`. */
  readonly retries: number;
  /** Distinct puzzles with any retry presentation. */
  readonly puzzlesRequiringRetry: number;
  readonly solvingTime: SolvingTimeMetrics;
  /** Rate metrics are per puzzle. */
  readonly sampleUnit: 'puzzles';
}

/** Inputs to `computeCycleMetrics`. */
export interface ComputeCycleMetricsInput {
  /** The cycle's ordered snapshot membership. */
  readonly puzzleIds: readonly string[];
  /** The cycle's persisted attempt rows (any order). */
  readonly attempts: readonly PuzzleAttemptRow[];
  /** Snapshot puzzle ids whose row no longer exists (excluded). */
  readonly missingPuzzleIds?: ReadonlySet<string>;
}

/**
 * Compute the canonical cycle aggregates from persisted rows. Iterates the
 * snapshot membership so attempts for puzzles outside the snapshot are never
 * counted; a puzzle with no rows is pending and contributes nothing. Rate/time
 * aggregates are `null` (empty) when no puzzle is definite.
 */
export function computeCycleMetrics(input: ComputeCycleMetricsInput): CycleMetrics {
  const grouped = groupAttempts(input.attempts);
  const missing = input.missingPuzzleIds;
  const completedSolvingTimes: number[] = [];
  let puzzlesAttempted = 0;
  let puzzlesCompleted = 0;
  let puzzlesSkipped = 0;
  let firstTrySolved = 0;
  let eventuallySolved = 0;
  let totalPresentations = 0;
  let totalWrongMoves = 0;
  let hintsUsed = 0;
  let puzzlesRequiringHint = 0;
  let retries = 0;
  let puzzlesRequiringRetry = 0;
  let totalSolvingMs = 0;

  for (const puzzleId of input.puzzleIds) {
    if (missing?.has(puzzleId)) {
      continue;
    }
    const rows = grouped.get(puzzleId);
    if (rows === undefined || rows.length === 0) {
      continue;
    }
    const resolution = resolvePuzzleCycle(puzzleId, rows);
    puzzlesAttempted += 1;
    totalPresentations += resolution.presentationCount;
    totalWrongMoves += resolution.wrongMoves;
    hintsUsed += resolution.hints;
    if (resolution.definite) {
      puzzlesCompleted += 1;
      totalSolvingMs += resolution.solvingTimeMs;
      completedSolvingTimes.push(resolution.solvingTimeMs);
      if (resolution.firstTrySolved) {
        firstTrySolved += 1;
      }
      if (resolution.eventuallySolved) {
        eventuallySolved += 1;
      }
    } else if (resolution.skipped) {
      puzzlesSkipped += 1;
    }
    if (resolution.hints > 0) {
      puzzlesRequiringHint += 1;
    }
    const retryCount = countRetries(resolution);
    if (retryCount > 0) {
      puzzlesRequiringRetry += 1;
      retries += retryCount;
    }
  }

  return {
    puzzlesAttempted,
    puzzlesCompleted,
    puzzlesSkipped,
    firstTryAccuracy: rate(firstTrySolved, puzzlesCompleted),
    solveRate: rate(eventuallySolved, puzzlesCompleted),
    totalPresentations,
    totalWrongMoves,
    hintsUsed,
    puzzlesRequiringHint,
    retries,
    puzzlesRequiringRetry,
    solvingTime: {
      totalMs: totalSolvingMs,
      averageMs: puzzlesCompleted === 0 ? null : totalSolvingMs / puzzlesCompleted,
      medianMs: median(completedSolvingTimes),
    },
    sampleUnit: 'puzzles',
  };
}

/** Count the attempt rows of one puzzle with `presentationIndex > 1`. */
function countRetries(resolution: CycleResolution): number {
  return resolution.presentations.filter((row) => row.presentationIndex > 1).length;
}

/** `numerator / denominator`, or `null` when the denominator is zero. */
function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

/** Median of a numeric list (mean of the two middles when even); `null` when empty. */
function median(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle]!;
  }
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** Group attempt rows by puzzle id, preserving input order within a puzzle. */
function groupAttempts(attempts: readonly PuzzleAttemptRow[]): Map<string, PuzzleAttemptRow[]> {
  const grouped = new Map<string, PuzzleAttemptRow[]>();
  for (const row of attempts) {
    const bucket = grouped.get(row.puzzleId);
    if (bucket === undefined) {
      grouped.set(row.puzzleId, [row]);
    } else {
      bucket.push(row);
    }
  }
  return grouped;
}

/** The flat metric keys a `CycleComparison` reports deltas for. */
export type CycleMetricKey =
  | 'puzzlesAttempted'
  | 'puzzlesCompleted'
  | 'puzzlesSkipped'
  | 'firstTryAccuracy'
  | 'solveRate'
  | 'totalPresentations'
  | 'totalWrongMoves'
  | 'hintsUsed'
  | 'puzzlesRequiringHint'
  | 'retries'
  | 'puzzlesRequiringRetry'
  | 'solvingTimeTotalMs'
  | 'solvingTimeAverageMs'
  | 'solvingTimeMedianMs';

/** A per-metric delta record; a value is `null` when it is not defined. */
export type CycleMetricDeltas = Readonly<Record<CycleMetricKey, number | null>>;

/**
 * A same-set cross-cycle comparison. `absoluteDelta` is `current - previous`;
 * `relativeDelta` is `(current - previous) / previous`, and each field is
 * `null` when the corresponding previous value is `null` or `0`. Values are
 * data only — no improvement/causation claim is made.
 */
export interface CycleComparison {
  readonly current: CycleMetrics;
  readonly previous: CycleMetrics;
  readonly absoluteDelta: CycleMetricDeltas;
  readonly relativeDelta: CycleMetricDeltas;
}

/**
 * Compare two cycles' canonical metrics (same set, same definition). Returns
 * the two metric sets plus measured absolute and relative deltas.
 */
export function compareCycleMetrics(
  current: CycleMetrics,
  previous: CycleMetrics,
): CycleComparison {
  const currentValues = flatten(current);
  const previousValues = flatten(previous);
  const absoluteDelta = {} as Record<CycleMetricKey, number | null>;
  const relativeDelta = {} as Record<CycleMetricKey, number | null>;
  for (const key of Object.keys(currentValues) as CycleMetricKey[]) {
    const currentValue = currentValues[key];
    const previousValue = previousValues[key];
    absoluteDelta[key] =
      currentValue === null || previousValue === null ? null : currentValue - previousValue;
    relativeDelta[key] =
      currentValue === null || previousValue === null || previousValue === 0
        ? null
        : (currentValue - previousValue) / previousValue;
  }
  return { current, previous, absoluteDelta, relativeDelta };
}

/** Flatten a `CycleMetrics` into the comparable key set. */
function flatten(metrics: CycleMetrics): Readonly<Record<CycleMetricKey, number | null>> {
  return {
    puzzlesAttempted: metrics.puzzlesAttempted,
    puzzlesCompleted: metrics.puzzlesCompleted,
    puzzlesSkipped: metrics.puzzlesSkipped,
    firstTryAccuracy: metrics.firstTryAccuracy,
    solveRate: metrics.solveRate,
    totalPresentations: metrics.totalPresentations,
    totalWrongMoves: metrics.totalWrongMoves,
    hintsUsed: metrics.hintsUsed,
    puzzlesRequiringHint: metrics.puzzlesRequiringHint,
    retries: metrics.retries,
    puzzlesRequiringRetry: metrics.puzzlesRequiringRetry,
    solvingTimeTotalMs: metrics.solvingTime.totalMs,
    solvingTimeAverageMs: metrics.solvingTime.averageMs,
    solvingTimeMedianMs: metrics.solvingTime.medianMs,
  };
}

// --- Woodpecker guidance (pure, derived; never stored) ----------------------

/**
 * The first-cycle first-try guidance band (spec §5, AC #17). **Guidance only**
 * — never a gate; the UI frames it as text, never colour.
 */
export const FIRST_CYCLE_FIRST_TRY_BAND = { min: 0.6, max: 0.75 } as const;

/** Recommended minimum spacing between cycles of the same block (spec §4). */
export const SPACING_RECOMMENDED_MS = 24 * 60 * 60 * 1000;

/**
 * The Woodpecker time-halving guidance for one cycle against the previous cycle
 * of the same block. Every field is derived and honest: a cycle with no definite
 * puzzle is not a measured time, and a previous cycle without one yields no
 * fabricated target or delta.
 */
export interface CycleTimeGoal {
  /** The current cycle's total solving time in millis (`0` when unmeasured). */
  readonly currentTotalMs: number;
  /** True when the current cycle has at least one definite puzzle. */
  readonly currentMeasured: boolean;
  /** The previous cycle's total solving time, or `null` when unavailable. */
  readonly previousTotalMs: number | null;
  /** `current - previous`, or `null` when either side is unmeasured. */
  readonly deltaMs: number | null;
  /** "Beat half the previous cycle's time": `previous / 2`, or `null`. */
  readonly targetMs: number | null;
}

/**
 * Derive the time-halving guidance from the current cycle's metrics and the
 * previous cycle's metrics (`null` when this is the first cycle of the block).
 * Pure and side-effect free; it never invents a `0` for an empty sample.
 */
export function cycleTimeGoal(current: CycleMetrics, previous: CycleMetrics | null): CycleTimeGoal {
  const currentMeasured = current.puzzlesCompleted > 0;
  const previousTotalMs =
    previous !== null && previous.puzzlesCompleted > 0 ? previous.solvingTime.totalMs : null;
  return {
    currentTotalMs: current.solvingTime.totalMs,
    currentMeasured,
    previousTotalMs,
    deltaMs:
      currentMeasured && previousTotalMs !== null
        ? current.solvingTime.totalMs - previousTotalMs
        : null,
    targetMs: previousTotalMs === null ? null : previousTotalMs / 2,
  };
}

/**
 * A same-block spacing nudge: the immediately preceding cycle of the block and
 * how long ago it ended. `null` when the block has no previous cycle, the
 * previous cycle never ended, or the gap already meets the recommendation.
 */
export interface CycleSpacingNudge {
  readonly previousCycleNumber: number;
  readonly previousEndedAt: number;
  /** `current.startedAt - previousEndedAt` in millis (may be negative). */
  readonly elapsedMs: number;
}

/**
 * Derive the spacing nudge for a cycle of a block (spec §4). Finds the
 * immediately preceding cycle by number and returns a nudge when it ended less
 * than `SPACING_RECOMMENDED_MS` before the current cycle started. Pure; the
 * caller decides whether the set is a block and whether to surface it.
 */
export function spacingNudgeFor(
  cycles: readonly TrainingCycleRow[],
  current: TrainingCycleRow,
): CycleSpacingNudge | null {
  let previous: TrainingCycleRow | null = null;
  for (const cycle of cycles) {
    if (cycle.cycleNumber >= current.cycleNumber) {
      continue;
    }
    if (previous === null || cycle.cycleNumber > previous.cycleNumber) {
      previous = cycle;
    }
  }
  if (previous === null) {
    return null;
  }
  const endedAt = previous.completedAt ?? previous.abandonedAt;
  if (endedAt === null) {
    return null;
  }
  const elapsedMs = current.startedAt - endedAt;
  if (elapsedMs >= SPACING_RECOMMENDED_MS) {
    return null;
  }
  return { previousCycleNumber: previous.cycleNumber, previousEndedAt: endedAt, elapsedMs };
}
