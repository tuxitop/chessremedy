import { describe, expect, it } from 'vitest';
import { platformGameUrl } from './platformGameUrl';

describe('platformGameUrl', () => {
  it('prefers a Link header URL from the PGN', () => {
    const pgn =
      '[Event "Live Chess"]\n[Site "Chess.com"]\n[Link "https://www.chess.com/game/live/999"]\n\n1. e4';
    expect(platformGameUrl('chesscom', '123', pgn)).toBe('https://www.chess.com/game/live/999');
  });

  it('uses a Site header when it is an absolute URL', () => {
    const pgn = '[Site "https://lichess.org/abcd1234"]\n\n1. e4';
    expect(platformGameUrl('lichess', 'abcd1234', pgn)).toBe('https://lichess.org/abcd1234');
  });

  it('derives the Chess.com page from the external id when the PGN has no URL', () => {
    expect(platformGameUrl('chesscom', '7123456703', '[Site "Chess.com"]')).toBe(
      'https://www.chess.com/game/live/7123456703',
    );
  });

  it('derives the Lichess page from the external id', () => {
    expect(platformGameUrl('lichess', 'abcd1234', undefined)).toBe('https://lichess.org/abcd1234');
  });

  it('returns null for local/fixture games and missing external ids', () => {
    expect(platformGameUrl('local', 'x', undefined)).toBeNull();
    expect(platformGameUrl('fixture', 'x', undefined)).toBeNull();
    expect(platformGameUrl('chesscom', null, undefined)).toBeNull();
    expect(platformGameUrl('chesscom', '   ', undefined)).toBeNull();
  });
});
