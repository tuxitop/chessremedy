/**
 * Feature 014 — deterministic statistics scenarios (pure, test-only).
 *
 * Each scenario is a fixed bundle of game/job/summary rows covering the
 * Stage-A fixture requirements (empty, no analysis, one analyzed, six time
 * controls, detection states, missing data, mixed versions). No engine,
 * network or real user data.
 */

import { CLASSIFICATION_VERSION } from '@/domain/chess/classification';
import { DETECTION_VERSION } from '@/domain/tactics/types';
import type { TimeControlCategory } from '@/domain/chess/timeControl';
import type { SummaryDetectionState } from '@/domain/analysis/summaryDerivation';
import type { AnalysisJob } from '@/domain/analysis/job';
import type { StatisticsAnalysisSummary } from '../types';
import { groupJobsByGame, groupSummariesByAnalysisId } from '../eligibility';
import type { StatisticsScenario } from './builders';
import { FIXTURE_ENGINE, analyzedGame, game, scenarioOf } from './builders';

/** Zero games. */
export function emptyScenario(): StatisticsScenario {
  return { games: [], jobs: [], summaries: [] };
}

/** Games with no analysis jobs or summaries. */
export function noAnalysisScenario(): StatisticsScenario {
  return {
    games: [
      game({ id: 'g1', playedAt: '2026-09-01T12:00:00.000Z' }),
      game({ id: 'g2', playedAt: '2026-09-02T12:00:00.000Z', source: 'chesscom' }),
      game({ id: 'g3', playedAt: null }),
    ],
    jobs: [],
    summaries: [],
  };
}

/** One analyzed rapid game with known counts/accuracy. */
export function oneAnalyzedScenario(): StatisticsScenario {
  return scenarioOf([
    analyzedGame('g1', {
      summary: {
        accuracy: 90,
        accuracyMoves: 30,
        classificationCounts: { best: 10, good: 15, inaccuracy: 3, mistake: 1, blunder: 1 },
        missedTacticCount: 0,
      },
    }),
  ]);
}

/** The six ADR-013 time-control categories, each with a distinct blunder count. */
export const SIX_TIME_CONTROLS: readonly TimeControlCategory[] = [
  'bullet',
  'blitz',
  'rapid',
  'classical',
  'correspondence',
  'unknown',
];

export function sixTimeControlsScenario(): StatisticsScenario {
  return scenarioOf(
    SIX_TIME_CONTROLS.map((timeControl, index) =>
      analyzedGame(`g-${timeControl}`, {
        game: {
          normalizedTimeControl: timeControl,
          source: 'lichess',
          playedAt: `2026-09-0${index + 1}T12:00:00.000Z`,
        },
        summary: {
          classificationCounts: {
            best: 0,
            good: 0,
            inaccuracy: 0,
            mistake: 0,
            blunder: index + 1,
          },
          accuracy: 80 + index,
          accuracyMoves: 10,
        },
      }),
    ),
  );
}

/** Lichess and Chess.com with separate ratings (same time control). */
export function platformsScenario(): StatisticsScenario {
  return scenarioOf([
    analyzedGame('g-lichess', {
      game: { source: 'lichess', userRating: 2000, normalizedTimeControl: 'rapid' },
    }),
    analyzedGame('g-chesscom', {
      game: { source: 'chesscom', userRating: 1500, normalizedTimeControl: 'rapid' },
    }),
  ]);
}

interface DetectionSpec {
  readonly id: string;
  readonly state: SummaryDetectionState;
  readonly version: number | null;
  readonly count: number | null;
}

/** Detection absent/queued/inProgress/failed/completed-current/older. */
export function detectionStatesScenario(): StatisticsScenario {
  const specs: readonly DetectionSpec[] = [
    { id: 'g-absent', state: 'absent', version: null, count: null },
    { id: 'g-queued', state: 'queued', version: null, count: null },
    { id: 'g-inProgress', state: 'inProgress', version: null, count: null },
    { id: 'g-failed', state: 'failed', version: null, count: null },
    { id: 'g-current', state: 'completed', version: DETECTION_VERSION, count: 0 },
    { id: 'g-older', state: 'completed', version: DETECTION_VERSION - 1, count: 3 },
  ];
  return scenarioOf(
    specs.map((spec) =>
      analyzedGame(spec.id, {
        summary: {
          detectionState: spec.state,
          detectionVersion: spec.version,
          missedTacticCount: spec.count,
        },
      }),
    ),
  );
}

/** Missing rating, missing playedAt, unknown and runtime-unrecognized time controls. */
export function missingDataScenario(): StatisticsScenario {
  return {
    games: [
      game({ id: 'g-no-rating', userRating: null }),
      game({ id: 'g-undated', playedAt: null }),
      game({ id: 'g-unknown-tc', normalizedTimeControl: 'unknown' }),
      game({
        id: 'g-corrupt-tc',
        normalizedTimeControl: 'lightning' as unknown as TimeControlCategory,
      }),
    ],
    jobs: [],
    summaries: [],
  };
}

/** Two analyzed games with different engine identities and classification versions. */
export function mixedVersionsScenario(): StatisticsScenario {
  return scenarioOf([
    analyzedGame('g-engine-a', {
      job: {
        engine: { ...FIXTURE_ENGINE, engineVersion: '18.0.8' },
        classificationVersion: CLASSIFICATION_VERSION,
      },
    }),
    analyzedGame('g-engine-b', {
      job: {
        engine: { ...FIXTURE_ENGINE, engineVersion: '17.1.0', engineBuild: 'stockfish-17-full' },
        classificationVersion: CLASSIFICATION_VERSION + 1,
      },
    }),
  ]);
}

/** Index a scenario into the maps the pure functions consume. */
export function indexScenario(scenario: StatisticsScenario): {
  readonly jobsByGame: Map<string, AnalysisJob[]>;
  readonly summariesByAnalysisId: Map<string, StatisticsAnalysisSummary>;
} {
  return {
    jobsByGame: groupJobsByGame(scenario.jobs),
    summariesByAnalysisId: groupSummariesByAnalysisId(scenario.summaries),
  };
}
