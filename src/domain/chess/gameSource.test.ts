import { describe, expect, it } from 'vitest';
import { GAME_SOURCES, GAME_SOURCE_LABELS, isGameSource, normalizeGameSource } from './gameSource';

describe('normalizeGameSource', () => {
  it('normalizes Chess.com variants', () => {
    expect(normalizeGameSource('chess.com')).toBe('chesscom');
    expect(normalizeGameSource('CHESSCOM')).toBe('chesscom');
    expect(normalizeGameSource('Chess-com')).toBe('chesscom');
    expect(normalizeGameSource('  chess.com  ')).toBe('chesscom');
  });

  it('normalizes Lichess variants', () => {
    expect(normalizeGameSource('lichess')).toBe('lichess');
    expect(normalizeGameSource('lichess.org')).toBe('lichess');
    expect(normalizeGameSource('LICHESS')).toBe('lichess');
  });

  it('normalizes local/fixture variants', () => {
    expect(normalizeGameSource('local')).toBe('local');
    expect(normalizeGameSource('pgn')).toBe('local');
    expect(normalizeGameSource('imported')).toBe('local');
    expect(normalizeGameSource('fixture')).toBe('fixture');
  });

  it('returns null for unknown input', () => {
    expect(normalizeGameSource('')).toBeNull();
    expect(normalizeGameSource('chessbase')).toBeNull();
    expect(normalizeGameSource('chess')).toBeNull();
    expect(normalizeGameSource('??')).toBeNull();
  });

  it('covers all four sources in GAME_SOURCES and labels', () => {
    expect(GAME_SOURCES).toEqual(['chesscom', 'lichess', 'local', 'fixture']);
    for (const source of GAME_SOURCES) {
      expect(GAME_SOURCE_LABELS[source].length).toBeGreaterThan(0);
      expect(isGameSource(source)).toBe(true);
    }
    expect(isGameSource('nope')).toBe(false);
  });
});
