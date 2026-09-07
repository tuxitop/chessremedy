/**
 * Stage-1 candidate generation tests (Feature 010). Deterministic
 * `MoveAnalysis` fixtures via `test-support`, exercising every ADR-026 filter.
 */

import { describe, expect, it } from 'vitest';
import type { Color } from 'chessops/types';
import { cpValueOf, winPercentFromCp } from '@/domain/chess';
import type { MoveAnalysis } from '@/domain/chess';
import { makeMove, makeRecords } from '../analysis/test-support';
import {
  generateCandidates,
  MAX_CANDIDATES_PER_GAME,
  MISSED_MATE_MAX_PLIES,
  MISSED_WINNING_MIN_CP,
  QUIET_MISS_MIN_WPLOSS,
} from './stage1';
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

describe('generateCandidates v2 — opponent-conceded swing (rule 2)', () => {
  const gameId = GAME;
  const analysisId = ANALYSIS;

  it('emits a candidate when the opponent conceded a big swing and the user replied quietly', () => {
    // Black (user) at ply 1. White's ply 0 blundered from +200 to -500 (its own
    // mover-perspective win-% drops far below the floor), then Black's quiet
    // non-best reply lost only a couple of win-% points.
    const records: readonly MoveAnalysis[] = [
      makeMove(0, {
        gameId,
        analysisId,
        side: 'white',
        playedMove: { san: 'e4', uci: 'e2e4' },
        bestMove: { san: 'd4', uci: 'd2d4' },
        bestPv: ['d2d4'],
        evalBefore: { cp: 200, mate: null },
        evalAfter: { cp: -500, mate: null },
        classification: 'blunder',
      }),
      makeMove(1, {
        gameId,
        analysisId,
        side: 'black',
        playedMove: { san: 'a6', uci: 'a7a6' },
        bestMove: { san: 'Qh4', uci: 'd8h4' },
        bestPv: ['d8h4'],
        evalBefore: { cp: 500, mate: null },
        evalAfter: { cp: 450, mate: null },
        classification: 'good',
      }),
    ];
    const candidates = generateCandidates(records, 'black', NOW);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.sourcePly).toBe(1);
    expect(candidates[0]!.candidateGenerationVersion).toBe(CANDIDATE_GENERATION_VERSION);
  });

  it('never emits for a swing below the concession floor', () => {
    const records: readonly MoveAnalysis[] = [
      makeMove(0, {
        gameId,
        analysisId,
        side: 'white',
        playedMove: { san: 'e4', uci: 'e2e4' },
        bestMove: { san: 'd4', uci: 'd2d4' },
        bestPv: ['d2d4'],
        evalBefore: { cp: 100, mate: null },
        evalAfter: { cp: 50, mate: null },
        classification: 'good',
      }),
      makeMove(1, {
        gameId,
        analysisId,
        side: 'black',
        playedMove: { san: 'a6', uci: 'a7a6' },
        bestMove: { san: 'd5', uci: 'd7d5' },
        bestPv: ['d7d5'],
        evalBefore: { cp: -50, mate: null },
        evalAfter: { cp: -60, mate: null },
        classification: 'good',
      }),
    ];
    expect(generateCandidates(records, 'black', NOW)).toEqual([]);
  });

  it('is unscathed when the user found the best move after the concession', () => {
    const records: readonly MoveAnalysis[] = [
      makeMove(0, {
        gameId,
        analysisId,
        side: 'white',
        playedMove: { san: 'e4', uci: 'e2e4' },
        bestMove: { san: 'd4', uci: 'd2d4' },
        bestPv: ['d2d4'],
        evalBefore: { cp: 200, mate: null },
        evalAfter: { cp: -500, mate: null },
        classification: 'blunder',
      }),
      makeMove(1, {
        gameId,
        analysisId,
        side: 'black',
        playedMove: { san: 'Qh4', uci: 'd8h4' },
        bestMove: { san: 'Qh4', uci: 'd8h4' },
        bestPv: ['d8h4'],
        evalBefore: { cp: 500, mate: null },
        evalAfter: { cp: 500, mate: null },
        classification: 'best',
      }),
    ];
    expect(generateCandidates(records, 'black', NOW)).toEqual([]);
  });
});

describe('generateCandidates v2 — missed decisive / missed mate (rule 3)', () => {
  it('emits a candidate when the user had a forced mate but played something else', () => {
    const records = [
      makeMove(4, {
        gameId: GAME,
        analysisId: ANALYSIS,
        side: 'white',
        playedMove: { san: 'h3', uci: 'h2h3' },
        bestMove: { san: 'Qxf7', uci: 'd1f7' },
        bestPv: ['d1f7', 'e8d8', 'f7d8'],
        evalBefore: { cp: null, mate: 2 },
        evalAfter: { cp: 900, mate: null },
        classification: 'good',
      }),
    ];
    const candidates = generateCandidates(records, 'white', NOW);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.sourcePly).toBe(4);
  });

  it('emits a candidate from an already-winning position (>= +300 user edge)', () => {
    const records = [
      makeMove(4, {
        gameId: GAME,
        analysisId: ANALYSIS,
        side: 'white',
        playedMove: { san: 'Be3', uci: 'c1e3' },
        bestMove: { san: 'Qxf7', uci: 'd1f7' },
        bestPv: ['d1f7'],
        evalBefore: { cp: 400, mate: null },
        evalAfter: { cp: 350, mate: null },
        classification: 'good',
      }),
    ];
    const candidates = generateCandidates(records, 'white', NOW);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.sourcePly).toBe(4);
  });

  it('does not emit when the winning edge is below the +300 floor and not a mate', () => {
    const records = [
      makeMove(4, {
        gameId: GAME,
        analysisId: ANALYSIS,
        side: 'white',
        playedMove: { san: 'Be3', uci: 'c1e3' },
        bestMove: { san: 'Nxe5', uci: 'f3e5' },
        bestPv: ['f3e5'],
        evalBefore: { cp: 250, mate: null },
        evalAfter: { cp: 220, mate: null },
        classification: 'good',
      }),
    ];
    expect(generateCandidates(records, 'white', NOW)).toEqual([]);
  });

  it('only counts a forced mate inside the plies window', () => {
    const outside = makeMove(4, {
      gameId: GAME,
      analysisId: ANALYSIS,
      side: 'white',
      playedMove: { san: 'h3', uci: 'h2h3' },
      bestMove: { san: 'Qxf7', uci: 'd1f7' },
      bestPv: ['d1f7'],
      evalBefore: { cp: null, mate: 10 },
      evalAfter: { cp: 900, mate: null },
      classification: 'good',
    });
    // mate 10 = 19 plies, far beyond MISSED_MATE_MAX_PLIES, and +250 cp would be
    // the only alternative trigger — use a below-floor edge to isolate the rule.
    const records = [{ ...outside, evalBefore: { cp: 250, mate: null } }];
    expect(generateCandidates(records, 'white', NOW)).toEqual([]);
    expect(MISSED_MATE_MAX_PLIES).toBe(8);
    expect(MISSED_WINNING_MIN_CP).toBe(300);
  });
});

describe('generateCandidates v2 — quiet / small-loss miss (rule 4)', () => {
  it('emits when the move lost < 5 win-% but the best first move is a capture', () => {
    // Best Nxe5 (a capture) at the STARTING_FEN; the quiet played move only cost
    // ~4.1 win-% (cp 200 -> 150), below the mistake band, and the start position
    // is not "already winning" so only rule 4 can fire.
    const records = [
      makeMove(4, {
        gameId: GAME,
        analysisId: ANALYSIS,
        side: 'white',
        playedMove: { san: 'c3', uci: 'c2c3' },
        bestMove: { san: 'Nxe5', uci: 'f3e5' },
        bestPv: ['f3e5', 'd7d6'],
        positionFen: STARTING_FEN,
        evalBefore: { cp: 200, mate: null },
        evalAfter: { cp: 150, mate: null },
        classification: 'good',
      }),
    ];
    const candidates = generateCandidates(records, 'white', NOW);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.sourcePly).toBe(4);
    const wpLoss = candidates[0]!.wpLoss;
    expect(wpLoss).toBeLessThan(5);
    expect(wpLoss).toBeGreaterThanOrEqual(QUIET_MISS_MIN_WPLOSS);
  });

  it('never emits when the best first move is quiet (no forcing move to miss)', () => {
    // Identical small-loss shape, but the best move is a quiet bishop move: no
    // forcing tactic was on offer, so no candidate fires.
    const records = [
      makeMove(4, {
        gameId: GAME,
        analysisId: ANALYSIS,
        side: 'white',
        playedMove: { san: 'c3', uci: 'c2c3' },
        bestMove: { san: 'Be3', uci: 'c1e3' },
        bestPv: ['c1e3'],
        positionFen: STARTING_FEN,
        evalBefore: { cp: 200, mate: null },
        evalAfter: { cp: 150, mate: null },
        classification: 'good',
      }),
    ];
    expect(generateCandidates(records, 'white', NOW)).toEqual([]);
  });
});

describe('generateCandidates v2 — per-game cap and swing ordering (Q3)', () => {
  it('caps the emitted candidate set at MAX_CANDIDATES_PER_GAME', () => {
    const records: MoveAnalysis[] = [];
    // 20 distinct white user plies, each a >= 5 win-% loss (rule 1 fires).
    for (let ply = 0; ply < 40; ply += 2) {
      records.push(
        makeMove(ply, {
          gameId: GAME,
          analysisId: ANALYSIS,
          side: 'white',
          playedMove: { san: 'h3', uci: 'h2h3' },
          bestMove: { san: 'd4', uci: 'd2d4' },
          bestPv: ['d2d4'],
          evalBefore: { cp: 300, mate: null },
          evalAfter: { cp: 100, mate: null },
          classification: 'blunder',
        }),
      );
    }
    const candidates = generateCandidates(records, 'white', NOW);
    expect(MAX_CANDIDATES_PER_GAME).toBe(16);
    expect(candidates).toHaveLength(16);
  });

  it('orders candidates by swing size, biggest first, then by ply', () => {
    const records = [
      // Biggest swing: 300 -> -500 (largest wpLoss).
      makeMove(0, {
        gameId: GAME,
        analysisId: ANALYSIS,
        side: 'white',
        playedMove: { san: 'h3', uci: 'h2h3' },
        bestMove: { san: 'd4', uci: 'd2d4' },
        bestPv: ['d2d4'],
        evalBefore: { cp: 300, mate: null },
        evalAfter: { cp: -500, mate: null },
        classification: 'blunder',
      }),
      // Smaller swing: 300 -> 100.
      makeMove(2, {
        gameId: GAME,
        analysisId: ANALYSIS,
        side: 'white',
        playedMove: { san: 'h3', uci: 'h2h3' },
        bestMove: { san: 'd4', uci: 'd2d4' },
        bestPv: ['d2d4'],
        evalBefore: { cp: 300, mate: null },
        evalAfter: { cp: 100, mate: null },
        classification: 'blunder',
      }),
    ];
    const candidates = generateCandidates(records, 'white', NOW);
    expect(candidates.map((c) => c.sourcePly)).toEqual([0, 2]);
  });
});
