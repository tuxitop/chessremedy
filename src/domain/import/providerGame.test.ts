import { describe, expect, it } from 'vitest';
import { fixtureGame } from '@/domain/chess/fixtures';
import { providerGameToGame, type ProviderGameRecord } from './providerGame';

function record(overrides: Partial<ProviderGameRecord>): ProviderGameRecord {
  return {
    source: 'chesscom',
    externalId: '1001',
    username: 'chessremedy',
    pgn: `[Event "x"]
[Date "2026.01.10"]
[White "chessremedy"]
[Black "bob"]
[Result "1-0"]
[WhiteElo "1500"]
[BlackElo "1520"]
[TimeControl "300"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Bxc6 dxc6 5. O-O 1-0`,
    playedAtIso: null,
    timeControlRaw: null,
    whiteName: 'chessremedy',
    blackName: 'bob',
    whiteElo: 1500,
    blackElo: 1520,
    ...overrides,
  };
}

describe('providerGameToGame', () => {
  it('reproduces the Chess.com fixture game exactly when no enrichment differs', () => {
    const fixture = fixtureGame('cc-blitz-clean'); // user Black vs eagereddie
    const outcome = providerGameToGame({
      source: 'chesscom',
      externalId: fixture.externalId!,
      username: 'chessremedy',
      pgn: fixture.pgn,
      playedAtIso: null,
      timeControlRaw: null,
      whiteName: 'eagereddie',
      blackName: 'chessremedy',
      whiteElo: 1510,
      blackElo: 1535,
    });
    expect(outcome.kind).toBe('game');
    if (outcome.kind !== 'game') return;
    expect(outcome.game).toEqual(fixture);
    expect(outcome.game.id).toBe('chesscom:7123456702');
    expect(outcome.game.userColor).toBe('black');
    expect(outcome.game.normalizedTimeControl).toBe('blitz');
  });

  it('uses provider enrichment when the PGN is sparse', () => {
    const outcome = providerGameToGame(
      record({
        pgn: `[Event "x"]
[White "chessremedy"]
[Black "bob"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6 5. d3 d6 6. O-O 1-0`,
        playedAtIso: '2026-01-10T12:34:56.000Z',
        timeControlRaw: '600+5',
        whiteElo: 1620,
        blackElo: 1600,
      }),
    );
    expect(outcome.kind).toBe('game');
    if (outcome.kind !== 'game') return;
    expect(outcome.game.playedAt).toBe('2026-01-10T12:34:56.000Z');
    expect(outcome.game.timeControl).toBe('600+5');
    expect(outcome.game.normalizedTimeControl).toBe('rapid');
    // Ratings fall back from the record even though the PGN has no Elo.
    expect(outcome.game.whitePlayer).toEqual({ name: 'chessremedy', rating: 1620 });
    expect(outcome.game.blackPlayer).toEqual({ name: 'bob', rating: 1600 });
  });

  it('classifies a record-only correspondence time control', () => {
    const outcome = providerGameToGame(
      record({
        pgn: `[Event "x"]
[White "ally"]
[Black "chessremedy"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O 1/2-1/2`,
        timeControlRaw: '1/259200',
        whiteName: 'ally',
        blackName: 'chessremedy',
      }),
    );
    expect(outcome.kind).toBe('game');
    if (outcome.kind !== 'game') return;
    expect(outcome.game.timeControl).toBe('1/259200');
    expect(outcome.game.normalizedTimeControl).toBe('correspondence');
  });

  it('classifies record-only controls with the record provider profile', () => {
    const sparsePgn = `[Event "x"]
[White "chessremedy"]
[Black "bob"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6 5. d3 d6 6. O-O 1-0`;

    const chesscom = providerGameToGame(record({ pgn: sparsePgn, timeControlRaw: '300+5' }));
    expect(chesscom.kind).toBe('game');
    if (chesscom.kind !== 'game') return;
    expect(chesscom.game.normalizedTimeControl).toBe('blitz');

    const chesscomLong = providerGameToGame(record({ pgn: sparsePgn, timeControlRaw: '1800' }));
    expect(chesscomLong.kind).toBe('game');
    if (chesscomLong.kind !== 'game') return;
    expect(chesscomLong.game.normalizedTimeControl).toBe('rapid');

    const lichess = providerGameToGame(
      record({ source: 'lichess', pgn: sparsePgn, timeControlRaw: '300+5' }),
    );
    expect(lichess.kind).toBe('game');
    if (lichess.kind !== 'game') return;
    expect(lichess.game.normalizedTimeControl).toBe('rapid');
  });

  it('skips a game when the importing user is not a player', () => {
    const outcome = providerGameToGame(record({ whiteName: 'somebody', blackName: 'else' }));
    expect(outcome.kind).toBe('skip');
    if (outcome.kind !== 'skip') return;
    expect(outcome.code).toBe('userNotInGame');
  });

  it('skips a game with a missing external id', () => {
    const outcome = providerGameToGame(record({ externalId: '   ' }));
    expect(outcome.kind).toBe('skip');
    if (outcome.kind !== 'skip') return;
    expect(outcome.code).toBe('missingId');
  });

  it('skips an illegal PGN with the illegalMove code', () => {
    const outcome = providerGameToGame(
      record({
        pgn: `[Event "x"]
[White "chessremedy"]
[Black "bob"]
[Result "*"]

1. e4 e5 2. f4 Qh4+ 3. g4 *`,
      }),
    );
    expect(outcome.kind).toBe('skip');
    if (outcome.kind !== 'skip') return;
    expect(outcome.code).toBe('illegalMove');
  });

  it('is deterministic: the same record maps to an identical game twice', () => {
    const input = record({});
    const first = providerGameToGame(input);
    const second = providerGameToGame(input);
    expect(first.kind).toBe('game');
    expect(second.kind).toBe('game');
    if (first.kind !== 'game' || second.kind !== 'game') return;
    expect(second.game).toEqual(first.game);
    expect(second.game.id).toBe(first.game.id);
  });
});
