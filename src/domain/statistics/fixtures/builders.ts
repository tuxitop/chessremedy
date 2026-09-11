/**
 * Feature 014 — deterministic statistics fixtures (pure, test-only).
 *
 * Builders and scenario datasets used by the Stage-A fixture tests. They
 * import only domain types/constants and never touch the network, engine,
 * Dexie or real user data.
 */

import type { AnalysisJob } from '@/domain/analysis/job';
import { ANALYSIS_VERSION, type EngineMetadata, type MoveAnalysis } from '@/domain/chess/analysis';
import { CLASSIFICATION_VERSION } from '@/domain/chess/classification';
import { GAME_PHASE_VERSION } from '@/domain/chess/gamePhase';
import { DETECTION_VERSION } from '@/domain/tactics/types';
import type { PuzzleAttemptRow } from '@/domain/training/types';
import type { StatisticsAnalysisSummary, StatisticsGameRow } from '../types';

/** Stable engine identity used by default fixtures. */
export const FIXTURE_ENGINE: EngineMetadata = {
  engineName: 'Stockfish',
  engineVersion: '18.0.8',
  engineBuild: 'stockfish-18-lite-single',
  profile: 'normal',
};

/** Build a deterministic game row. */
export function game(overrides: Partial<StatisticsGameRow> = {}): StatisticsGameRow {
  return {
    id: 'lichess:g1',
    source: 'lichess',
    playedAt: '2026-09-01T12:00:00.000Z',
    normalizedTimeControl: 'rapid',
    userColor: 'white',
    result: '1-0',
    userRating: 1500,
    ...overrides,
  };
}

/** Build a deterministic analysis job. */
export function job(overrides: Partial<AnalysisJob> = {}): AnalysisJob {
  return {
    id: 'a1',
    gameId: 'lichess:g1',
    engine: FIXTURE_ENGINE,
    analysisVersion: ANALYSIS_VERSION,
    classificationVersion: CLASSIFICATION_VERSION,
    gamePhaseVersion: GAME_PHASE_VERSION,
    state: 'completed',
    totalPositions: 40,
    completedPositions: 40,
    lastError: null,
    createdAt: 1_000,
    updatedAt: 1_000,
    startedAt: 1_000,
    completedAt: 1_000,
    ...overrides,
  };
}

/** Build a deterministic persisted per-analysis summary. */
export function summary(
  overrides: Partial<StatisticsAnalysisSummary> = {},
): StatisticsAnalysisSummary {
  return {
    analysisId: 'a1',
    gameId: 'lichess:g1',
    accuracy: 90,
    accuracyMoves: 30,
    classificationCounts: { best: 10, good: 15, inaccuracy: 3, mistake: 1, blunder: 1 },
    userMoves: 30,
    detectionState: 'completed',
    missedTacticCount: 0,
    detectionVersion: DETECTION_VERSION,
    ...overrides,
  };
}

/** Build a deterministic puzzle attempt row (for orphaned-attempt tests). */
export function attempt(overrides: Partial<PuzzleAttemptRow> = {}): PuzzleAttemptRow {
  return {
    puzzleId: 'p1',
    trainingSetId: 'set1',
    cycleId: 'c1',
    presentationIndex: 1,
    startedAt: 1_000,
    endedAt: 2_000,
    result: 'solvedFirstTry',
    solvingTimeMs: 1_000,
    wrongMoveCount: 0,
    hintCount: 0,
    highestHintLevel: null,
    restartCount: 0,
    solved: true,
    puzzleGeneratorVersion: 2,
    origin: 'tactical',
    ...overrides,
  };
}

/** Build a deterministic persisted `MoveAnalysis` record. */
export function moveAnalysis(overrides: Partial<MoveAnalysis> = {}): MoveAnalysis {
  return {
    analysisId: 'a1',
    gameId: 'lichess:g1',
    ply: 0,
    moveNumber: 1,
    side: 'white',
    playedMove: { san: 'e4', uci: 'e2e4' },
    positionFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    evalBefore: { cp: 20, mate: null },
    evalAfter: { cp: 20, mate: null },
    wdlBefore: null,
    wdlAfter: null,
    bestMove: { san: 'e4', uci: 'e2e4' },
    bestPv: [],
    multipvLines: [],
    legalMovesCount: 20,
    inBook: false,
    classification: 'best',
    classificationVersion: CLASSIFICATION_VERSION,
    gamePhase: 'opening',
    gamePhaseVersion: GAME_PHASE_VERSION,
    missedTactic: false,
    detectionVersion: null,
    engine: FIXTURE_ENGINE,
    analysisVersion: ANALYSIS_VERSION,
    analyzedAt: 1_000,
    ...overrides,
  };
}

/** A fully analyzed game bundle. */
export interface AnalyzedGame {
  readonly game: StatisticsGameRow;
  readonly job: AnalysisJob;
  readonly summary: StatisticsAnalysisSummary;
}

/**
 * Build an analyzed game whose job and summary share the game id and a
 * supplied analysis id. Classification counts / accuracy are overridable.
 */
export function analyzedGame(
  id: string,
  overrides: {
    readonly game?: Partial<StatisticsGameRow>;
    readonly job?: Partial<AnalysisJob>;
    readonly summary?: Partial<StatisticsAnalysisSummary>;
    readonly analysisId?: string;
  } = {},
): AnalyzedGame {
  const analysisId = overrides.analysisId ?? `a-${id}`;
  const gameRow = game({ id, ...overrides.game });
  const jobRow = job({
    id: analysisId,
    gameId: id,
    ...overrides.job,
  });
  const summaryRow = summary({
    analysisId,
    gameId: id,
    ...overrides.summary,
  });
  return { game: gameRow, job: jobRow, summary: summaryRow };
}

/** A scenario bundle the tests can index and pass to the domain functions. */
export interface StatisticsScenario {
  readonly games: readonly StatisticsGameRow[];
  readonly jobs: readonly AnalysisJob[];
  readonly summaries: readonly StatisticsAnalysisSummary[];
}

/** Flatten analyzed-game bundles into a scenario. */
export function scenarioOf(analyzed: readonly AnalyzedGame[]): StatisticsScenario {
  return {
    games: analyzed.map((entry) => entry.game),
    jobs: analyzed.map((entry) => entry.job),
    summaries: analyzed.map((entry) => entry.summary),
  };
}
