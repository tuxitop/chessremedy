import { describe, expect, it } from 'vitest';
import { gameFromPgn } from './parseGame';
import type { ImportContext } from './parseGame';

const CHESSCOM_PGN = `[Event "Live Chess"]
[Site "Chess.com"]
[Date "2026.05.25"]
[White "chessremedy"]
[Black "bulletpete"]
[Result "0-1"]
[WhiteElo "1472"]
[BlackElo "1488"]
[TimeControl "60"]
[Termination "checkmate"]

1. f3 e5 2. g4?? Qh4# 0-1`;

const LICHESS_PGN = `[Event "Rated Bullet game"]
[Site "https://lichess.org/bX7kQ2mZ"]
[Date "2026.06.08"]
[White "chessremedy"]
[Black "bulletbob"]
[Result "1-0"]
[UTCDate "2026.06.08"]
[UTCTime "10:12:33"]
[WhiteElo "1821"]
[BlackElo "1795"]
[TimeControl "60"]
[Termination "Normal"]

1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. d3 Nd4 5. Qxf7# 1-0`;

function parseOk(pgn: string, ctx: ImportContext) {
  const result = gameFromPgn(pgn, ctx);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.game;
}

describe('gameFromPgn', () => {
  it('maps Chess.com-style headers onto a Game', () => {
    const game = parseOk(CHESSCOM_PGN, {
      source: 'chesscom',
      externalId: '6123456789',
      userColor: 'white',
    });
    expect(game.id).toBe('chesscom:6123456789');
    expect(game.source).toBe('chesscom');
    expect(game.externalId).toBe('6123456789');
    expect(game.whitePlayer).toEqual({ name: 'chessremedy', rating: 1472 });
    expect(game.blackPlayer).toEqual({ name: 'bulletpete', rating: 1488 });
    expect(game.result).toBe('0-1');
    expect(game.userColor).toBe('white');
    expect(game.timeControl).toBe('60');
    expect(game.normalizedTimeControl).toBe('bullet');
    expect(game.playedAt).toBe('2026-05-25T00:00:00Z');
    expect(game.pgn).toBe(CHESSCOM_PGN);
  });

  it('maps Lichess UTCDate/UTCTime onto playedAt', () => {
    const game = parseOk(LICHESS_PGN, {
      source: 'lichess',
      externalId: 'bX7kQ2mZ',
      userColor: 'white',
    });
    expect(game.playedAt).toBe('2026-06-08T10:12:33Z');
    expect(game.normalizedTimeControl).toBe('bullet');
  });

  it('classifies with the source profile (Chess.com 5|5 vs Lichess 5|5)', () => {
    const chesscom = parseOk(CHESSCOM_PGN.replace('[TimeControl "60"]', '[TimeControl "300+5"]'), {
      source: 'chesscom',
      externalId: '1',
      userColor: 'white',
    });
    expect(chesscom.normalizedTimeControl).toBe('blitz');

    const lichess = parseOk(LICHESS_PGN.replace('[TimeControl "60"]', '[TimeControl "300+5"]'), {
      source: 'lichess',
      externalId: 'bX7kQ2mZ',
      userColor: 'white',
    });
    expect(lichess.normalizedTimeControl).toBe('rapid');
  });

  it('maps a long Chess.com game to rapid (no classical group)', () => {
    const game = parseOk(CHESSCOM_PGN.replace('[TimeControl "60"]', '[TimeControl "1800"]'), {
      source: 'chesscom',
      externalId: '1',
      userColor: 'white',
    });
    expect(game.normalizedTimeControl).toBe('rapid');
  });

  it('derives userColor from a matching username', () => {
    const game = parseOk(CHESSCOM_PGN, {
      source: 'chesscom',
      externalId: '1',
      username: 'chessremedy',
    });
    expect(game.userColor).toBe('white');
  });

  it('lets an explicit userColor win over the username', () => {
    const game = parseOk(CHESSCOM_PGN, {
      source: 'chesscom',
      externalId: '1',
      userColor: 'black',
      username: 'chessremedy',
    });
    expect(game.userColor).toBe('black');
  });

  it('is deterministic for identical input', () => {
    const ctx = { source: 'local' as const, userColor: 'white' as const };
    expect(parseOk(CHESSCOM_PGN, ctx)).toEqual(parseOk(CHESSCOM_PGN, ctx));
  });

  it('returns null playedAt for missing or unknown dates', () => {
    const dateless = CHESSCOM_PGN.replace('[Date "2026.05.25"]\n', '');
    expect(parseOk(dateless, { source: 'local', userColor: 'white' }).playedAt).toBeNull();

    const unknown = CHESSCOM_PGN.replace('2026.05.25', '????.??.??');
    expect(parseOk(unknown, { source: 'local', userColor: 'white' }).playedAt).toBeNull();
  });

  it('maps missing/placeholder Elo to a null rating', () => {
    const pgn = CHESSCOM_PGN.replace('[WhiteElo "1472"]\n', '[WhiteElo "?"]\n').replace(
      '[BlackElo "1488"]\n',
      '',
    );
    const game = parseOk(pgn, { source: 'chesscom', externalId: '1', userColor: 'white' });
    expect(game.whitePlayer.rating).toBeNull();
    expect(game.blackPlayer.rating).toBeNull();
  });

  it('honours a [SetUp] + [FEN] start position', () => {
    const pgn = `[Event "Local"]
[Date "2026.06.03"]
[Result "1/2-1/2"]
[SetUp "1"]
[FEN "8/8/8/4k3/8/4K3/8/8 w - - 0 1"]
[TimeControl "900+10"]

1. Kd3 Kd5 2. Ke3 Ke5 1/2-1/2`;
    const game = parseOk(pgn, { source: 'local', userColor: 'white' });
    expect(game.moves.startFen).toBe('8/8/8/4k3/8/4K3/8/8 w - - 0 1');
    expect(game.normalizedTimeControl).toBe('rapid');
  });

  it('takes the first game from multi-game text', () => {
    const multi = `${CHESSCOM_PGN}\n\n${CHESSCOM_PGN.replace('bulletpete', 'secondplayer')}`;
    const game = parseOk(multi, { source: 'chesscom', externalId: '1', userColor: 'white' });
    expect(game.blackPlayer.name).toBe('bulletpete');
  });

  it('returns errors for structural failures', () => {
    const expectError = (pgn: string, ctx: ImportContext, code: string) => {
      const result = gameFromPgn(pgn, ctx);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(code);
      }
    };

    expectError('', { source: 'local', userColor: 'white' }, 'noGame');
    expectError('   \n  \n', { source: 'local', userColor: 'white' }, 'noGame');
    expectError('hello world 12345', { source: 'local', userColor: 'white' }, 'noMoves');
    expectError(CHESSCOM_PGN, { source: 'lichess' }, 'missingExternalId');
    expectError(
      CHESSCOM_PGN,
      { source: 'lichess', externalId: 'x', username: 'ghost' },
      'ambiguousColor',
    );
    expectError(
      CHESSCOM_PGN,
      { source: 'nope' as ImportContext['source'], userColor: 'white' },
      'invalidSource',
    );
  });

  it('rejects an illegal SAN with its ply', () => {
    const pgn = '[Result "*"]\n\n1. Qe5+ Kd8';
    const result = gameFromPgn(pgn, { source: 'local', userColor: 'white' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('illegalMove');
      expect(result.error.ply).toBe(0);
      expect(result.error.message).toContain('Qe5+');
    }
  });

  it('accepts a zero-move game with a real result (forfeit)', () => {
    const pgn = `[Event "Forfeit"]
[Date "2026.06.20"]
[White "alice"]
[Black "bob"]
[Result "0-1"]
[TimeControl "300"]

0-1`;
    const game = parseOk(pgn, { source: 'local', userColor: 'black' });
    expect(game.result).toBe('0-1');
    expect(game.moves.root.children).toHaveLength(0);
  });
});
