import { describe, expect, it } from 'vitest';
import { formatEvaluation, formatNodes, formatPv, formatTime, numberSans } from './engineFormat';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('engine display formatting', () => {
  it('formats evaluations without conflating mate and centipawns', () => {
    expect(formatEvaluation({ cp: 21 })).toBe('+0.21');
    expect(formatEvaluation({ cp: -134 })).toBe('-1.34');
    expect(formatEvaluation({ cp: 0 })).toBe('0.00');
    expect(formatEvaluation({ mate: 3 })).toBe('M3');
    expect(formatEvaluation({ mate: -5 })).toBe('-M5');
  });

  it('formats node counts and times', () => {
    expect(formatNodes(1234)).toBe('1.2k');
    expect(formatNodes(1_400_000)).toBe('1.4M');
    expect(formatNodes(321)).toBe('321');
    expect(formatTime(900)).toBe('900ms');
    expect(formatTime(2100)).toBe('2.1s');
  });

  it('numbers PVs with PGN move numbers derived from the FEN', () => {
    expect(formatPv(START_FEN, [{ uci: 'e2e4' }, { uci: 'e7e5' }, { uci: 'g1f3' }])).toBe(
      '1. e4 e5 2. Nf3',
    );
    const blackToMove = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    expect(formatPv(blackToMove, [{ uci: 'e7e5' }, { uci: 'g1f3' }])).toBe('1... e5 2. Nf3');
  });

  it('numbers SAN lists directly and falls back to raw UCI', () => {
    expect(numberSans(START_FEN, ['e4', 'e5', 'Nf3'])).toBe('1. e4 e5 2. Nf3');
    expect(formatPv(START_FEN, [{ uci: 'zzz' }])).toBe('zzz');
  });
});
