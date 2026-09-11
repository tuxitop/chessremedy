/**
 * Feature 014 — statistics application service (infrastructure).
 *
 * Loads only the rows a query needs through the existing read-only
 * repositories, then runs the pure Feature-014 aggregation (inline for small
 * snapshots, off-thread in a Worker above `STATISTICS_WORKER_ROW_THRESHOLD`).
 * It:
 *
 * - pushes the query window/dimensions down into the games read and excludes
 *   `fixture` sources from production results (test-only opt-in);
 * - selects each game's **eligible analysis** (latest completed job with a
 *   persisted summary) and reads `MoveAnalysis` only for those analyses and
 *   only when phase metrics are requested;
 * - reads training rows only for the requested set/cycles (or the global
 *   attempts read for mastered counts);
 * - memoizes behind a caller-supplied `dataVersionKey` (non-authoritative: a
 *   miss recomputes, and no key means no caching);
 * - may invoke an injected lazy-summary backfill, swallowing and counting
 *   failures; Feature 014 never writes a summary itself;
 * - returns typed `{ ok } | { ok: false, reason }` results, never throwing on
 *   a malformed query.
 *
 * Expensive work never runs on the UI thread above the threshold (ARCHITECTURE
 * §10). All clocks and repositories are injectable for tests.
 */

import type { AnalysisJob } from '@/domain/analysis/job';
import type { GameId } from '@/domain/chess/game';
import type { PuzzleRow } from '@/domain/puzzle/types';
import {
  computeStatistics,
  countSnapshotRows,
  eligibleAnalysisOf,
  groupJobsByGame,
  groupSummariesByAnalysisId,
  isProductionPlatform,
  resolveStatisticsQuery,
  validateStatisticsQuery,
} from '@/domain/statistics';
import type {
  Aggregate,
  CategoryStats,
  RepeatedlyFailedPuzzle,
  StatisticsAnalysisSummary,
  StatisticsComputeInput,
  StatisticsComputeResult,
  StatisticsDiagnostics,
  StatisticsGameRow,
  StatisticsQuery,
  StatisticsTrainingSnapshot,
  TrainingSetStats,
  TrendGranularity,
  TrendMetric,
} from '@/domain/statistics';
import type { PuzzleAttemptRow } from '@/domain/training/types';
import type { TacticalTrainingSetRow, TrainingCycleRow } from '@/domain/training/cycleTypes';
import { toExclusiveQueryInstants } from '@/domain/gameLibrary/timeframe';
import type { AnalysisRepository } from '@/infrastructure/db/analysis-repository';
import type { AnalysisJobsRepository } from '@/infrastructure/db/analysis-jobs-repository';
import type { PuzzleAttemptsRepository } from '@/infrastructure/db/attempts-repository';
import type { GameQuery, GameSummary, GamesRepository } from '@/infrastructure/db/games-repository';
import type { PuzzlesRepository } from '@/infrastructure/db/puzzles-repository';
import type { AnalysisSummariesRepository } from '@/infrastructure/db/summaries-repository';
import type { TrainingCyclesRepository } from '@/infrastructure/db/training-cycles-repository';
import type { TrainingSetsRepository } from '@/infrastructure/db/training-sets-repository';
import type { StatisticsCompute } from './worker-protocol';

/**
 * Loaded-row count above which the pure aggregation is offloaded to a Worker.
 * Initial value from the Feature-014 plan (§7/§11); the benchmark records the
 * measured budget it was chosen against.
 */
export const STATISTICS_WORKER_ROW_THRESHOLD = 2000;

/** A query without a required clock; the service fills it from its `now`. */
export type StatisticsServiceQuery = Omit<StatisticsQuery, 'now'> & {
  readonly now?: number;
};

/** Typed failure reasons; a malformed query never widens silently. */
export type StatisticsFailureReason = 'invalid-date-range' | 'not-found' | 'compute-error';

/** Typed result: never throws for a malformed query or a missing set. */
export type StatisticsResult<T> =
  | { readonly ok: true; readonly result: T }
  | { readonly ok: false; readonly reason: StatisticsFailureReason; readonly message?: string };

/** Domain diagnostics plus the service-owned backfill counters. */
export interface StatisticsServiceDiagnostics extends StatisticsDiagnostics {
  /** Summaries created by the optional backfill during this read. */
  readonly backfillCreated: number;
  /** Backfill invocations that failed (swallowed, never fatal). */
  readonly backfillFailures: number;
}

/** Per-call read options (memo key + optional backfill). */
export interface StatisticsReadOptions {
  /**
   * Caller/assembler-supplied data version. When present, results are memoized
   * under `(queryKey, dataVersionKey)`; when absent, no caching happens.
   */
  readonly dataVersionKey?: string;
  /**
   * Opt-in lazy-summary backfill before computing (uses the injected
   * `ensureSummariesForRows`). Feature 014 never writes summaries itself.
   */
  readonly backfill?: boolean;
}

/** Trend read options (granularity defaults to `week`). */
export interface StatisticsTrendOptions extends StatisticsReadOptions {
  readonly granularity?: TrendGranularity;
}

/** Canonical game-metrics report (compute bundle + service diagnostics). */
export type GameMetricsReport = Extract<StatisticsComputeResult, { operation: 'gameMetrics' }> & {
  readonly diagnostics: StatisticsServiceDiagnostics;
};

/** Canonical phase-metrics report (compute bundle + service diagnostics). */
export type PhaseMetricsReport = Extract<StatisticsComputeResult, { operation: 'phaseMetrics' }> & {
  readonly diagnostics: StatisticsServiceDiagnostics;
};

export interface StatisticsServiceOptions {
  readonly games: GamesRepository;
  readonly jobs: AnalysisJobsRepository;
  readonly summaries: AnalysisSummariesRepository;
  readonly analyses: AnalysisRepository;
  readonly puzzles: PuzzlesRepository;
  readonly attempts: PuzzleAttemptsRepository;
  readonly sets: TrainingSetsRepository;
  readonly cycles: TrainingCyclesRepository;
  /** Wall clock for a query that omits `now`; defaults to `Date.now`. */
  readonly now?: () => number;
  /** Optional Feature-010 lazy-summary backfill. */
  readonly ensureSummariesForRows?: (gameIds: readonly GameId[]) => Promise<number>;
  /** Optional off-thread compute used above the row threshold. */
  readonly worker?: StatisticsCompute;
  /** Override the Worker threshold (tests/benchmarks). */
  readonly workerRowThreshold?: number;
  /** Test-only: include `fixture`-source games in production results. */
  readonly includeFixtureSources?: boolean;
}

/** Game rows plus the derived rows and backfill counters for one read. */
interface LoadedGames {
  readonly games: readonly StatisticsGameRow[];
  readonly jobs: readonly AnalysisJob[];
  readonly summaries: readonly StatisticsAnalysisSummary[];
  readonly backfillCreated: number;
  readonly backfillFailures: number;
}

/** One set's loaded training rows (or `undefined` when the set is absent). */
interface LoadedTrainingRows {
  readonly set: TacticalTrainingSetRow;
  readonly cycles: readonly TrainingCycleRow[];
  readonly attempts: readonly PuzzleAttemptRow[];
  readonly puzzles: readonly PuzzleRow[];
}

export class StatisticsService {
  private readonly games: GamesRepository;
  private readonly jobs: AnalysisJobsRepository;
  private readonly summaries: AnalysisSummariesRepository;
  private readonly analyses: AnalysisRepository;
  private readonly puzzles: PuzzlesRepository;
  private readonly attempts: PuzzleAttemptsRepository;
  private readonly sets: TrainingSetsRepository;
  private readonly cycles: TrainingCyclesRepository;
  private readonly now: () => number;
  private readonly ensureSummariesForRows: ((gameIds: readonly GameId[]) => Promise<number>) | null;
  private readonly worker: StatisticsCompute | null;
  private readonly workerRowThreshold: number;
  private readonly includeFixtureSources: boolean;
  private readonly memo = new Map<string, Promise<StatisticsComputeResult>>();
  private requestId = 0;

  constructor(options: StatisticsServiceOptions) {
    this.games = options.games;
    this.jobs = options.jobs;
    this.summaries = options.summaries;
    this.analyses = options.analyses;
    this.puzzles = options.puzzles;
    this.attempts = options.attempts;
    this.sets = options.sets;
    this.cycles = options.cycles;
    this.now = options.now ?? (() => Date.now());
    this.ensureSummariesForRows = options.ensureSummariesForRows ?? null;
    this.worker = options.worker ?? null;
    this.workerRowThreshold = options.workerRowThreshold ?? STATISTICS_WORKER_ROW_THRESHOLD;
    this.includeFixtureSources = options.includeFixtureSources ?? false;
  }

  /** Canonical game-analysis metrics, dimensioned per concrete partition. */
  async gameMetrics(
    queryInput: StatisticsServiceQuery,
    options: StatisticsReadOptions = {},
  ): Promise<StatisticsResult<GameMetricsReport>> {
    const query = this.normalizeQuery(queryInput);
    const invalid = validateStatisticsQuery(query);
    if (!invalid.ok) {
      return { ok: false, reason: invalid.reason, message: invalid.message };
    }
    const loaded = await this.loadGames(query, options.backfill === true);
    const memoKey =
      options.backfill === true
        ? undefined
        : this.memoKey('gameMetrics', query, options.dataVersionKey, '');
    const result = await this.run(
      {
        operation: 'gameMetrics',
        query,
        snapshot: { games: loaded.games, jobs: loaded.jobs, summaries: loaded.summaries },
      },
      memoKey,
    );
    if (result.operation !== 'gameMetrics') {
      return { ok: false, reason: 'compute-error' };
    }
    return {
      ok: true,
      result: {
        ...result,
        diagnostics: {
          ...result.diagnostics,
          backfillCreated: loaded.backfillCreated,
          backfillFailures: loaded.backfillFailures,
        },
      },
    };
  }

  /** One trend series per concrete `(platform, timeControl)` partition. */
  async trendSeries(
    metric: TrendMetric,
    queryInput: StatisticsServiceQuery,
    options: StatisticsTrendOptions = {},
  ): Promise<StatisticsResult<Extract<StatisticsComputeResult, { operation: 'trendSeries' }>>> {
    const query = this.normalizeQuery(queryInput);
    const invalid = validateStatisticsQuery(query);
    if (!invalid.ok) {
      return { ok: false, reason: invalid.reason, message: invalid.message };
    }
    const granularity = options.granularity ?? 'week';
    const loaded = await this.loadGames(query, options.backfill === true);
    const memoKey =
      options.backfill === true
        ? undefined
        : this.memoKey(
            'trendSeries',
            query,
            options.dataVersionKey,
            `${metric}\u0000${granularity}`,
          );
    const result = await this.run(
      {
        operation: 'trendSeries',
        query,
        metric,
        granularity,
        snapshot: { games: loaded.games, jobs: loaded.jobs, summaries: loaded.summaries },
      },
      memoKey,
    );
    if (result.operation !== 'trendSeries') {
      return { ok: false, reason: 'compute-error' };
    }
    return { ok: true, result };
  }

  /** One rating history per concrete `(platform, timeControl)` with ratings. */
  async ratingHistories(
    queryInput: StatisticsServiceQuery,
    options: StatisticsReadOptions = {},
  ): Promise<StatisticsResult<Extract<StatisticsComputeResult, { operation: 'ratingHistories' }>>> {
    const query = this.normalizeQuery(queryInput);
    const invalid = validateStatisticsQuery(query);
    if (!invalid.ok) {
      return { ok: false, reason: invalid.reason, message: invalid.message };
    }
    const loaded = await this.loadGames(query, options.backfill === true);
    const memoKey =
      options.backfill === true
        ? undefined
        : this.memoKey('ratingHistories', query, options.dataVersionKey, '');
    const result = await this.run(
      {
        operation: 'ratingHistories',
        query,
        snapshot: { games: loaded.games, jobs: loaded.jobs, summaries: loaded.summaries },
      },
      memoKey,
    );
    if (result.operation !== 'ratingHistories') {
      return { ok: false, reason: 'compute-error' };
    }
    return { ok: true, result };
  }

  /** Per-phase aggregates over the eligible analyses' persisted moves. */
  async phaseMetrics(
    queryInput: StatisticsServiceQuery,
    options: StatisticsReadOptions = {},
  ): Promise<StatisticsResult<PhaseMetricsReport>> {
    const query = this.normalizeQuery(queryInput);
    const invalid = validateStatisticsQuery(query);
    if (!invalid.ok) {
      return { ok: false, reason: invalid.reason, message: invalid.message };
    }
    const loaded = await this.loadGames(query, options.backfill === true);
    const analysisIds = new Set<string>();
    const jobsByGame = groupJobsByGame(loaded.jobs);
    const summariesByAnalysisId = groupSummariesByAnalysisId(loaded.summaries);
    for (const game of loaded.games) {
      const eligible = eligibleAnalysisOf(
        game.id,
        jobsByGame.get(game.id) ?? [],
        summariesByAnalysisId,
      );
      if (eligible) {
        analysisIds.add(eligible.analysisId);
      }
    }
    const analyses = await this.analyses.listForAnalyses([...analysisIds]);
    const memoKey =
      options.backfill === true
        ? undefined
        : this.memoKey('phaseMetrics', query, options.dataVersionKey, '');
    const result = await this.run(
      {
        operation: 'phaseMetrics',
        query,
        snapshot: {
          games: loaded.games,
          jobs: loaded.jobs,
          summaries: loaded.summaries,
          analyses,
        },
      },
      memoKey,
    );
    if (result.operation !== 'phaseMetrics') {
      return { ok: false, reason: 'compute-error' };
    }
    return {
      ok: true,
      result: {
        ...result,
        diagnostics: {
          ...result.diagnostics,
          backfillCreated: loaded.backfillCreated,
          backfillFailures: loaded.backfillFailures,
        },
      },
    };
  }

  /** One training set's per-cycle aggregates (canonical Feature-013 metrics). */
  async trainingSetStats(
    setId: string,
    options: StatisticsReadOptions = {},
  ): Promise<StatisticsResult<TrainingSetStats>> {
    const rows = await this.loadTrainingRows(setId);
    if (rows === undefined) {
      return { ok: false, reason: 'not-found' };
    }
    const snapshot: StatisticsTrainingSnapshot = {
      sets: [rows.set],
      cycles: rows.cycles,
      attempts: rows.attempts,
      puzzles: rows.puzzles,
    };
    const memoKey = this.memoKey('trainingSetStats', null, options.dataVersionKey, setId);
    const result = await this.run({ operation: 'trainingSetStats', setId, snapshot }, memoKey);
    if (result.operation !== 'trainingSetStats') {
      return { ok: false, reason: 'compute-error' };
    }
    return { ok: true, result: result.stats };
  }

  /** Weakest-category ranking over one set's attempts. */
  async weakestCategories(
    setId: string,
    options: StatisticsReadOptions = {},
  ): Promise<StatisticsResult<readonly CategoryStats[]>> {
    const rows = await this.loadTrainingRows(setId);
    if (rows === undefined) {
      return { ok: false, reason: 'not-found' };
    }
    const snapshot: StatisticsTrainingSnapshot = {
      sets: [rows.set],
      cycles: rows.cycles,
      attempts: rows.attempts,
      puzzles: rows.puzzles,
    };
    const memoKey = this.memoKey('weakestCategories', null, options.dataVersionKey, setId);
    const result = await this.run({ operation: 'weakestCategories', setId, snapshot }, memoKey);
    if (result.operation !== 'weakestCategories') {
      return { ok: false, reason: 'compute-error' };
    }
    return { ok: true, result: result.categories };
  }

  /** Puzzles failed in at least two distinct cycles of one set. */
  async repeatedlyFailed(
    setId: string,
    options: StatisticsReadOptions = {},
  ): Promise<StatisticsResult<readonly RepeatedlyFailedPuzzle[]>> {
    const rows = await this.loadTrainingRows(setId);
    if (rows === undefined) {
      return { ok: false, reason: 'not-found' };
    }
    const snapshot: StatisticsTrainingSnapshot = {
      sets: [rows.set],
      cycles: rows.cycles,
      attempts: rows.attempts,
      puzzles: rows.puzzles,
    };
    const memoKey = this.memoKey('repeatedlyFailed', null, options.dataVersionKey, setId);
    const result = await this.run({ operation: 'repeatedlyFailed', setId, snapshot }, memoKey);
    if (result.operation !== 'repeatedlyFailed') {
      return { ok: false, reason: 'compute-error' };
    }
    return { ok: true, result: result.puzzles };
  }

  /**
   * Mastered-puzzle counts for the requested games (global mastery read). The
   * Game Library's read-only insight; absent attempts yield `empty`, never a
   * fake `0`.
   */
  async masteredPuzzleCounts(
    gameIds: readonly GameId[],
    options: StatisticsReadOptions = {},
  ): Promise<StatisticsResult<ReadonlyMap<GameId, Aggregate>>> {
    const attempts = await this.attempts.listAll();
    const snapshot: StatisticsTrainingSnapshot = {
      sets: [],
      cycles: [],
      attempts,
      puzzles: [],
    };
    const memoKey = this.memoKey(
      'masteredPuzzleCounts',
      null,
      options.dataVersionKey,
      gameIds.join('\u0000'),
    );
    const result = await this.run(
      { operation: 'masteredPuzzleCounts', gameIds, snapshot },
      memoKey,
    );
    if (result.operation !== 'masteredPuzzleCounts') {
      return { ok: false, reason: 'compute-error' };
    }
    return { ok: true, result: new Map(result.counts) };
  }

  /** Drop every memoized result (test/lifecycle helper; never needed for correctness). */
  clearMemo(): void {
    this.memo.clear();
  }

  private normalizeQuery(input: StatisticsServiceQuery): StatisticsQuery {
    return { ...input, now: input.now ?? this.now() };
  }

  private async loadGames(query: StatisticsQuery, backfill: boolean): Promise<LoadedGames> {
    const summaries = await this.games.listGameSummaries(gameQueryFor(query));
    const games = summaries
      .map(toStatisticsGameRow)
      .filter((row) => this.includeFixtureSources || isProductionPlatform(row.source));

    let backfillCreated = 0;
    let backfillFailures = 0;
    if (backfill && this.ensureSummariesForRows !== null && games.length > 0) {
      try {
        backfillCreated = await this.ensureSummariesForRows(games.map((game) => game.id));
      } catch {
        backfillFailures = 1;
      }
    }

    const gameIds = games.map((game) => game.id);
    const [jobs, summaryRows] = await Promise.all([
      this.jobs.listByGames(gameIds),
      this.summaries.listForGames(gameIds),
    ]);
    return { games, jobs, summaries: summaryRows, backfillCreated, backfillFailures };
  }

  private async loadTrainingRows(setId: string): Promise<LoadedTrainingRows | undefined> {
    const set = await this.sets.get(setId);
    if (set === undefined) {
      return undefined;
    }
    const cycles = await this.cycles.listForSet(setId);
    const attemptLists = await Promise.all(
      cycles.map((cycle) => this.attempts.listForCycle(cycle.id)),
    );
    const attempts = attemptLists.flat();
    const puzzles = await this.puzzles.getPuzzles(set.puzzleIds);
    return { set, cycles, attempts, puzzles };
  }

  /**
   * Run one pure operation: memoized when a key is supplied, off-thread when
   * the loaded snapshot crosses the threshold and a Worker is wired. A Worker
   * failure falls back to the inline path so a read never fails because of the
   * transport.
   */
  private async run(
    input: StatisticsComputeInput,
    memoKey: string | undefined,
  ): Promise<StatisticsComputeResult> {
    if (memoKey !== undefined) {
      const cached = this.memo.get(memoKey);
      if (cached !== undefined) {
        return cached;
      }
    }
    const promise = this.compute(input);
    if (memoKey !== undefined) {
      this.memo.set(memoKey, promise);
    }
    return promise;
  }

  private async compute(input: StatisticsComputeInput): Promise<StatisticsComputeResult> {
    if (this.worker !== null && countSnapshotRows(input) >= this.workerRowThreshold) {
      try {
        this.requestId += 1;
        const response = await this.worker.compute({ id: this.requestId, input });
        if (response.ok) {
          return response.result;
        }
      } catch {
        // Fall through to the inline path.
      }
    }
    return computeStatistics(input);
  }

  private memoKey(
    operation: string,
    query: StatisticsQuery | null,
    dataVersionKey: string | undefined,
    extra: string,
  ): string | undefined {
    if (dataVersionKey === undefined) {
      return undefined;
    }
    const queryKey = query === null ? '' : queryKeyOf(query);
    return `${operation}\u0000${extra}\u0000${queryKey}\u0000${dataVersionKey}`;
  }
}

/** Push the query window/dimensions into the games read (existing indexes). */
function gameQueryFor(query: StatisticsQuery): GameQuery {
  const window = resolveStatisticsQuery(query).window;
  const instants = toExclusiveQueryInstants(window);
  return {
    ...(query.platform !== 'all' ? { source: query.platform } : {}),
    ...(query.timeControl !== 'all' ? { normalizedTimeControl: query.timeControl } : {}),
    ...(query.side !== 'all' ? { userColor: query.side } : {}),
    ...instants,
  };
}

function toStatisticsGameRow(summary: GameSummary): StatisticsGameRow {
  const player = summary.userColor === 'white' ? summary.whitePlayer : summary.blackPlayer;
  return {
    id: summary.id,
    source: summary.source,
    playedAt: summary.playedAt,
    normalizedTimeControl: summary.normalizedTimeControl,
    userColor: summary.userColor,
    result: summary.result,
    userRating: player.rating,
  };
}

/** Stable query fingerprint for the memo key (independent of object key order). */
function queryKeyOf(query: StatisticsQuery): string {
  const range =
    query.dateRange.preset === 'custom'
      ? `custom:${query.dateRange.from}:${query.dateRange.to}`
      : query.dateRange.preset;
  return [
    query.platform,
    query.timeControl,
    query.side,
    query.result,
    String(query.now),
    range,
    query.combine === true ? '1' : '0',
  ].join('\u0001');
}
