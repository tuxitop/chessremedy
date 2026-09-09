import { describe, expect, it } from 'vitest';
import { parsePuzzleId, puzzleIdOf } from './id';

describe('puzzleIdOf', () => {
  it('projects the F011 natural key onto a single id string', () => {
    expect(puzzleIdOf('game-1', 0)).toBe('game-1:0');
    expect(puzzleIdOf('game-1', 6)).toBe('game-1:6');
  });

  it('keeps a game id containing colons intact (last colon is the separator)', () => {
    expect(puzzleIdOf('fixture:mate-two', 10)).toBe('fixture:mate-two:10');
  });
});

describe('parsePuzzleId', () => {
  it('round-trips puzzleIdOf for plain and colon-containing game ids', () => {
    for (const [gameId, ply] of [
      ['game-1', 0],
      ['game-1', 6],
      ['fixture:mate-two', 10],
      ['some:game:id', 42],
    ] as const) {
      const parsed = parsePuzzleId(puzzleIdOf(gameId, ply));
      expect(parsed).toEqual({ ok: true, sourceGameId: gameId, sourcePly: ply });
    }
  });

  it('rejects an empty id', () => {
    const parsed = parsePuzzleId('');
    expect(parsed.ok).toBe(false);
  });

  it('rejects an id with no separator', () => {
    const parsed = parsePuzzleId('no-separator');
    expect(parsed.ok).toBe(false);
  });

  it('rejects an empty game id segment', () => {
    expect(parsePuzzleId(':6').ok).toBe(false);
  });

  it('rejects an empty ply segment', () => {
    expect(parsePuzzleId('game-1:').ok).toBe(false);
  });

  it('rejects a non-numeric ply segment', () => {
    expect(parsePuzzleId('game-1:six').ok).toBe(false);
    expect(parsePuzzleId('game-1:-3').ok).toBe(false);
  });
});
