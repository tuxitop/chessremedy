import { describe, expect, it } from 'vitest';
import { fenOf, parsePositionFen, resolveStartPosition } from './position';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('parsePositionFen', () => {
  it('parses a standard start position', () => {
    const result = parsePositionFen(START_FEN);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.position.turn).toBe('white');
      expect(result.position.fullmoves).toBe(1);
    }
  });

  it('rejects an invalid FEN', () => {
    const result = parsePositionFen('not-a-fen');
    expect(result.ok).toBe(false);
  });

  it('round-trips through fenOf', () => {
    const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
    const parsed = parsePositionFen(fen);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(fenOf(parsed.position)).toBe(fen);
    }
  });
});

describe('resolveStartPosition', () => {
  it('returns the standard start for empty headers', () => {
    const result = resolveStartPosition(new Map());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(fenOf(result.position)).toBe(START_FEN);
    }
  });

  it('honours a [FEN] header start position', () => {
    const headers = new Map<string, string>([
      ['SetUp', '1'],
      ['FEN', '8/8/8/4k3/8/4K3/8/8 w - - 0 1'],
    ]);
    const result = resolveStartPosition(headers);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(fenOf(result.position)).toBe('8/8/8/4k3/8/4K3/8/8 w - - 0 1');
    }
  });

  it('surfaces an invalid FEN header as an error', () => {
    const headers = new Map<string, string>([
      ['SetUp', '1'],
      ['FEN', 'bogus'],
    ]);
    expect(resolveStartPosition(headers).ok).toBe(false);
  });
});
