/**
 * Feature 018 — Home data-source adapter (infrastructure).
 *
 * The narrow read-only seam the `useHome` hook consumes. The browser
 * implementation statically imports the Dexie repositories (Feature 007/013)
 * and **dynamically** imports the Feature-014 statistics service, so the
 * service, its worker client and the engine module it pulls in never enter the
 * initial Home chunk. The canonical Feature-013 `masteredPuzzleIds` derivation
 * is reused for the mastered count — Home re-implements no mastery math.
 */

import type { TrainingSetStats } from '@/domain/statistics';
import type { PuzzleRow } from '@/domain/puzzle';
import type {
  TacticalTrainingSetRow,
  TrainingCycleRow,
  TrainingSetStatus,
} from '@/domain/training/cycleTypes';
import { masteredPuzzleIds } from '@/domain/training/mastery';
import { attemptsRepository } from '@/infrastructure/db/attempts-repository';
import { gamesRepository } from '@/infrastructure/db/games-repository';
import { puzzlesRepository } from '@/infrastructure/db/puzzles-repository';
import { trainingCyclesRepository } from '@/infrastructure/db/training-cycles-repository';
import { trainingSetsRepository } from '@/infrastructure/db/training-sets-repository';
import type {
  GameMetricsReport,
  StatisticsReadOptions,
  StatisticsResult,
  StatisticsServiceQuery,
} from '@/infrastructure/statistics';

/** The canonical mastered/total puzzle counts Home surfaces. */
export interface HomeMasteryData {
  /** Size of the canonical Feature-013 `masteredPuzzleIds` set. */
  readonly mastered: number;
  /** Total persisted puzzles. */
  readonly total: number;
}

/** The narrow read-only seam the Home hook consumes (structurally fake-able). */
export interface HomeDataSource {
  /** Total stored games (Feature 007). */
  countGames(): Promise<number>;
  /** Canonical Feature-014 game metrics over the requested query. */
  gameMetrics(
    query: StatisticsServiceQuery,
    options?: StatisticsReadOptions,
  ): Promise<StatisticsResult<GameMetricsReport>>;
  /** Training sets filtered by status (Feature 013). */
  listSets(options?: {
    readonly status?: TrainingSetStatus;
  }): Promise<readonly TacticalTrainingSetRow[]>;
  /** The single open Woodpecker block, or `undefined` when none is open. */
  getOpenBlock(): Promise<TacticalTrainingSetRow | undefined>;
  /** Every persisted training cycle (Feature 013). */
  listCycles(): Promise<readonly TrainingCycleRow[]>;
  /** Canonical Feature-014 set statistics for one set. */
  trainingSetStats(
    setId: string,
    options?: StatisticsReadOptions,
  ): Promise<StatisticsResult<TrainingSetStats>>;
  /** Canonical Feature-013 mastery size plus the persisted puzzle count. */
  masterySummary(): Promise<HomeMasteryData>;
  /** The most recently created puzzle (Home preview), or `undefined`. */
  latestPuzzle(): Promise<PuzzleRow | undefined>;
}

/** The production browser data source (repositories + dynamic statistics service). */
export function createBrowserHomeDataSource(): HomeDataSource {
  return {
    countGames: () => gamesRepository.countGames(),
    async gameMetrics(query, options) {
      const { getBrowserStatisticsService } = await import('@/infrastructure/statistics');
      return getBrowserStatisticsService().gameMetrics(query, options);
    },
    listSets: (options) => trainingSetsRepository.list(options),
    getOpenBlock: () => trainingSetsRepository.getOpenBlock(),
    listCycles: () => trainingCyclesRepository.listAll(),
    async trainingSetStats(setId, options) {
      const { getBrowserStatisticsService } = await import('@/infrastructure/statistics');
      return getBrowserStatisticsService().trainingSetStats(setId, options);
    },
    async masterySummary() {
      const [puzzles, attempts, cycles] = await Promise.all([
        puzzlesRepository.listAll(),
        attemptsRepository.listAll(),
        trainingCyclesRepository.listAll(),
      ]);
      return { mastered: masteredPuzzleIds(attempts, cycles).size, total: puzzles.length };
    },
    async latestPuzzle() {
      const puzzles = await puzzlesRepository.listAll();
      let latest: PuzzleRow | undefined;
      for (const puzzle of puzzles) {
        if (latest === undefined || puzzle.createdAt > latest.createdAt) {
          latest = puzzle;
        }
      }
      return latest;
    },
  };
}
