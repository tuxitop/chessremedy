import { describe, expect, it } from 'vitest';
import type { MoveAnalysis } from '@/domain/chess';
import { makeMove } from './test-support';
import { summarizeAnalysis } from './summary';

const ANALYSIS = 'a1';

function record(
  ply: number,
  side: 'white' | 'black',
  classification: MoveAnalysis['classification'],
): MoveAnalysis {
  return makeMove(ply, { gameId: 'lichess:x', analysisId: ANALYSIS, side, classification });
}

describe('summarizeAnalysis (Review summary)', () => {
  it('separates user moves from opponent moves and counts classifications', () => {
    const records = [
      record(0, 'white', 'best'),
      record(1, 'black', 'good'),
      record(2, 'white', 'mistake'),
      record(3, 'black', 'blunder'),
    ];
    const summary = summarizeAnalysis(records, 'white');
    expect(summary.user).toEqual({ best: 1, good: 0, inaccuracy: 0, mistake: 1, blunder: 0 });
    expect(summary.opponent).toEqual({ best: 0, good: 1, inaccuracy: 0, mistake: 0, blunder: 1 });
    expect(summary.userMoves).toBe(2);
    expect(summary.totalMoves).toBe(4);
  });

  it('counts missed tactics only for the user (reserved until Feature 010)', () => {
    const records = [
      makeMove(0, {
        gameId: 'lichess:x',
        analysisId: ANALYSIS,
        side: 'white',
        classification: 'blunder',
        missedTactic: true,
        detectionVersion: 1,
      }),
      makeMove(1, {
        gameId: 'lichess:x',
        analysisId: ANALYSIS,
        side: 'black',
        classification: 'blunder',
        missedTactic: true,
      }),
    ];
    const summary = summarizeAnalysis(records, 'white');
    expect(summary.userMissedTactics).toBe(1);
  });

  it('handles the black user perspective', () => {
    const records = [record(0, 'white', 'best'), record(1, 'black', 'good')];
    const summary = summarizeAnalysis(records, 'black');
    expect(summary.user).toEqual({ best: 0, good: 1, inaccuracy: 0, mistake: 0, blunder: 0 });
  });
});
