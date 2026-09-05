/**
 * Stage-1 candidate generation tests (Feature 010). Deterministic
 * `MoveAnalysis` fixtures via `test-support`, exercising every ADR-026 filter.
 */

import { describe, expect, it } from 'vitest';
import type { Color } from 'chessops/types';
import { cpValueOf, winPercentFromCp } from '@/domain/chess';
import type { MoveAnalysis } from '@/domain/chess';
import { makeMove, makeRecords } from '../analysis/test-support';
import { generateCandidates } from './stage1';
import { CANDIDATE_GENERATION_VERSION } from './types';

const ANALYSIS = 'analysis-1';
const GAME = 'lichess:game1';
const NOW = 1_700_000_000_000;

const STARTING_FEN = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';

function expectedWpLoss(cpBefore: number, cpAfter: number): number {
  return Math.min(100, Math.max(0, winPercentFromCp(cpBefore) - winPercentFromCp(cpAfter)));
}

function userBlunder(ply: number, side: Color): MoveAnalysis {
  return makeMove(ply, {
    gameId: GAME,
    analysisId: ANALYSIS,
    side,
    playedMove: { san: 'd3', uci: 'd2d3' },
    bestMove: { san: 'Nxe5', uci: 'f3e5' },
    bestPv: ['f3e5', 'd7d6'],
    positionFen: STARTING_FEN,
    evalBefore: { cp: 300, mate: null },
    evalAfter: { cp: 0, mate: null },
    classification: 'blunder',
  });
}

function userGoodMove(ply: number, side: Color): MoveAnalysis {
  return makeMove(ply, {
    gameId: GAME,
    analysisId: ANALYSIS,
    side,
    playedMove: { san: 'Nc3', uci: 'b1c3' },
    bestMove: { san: 'c3', uci: 'c2c3' },
    bestPv: ['c2c3'],
    evalBefore: { cp: 20, mate: null },
    evalAfter: { cp: 10, mate: null },
    classification: 'good',
  });
}

describe('generateCandidates (Stage 1)', () => {
  it('emits a raw candidate for a user blunder with wpLoss >= 10 and played != best', () => {
    const records = [userBlunder(4, 'white'), userBlunder(5, 'black')];
    const candidates = generateCandidates(records, 'white', NOW);
    expect(candidates).toHaveLength(1);

    const candidate = candidates[0]!;
    expect(candidate.id).toBe(`${ANALYSIS}:4`);
    expect(candidate.analysisId).toBe(ANALYSIS);
    expect(candidate.sourceGameId).toBe(GAME);
    expect(candidate.sourcePly).toBe(4);
    expect(candidate.startingFen).toBe(STARTING_FEN);
    expect(candidate.userMovePlayed).toBe('d2d3');
    expect(candidate.bestMove).toBe('f3e5');
    expect(candidate.bestPv).toEqual(['f3e5', 'd7d6']);
    expect(candidate.wpLoss).toBeCloseTo(expectedWpLoss(300, 0), 10);
    expect(candidate.evalCpBefore).toBe(300);
    expect(candidate.evalCpAfterUserMove).toBe(0);
    expect(candidate.candidateGenerationVersion).toBe(CANDIDATE_GENERATION_VERSION);
    expect(candidate.createdAt).toBe(NOW);
  });

  it('never emits for opponent plies, even for blunders', () => {
    const records = [userBlunder(5, 'black')];
    expect(generateCandidates(records, 'white', NOW)).toEqual([]);
  });

  it('excludes user plies whose wpLoss is below the mistake band', () => {
    const records = [userGoodMove(2, 'white')];
    expect(generateCandidates(records, 'white', NOW)).toEqual([]);
  });

  it('excludes user plies where the played move equals the best move', () => {
    const records = [
      makeMove(2, {
        gameId: GAME,
        analysisId: ANALYSIS,
        side: 'white',
        playedMove: { san: 'Nxe5', uci: 'f3e5' },
        bestMove: { san: 'Nxe5', uci: 'f3e5' },
        bestPv: ['f3e5'],
        evalBefore: { cp: 300, mate: null },
        evalAfter: { cp: 0, mate: null },
        classification: 'blunder',
      }),
    ];
    expect(generateCandidates(records, 'white', NOW)).toEqual([]);
  });

  it('excludes in-book user plies', () => {
    const records = [{ ...userBlunder(4, 'white'), inBook: true }];
    expect(generateCandidates(records, 'white', NOW)).toEqual([]);
  });

  it('excludes records missing an evaluation on either side', () => {
    const records = [
      { ...userBlunder(4, 'white'), evalBefore: { cp: null, mate: null } },
      { ...userBlunder(6, 'white'), evalAfter: { cp: null, mate: null } },
    ];
    expect(generateCandidates(records, 'white', NOW)).toEqual([]);
  });

  it('excludes records with no engine best move', () => {
    const records = [{ ...userBlunder(4, 'white'), bestMove: null, bestPv: [] }];
    expect(generateCandidates(records, 'white', NOW)).toEqual([]);
  });

  it('accepts mate-valued evaluations and reports null centipawns', () => {
    const records = [
      makeMove(4, {
        gameId: GAME,
        analysisId: ANALYSIS,
        side: 'white',
        playedMove: { san: 'h3', uci: 'h2h3' },
        bestMove: { san: 'Qxf7', uci: 'd1f7' },
        bestPv: ['d1f7', 'e8d8'],
        evalBefore: { cp: null, mate: 2 },
        evalAfter: { cp: null, mate: -3 },
        classification: 'blunder',
      }),
    ];
    const candidates = generateCandidates(records, 'white', NOW);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.evalCpBefore).toBeNull();
    expect(candidates[0]!.evalCpAfterUserMove).toBeNull();
    const wpBefore = winPercentFromCp(cpValueOf({ cp: null, mate: 2 }));
    const wpAfter = winPercentFromCp(cpValueOf({ cp: null, mate: -3 }));
    expect(candidates[0]!.wpLoss).toBeCloseTo(Math.min(100, Math.max(0, wpBefore - wpAfter)), 10);
  });

  it('returns an empty array for a clean game', () => {
    const records = makeRecords(GAME, ANALYSIS, 8);
    expect(generateCandidates(records, 'white', NOW)).toEqual([]);
  });

  it('is deterministic and keeps record order for a mixed game', () => {
    const records = [userGoodMove(0, 'white'), userBlunder(4, 'white'), userGoodMove(8, 'white')];
    const first = generateCandidates(records, 'white', NOW);
    const second = generateCandidates(records, 'white', NOW);
    expect(first).toEqual(second);
    expect(first.map((c) => c.sourcePly)).toEqual([4]);
  });
});
