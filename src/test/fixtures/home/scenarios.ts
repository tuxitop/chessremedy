/**
 * Feature 018 — deterministic Home scenarios (test-only).
 *
 * Builds the `FakeHomeResults` matrix the hook/page/component tests consume by
 * reusing the canonical Feature-014 compute over domain fixtures and the
 * Feature-013 set/cycle/attempt fixtures. Every aggregate state, partition,
 * continue state, mastery state and error case is covered; no engine, network
 * or real user data.
 */

import type { AnalysisJob } from '@/domain/analysis/job';
import { puzzleIdOf } from '@/domain/puzzle/id';
import { computeStatistics, setStatsFor } from '@/domain/statistics';
import type {
  StatisticsAnalysisSummary,
  StatisticsGameRow,
  StatisticsQuery,
  TrainingSetStats,
} from '@/domain/statistics';
import { game } from '@/domain/statistics/fixtures/builders';
import type { GameMetricsReport, StatisticsResult } from '@/infrastructure/statistics';
import { QUICK_TRAIN_SET_ID } from '@/domain/training/autoSet';
import type { TacticalTrainingSetRow, TrainingCycleRow } from '@/domain/training/cycleTypes';
import {
  attemptRowsForCycle,
  blockSetFixture,
  cycleFixture,
  setFixture,
} from '@/domain/training/test-support';
import type { TrainingResult } from '@/domain/training/types';
import { HOME_STATS_WINDOW } from '@/presentation/home';
import { DASHBOARD_FIXTURE_NOW, richDashboardScenario } from '@/test/fixtures/dashboard/scenarios';
import type { FakeHomeResults } from './fakeHomeDataSource';

/** Fixed clock the scenarios resolve the Home window against. */
export const HOME_FIXTURE_NOW = DASHBOARD_FIXTURE_NOW;

const DAY = 86_400_000;

const HOME_QUERY: StatisticsQuery = {
  platform: 'all',
  timeControl: 'all',
  side: 'all',
  result: 'all',
  dateRange: HOME_STATS_WINDOW,
  now: HOME_FIXTURE_NOW,
};

/** Compute a Feature-014 game-metrics result from a snapshot (fixture-only). */
function gameMetricsFor(
  games: readonly StatisticsGameRow[],
  jobs: readonly AnalysisJob[] = [],
  summaries: readonly StatisticsAnalysisSummary[] = [],
): StatisticsResult<GameMetricsReport> {
  const computed = computeStatistics({
    operation: 'gameMetrics',
    query: HOME_QUERY,
    snapshot: { games, jobs, summaries },
  });
  if (computed.operation !== 'gameMetrics') {
    throw new Error('unexpected compute operation');
  }
  return {
    ok: true,
    result: {
      ...computed,
      diagnostics: { ...computed.diagnostics, backfillCreated: 0, backfillFailures: 0 },
    },
  };
}

/** Puzzle ids for a synthetic `fixture:<prefix>` game. */
function puzzleIds(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => puzzleIdOf(`fixture:${prefix}`, index + 1));
}

/** A per-puzzle result script with every puzzle solved first try by default. */
function solved(
  list: readonly string[],
  overrides: Readonly<Record<string, readonly TrainingResult[]>> = {},
): Record<string, readonly TrainingResult[]> {
  const results: Record<string, readonly TrainingResult[]> = {};
  for (const id of list) {
    results[id] = overrides[id] ?? ['solvedFirstTry'];
  }
  return results;
}

/** The rich Feature-014 game metrics (Lichess rapid primary + Chess.com blitz). */
export function richHomeGameMetrics(): StatisticsResult<GameMetricsReport> {
  return richDashboardScenario().data.gameMetrics;
}

/** An active custom set with a completed and an in-progress cycle. */
function setWithCycles(): {
  set: TacticalTrainingSetRow;
  cycles: readonly TrainingCycleRow[];
} {
  const ids = puzzleIds('home-set', 8);
  const set = setFixture({
    id: 'home-set',
    name: 'Rapid review',
    puzzleIds: ids,
    updatedAt: HOME_FIXTURE_NOW - 1000,
  });
  const completed = cycleFixture({
    id: 'home-cycle-1',
    trainingSetId: set.id,
    cycleNumber: 1,
    status: 'completed',
    puzzleIds: ids,
    startedAt: HOME_FIXTURE_NOW - 10 * DAY,
    completedAt: HOME_FIXTURE_NOW - 9 * DAY,
  });
  const inProgress = cycleFixture({
    id: 'home-cycle-2',
    trainingSetId: set.id,
    cycleNumber: 2,
    status: 'inProgress',
    puzzleIds: ids,
    startedAt: HOME_FIXTURE_NOW - DAY,
  });
  return { set, cycles: [completed, inProgress] };
}

/** An open block with a partial in-progress cycle and its Feature-014 stats. */
export function blockWithProgress(): {
  block: TacticalTrainingSetRow;
  cycles: readonly TrainingCycleRow[];
  stats: TrainingSetStats;
} {
  const ids = puzzleIds('home-block', 5);
  const block = blockSetFixture({ id: 'home-block', name: 'Woodpecker block', puzzleIds: ids });
  const cycle = cycleFixture({
    id: 'home-block-cycle',
    trainingSetId: block.id,
    cycleNumber: 1,
    status: 'inProgress',
    puzzleIds: ids,
    startedAt: HOME_FIXTURE_NOW - DAY,
  });
  const attempts = attemptRowsForCycle({
    puzzleIds: ids.slice(0, 2),
    results: solved(ids.slice(0, 2)),
    trainingSetId: block.id,
    cycleId: cycle.id,
    startedAt: HOME_FIXTURE_NOW - DAY,
  });
  return { block, cycles: [cycle], stats: setStatsFor({ set: block, cycles: [cycle], attempts }) };
}

/** An open block with no cycles recorded yet and its Feature-014 stats. */
export function blockWithoutCycles(): {
  block: TacticalTrainingSetRow;
  stats: TrainingSetStats;
} {
  const block = blockSetFixture({
    id: 'home-block',
    name: 'Woodpecker block',
    puzzleIds: puzzleIds('home-block', 5),
  });
  return { block, stats: setStatsFor({ set: block, cycles: [], attempts: [] }) };
}

/** Overrides for `homeScenario`; every field defaults deterministically. */
export interface HomeScenarioInput {
  readonly totalGames?: number;
  readonly gameMetrics?: StatisticsResult<GameMetricsReport>;
  readonly activeSets?: readonly TacticalTrainingSetRow[];
  readonly archivedSets?: readonly TacticalTrainingSetRow[];
  readonly openBlock?: TacticalTrainingSetRow | null;
  readonly cycles?: readonly TrainingCycleRow[];
  readonly mastery?: { readonly mastered: number; readonly total: number };
  readonly blockStats?: Readonly<Record<string, TrainingSetStats>>;
}

/** Build a `FakeHomeResults` from overrides (defaults: rich games, no training). */
export function homeScenario(input: HomeScenarioInput = {}): FakeHomeResults {
  return {
    totalGames: input.totalGames ?? 18,
    gameMetrics: input.gameMetrics ?? richHomeGameMetrics(),
    activeSets: input.activeSets ?? [],
    archivedSets: input.archivedSets ?? [],
    openBlock: input.openBlock ?? null,
    cycles: input.cycles ?? [],
    mastery: input.mastery ?? { mastered: 0, total: 0 },
    blockStats: input.blockStats ?? {},
  };
}

/** First-run: no games, no sets, no puzzles. */
export function firstRunHomeScenario(): FakeHomeResults {
  return homeScenario({
    totalGames: 0,
    gameMetrics: gameMetricsFor([], [], []),
    mastery: { mastered: 0, total: 0 },
  });
}

/** Games stored but none analyzed. */
export function noAnalysisHomeScenario(): FakeHomeResults {
  const games = [
    game({ id: 'lichess:no-analysis:0' }),
    game({ id: 'lichess:no-analysis:1' }),
    game({ id: 'lichess:no-analysis:2' }),
  ];
  return homeScenario({ totalGames: games.length, gameMetrics: gameMetricsFor(games, [], []) });
}

/** Returning: rich games, an active set with an in-progress cycle, some mastery. */
export function returningHomeScenario(): FakeHomeResults {
  const { set, cycles } = setWithCycles();
  return homeScenario({
    activeSets: [set],
    cycles,
    mastery: { mastered: 3, total: 8 },
  });
}

/** Open block with a partial in-progress cycle and no in-progress custom cycle. */
export function openBlockHomeScenario(): FakeHomeResults {
  const { block, cycles, stats } = blockWithProgress();
  return homeScenario({
    openBlock: block,
    cycles,
    blockStats: { [block.id]: stats },
    mastery: { mastered: 1, total: 5 },
  });
}

/** Open block with no cycles recorded yet. */
export function openBlockNotStartedHomeScenario(): FakeHomeResults {
  const { block, stats } = blockWithoutCycles();
  return homeScenario({
    openBlock: block,
    blockStats: { [block.id]: stats },
    mastery: { mastered: 0, total: 5 },
  });
}

/** Most recently active custom set with no cycle and no open block. */
export function mostRecentSetHomeScenario(): FakeHomeResults {
  const set = setFixture({ id: 'home-set', name: 'Rapid review', updatedAt: HOME_FIXTURE_NOW });
  return homeScenario({ activeSets: [set] });
}

/** A Quick-train in-progress cycle with no set row. */
export function quickTrainHomeScenario(): FakeHomeResults {
  const cycle = cycleFixture({
    id: 'home-quick-cycle',
    trainingSetId: QUICK_TRAIN_SET_ID,
    cycleNumber: 4,
    status: 'inProgress',
    startedAt: HOME_FIXTURE_NOW,
  });
  return homeScenario({ cycles: [cycle] });
}

/** No continue target: no cycle, no block, no custom set. */
export function noTargetHomeScenario(): FakeHomeResults {
  return homeScenario();
}

/** No puzzles generated yet. */
export function noPuzzlesHomeScenario(): FakeHomeResults {
  return homeScenario({ mastery: { mastered: 0, total: 0 } });
}

/** Every puzzle mastered. */
export function allMasteredHomeScenario(): FakeHomeResults {
  return homeScenario({ mastery: { mastered: 8, total: 8 } });
}
