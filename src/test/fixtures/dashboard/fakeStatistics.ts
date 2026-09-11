/**
 * Feature 015 — deterministic fake statistics source (test-only).
 *
 * Implements the narrow `DashboardStatisticsSource` the hook consumes, records
 * every call and returns configured Feature-014-shaped results. No engine, no
 * network, no IndexedDB. The matching set-listing fake implements
 * `DashboardTrainingSetsSource`.
 */

import type {
  CategoryStats,
  RepeatedlyFailedPuzzle,
  TrainingSetStats,
  TrendMetric,
} from '@/domain/statistics';
import type { TacticalTrainingSetRow, TrainingSetStatus } from '@/domain/training';
import type {
  GameMetricsReport,
  PhaseMetricsReport,
  StatisticsReadOptions,
  StatisticsResult,
  StatisticsServiceQuery,
  StatisticsTrendOptions,
} from '@/infrastructure/statistics';
import type {
  DashboardRatingComputation,
  DashboardStatisticsSource,
  DashboardTrainingSetsSource,
  DashboardTrendComputation,
} from '@/hooks/useDashboard';

/** One configured training-set result bundle. */
export interface FakeTrainingResults {
  readonly stats: TrainingSetStats;
  readonly categories: readonly CategoryStats[];
  readonly failed: readonly RepeatedlyFailedPuzzle[];
}

/** The complete configured result set the fake returns. */
export interface FakeStatisticsData {
  readonly gameMetrics: StatisticsResult<GameMetricsReport>;
  readonly trends: Readonly<Record<TrendMetric, StatisticsResult<DashboardTrendComputation>>>;
  readonly ratings: StatisticsResult<DashboardRatingComputation>;
  readonly phases: StatisticsResult<PhaseMetricsReport>;
  readonly training: Readonly<Record<string, FakeTrainingResults>>;
}

/** One recorded call (method + its identifying arguments). */
export interface FakeStatisticsCall {
  readonly method: string;
  readonly query?: StatisticsServiceQuery;
  readonly metric?: TrendMetric;
  readonly setId?: string;
  readonly options?: StatisticsReadOptions | StatisticsTrendOptions;
}

/** Configurable, call-recording fake `StatisticsService`. */
export class FakeStatisticsSource implements DashboardStatisticsSource {
  data: FakeStatisticsData;
  readonly calls: FakeStatisticsCall[] = [];

  constructor(data: FakeStatisticsData) {
    this.data = data;
  }

  countCalls(method: string): number {
    return this.calls.filter((call) => call.method === method).length;
  }

  callsFor(method: string): readonly FakeStatisticsCall[] {
    return this.calls.filter((call) => call.method === method);
  }

  reset(): void {
    this.calls.length = 0;
  }

  async gameMetrics(
    query: StatisticsServiceQuery,
    options?: StatisticsReadOptions,
  ): Promise<StatisticsResult<GameMetricsReport>> {
    this.calls.push({ method: 'gameMetrics', query, ...(options ? { options } : {}) });
    return this.data.gameMetrics;
  }

  async trendSeries(
    metric: TrendMetric,
    query: StatisticsServiceQuery,
    options?: StatisticsTrendOptions,
  ): Promise<StatisticsResult<DashboardTrendComputation>> {
    this.calls.push({ method: 'trendSeries', metric, query, ...(options ? { options } : {}) });
    return this.data.trends[metric];
  }

  async ratingHistories(
    query: StatisticsServiceQuery,
    options?: StatisticsReadOptions,
  ): Promise<StatisticsResult<DashboardRatingComputation>> {
    this.calls.push({ method: 'ratingHistories', query, ...(options ? { options } : {}) });
    return this.data.ratings;
  }

  async phaseMetrics(
    query: StatisticsServiceQuery,
    options?: StatisticsReadOptions,
  ): Promise<StatisticsResult<PhaseMetricsReport>> {
    this.calls.push({ method: 'phaseMetrics', query, ...(options ? { options } : {}) });
    return this.data.phases;
  }

  async trainingSetStats(
    setId: string,
    options?: StatisticsReadOptions,
  ): Promise<StatisticsResult<TrainingSetStats>> {
    this.calls.push({ method: 'trainingSetStats', setId, ...(options ? { options } : {}) });
    const entry = this.data.training[setId];
    return entry === undefined
      ? { ok: false, reason: 'not-found' }
      : { ok: true, result: entry.stats };
  }

  async weakestCategories(
    setId: string,
    options?: StatisticsReadOptions,
  ): Promise<StatisticsResult<readonly CategoryStats[]>> {
    this.calls.push({ method: 'weakestCategories', setId, ...(options ? { options } : {}) });
    const entry = this.data.training[setId];
    return entry === undefined
      ? { ok: false, reason: 'not-found' }
      : { ok: true, result: entry.categories };
  }

  async repeatedlyFailed(
    setId: string,
    options?: StatisticsReadOptions,
  ): Promise<StatisticsResult<readonly RepeatedlyFailedPuzzle[]>> {
    this.calls.push({ method: 'repeatedlyFailed', setId, ...(options ? { options } : {}) });
    const entry = this.data.training[setId];
    return entry === undefined
      ? { ok: false, reason: 'not-found' }
      : { ok: true, result: entry.failed };
  }
}

/** Configurable fake `DashboardTrainingSetsSource`. */
export class FakeTrainingSetsSource implements DashboardTrainingSetsSource {
  readonly active: readonly TacticalTrainingSetRow[];
  readonly archived: readonly TacticalTrainingSetRow[];
  readonly block: TacticalTrainingSetRow | undefined;
  readonly listCalls: TrainingSetStatus[] = [];
  openBlockCalls = 0;

  constructor(
    active: readonly TacticalTrainingSetRow[] = [],
    archived: readonly TacticalTrainingSetRow[] = [],
    block: TacticalTrainingSetRow | undefined = undefined,
  ) {
    this.active = active;
    this.archived = archived;
    this.block = block;
  }

  async list(
    options: { readonly status?: TrainingSetStatus } = {},
  ): Promise<readonly TacticalTrainingSetRow[]> {
    const status = options.status ?? 'active';
    this.listCalls.push(status);
    return status === 'archived' ? this.archived : this.active;
  }

  async getOpenBlock(): Promise<TacticalTrainingSetRow | undefined> {
    this.openBlockCalls += 1;
    return this.block;
  }
}
