/**
 * Feature 015 — deterministic dashboard scenarios (test-only).
 *
 * Builds the full `FakeStatisticsData` matrix the hook/component tests consume
 * by reusing the Feature-014 compute over the canonical domain fixtures: every
 * aggregate state (ok/insufficient/empty/notDetected), concrete Lichess +
 * Chess.com partitions, rating histories with a missing rating and an undated
 * game, phase metrics with differing move exposure, a training set with
 * inProgress/completed/abandoned/all-skipped/insufficient cycles, ranked +
 * unranked weakest categories, a repeatedly-failed puzzle and a mixed/outdated
 * version summary. No engine, network or real user data.
 */

import { DEFAULT_LIBRARY_FILTERS } from '@/domain/gameLibrary';
import {
  computeStatistics,
  repeatedlyFailedPuzzles,
  setStatsFor,
  weakestCategories,
} from '@/domain/statistics';
import type {
  StatisticsComputeInput,
  StatisticsComputeResult,
  StatisticsGameSnapshot,
  TrendGranularity,
  TrendMetric,
} from '@/domain/statistics';
import { ANALYSIS_VERSION, type MoveAnalysis } from '@/domain/chess/analysis';
import { CLASSIFICATION_VERSION } from '@/domain/chess/classification';
import { DETECTION_VERSION } from '@/domain/tactics';
import { puzzleIdOf } from '@/domain/puzzle/id';
import type { PuzzleRow } from '@/domain/puzzle/types';
import type { TacticalObjective } from '@/domain/tactics';
import type { TacticalTrainingSetRow } from '@/domain/training';
import type { TrainingResult } from '@/domain/training/types';
import {
  attemptRowsForCycle,
  blockSetFixture,
  cycleFixture,
  setFixture,
} from '@/domain/training/test-support';
import { puzzleRowFixture } from '@/domain/puzzle/test-support';
import type {
  GameMetricsReport,
  PhaseMetricsReport,
  StatisticsResult,
} from '@/infrastructure/statistics';
import { dashboardQueryFromFilters } from '@/presentation/dashboard/query';
import type { DashboardRatingComputation, DashboardTrendComputation } from '@/hooks/useDashboard';
import {
  analyzedGame,
  FIXTURE_ENGINE,
  game,
  moveAnalysis,
} from '@/domain/statistics/fixtures/builders';
import type { AnalyzedGame } from '@/domain/statistics/fixtures/builders';
import type { FakeStatisticsData, FakeTrainingResults } from './fakeStatistics';

/** Fixed clock the scenarios resolve presets against. */
export const DASHBOARD_FIXTURE_NOW = Date.UTC(2026, 8, 15, 12, 0, 0);
const DAY = 86_400_000;
const QUERY = dashboardQueryFromFilters(DEFAULT_LIBRARY_FILTERS, DASHBOARD_FIXTURE_NOW);
const GRANULARITY: TrendGranularity = 'week';

const ALL_TREND_METRICS: readonly TrendMetric[] = [
  'gamesPlayed',
  'gamesAnalyzed',
  'accuracy',
  'rating',
  'inaccuraciesPerGame',
  'mistakesPerGame',
  'blundersPerGame',
  'missedTacticsPerGame',
  'inaccuracies',
  'mistakes',
  'blunders',
  'missedTactics',
];

const FULL_COUNTS = { best: 10, good: 12, inaccuracy: 2, mistake: 1, blunder: 1 } as const;

/** The complete scenario bundle: fake data plus the training-set selector inputs. */
export interface DashboardScenario {
  readonly data: FakeStatisticsData;
  readonly activeSets: readonly TacticalTrainingSetRow[];
  readonly archivedSets: readonly TacticalTrainingSetRow[];
  readonly openBlock: TacticalTrainingSetRow | undefined;
}

function computeOrThrow(input: StatisticsComputeInput): StatisticsComputeResult {
  return computeStatistics(input);
}

function gameMetricsResult(snapshot: StatisticsGameSnapshot): StatisticsResult<GameMetricsReport> {
  const computed = computeOrThrow({ operation: 'gameMetrics', query: QUERY, snapshot });
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

function trendResults(
  snapshot: StatisticsGameSnapshot,
): Readonly<Record<TrendMetric, StatisticsResult<DashboardTrendComputation>>> {
  const results = {} as Record<TrendMetric, StatisticsResult<DashboardTrendComputation>>;
  for (const metric of ALL_TREND_METRICS) {
    const computed = computeOrThrow({
      operation: 'trendSeries',
      query: QUERY,
      metric,
      granularity: GRANULARITY,
      snapshot,
    });
    if (computed.operation !== 'trendSeries') {
      throw new Error('unexpected compute operation');
    }
    results[metric] = { ok: true, result: computed };
  }
  return results;
}

function ratingResult(
  snapshot: StatisticsGameSnapshot,
): StatisticsResult<DashboardRatingComputation> {
  const computed = computeOrThrow({ operation: 'ratingHistories', query: QUERY, snapshot });
  if (computed.operation !== 'ratingHistories') {
    throw new Error('unexpected compute operation');
  }
  return { ok: true, result: computed };
}

function phaseResult(
  snapshot: StatisticsGameSnapshot,
  analyses: readonly MoveAnalysis[],
): StatisticsResult<PhaseMetricsReport> {
  const computed = computeOrThrow({
    operation: 'phaseMetrics',
    query: QUERY,
    snapshot: { ...snapshot, analyses },
  });
  if (computed.operation !== 'phaseMetrics') {
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

/** One deterministic Lichess rapid game spec (date/rating/accuracy/missed). */
interface RapidGameSpec {
  readonly index: number;
  readonly date: string;
  readonly rating: number;
  readonly accuracy: number;
  readonly missed: number;
}

/** Lichess rapid spread over three ISO weeks with two explicit gaps (W33/W35). */
const RAPID_GAME_SPECS: readonly RapidGameSpec[] = [
  // Week 32 — five analyzed, detected games → `ok` aggregates.
  { index: 0, date: '2026-08-03', rating: 1500, accuracy: 90, missed: 1 },
  { index: 1, date: '2026-08-04', rating: 1510, accuracy: 88, missed: 0 },
  { index: 2, date: '2026-08-05', rating: 1505, accuracy: 86, missed: 2 },
  { index: 3, date: '2026-08-06', rating: 1495, accuracy: 84, missed: 0 },
  { index: 4, date: '2026-08-07', rating: 1502, accuracy: 82, missed: 1 },
  // Week 34 — four analyzed, detected games → `insufficient` (n = 4).
  { index: 5, date: '2026-08-17', rating: 1508, accuracy: 80, missed: 1 },
  { index: 6, date: '2026-08-18', rating: 1512, accuracy: 79, missed: 0 },
  { index: 7, date: '2026-08-19', rating: 1506, accuracy: 81, missed: 1 },
  { index: 8, date: '2026-08-20', rating: 1514, accuracy: 83, missed: 0 },
  // Week 36 boundary — a single Monday game → `insufficient` (n = 1).
  { index: 9, date: '2026-08-31', rating: 1518, accuracy: 85, missed: 1 },
];

/**
 * The rich game snapshot. Lichess rapid spans three ISO weeks (W32 `ok`, an
 * explicit W33 gap, W34 `insufficient`, a W35 gap and a W36 period-boundary
 * point); Chess.com blitz is four games with no current detection pass
 * (`insufficient`/`notDetected`); Lichess bullet is unanalyzed (`empty`); and a
 * missing-rating game plus an undated game contribute no rating point.
 *
 * With `mixedVersions` the blitz jobs carry a legacy analysis/classification
 * version and a second engine identity, producing a mixed/outdated
 * `VersionSummary`.
 */
function gameSnapshot(mixedVersions = false): {
  snapshot: StatisticsGameSnapshot;
  analyses: readonly MoveAnalysis[];
} {
  const rapid = RAPID_GAME_SPECS.map((spec) =>
    analyzedGame(`lichess:rapid:${spec.index}`, {
      game: {
        source: 'lichess',
        normalizedTimeControl: 'rapid',
        playedAt: `${spec.date}T12:00:00.000Z`,
        userRating: spec.rating,
      },
      summary: {
        accuracy: spec.accuracy,
        accuracyMoves: 30 - spec.index,
        classificationCounts: FULL_COUNTS,
        detectionState: 'completed',
        detectionVersion: DETECTION_VERSION,
        missedTacticCount: spec.missed,
      },
    }),
  );
  // Four Chess.com blitz games with no current detection pass → insufficient
  // classification and `notDetected` missed tactics.
  const blitz = Array.from({ length: 4 }, (_, index) =>
    analyzedGame(`chesscom:blitz:${index}`, {
      game: {
        source: 'chesscom',
        normalizedTimeControl: 'blitz',
        playedAt: `2026-08-${String(5 + index).padStart(2, '0')}T12:00:00.000Z`,
        userRating: 1400 + index,
      },
      summary: {
        accuracy: 70 + index,
        accuracyMoves: 20,
        classificationCounts: FULL_COUNTS,
        detectionState: 'absent',
        detectionVersion: null,
        missedTacticCount: null,
      },
    }),
  );
  // Mixed/outdated provenance: the blitz jobs carry a legacy pipeline version
  // and a second engine identity (a single partition stays dimensioned).
  const legacy = (entry: AnalyzedGame): AnalyzedGame => ({
    ...entry,
    job: {
      ...entry.job,
      analysisVersion: ANALYSIS_VERSION - 1,
      classificationVersion: CLASSIFICATION_VERSION - 1,
      engine: { ...FIXTURE_ENGINE, engineVersion: '17.1.0', engineBuild: 'stockfish-17' },
    },
  });
  const blitzEntries = mixedVersions ? blitz.map(legacy) : blitz;
  // Unanalyzed games in a third partition → `empty` classification aggregates.
  const bullet = [
    game({
      id: 'lichess:bullet:0',
      source: 'lichess',
      normalizedTimeControl: 'bullet',
      playedAt: '2026-08-06T12:00:00.000Z',
      userRating: 1300,
    }),
    game({
      id: 'lichess:bullet:1',
      source: 'lichess',
      normalizedTimeControl: 'bullet',
      playedAt: '2026-08-07T12:00:00.000Z',
      userRating: 1305,
    }),
  ];
  // A missing-rating game and an undated game: neither contributes a rating point.
  const missing = [
    game({
      id: 'lichess:rapid:no-rating',
      source: 'lichess',
      normalizedTimeControl: 'rapid',
      playedAt: '2026-08-08T12:00:00.000Z',
      userRating: null,
    }),
    game({
      id: 'lichess:rapid:undated',
      source: 'lichess',
      normalizedTimeControl: 'rapid',
      playedAt: null,
      userRating: 1520,
    }),
  ];

  const snapshot: StatisticsGameSnapshot = {
    games: [
      ...rapid.map((entry) => entry.game),
      ...blitz.map((entry) => entry.game),
      ...bullet,
      ...missing,
    ],
    jobs: [...rapid.map((entry) => entry.job), ...blitzEntries.map((entry) => entry.job)],
    summaries: [
      ...rapid.map((entry) => entry.summary),
      ...blitzEntries.map((entry) => entry.summary),
    ],
  };

  const analyses: MoveAnalysis[] = [
    moveAnalysis({
      analysisId: 'a-lichess:rapid:0',
      gameId: 'lichess:rapid:0',
      side: 'white',
      gamePhase: 'opening',
      classification: 'inaccuracy',
      detectionVersion: DETECTION_VERSION,
    }),
    moveAnalysis({
      analysisId: 'a-lichess:rapid:0',
      gameId: 'lichess:rapid:0',
      side: 'white',
      gamePhase: 'middlegame',
      classification: 'mistake',
      detectionVersion: DETECTION_VERSION,
    }),
    moveAnalysis({
      analysisId: 'a-lichess:rapid:0',
      gameId: 'lichess:rapid:0',
      side: 'white',
      gamePhase: 'endgame',
      classification: 'blunder',
      detectionVersion: DETECTION_VERSION,
    }),
    moveAnalysis({
      analysisId: 'a-lichess:rapid:1',
      gameId: 'lichess:rapid:1',
      side: 'white',
      gamePhase: 'opening',
      classification: 'blunder',
      detectionVersion: DETECTION_VERSION,
    }),
    moveAnalysis({
      analysisId: 'a-lichess:rapid:1',
      gameId: 'lichess:rapid:1',
      side: 'white',
      gamePhase: 'middlegame',
      classification: 'inaccuracy',
      detectionVersion: DETECTION_VERSION,
    }),
    // Extra opening moves so the opening phase reaches an `ok` move sample
    // while middlegame/endgame stay `insufficient` (differing exposure).
    moveAnalysis({
      analysisId: 'a-lichess:rapid:2',
      gameId: 'lichess:rapid:2',
      side: 'white',
      gamePhase: 'opening',
      classification: 'inaccuracy',
      detectionVersion: DETECTION_VERSION,
    }),
    moveAnalysis({
      analysisId: 'a-lichess:rapid:3',
      gameId: 'lichess:rapid:3',
      side: 'white',
      gamePhase: 'opening',
      classification: 'mistake',
      detectionVersion: DETECTION_VERSION,
    }),
    moveAnalysis({
      analysisId: 'a-lichess:rapid:4',
      gameId: 'lichess:rapid:4',
      side: 'white',
      gamePhase: 'opening',
      classification: 'blunder',
      detectionVersion: DETECTION_VERSION,
    }),
  ];

  return { snapshot, analyses };
}

function trainingData(): {
  training: Readonly<Record<string, FakeTrainingResults>>;
  activeSets: readonly TacticalTrainingSetRow[];
  archivedSets: readonly TacticalTrainingSetRow[];
} {
  const objectives: readonly TacticalObjective[] = [
    'winning_material',
    'winning_material',
    'winning_material',
    'winning_material',
    'winning_material',
    'winning_material',
    'forcing_mate',
    'forcing_mate',
  ];
  const puzzles: PuzzleRow[] = [
    ...objectives.map((objective, index) => {
      const base = puzzleRowFixture('mate-one');
      return {
        ...base,
        sourceGameId: 'fixture:dashboard',
        sourcePly: index + 1,
        origin: 'tactical' as const,
        tacticalObjective: objective,
      };
    }),
    (() => {
      const { tacticalObjective: _objective, ...base } = puzzleRowFixture('mate-one');
      return {
        ...base,
        sourceGameId: 'fixture:dashboard',
        sourcePly: 9,
        origin: 'blunder' as const,
      };
    })(),
  ];
  const ids = puzzles.map((puzzle) => puzzleIdOf(puzzle.sourceGameId, puzzle.sourcePly));
  const winning = ids.slice(0, 6);

  const set = setFixture({
    id: 'fixture:dashboard-set',
    name: 'Dashboard fixture set',
    status: 'active',
    puzzleIds: ids,
    updatedAt: DASHBOARD_FIXTURE_NOW,
  });

  const solved = (list: readonly string[], overrides: Record<string, TrainingResult[]> = {}) => {
    const results: Record<string, TrainingResult[]> = {};
    for (const id of list) {
      results[id] = overrides[id] ?? ['solvedFirstTry'];
    }
    return results;
  };

  const cycle1Id = 'fixture:dashboard-cycle-1';
  const cycle2Id = 'fixture:dashboard-cycle-2';
  const cycle3Id = 'fixture:dashboard-cycle-3';
  const cycle4Id = 'fixture:dashboard-cycle-4';
  const cycle5Id = 'fixture:dashboard-cycle-5';

  const cycles = [
    cycleFixture({
      id: cycle1Id,
      trainingSetId: set.id,
      cycleNumber: 1,
      status: 'completed',
      puzzleIds: winning,
      startedAt: DASHBOARD_FIXTURE_NOW - 20 * DAY,
      completedAt: DASHBOARD_FIXTURE_NOW - 19 * DAY,
    }),
    cycleFixture({
      id: cycle2Id,
      trainingSetId: set.id,
      cycleNumber: 2,
      status: 'completed',
      puzzleIds: ids.slice(0, 8),
      startedAt: DASHBOARD_FIXTURE_NOW - 15 * DAY,
      completedAt: DASHBOARD_FIXTURE_NOW - 14 * DAY,
    }),
    cycleFixture({
      id: cycle3Id,
      trainingSetId: set.id,
      cycleNumber: 3,
      status: 'abandoned',
      puzzleIds: winning.slice(0, 2),
      startedAt: DASHBOARD_FIXTURE_NOW - 10 * DAY,
      abandonedAt: DASHBOARD_FIXTURE_NOW - 9 * DAY,
    }),
    cycleFixture({
      id: cycle4Id,
      trainingSetId: set.id,
      cycleNumber: 4,
      status: 'completed',
      puzzleIds: winning.slice(0, 4),
      startedAt: DASHBOARD_FIXTURE_NOW - 5 * DAY,
      completedAt: DASHBOARD_FIXTURE_NOW - 4 * DAY,
    }),
    cycleFixture({
      id: cycle5Id,
      trainingSetId: set.id,
      cycleNumber: 5,
      status: 'inProgress',
      puzzleIds: winning.slice(0, 3),
      startedAt: DASHBOARD_FIXTURE_NOW - DAY,
    }),
  ];

  const attempts = [
    ...attemptRowsForCycle({
      puzzleIds: winning,
      results: solved(winning, { [winning[0]!]: ['failed', 'solvedFirstTry'] }),
      trainingSetId: set.id,
      cycleId: cycle1Id,
      startedAt: DASHBOARD_FIXTURE_NOW - 20 * DAY,
    }),
    ...attemptRowsForCycle({
      puzzleIds: ids.slice(0, 8),
      results: solved(ids.slice(0, 8), {
        [winning[0]!]: ['failed'],
        [winning[1]!]: ['solvedWithHelp'],
      }),
      trainingSetId: set.id,
      cycleId: cycle2Id,
      startedAt: DASHBOARD_FIXTURE_NOW - 15 * DAY,
    }),
    ...attemptRowsForCycle({
      puzzleIds: winning.slice(0, 2),
      results: solved(winning.slice(0, 2), { [winning[0]!]: ['failed'] }),
      trainingSetId: set.id,
      cycleId: cycle3Id,
      startedAt: DASHBOARD_FIXTURE_NOW - 10 * DAY,
    }),
    ...attemptRowsForCycle({
      puzzleIds: winning.slice(0, 4),
      results: solved(winning.slice(0, 4), {
        [winning[0]!]: ['skipped'],
        [winning[1]!]: ['skipped'],
        [winning[2]!]: ['skipped'],
        [winning[3]!]: ['skipped'],
      }),
      trainingSetId: set.id,
      cycleId: cycle4Id,
      startedAt: DASHBOARD_FIXTURE_NOW - 5 * DAY,
    }),
    ...attemptRowsForCycle({
      puzzleIds: winning.slice(0, 3),
      results: solved(winning.slice(0, 3)),
      trainingSetId: set.id,
      cycleId: cycle5Id,
      startedAt: DASHBOARD_FIXTURE_NOW - DAY,
    }),
  ];

  const stats = setStatsFor({ set, cycles, attempts });
  const categories = weakestCategories({ set, puzzles, attempts });
  const failed = repeatedlyFailedPuzzles({ trainingSetId: set.id, attempts });

  const archivedSet = setFixture({
    id: 'fixture:dashboard-archived',
    name: 'Archived set',
    status: 'archived',
    puzzleIds: winning.slice(0, 3),
    updatedAt: DASHBOARD_FIXTURE_NOW - 30 * DAY,
  });

  const training: Record<string, FakeTrainingResults> = {
    [set.id]: { stats, categories, failed },
    [archivedSet.id]: { stats, categories, failed },
  };

  return { training, activeSets: [set], archivedSets: [archivedSet] };
}

function buildData(
  training: Readonly<Record<string, FakeTrainingResults>>,
  mixedVersions = false,
): FakeStatisticsData {
  const { snapshot, analyses } = gameSnapshot(mixedVersions);
  return {
    gameMetrics: gameMetricsResult(snapshot),
    trends: trendResults(snapshot),
    ratings: ratingResult(snapshot),
    phases: phaseResult(snapshot, analyses),
    training,
  };
}

/** The rich scenario: all aggregate states, partitions, training states. */
export function richDashboardScenario(): DashboardScenario {
  const { training, activeSets, archivedSets } = trainingData();
  return {
    data: buildData(training),
    activeSets,
    archivedSets,
    openBlock: undefined,
  };
}

/** The rich scenario with a mixed/outdated `VersionSummary` (ADR-020 labels). */
export function mixedVersionDashboardScenario(): DashboardScenario {
  const { training, activeSets, archivedSets } = trainingData();
  return {
    data: buildData(training, true),
    activeSets,
    archivedSets,
    openBlock: undefined,
  };
}

/** The rich scenario plus an open Woodpecker block (default selection). */
export function openBlockDashboardScenario(): DashboardScenario {
  const base = richDashboardScenario();
  const block = blockSetFixture({ id: 'fixture:dashboard-block', name: 'Open block' });
  const entry = base.data.training['fixture:dashboard-set'];
  return {
    ...base,
    openBlock: block,
    data: {
      ...base.data,
      training:
        entry === undefined ? base.data.training : { ...base.data.training, [block.id]: entry },
    },
  };
}

/** An empty dataset: no games, no training sets. */
export function emptyDashboardScenario(): DashboardScenario {
  const empty: StatisticsGameSnapshot = { games: [], jobs: [], summaries: [] };
  return {
    data: {
      gameMetrics: gameMetricsResult(empty),
      trends: trendResults(empty),
      ratings: ratingResult(empty),
      phases: phaseResult(empty, []),
      training: {},
    },
    activeSets: [],
    archivedSets: [],
    openBlock: undefined,
  };
}
