import { describe, expect, it } from 'vitest';
import { uciPvToSan } from './san';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('uciPvToSan', () => {
  it('renders ordinary moves', () => {
    const result = uciPvToSan(START_FEN, ['e2e4', 'e7e5', 'g1f3']);
    expect(result).toEqual({ ok: true, sans: ['e4', 'e5', 'Nf3'] });
  });

  it('renders captures with disambiguation', () => {
    const fen = '4k3/8/8/4p3/8/5N2/8/4K3 w - - 0 1';
    expect(uciPvToSan(fen, ['f3e5'])).toEqual({ ok: true, sans: ['Nxe5'] });
  });

  it('renders castling (UCI king-to-rook / king-takes-rook forms)', () => {
    const castleFen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
    expect(uciPvToSan(castleFen, ['e1g1'])).toEqual({ ok: true, sans: ['O-O'] });
    expect(uciPvToSan(castleFen, ['e1a1'])).toEqual({ ok: true, sans: ['O-O-O'] });
    const blackToMove = 'r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1';
    expect(uciPvToSan(blackToMove, ['e8g8'])).toEqual({ ok: true, sans: ['O-O'] });
    expect(uciPvToSan(blackToMove, ['e8c8'])).toEqual({ ok: true, sans: ['O-O-O'] });
  });

  it('renders en-passant captures', () => {
    const fen = '4k3/8/8/3pPp2/8/8/8/4K3 w - f6 0 3';
    expect(uciPvToSan(fen, ['e5f6'])).toEqual({ ok: true, sans: ['exf6'] });
  });

  it('renders promotions with the chosen piece', () => {
    const fen = '8/4P3/k7/8/8/8/8/4K3 w - - 0 1';
    expect(uciPvToSan(fen, ['e7e8q'])).toEqual({ ok: true, sans: ['e8=Q'] });
    expect(uciPvToSan(fen, ['e7e8n'])).toEqual({ ok: true, sans: ['e8=N'] });
  });

  it('errors on malformed UCI tokens', () => {
    const result = uciPvToSan(START_FEN, ['zzz']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('Invalid UCI');
  });

  it('errors on illegal moves', () => {
    const result = uciPvToSan(START_FEN, ['e2e5']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('Illegal UCI');
  });

  it('errors on an invalid FEN', () => {
    const result = uciPvToSan('nonsense', ['e2e4']);
    expect(result.ok).toBe(false);
  });

  it('returns an empty list for an empty PV', () => {
    expect(uciPvToSan(START_FEN, [])).toEqual({ ok: true, sans: [] });
  });
});
