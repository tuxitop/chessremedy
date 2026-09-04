/**
 * Deterministic analysis fixtures for tests (Feature 008).
 *
 * Production-shape builders so persistence/service/component tests can fabricate
 * jobs and `MoveAnalysis` records without re-specifying the full shape. Never
 * imported by production modules.
 */

import type { EngineMetadata, MoveAnalysis, PlayedMove } from '@/domain/chess';
import { createAnalysisJob, type AnalysisJob } from './index';

export const TEST_ENGINE: EngineMetadata = {
  engineName: 'stockfish',
  engineVersion: '18.0.8',
  engineBuild: 'stockfish-18-lite-single',
  profile: 'normal',
};

export function makeEngine(profile: EngineMetadata['profile'] = 'normal'): EngineMetadata {
  return { ...TEST_ENGINE, profile };
}

export function makeJob(
  gameId: string,
  totalPositions = 1,
  engine: EngineMetadata = TEST_ENGINE,
): AnalysisJob {
  return createAnalysisJob(gameId, engine, totalPositions, 1_700_000_000_000);
}

export function makeMove(
  ply: number,
  overrides: Partial<MoveAnalysis> = {},
  engine: EngineMetadata = TEST_ENGINE,
): MoveAnalysis {
  const playedMove: PlayedMove = overrides.playedMove ?? { san: 'e4', uci: 'e2e4' };
  return {
    analysisId: overrides.analysisId ?? 'analysis-1',
    gameId: overrides.gameId ?? 'lichess:abc',
    ply,
    moveNumber: Math.floor(ply / 2) + 1,
    side: ply % 2 === 0 ? 'white' : 'black',
    playedMove,
    positionFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    evalBefore: { cp: 20, mate: null },
    evalAfter: { cp: -10, mate: null },
    wdlBefore: { w: 520, d: 460, l: 20 },
    wdlAfter: { w: 470, d: 500, l: 30 },
    bestMove: playedMove,
    bestPv: [playedMove.uci, 'e7e5'],
    multipvLines: [
      {
        multipv: 1,
        uci: [playedMove.uci, 'e7e5'],
        evaluation: { cp: 20, mate: null },
        wdl: { w: 520, d: 460, l: 20 },
      },
    ],
    legalMovesCount: 20,
    inBook: false,
    classification: 'best',
    classificationVersion: 1,
    gamePhase: 'opening',
    gamePhaseVersion: 1,
    missedTactic: false,
    detectionVersion: null,
    engine,
    analysisVersion: 1,
    analyzedAt: 1_700_000_000_000,
    ...overrides,
  };
}

export function makeRecords(
  gameId: string,
  analysisId: string,
  count: number,
): readonly MoveAnalysis[] {
  const records: MoveAnalysis[] = [];
  for (let ply = 0; ply < count; ply += 1) {
    records.push(makeMove(ply, { gameId, analysisId }));
  }
  return records;
}
