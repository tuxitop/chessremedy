/**
 * Feature 018 — deterministic fake Home data source (test-only).
 *
 * Implements the narrow `HomeDataSource` the hook consumes, records every call
 * and returns configured Feature-014/013-shaped results. No engine, network or
 * IndexedDB; each method can be made to reject so slice independence is
 * assertable.
 */

import type { TrainingSetStats } from '@/domain/statistics';
import type {
  TacticalTrainingSetRow,
  TrainingCycleRow,
  TrainingSetStatus,
} from '@/domain/training/cycleTypes';
import type { HomeDataSource, HomeMasteryData } from '@/infrastructure/home/home-data-source';
import type {
  GameMetricsReport,
  StatisticsReadOptions,
  StatisticsResult,
  StatisticsServiceQuery,
} from '@/infrastructure/statistics';

/** The complete configured result set the fake returns. */
export interface FakeHomeResults {
  readonly totalGames: number;
  readonly gameMetrics: StatisticsResult<GameMetricsReport>;
  readonly activeSets: readonly TacticalTrainingSetRow[];
  readonly archivedSets: readonly TacticalTrainingSetRow[];
  readonly openBlock: TacticalTrainingSetRow | null;
  readonly cycles: readonly TrainingCycleRow[];
  readonly mastery: HomeMasteryData;
  /** Feature-014 set statistics keyed by set id. */
  readonly blockStats: Readonly<Record<string, TrainingSetStats>>;
}

/** One recorded call (method + its identifying arguments). */
export interface FakeHomeCall {
  readonly method: string;
  readonly query?: StatisticsServiceQuery;
  readonly setId?: string;
  readonly status?: TrainingSetStatus;
  readonly options?: StatisticsReadOptions;
}

/** Configurable, call-recording fake `HomeDataSource`. */
export class FakeHomeDataSource implements HomeDataSource {
  data: FakeHomeResults;
  readonly calls: FakeHomeCall[] = [];
  failGame = false;
  failTraining = false;
  failMastery = false;
  failBlock = false;

  constructor(data: FakeHomeResults) {
    this.data = data;
  }

  countCalls(method: string): number {
    return this.calls.filter((call) => call.method === method).length;
  }

  callsFor(method: string): readonly FakeHomeCall[] {
    return this.calls.filter((call) => call.method === method);
  }

  reset(): void {
    this.calls.length = 0;
  }

  async countGames(): Promise<number> {
    this.calls.push({ method: 'countGames' });
    if (this.failGame) {
      throw new Error('countGames failed');
    }
    return this.data.totalGames;
  }

  async gameMetrics(
    query: StatisticsServiceQuery,
    options?: StatisticsReadOptions,
  ): Promise<StatisticsResult<GameMetricsReport>> {
    this.calls.push({ method: 'gameMetrics', query, ...(options ? { options } : {}) });
    if (this.failGame) {
      throw new Error('gameMetrics failed');
    }
    return this.data.gameMetrics;
  }

  async listSets(
    options: { readonly status?: TrainingSetStatus } = {},
  ): Promise<readonly TacticalTrainingSetRow[]> {
    const status = options.status ?? 'active';
    this.calls.push({ method: 'listSets', status });
    if (this.failTraining) {
      throw new Error('listSets failed');
    }
    return status === 'archived' ? this.data.archivedSets : this.data.activeSets;
  }

  async getOpenBlock(): Promise<TacticalTrainingSetRow | undefined> {
    this.calls.push({ method: 'getOpenBlock' });
    if (this.failTraining) {
      throw new Error('getOpenBlock failed');
    }
    return this.data.openBlock ?? undefined;
  }

  async listCycles(): Promise<readonly TrainingCycleRow[]> {
    this.calls.push({ method: 'listCycles' });
    if (this.failTraining) {
      throw new Error('listCycles failed');
    }
    return this.data.cycles;
  }

  async trainingSetStats(
    setId: string,
    options?: StatisticsReadOptions,
  ): Promise<StatisticsResult<TrainingSetStats>> {
    this.calls.push({ method: 'trainingSetStats', setId, ...(options ? { options } : {}) });
    if (this.failBlock) {
      throw new Error('trainingSetStats failed');
    }
    const stats = this.data.blockStats[setId];
    return stats === undefined ? { ok: false, reason: 'not-found' } : { ok: true, result: stats };
  }

  async masterySummary(): Promise<HomeMasteryData> {
    this.calls.push({ method: 'masterySummary' });
    if (this.failMastery) {
      throw new Error('masterySummary failed');
    }
    return this.data.mastery;
  }
}
