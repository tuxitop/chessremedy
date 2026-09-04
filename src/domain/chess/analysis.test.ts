import { describe, expect, it } from 'vitest';
import {
  ANALYSIS_JOB_STATES,
  ANALYSIS_PROFILES,
  ANALYSIS_VERSION,
  GAME_PHASES,
  MOVE_CLASSIFICATIONS,
  type EngineMetadata,
  type MoveAnalysis,
} from './analysis';

const ENGINE: EngineMetadata = {
  engineName: 'stockfish',
  engineVersion: '18.0.8',
  engineBuild: 'stockfish-18-lite-single',
  profile: 'normal',
};

function sampleMoveAnalysis(overrides: Partial<MoveAnalysis> = {}): MoveAnalysis {
  return {
    analysisId: 'lichess:abc|a1|c1|p1|stockfish@18.0.8@stockfish-18-lite-single@normal',
    gameId: 'lichess:abc',
    ply: 0,
    moveNumber: 1,
    side: 'white',
    playedMove: { san: 'e4', uci: 'e2e4' },
    positionFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    evalBefore: { cp: 21, mate: null },
    evalAfter: { cp: -18, mate: null },
    wdlBefore: { w: 520, d: 460, l: 20 },
    wdlAfter: { w: 480, d: 500, l: 20 },
    bestMove: { san: 'e4', uci: 'e2e4' },
    bestPv: ['e2e4', 'e7e5'],
    multipvLines: [
      {
        multipv: 1,
        uci: ['e2e4', 'e7e5'],
        evaluation: { cp: 21, mate: null },
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
    engine: ENGINE,
    analysisVersion: ANALYSIS_VERSION,
    analyzedAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe('analysis model', () => {
  it('fixes the literal sets', () => {
    expect(GAME_PHASES).toEqual(['opening', 'middlegame', 'endgame']);
    expect(ANALYSIS_JOB_STATES).toEqual([
      'queued',
      'inProgress',
      'completed',
      'cancelled',
      'failed',
    ]);
    expect(ANALYSIS_PROFILES).toEqual(['fast', 'normal', 'tactical', 'deep']);
    expect(MOVE_CLASSIFICATIONS).toEqual(['best', 'good', 'inaccuracy', 'mistake', 'blunder']);
    expect(ANALYSIS_VERSION).toBe(1);
  });

  it('constructs a completed move record with WDL and classification', () => {
    const record = sampleMoveAnalysis();
    expect(record.wdlBefore).toEqual({ w: 520, d: 460, l: 20 });
    expect(record.evalBefore.cp).toBe(21);
    expect(record.classification).toBe('best');
  });

  it('reserves the missed-tactic contract for Feature 010', () => {
    const record: MoveAnalysis = sampleMoveAnalysis({
      missedTactic: true,
      detectionVersion: 3,
    });
    expect(record.missedTactic).toBe(true);
    expect(record.detectionVersion).toBe(3);
    // Feature 008 never computes it — a fresh record defaults false/null.
    const fresh = sampleMoveAnalysis();
    expect(fresh.missedTactic).toBe(false);
    expect(fresh.detectionVersion).toBeNull();
  });

  it('supports the fast profile with null WDL and mate-only evaluations', () => {
    const fast: MoveAnalysis = sampleMoveAnalysis({
      wdlBefore: null,
      wdlAfter: null,
      evalBefore: { cp: null, mate: null },
      engine: { ...ENGINE, profile: 'fast' },
    });
    expect(fast.wdlBefore).toBeNull();
    expect(fast.wdlAfter).toBeNull();

    const mate: MoveAnalysis = sampleMoveAnalysis({
      evalAfter: { cp: null, mate: -2 },
    });
    expect(mate.evalAfter.mate).toBe(-2);
    expect(mate.evalAfter.cp).toBeNull();
    expect(ANALYSIS_PROFILES).toContain(mate.engine.profile);
  });
});
