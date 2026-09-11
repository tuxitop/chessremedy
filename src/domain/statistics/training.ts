/**
 * Feature 014 — tactical-training aggregates (pure).
 *
 * The set-scoped statistics layer over Feature-013 sets/cycles and the
 * immutable Feature-012 `PuzzleAttemptRow`s. Every cycle aggregate is derived
 * by the **canonical** Feature-013 `computeCycleMetrics` / `resolvePuzzleCycle`
 * and every mastery count by the canonical `masteryOf` / `masteredPuzzleIds` —
 * no cycle-metric or mastery math is re-implemented here (spec §8/§11,
 * AC #10/#15).
 *
 * Training aggregates are deliberately set-scoped: they never accept the
 * game-analysis platform/time-control/date filters (spec §8). A training set is
 * a deliberate user artifact, so a puzzle is immutable provenance and game
 * analysis freshness never gates a training statistic.
 *
 * No React, Dexie, Worker, engine or network import.
 */

import { parsePuzzleId, puzzleIdOf } from '@/domain/puzzle/id';
import type { PuzzleRow } from '@/domain/puzzle/types';
import type { TacticalObjective } from '@/domain/tactics';
import { resolvePuzzleCycle, type CycleResolution } from '@/domain/training/cycle';
import { compareCycleMetrics, computeCycleMetrics } from '@/domain/training/cycleMetrics';
import type { CycleComparison, CycleMetrics } from '@/domain/training/cycleMetrics';
import type {
  TacticalTrainingSetRow,
  TrainingCycleRow,
  TrainingCycleStatus,
  TrainingSetStatus,
} from '@/domain/training/cycleTypes';
import { masteredPuzzleIds } from '@/domain/training/mastery';
import type { PuzzleAttemptRow } from '@/domain/training/types';
import { aggregateOf, emptyAggregate } from './aggregate';
import { MIN_SAMPLE_SIZE } from './types';
import type { Aggregate } from './types';

/** Category a puzzle belongs to in the weakest-categories ranking. */
export type WeaknessCategory = TacticalObjective | 'blunder';

/** Solving-time aggregates for one cycle; averages/median are per completed puzzle. */
export interface CycleSolvingTimeStats {
  /** Σ `solvingTimeMs` over definite presentations (a real `0` when none). */
  readonly totalMs: number;
  /** `totalMs / puzzlesCompleted`, or `empty` when no puzzle is definite. */
  readonly average: Aggregate;
  /** Median per-completed-puzzle solving time, or `empty` when none. */
  readonly median: Aggregate;
}

/**
 * One cycle's statistics. `metrics` is the canonical Feature-013
 * `CycleMetrics`; the rate/time fields wrap the same values as honest
 * `Aggregate`s (`sample.unit = 'puzzles'`, `n = puzzlesCompleted`) so the
 * dashboard can render `n`/state and never a fabricated zero. `partial` marks
 * an `inProgress` cycle; `abandoned` is carried in `status`.
 */
export interface CycleStats {
  readonly cycleId: string;
  readonly trainingSetId: string;
  readonly cycleNumber: number;
  readonly status: TrainingCycleStatus;
  /** True for an `inProgress` cycle (partial aggregates). */
  readonly partial: boolean;
  readonly startedAt: number;
  readonly completedAt: number | null;
  readonly abandonedAt: number | null;
  /** The canonical Feature-013 cycle metrics (reused verbatim). */
  readonly metrics: CycleMetrics;
  /** Per-puzzle canonical resolutions in cycle snapshot order (pending omitted). */
  readonly resolutions: readonly CycleResolution[];
  readonly firstTryAccuracy: Aggregate;
  readonly solveRate: Aggregate;
  readonly solvingTime: CycleSolvingTimeStats;
}

/** Inputs to `cycleStatsFor`. */
export interface CycleStatsInput {
  readonly cycle: TrainingCycleRow;
  /** Attempt rows for the cycle (rows for other cycles are ignored). */
  readonly attempts: readonly PuzzleAttemptRow[];
  /** Snapshot puzzle ids whose row no longer exists (excluded). */
  readonly missingPuzzleIds?: ReadonlySet<string>;
}

/**
 * Per-cycle statistics for one cycle: canonical `computeCycleMetrics` over the
 * cycle's snapshot membership plus canonical per-puzzle `resolvePuzzleCycle`
 * resolutions. Attempts belonging to another cycle are ignored. `skipped`
 * never enters an accuracy/solve-rate denominator; a cycle with zero definite
 * puzzles yields `empty` rate/time aggregates (never `0`).
 */
export function cycleStatsFor(input: CycleStatsInput): CycleStats {
  const attempts = input.attempts.filter((attempt) => attempt.cycleId === input.cycle.id);
  const metrics = computeCycleMetrics({
    puzzleIds: input.cycle.puzzleIds,
    attempts,
    ...(input.missingPuzzleIds === undefined ? {} : { missingPuzzleIds: input.missingPuzzleIds }),
  });
  return {
    cycleId: input.cycle.id,
    trainingSetId: input.cycle.trainingSetId,
    cycleNumber: input.cycle.cycleNumber,
    status: input.cycle.status,
    partial: input.cycle.status === 'inProgress',
    startedAt: input.cycle.startedAt,
    completedAt: input.cycle.completedAt,
    abandonedAt: input.cycle.abandonedAt,
    metrics,
    resolutions: resolutionsFor(input.cycle.puzzleIds, attempts, input.missingPuzzleIds),
    firstTryAccuracy: aggregateOf(metrics.firstTryAccuracy, metrics.puzzlesCompleted, 'puzzles'),
    solveRate: aggregateOf(metrics.solveRate, metrics.puzzlesCompleted, 'puzzles'),
    solvingTime: {
      totalMs: metrics.solvingTime.totalMs,
      average: aggregateOf(metrics.solvingTime.averageMs, metrics.puzzlesCompleted, 'puzzles'),
      median: aggregateOf(metrics.solvingTime.medianMs, metrics.puzzlesCompleted, 'puzzles'),
    },
  };
}

/** Per-puzzle canonical resolutions in snapshot order (pending puzzles omitted). */
function resolutionsFor(
  puzzleIds: readonly string[],
  attempts: readonly PuzzleAttemptRow[],
  missingPuzzleIds?: ReadonlySet<string>,
): CycleResolution[] {
  const grouped = groupByPuzzle(attempts);
  const resolutions: CycleResolution[] = [];
  for (const puzzleId of puzzleIds) {
    if (missingPuzzleIds?.has(puzzleId) === true) {
      continue;
    }
    const rows = grouped.get(puzzleId);
    if (rows === undefined || rows.length === 0) {
      continue;
    }
    resolutions.push(resolvePuzzleCycle(puzzleId, rows));
  }
  return resolutions;
}

/** Group attempt rows by puzzle id, preserving input order within a puzzle. */
function groupByPuzzle(attempts: readonly PuzzleAttemptRow[]): Map<string, PuzzleAttemptRow[]> {
  const grouped = new Map<string, PuzzleAttemptRow[]>();
  for (const attempt of attempts) {
    const bucket = grouped.get(attempt.puzzleId);
    if (bucket === undefined) {
      grouped.set(attempt.puzzleId, [attempt]);
    } else {
      bucket.push(attempt);
    }
  }
  return grouped;
}

/**
 * Set-level training statistics. `cycles` are ordered by cycle number
 * ascending; `currentCycle` is the highest-numbered cycle (the set's most
 * recent pass). Completed, in-progress and abandoned cycles are also exposed
 * separately so a consumer never conflates an abandoned partial pass with a
 * completed one.
 */
export interface TrainingSetStats {
  readonly setId: string;
  readonly name: string;
  readonly status: TrainingSetStatus;
  /** The stored membership size (a block snapshot or a custom set). */
  readonly puzzleCount: number;
  readonly cycles: readonly CycleStats[];
  readonly currentCycle: CycleStats | null;
  readonly completedCycles: readonly CycleStats[];
  readonly inProgressCycles: readonly CycleStats[];
  readonly abandonedCycles: readonly CycleStats[];
  /**
   * `compareCycleMetrics(current, previous)` for the two most recent cycles of
   * the same set (data only — never a causation/improvement claim). `null`
   * with fewer than two cycles.
   */
  readonly crossCycleComparison: CycleComparison | null;
}

/** Inputs to `setStatsFor`. */
export interface TrainingSetStatsInput {
  readonly set: TacticalTrainingSetRow;
  /** Cycles of the set (cycles of another set are ignored). */
  readonly cycles: readonly TrainingCycleRow[];
  /** Attempt rows (rows for other cycles/sets are ignored per cycle). */
  readonly attempts: readonly PuzzleAttemptRow[];
  /** Optional per-cycle missing puzzle rows (excluded from that cycle). */
  readonly missingPuzzleIdsByCycle?: ReadonlyMap<string, ReadonlySet<string>>;
}

/** Set-level statistics over one training set's cycles and attempts. */
export function setStatsFor(input: TrainingSetStatsInput): TrainingSetStats {
  const cycles = input.cycles
    .filter((cycle) => cycle.trainingSetId === input.set.id)
    .slice()
    .sort((a, b) => a.cycleNumber - b.cycleNumber || compareText(a.id, b.id))
    .map((cycle) => {
      const missingPuzzleIds = input.missingPuzzleIdsByCycle?.get(cycle.id);
      return cycleStatsFor({
        cycle,
        attempts: input.attempts,
        ...(missingPuzzleIds === undefined ? {} : { missingPuzzleIds }),
      });
    });

  const last = cycles[cycles.length - 1] ?? null;
  const previous = cycles[cycles.length - 2] ?? null;

  return {
    setId: input.set.id,
    name: input.set.name,
    status: input.set.status,
    puzzleCount: input.set.puzzleIds.length,
    cycles,
    currentCycle: last,
    completedCycles: cycles.filter((cycle) => cycle.status === 'completed'),
    inProgressCycles: cycles.filter((cycle) => cycle.status === 'inProgress'),
    abandonedCycles: cycles.filter((cycle) => cycle.status === 'abandoned'),
    crossCycleComparison:
      last !== null && previous !== null
        ? compareCycleMetrics(last.metrics, previous.metrics)
        : null,
  };
}

/** One category's weakest-category aggregate. */
export interface CategoryStats {
  readonly category: WeaknessCategory;
  /** Distinct puzzles of this category with at least one attempt row. */
  readonly puzzleCount: number;
  /** Definite puzzles of this category — the accuracy/solve-rate denominator. */
  readonly definiteAttempts: number;
  /** Distinct puzzles of this category eventually solved. */
  readonly solved: number;
  readonly firstTryAccuracy: Aggregate;
  readonly solveRate: Aggregate;
  /** True when `definiteAttempts >= MIN_SAMPLE_SIZE` (enters the ranking). */
  readonly ranked: boolean;
}

/** Inputs to `weakestCategories`. */
export interface WeakestCategoriesInput {
  readonly set: TacticalTrainingSetRow;
  /** Puzzle rows used for the category mapping (orphaned membership skipped). */
  readonly puzzles: readonly PuzzleRow[];
  /** Attempt rows of the set (rows of another set are ignored). */
  readonly attempts: readonly PuzzleAttemptRow[];
}

/**
 * Weakest tactical categories over a set's attempts. A category is
 * `puzzle.tacticalObjective` for a tactical row, `'blunder'` for a
 * blunder-origin row. Only categories with `definiteAttempts >=
 * MIN_SAMPLE_SIZE` enter the ranking; those are returned first, ordered by
 * ascending `solveRate` then ascending category key. Unranked categories are
 * still reported afterwards, ordered by category key. Each rate carries its
 * honest `puzzles` sample (`n = definiteAttempts`).
 */
export function weakestCategories(input: WeakestCategoriesInput): readonly CategoryStats[] {
  const setAttempts = input.attempts.filter((attempt) => attempt.trainingSetId === input.set.id);
  const puzzleById = new Map<string, PuzzleRow>();
  for (const puzzle of input.puzzles) {
    puzzleById.set(puzzleIdOf(puzzle.sourceGameId, puzzle.sourcePly), puzzle);
  }

  const puzzleIdsByCategory = new Map<WeaknessCategory, string[]>();
  for (const puzzleId of input.set.puzzleIds) {
    const puzzle = puzzleById.get(puzzleId);
    if (puzzle === undefined) {
      continue;
    }
    const category = categoryOf(puzzle);
    if (category === null) {
      continue;
    }
    const bucket = puzzleIdsByCategory.get(category);
    if (bucket === undefined) {
      puzzleIdsByCategory.set(category, [puzzleId]);
    } else {
      bucket.push(puzzleId);
    }
  }

  const stats: CategoryStats[] = [];
  for (const [category, puzzleIds] of puzzleIdsByCategory) {
    const metrics = computeCycleMetrics({ puzzleIds, attempts: setAttempts });
    stats.push({
      category,
      puzzleCount: metrics.puzzlesAttempted,
      definiteAttempts: metrics.puzzlesCompleted,
      solved: numeratorOf(metrics.solveRate, metrics.puzzlesCompleted),
      firstTryAccuracy: aggregateOf(metrics.firstTryAccuracy, metrics.puzzlesCompleted, 'puzzles'),
      solveRate: aggregateOf(metrics.solveRate, metrics.puzzlesCompleted, 'puzzles'),
      ranked: metrics.puzzlesCompleted >= MIN_SAMPLE_SIZE,
    });
  }
  return stats.sort(compareCategoryStats);
}

/** A puzzle failed in at least two distinct cycles of one set. */
export interface RepeatedlyFailedPuzzle {
  readonly puzzleId: string;
  readonly sourceGameId: string;
  /** Number of `failed` attempt rows. */
  readonly failureCount: number;
  /** Number of distinct cycles with a failure. */
  readonly cycleCount: number;
  /** The latest failure's `endedAt` (epoch ms). */
  readonly lastFailedAt: number;
}

/** Inputs to `repeatedlyFailedPuzzles`. */
export interface RepeatedlyFailedInput {
  readonly trainingSetId: string;
  readonly attempts: readonly PuzzleAttemptRow[];
}

/**
 * Puzzles failed in at least two distinct cycles of the same set, ordered by
 * `failureCount` descending then `puzzleId` ascending. `sourceGameId` comes
 * from the canonical `parsePuzzleId`; malformed ids are skipped (never
 * fabricated). This is a progress signal only — it schedules or removes
 * nothing (ADR-031).
 */
export function repeatedlyFailedPuzzles(
  input: RepeatedlyFailedInput,
): readonly RepeatedlyFailedPuzzle[] {
  interface FailureAccumulator {
    failureCount: number;
    readonly cycles: Set<string>;
    lastFailedAt: number;
  }

  const byPuzzle = new Map<string, FailureAccumulator>();
  for (const attempt of input.attempts) {
    if (attempt.trainingSetId !== input.trainingSetId || attempt.result !== 'failed') {
      continue;
    }
    let accumulator = byPuzzle.get(attempt.puzzleId);
    if (accumulator === undefined) {
      accumulator = { failureCount: 0, cycles: new Set<string>(), lastFailedAt: attempt.endedAt };
      byPuzzle.set(attempt.puzzleId, accumulator);
    }
    accumulator.failureCount += 1;
    accumulator.cycles.add(attempt.cycleId);
    if (attempt.endedAt > accumulator.lastFailedAt) {
      accumulator.lastFailedAt = attempt.endedAt;
    }
  }

  const repeated: RepeatedlyFailedPuzzle[] = [];
  for (const [puzzleId, accumulator] of byPuzzle) {
    if (accumulator.cycles.size < 2) {
      continue;
    }
    const parsed = parsePuzzleId(puzzleId);
    if (!parsed.ok) {
      continue;
    }
    repeated.push({
      puzzleId,
      sourceGameId: parsed.sourceGameId,
      failureCount: accumulator.failureCount,
      cycleCount: accumulator.cycles.size,
      lastFailedAt: accumulator.lastFailedAt,
    });
  }
  return repeated.sort(
    (a, b) => b.failureCount - a.failureCount || compareText(a.puzzleId, b.puzzleId),
  );
}

/**
 * Distinct mastered puzzles whose `sourceGameId` is `gameId`. Mastery is the
 * canonical global derivation (a legitimate first-try solve in
 * `MASTERY_REQUIRED_CYCLES` distinct cycles). The sample is the `puzzles` that
 * game contributed attempts for; a game with no attempt rows is `empty`, never
 * a fake `0`.
 */
export function masteredPuzzleCountForGame(
  gameId: string,
  attempts: readonly PuzzleAttemptRow[],
  cycles: readonly TrainingCycleRow[],
): Aggregate {
  const candidate = new Set<string>();
  for (const attempt of attempts) {
    const parsed = parsePuzzleId(attempt.puzzleId);
    if (parsed.ok && parsed.sourceGameId === gameId) {
      candidate.add(attempt.puzzleId);
    }
  }
  return masteredAggregate(candidate, masteredPuzzleIds(attempts, cycles));
}

/**
 * Mastered-puzzle counts for several games in one pass. Every requested game id
 * is present in the returned map; a game with no attempt rows maps to `empty`.
 * `cycles` are the persisted cycles an attempt must belong to in order to
 * credit (orphaned rows are ignored).
 */
export function masteredPuzzleCountsForGames(
  gameIds: readonly string[],
  attempts: readonly PuzzleAttemptRow[],
  cycles: readonly TrainingCycleRow[],
): ReadonlyMap<string, Aggregate> {
  const candidates = new Map<string, Set<string>>();
  for (const gameId of gameIds) {
    candidates.set(gameId, new Set<string>());
  }
  for (const attempt of attempts) {
    const parsed = parsePuzzleId(attempt.puzzleId);
    if (!parsed.ok) {
      continue;
    }
    candidates.get(parsed.sourceGameId)?.add(attempt.puzzleId);
  }
  const mastered = masteredPuzzleIds(attempts, cycles);
  const result = new Map<string, Aggregate>();
  for (const [gameId, candidate] of candidates) {
    result.set(gameId, masteredAggregate(candidate, mastered));
  }
  return result;
}

/**
 * Distinct mastered puzzles in a set's stored membership, independent of which
 * set earned the mastery (a block's frozen snapshot or a custom set). The
 * sample is the set's membership puzzles that have at least one attempt row; a
 * set with no attempted member is `empty`. `cycles` are the persisted cycles an
 * attempt must belong to in order to credit (orphaned rows are ignored).
 */
export function masteredPuzzleCountForSet(
  set: TacticalTrainingSetRow,
  attempts: readonly PuzzleAttemptRow[],
  cycles: readonly TrainingCycleRow[],
): Aggregate {
  const attempted = new Set<string>();
  for (const attempt of attempts) {
    if (attempt.trainingSetId === set.id) {
      attempted.add(attempt.puzzleId);
    }
  }
  const candidate = new Set<string>();
  for (const puzzleId of set.puzzleIds) {
    if (attempted.has(puzzleId)) {
      candidate.add(puzzleId);
    }
  }
  return masteredAggregate(candidate, masteredPuzzleIds(attempts, cycles));
}

/** Count the mastered puzzles in a candidate universe, or `empty` when none. */
function masteredAggregate(
  candidate: ReadonlySet<string>,
  mastered: ReadonlySet<string>,
): Aggregate {
  if (candidate.size === 0) {
    return emptyAggregate('puzzles');
  }
  let count = 0;
  for (const puzzleId of candidate) {
    if (mastered.has(puzzleId)) {
      count += 1;
    }
  }
  return aggregateOf(count, candidate.size, 'puzzles');
}

/** Category of a puzzle: blunder-origin (or missing objective) → `'blunder'`. */
function categoryOf(puzzle: PuzzleRow): WeaknessCategory | null {
  if ((puzzle.origin ?? 'tactical') === 'blunder') {
    return 'blunder';
  }
  return puzzle.tacticalObjective ?? null;
}

/**
 * The integer numerator behind a canonical `rate`, or `0` when the rate is
 * `empty`. `computeCycleMetrics` already holds the exact count; multiplying its
 * rate back by the denominator recovers it without re-implementing the cycle
 * math.
 */
function numeratorOf(rateValue: number | null, denominator: number): number {
  if (rateValue === null || denominator <= 0) {
    return 0;
  }
  return Math.round(rateValue * denominator);
}

/** Ranked categories first (ascending solve rate, then category), unranked last. */
function compareCategoryStats(a: CategoryStats, b: CategoryStats): number {
  if (a.ranked !== b.ranked) {
    return a.ranked ? -1 : 1;
  }
  if (a.ranked) {
    const aValue = a.solveRate.value ?? Number.POSITIVE_INFINITY;
    const bValue = b.solveRate.value ?? Number.POSITIVE_INFINITY;
    if (aValue !== bValue) {
      return aValue - bValue;
    }
  }
  return compareText(a.category, b.category);
}

function compareText(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}
