import { describe, expect, it } from 'vitest';
import {
  ANALYSIS_PROFILES,
  ANALYSIS_STATES,
  GAME_PHASES,
  type Analysis,
  type AnalysisProfile,
  type MoveAnalysis,
} from './analysis';

function sampleMoveAnalysis(overrides: Partial<MoveAnalysis> = {}): MoveAnalysis {
  return {
    id: 'ma-1',
    gameId: 'lichess:abc',
    ply: 0,
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    playedMove: { san: 'e4', uci: 'e2e4' },
    bestMove: { san: 'e4', uci: 'e2e4' },
    evalCp: 20,
    evalMate: null,
    wdl: { w: 400, d: 560, l: 40 },
    principalVariation: ['e2e4', 'e7e5'],
    legalMovesCount: 20,
    phase: 'opening',
    engine: {
      engineName: 'stockfish',
      engineVersion: '18.0.8',
      engineBuild: 'stockfish-18-lite-single',
      profile: 'normal',
    },
    analysisVersion: 1,
    analyzedAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe('analysis model', () => {
  it('fixes the literal sets', () => {
    expect(GAME_PHASES).toEqual(['opening', 'middlegame', 'endgame']);
    expect(ANALYSIS_STATES).toEqual(['pending', 'running', 'completed', 'failed', 'cancelled']);
    expect(ANALYSIS_PROFILES).toEqual(['fast', 'normal', 'tactical', 'deep']);
  });

  it('constructs a completed analysis with populated WDL', () => {
    const analysis: Analysis = {
      id: 'a-1',
      gameId: 'lichess:abc',
      state: 'completed',
      moves: [sampleMoveAnalysis()],
      analysisVersion: 1,
      createdAt: 1,
      updatedAt: 2,
    };
    expect(analysis.moves[0]!.wdl).toEqual({ w: 400, d: 560, l: 40 });
    expect(analysis.moves[0]!.evalCp).toBe(20);
  });

  it('supports a fast-profile move with null WDL and no engine yet', () => {
    const fast: MoveAnalysis = sampleMoveAnalysis({
      wdl: null,
      evalCp: null,
      evalMate: null,
      analyzedAt: null,
      legalMovesCount: null,
      engine: null,
      playedMove: null,
    });
    expect(fast.wdl).toBeNull();
    expect(fast.playedMove).toBeNull();
  });

  it('keeps mate and cp as independent nullable fields (runtime convention)', () => {
    const mate: MoveAnalysis = sampleMoveAnalysis({ evalCp: null, evalMate: 3, wdl: null });
    expect(mate.evalMate).toBe(3);
    expect(mate.evalCp).toBeNull();
    const profile: AnalysisProfile = mate.engine?.profile ?? 'fast';
    expect(ANALYSIS_PROFILES).toContain(profile);
  });
});
