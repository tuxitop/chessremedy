import { describe, expect, it } from 'vitest';
import { makeGameId, outcomeOf } from './game';
import type { GameOutcome, GameResult } from './game';

describe('outcomeOf', () => {
  const cases: ReadonlyArray<readonly [result: GameResult, outcome: GameOutcome]> = [
    ['1-0', 'whiteWins'],
    ['0-1', 'blackWins'],
    ['1/2-1/2', 'draw'],
    ['*', 'unknown'],
  ];
  for (const [result, outcome] of cases) {
    it(`maps ${result} to ${outcome}`, () => {
      expect(outcomeOf(result)).toBe(outcome);
    });
  }
});

describe('makeGameId', () => {
  it('prefixes provider external ids', () => {
    expect(makeGameId('chesscom', '6123456789', 'any pgn')).toBe('chesscom:6123456789');
    expect(makeGameId('lichess', 'bX7kQ2mZ', 'any pgn')).toBe('lichess:bX7kQ2mZ');
  });

  it('falls back to a stable PGN hash for local/fixture games', () => {
    const pgn = '[Event "x"]\n\n1. e4 e5 *';
    const first = makeGameId('local', null, pgn);
    const second = makeGameId('local', null, pgn);
    expect(first).toBe(second);
    expect(first.startsWith('local:')).toBe(true);
    expect(first).not.toBe(makeGameId('local', null, '[Event "y"]\n\n1. d4 d5 *'));
  });

  it('treats an empty external id as absent', () => {
    expect(makeGameId('fixture', '', 'pgn')).toBe(makeGameId('fixture', null, 'pgn'));
  });
});
