/**
 * Feature 014 — pure statistics compute orchestration.
 *
 * The single, framework-free entry point that turns an already-loaded
 * snapshot plus a `StatisticsQuery` into the canonical aggregate bundles. It
 * exists so the application service's inline path and the off-thread Worker
 * path run **exactly the same** pure orchestration (no duplicated math), and
 * it imports only the Feature-014 domain modules.
 *
 * Every function here is synchronous and deterministic for fixed inputs,
 * `now` and time zone. No React, Dexie, Worker, engine or network import.
 */

import type { AnalysisJob } from '@/domain/analysis/job';
import type { GameId } from '@/domain/chess/game';
import type { GameSource } from '@/domain/chess/gameSource';
import type { Color } from 'chessops/types';
import type { MoveAnalysis } from '@/domain/chess/analysis';
import type { TimeControlCategory } from '@/domain/chess/timeControl';
import type { PuzzleRow } from '@/domain/puzzle/types';
import type { TacticalTrainingSetRow, TrainingCycleRow } from '@/domain/training/cycleTypes';
import type { PuzzleAttemptRow } from '@/domain/training/types';
import { STATISTICS_VERSION } from './types';
import type {
  Aggregate,
  GameHistoryEntry,
  GameMetrics,
  PlatformDimension,
  RatingHistory,
  StatisticsAnalysisSummary,
  StatisticsDiagnostics,
  StatisticsGameRow,
  StatisticsQuery,
  TimeControlDimension,
  TrendGranularity,
  TrendMetric,
  TrendSeries,
  VersionSummary,
  PhaseMetrics,
} from './types';
import {
  buildStatisticsDiagnostics,
  detectionIsCurrent,
  eligibleAnalysisOf,
  groupJobsByGame,
  groupSummariesByAnalysisId,
} from './eligibility';
import { buildGameHistoryEntries } from './history';
import { gameMetricsFor } from './gameMetrics';
import { buildVersionSummary } from './version';
import { partitionGames, resolveStatisticsQuery } from './query';
import { buildTrendSeries } from './trends';
import { ratingHistories } from './rating';
import { phaseMetricsFor, summarizeByPhase } from './phase';
import type { PhaseSummary, PhaseSummarySet } from './phase';
import {
  masteredPuzzleCountsForGames,
  repeatedlyFailedPuzzles,
  setStatsFor,
  weakestCategories,
} from './training';
import type { CategoryStats, RepeatedlyFailedPuzzle, TrainingSetStats } from './training';

/** Already-loaded game-analysis rows the pure aggregation consumes. */
export interface StatisticsGameSnapshot {
  readonly games: readonly StatisticsGameRow[];
  readonly jobs: readonly AnalysisJob[];
  readonly summaries: readonly StatisticsAnalysisSummary[];
}

/** Game snapshot extended with the eligible analyses' persisted moves. */
export interface StatisticsPhaseSnapshot extends StatisticsGameSnapshot {
  readonly analyses: readonly MoveAnalysis[];
}

/** Already-loaded training rows the pure aggregation consumes. */
export interface StatisticsTrainingSnapshot {
  readonly sets: readonly TacticalTrainingSetRow[];
  readonly cycles: readonly TrainingCycleRow[];
  readonly attempts: readonly PuzzleAttemptRow[];
  readonly puzzles: readonly PuzzleRow[];
}

/** One query partition's canonical game metrics plus its history entries. */
export interface GameMetricsPartition {
  readonly platform: PlatformDimension;
  readonly timeControl: TimeControlDimension;
  readonly combined: boolean;
  readonly metrics: GameMetrics;
  readonly entries: readonly GameHistoryEntry[];
}

/** Result of the `gameMetrics` operation. */
export interface GameMetricsComputation {
  readonly partitions: readonly GameMetricsPartition[];
  readonly diagnostics: StatisticsDiagnostics;
  readonly versions: VersionSummary;
  readonly statisticsVersion: number;
}

/** Result of the `trendSeries` operation (one series per concrete pair). */
export interface TrendComputation {
  readonly series: readonly TrendSeries[];
  readonly versions: VersionSummary;
}

/** Result of the `ratingHistories` operation. */
export interface RatingComputation {
  readonly histories: readonly RatingHistory[];
  readonly versions: VersionSummary;
}

/** One query partition's canonical phase aggregates. */
export interface PhaseMetricsPartition {
  readonly platform: GameSource;
  readonly timeControl: TimeControlCategory;
  readonly phases: readonly PhaseMetrics[];
  readonly versions: VersionSummary;
}

/** Result of the `phaseMetrics` operation. */
export interface PhaseComputation {
  readonly partitions: readonly PhaseMetricsPartition[];
  readonly diagnostics: StatisticsDiagnostics;
}

/** Result of the `trainingSetStats` operation. */
export interface TrainingSetComputation {
  readonly stats: TrainingSetStats;
}

/** Result of the `weakestCategories` operation. */
export interface WeakestCategoriesComputation {
  readonly categories: readonly CategoryStats[];
}

/** Result of the `repeatedlyFailed` operation. */
export interface RepeatedlyFailedComputation {
  readonly puzzles: readonly RepeatedlyFailedPuzzle[];
}

/**
 * Result of the `masteredPuzzleCounts` operation. Entries are a plain array so
 * the whole result stays structured-cloneable across a Worker boundary; the
 * application service maps them back to a `Map`.
 */
export interface MasteredCountsComputation {
  readonly counts: readonly (readonly [GameId, Aggregate])[];
}

/** The structured-cloneable operation union the Worker and inline path share. */
export type StatisticsComputeInput =
  | {
      readonly operation: 'gameMetrics';
      readonly query: StatisticsQuery;
      readonly snapshot: StatisticsGameSnapshot;
    }
  | {
      readonly operation: 'trendSeries';
      readonly query: StatisticsQuery;
      readonly metric: TrendMetric;
      readonly granularity: TrendGranularity;
      readonly snapshot: StatisticsGameSnapshot;
    }
  | {
      readonly operation: 'ratingHistories';
      readonly query: StatisticsQuery;
      readonly snapshot: StatisticsGameSnapshot;
    }
  | {
      readonly operation: 'phaseMetrics';
      readonly query: StatisticsQuery;
      readonly snapshot: StatisticsPhaseSnapshot;
    }
  | {
      readonly operation: 'trainingSetStats';
      readonly setId: string;
      readonly snapshot: StatisticsTrainingSnapshot;
    }
  | {
      readonly operation: 'weakestCategories';
      readonly setId: string;
      readonly snapshot: StatisticsTrainingSnapshot;
    }
  | {
      readonly operation: 'repeatedlyFailed';
      readonly setId: string;
      readonly snapshot: StatisticsTrainingSnapshot;
    }
  | {
      readonly operation: 'masteredPuzzleCounts';
      readonly gameIds: readonly GameId[];
      readonly snapshot: StatisticsTrainingSnapshot;
    };

/** The structured-cloneable result union the Worker and inline path share. */
export type StatisticsComputeResult =
  | ({ readonly operation: 'gameMetrics' } & GameMetricsComputation)
  | ({ readonly operation: 'trendSeries' } & TrendComputation)
  | ({ readonly operation: 'ratingHistories' } & RatingComputation)
  | ({ readonly operation: 'phaseMetrics' } & PhaseComputation)
  | ({ readonly operation: 'trainingSetStats' } & TrainingSetComputation)
  | ({ readonly operation: 'weakestCategories' } & WeakestCategoriesComputation)
  | ({ readonly operation: 'repeatedlyFailed' } & RepeatedlyFailedComputation)
  | ({ readonly operation: 'masteredPuzzleCounts' } & MasteredCountsComputation);

/** The number of loaded rows a snapshot carries (the Worker threshold unit). */
export function countSnapshotRows(input: StatisticsComputeInput): number {
  const snapshot = input.snapshot;
  if ('sets' in snapshot) {
    return (
      snapshot.sets.length +
      snapshot.cycles.length +
      snapshot.attempts.length +
      snapshot.puzzles.length
    );
  }
  const analysisRows = 'analyses' in snapshot ? snapshot.analyses.length : 0;
  return snapshot.games.length + snapshot.jobs.length + snapshot.summaries.length + analysisRows;
}

/**
 * Run the pure aggregation for one operation. Synchronous and deterministic;
 * the application service validates the query and guarantees a non-empty
 * snapshot for the training operations before calling.
 */
export function computeStatistics(input: StatisticsComputeInput): StatisticsComputeResult {
  switch (input.operation) {
    case 'gameMetrics':
      return { operation: 'gameMetrics', ...computeGameMetrics(input.query, input.snapshot) };
    case 'trendSeries':
      return {
        operation: 'trendSeries',
        ...computeTrends(input.query, input.metric, input.granularity, input.snapshot),
      };
    case 'ratingHistories':
      return {
        operation: 'ratingHistories',
        ...computeRatingHistories(input.query, input.snapshot),
      };
    case 'phaseMetrics':
      return {
        operation: 'phaseMetrics',
        ...computePhaseMetrics(input.query, input.snapshot),
      };
    case 'trainingSetStats':
      return { operation: 'trainingSetStats', stats: computeSetStats(input.snapshot) };
    case 'weakestCategories':
      return {
        operation: 'weakestCategories',
        categories: weakestCategories({
          set: requireSet(input.snapshot, input.setId),
          puzzles: input.snapshot.puzzles,
          attempts: input.snapshot.attempts,
        }),
      };
    case 'repeatedlyFailed':
      return {
        operation: 'repeatedlyFailed',
        puzzles: repeatedlyFailedPuzzles({
          trainingSetId: input.setId,
          attempts: input.snapshot.attempts,
        }),
      };
    case 'masteredPuzzleCounts':
      return {
        operation: 'masteredPuzzleCounts',
        counts: [
          ...masteredPuzzleCountsForGames(
            input.gameIds,
            input.snapshot.attempts,
            input.snapshot.cycles,
          ),
        ],
      };
  }
}

function requireSet(snapshot: StatisticsTrainingSnapshot, setId: string): TacticalTrainingSetRow {
  const set = snapshot.sets.find((candidate) => candidate.id === setId);
  if (set === undefined) {
    throw new Error(`Statistics compute: training set ${setId} was not loaded.`);
  }
  return set;
}

function computeGameMetrics(
  query: StatisticsQuery,
  snapshot: StatisticsGameSnapshot,
): GameMetricsComputation {
  const jobsByGame = groupJobsByGame(snapshot.jobs);
  const summariesByAnalysisId = groupSummariesByAnalysisId(snapshot.summaries);
  const entries = buildGameHistoryEntries(snapshot.games, jobsByGame, summariesByAnalysisId);
  const entryById = new Map(entries.map((entry) => [entry.gameId, entry]));

  const partitions = partitionGames(snapshot.games, query, 'speedSensitive').map((partition) => {
    const partitionEntries = partition.games
      .map((game) => entryById.get(game.id))
      .filter((entry): entry is GameHistoryEntry => entry !== undefined);
    return {
      platform: partition.platform,
      timeControl: partition.timeControl,
      combined: partition.combined,
      metrics: gameMetricsFor(partitionEntries),
      entries: partitionEntries,
    };
  });

  return {
    partitions,
    diagnostics: buildStatisticsDiagnostics({
      games: snapshot.games,
      jobsByGame,
      summaries: snapshot.summaries,
    }),
    versions: buildVersionSummary(snapshot.jobs, snapshot.summaries),
    statisticsVersion: STATISTICS_VERSION,
  };
}

function computeTrends(
  query: StatisticsQuery,
  metric: TrendMetric,
  granularity: TrendGranularity,
  snapshot: StatisticsGameSnapshot,
): TrendComputation {
  const jobsByGame = groupJobsByGame(snapshot.jobs);
  const summariesByAnalysisId = groupSummariesByAnalysisId(snapshot.summaries);
  const entries = buildGameHistoryEntries(snapshot.games, jobsByGame, summariesByAnalysisId);
  const entryById = new Map(entries.map((entry) => [entry.gameId, entry]));
  const versions = buildVersionSummary(snapshot.jobs, snapshot.summaries);
  const window = resolveStatisticsQuery(query).window;

  const series = partitionGames(snapshot.games, query, 'speedSensitive').map((partition) => {
    const observations = partition.games
      .map((game) => entryById.get(game.id))
      .filter((entry): entry is GameHistoryEntry => entry !== undefined);
    return buildTrendSeries({
      metric,
      granularity,
      observations,
      platform: partition.platform as GameSource,
      timeControl: partition.timeControl as TimeControlCategory,
      window,
      versions,
    });
  });

  return { series, versions };
}

function computeRatingHistories(
  query: StatisticsQuery,
  snapshot: StatisticsGameSnapshot,
): RatingComputation {
  const versions = buildVersionSummary(snapshot.jobs, snapshot.summaries);
  return { histories: ratingHistories(snapshot.games, query, versions), versions };
}

function computePhaseMetrics(
  query: StatisticsQuery,
  snapshot: StatisticsPhaseSnapshot,
): PhaseComputation {
  const jobsByGame = groupJobsByGame(snapshot.jobs);
  const summariesByAnalysisId = groupSummariesByAnalysisId(snapshot.summaries);

  const currentDetectionAnalysisIds = new Set<string>();
  for (const game of snapshot.games) {
    const eligible = eligibleAnalysisOf(
      game.id,
      jobsByGame.get(game.id) ?? [],
      summariesByAnalysisId,
    );
    if (eligible && detectionIsCurrent(eligible.summary)) {
      currentDetectionAnalysisIds.add(eligible.analysisId);
    }
  }

  const partitions = partitionGames(snapshot.games, query, 'speedSensitive').map((partition) => {
    const gameById = new Map(partition.games.map((game) => [game.id, game]));
    const records = snapshot.analyses.filter((record) => gameById.has(record.gameId));
    const phases = phaseMetricsFor(
      phaseSetForRecords(records, gameById, currentDetectionAnalysisIds),
    );
    const partitionJobs = snapshot.jobs.filter((job) => gameById.has(job.gameId));
    const partitionSummaries = snapshot.summaries.filter((summary) => gameById.has(summary.gameId));
    return {
      platform: partition.platform as GameSource,
      timeControl: partition.timeControl as TimeControlCategory,
      phases,
      versions: buildVersionSummary(partitionJobs, partitionSummaries, records),
    };
  });

  return {
    partitions,
    diagnostics: buildStatisticsDiagnostics({
      games: snapshot.games,
      jobsByGame,
      summaries: snapshot.summaries,
    }),
  };
}

function computeSetStats(snapshot: StatisticsTrainingSnapshot): TrainingSetStats {
  const set = snapshot.sets[0];
  if (set === undefined) {
    throw new Error('Statistics compute: training set was not loaded.');
  }
  const present = new Set(
    snapshot.puzzles.map((puzzle) => `${puzzle.sourceGameId}:${puzzle.sourcePly}`),
  );
  const missingPuzzleIdsByCycle = new Map<string, ReadonlySet<string>>();
  for (const cycle of snapshot.cycles) {
    const missing = cycle.puzzleIds.filter((id) => !present.has(id));
    missingPuzzleIdsByCycle.set(cycle.id, new Set(missing));
  }
  return setStatsFor({
    set,
    cycles: snapshot.cycles,
    attempts: snapshot.attempts,
    missingPuzzleIdsByCycle,
  });
}

/**
 * Group records by their game's user color and merge the per-color phase
 * summaries into one. A game has exactly one user color, so the per-color
 * game denominators are disjoint and summing them is exact.
 */
function phaseSetForRecords(
  records: readonly MoveAnalysis[],
  gameById: ReadonlyMap<string, StatisticsGameRow>,
  currentDetectionAnalysisIds: ReadonlySet<string>,
): PhaseSummarySet {
  const byColor: Record<Color, MoveAnalysis[]> = { white: [], black: [] };
  for (const record of records) {
    const game = gameById.get(record.gameId);
    if (game === undefined) {
      continue;
    }
    byColor[game.userColor].push(record);
  }
  return mergePhaseSets([
    summarizeByPhase(byColor.white, 'white', currentDetectionAnalysisIds),
    summarizeByPhase(byColor.black, 'black', currentDetectionAnalysisIds),
  ]);
}

function mergePhaseSets(sets: readonly PhaseSummarySet[]): PhaseSummarySet {
  const first = sets[0];
  if (first === undefined) {
    return { analyzedGames: 0, detectedGames: 0, phases: [] };
  }
  const phases: PhaseSummary[] = first.phases.map((phase, index) => {
    let userMovesInPhase = 0;
    let detectedUserMovesInPhase = 0;
    let inaccuracies = 0;
    let mistakes = 0;
    let blunders = 0;
    let missedTactics = 0;
    for (const set of sets) {
      const part = set.phases[index];
      if (part === undefined) {
        continue;
      }
      userMovesInPhase += part.userMovesInPhase;
      detectedUserMovesInPhase += part.detectedUserMovesInPhase;
      inaccuracies += part.inaccuracies;
      mistakes += part.mistakes;
      blunders += part.blunders;
      missedTactics += part.missedTactics;
    }
    return {
      phase: phase.phase,
      userMovesInPhase,
      detectedUserMovesInPhase,
      inaccuracies,
      mistakes,
      blunders,
      missedTactics,
    };
  });
  return {
    analyzedGames: sets.reduce((total, set) => total + set.analyzedGames, 0),
    detectedGames: sets.reduce((total, set) => total + set.detectedGames, 0),
    phases,
  };
}
