import { describe, expect, it, beforeEach } from 'vitest';
import { db } from './database';
import { gamesRepository, GameCorruptionError, type GameRow } from './games-repository';
import { fixtureGame } from '@/domain/chess/fixtures';
import { gameFromPgn } from '@/domain/chess/parseGame';
import { makeGameId, type Game } from '@/domain/chess/game';
import type { Player } from '@/domain/chess/game';

function localGame(pgn: string, userColor: 'white' | 'black'): Game {
  const parsed = gameFromPgn(pgn, { source: 'local', userColor });
  if (!parsed.ok) {
    throw new Error(parsed.error.message);
  }
  return parsed.game;
}

const player = (name: string, rating: number | null): Player => ({ name, rating });

describe('gamesRepository CRUD', () => {
  beforeEach(async () => {
    await db.games.clear();
  });

  it('inserts a game and retrieves a full domain Game', async () => {
    const original = fixtureGame('cc-blitz-clean');
    const result = await gamesRepository.saveGame(original);
    expect(result).toEqual({ status: 'inserted', id: original.id });

    const stored = await gamesRepository.getGame(original.id);
    expect(stored).toBeDefined();
    expect(stored!.id).toBe(original.id);
    expect(stored!.source).toBe('chesscom');
    expect(stored!.externalId).toBe(original.externalId);
    expect(stored!.userColor).toBe('black');
    expect(stored!.whitePlayer).toEqual(original.whitePlayer);
    expect(stored!.blackPlayer).toEqual(original.blackPlayer);
    expect(stored!.result).toBe('0-1');
    expect(stored!.timeControl).toBe('300+0');
    expect(stored!.normalizedTimeControl).toBe('blitz');
    expect(stored!.pgn).toBe(original.pgn);
    expect(stored!.moves.startFen).toBe(original.moves.startFen);
    expect(stored!.moves.root.children.length).toBeGreaterThan(0);
  });

  it('returns undefined for a missing id', async () => {
    expect(await gamesRepository.getGame('lichess:nope')).toBeUndefined();
  });

  it('round-trips a FEN-start game preserving moves.startFen', async () => {
    const original = fixtureGame('local-fen-endgame');
    await gamesRepository.saveGame(original);
    const stored = await gamesRepository.getGame(original.id);
    expect(stored!.moves.startFen).toBe(original.moves.startFen);
    expect(stored!.moves.startFen).toContain('4k3');
  });

  it('round-trips a zero-move forfeit game', async () => {
    const pgn = `[Event "Forfeit"]
[Date "2026.06.20"]
[White "alice"]
[Black "bob"]
[Result "0-1"]
[TimeControl "300"]

0-1`;
    const game = localGame(pgn, 'black');
    await gamesRepository.saveGame(game);
    const stored = await gamesRepository.getGame(game.id);
    expect(stored!.result).toBe('0-1');
    expect(stored!.moves.root.children).toHaveLength(0);
  });

  it('updates provider content while preserving importedAt and refreshing updatedAt', async () => {
    const original = fixtureGame('cc-blitz-clean');
    await gamesRepository.saveGame(original);
    const before = (await db.games.get(original.id))!;

    const changed = localGame(original.pgn.replace('1535', '1536'), 'black');
    const forged: Game = {
      ...changed,
      id: original.id,
      source: 'chesscom',
      externalId: original.externalId,
    };
    const result = await gamesRepository.saveGame(forged);
    expect(result.status).toBe('updated');

    expect(await db.games.count()).toBe(1);
    const after = (await db.games.get(original.id))!;
    expect(after.importedAt).toBe(before.importedAt);
    expect(after.updatedAt).toBeGreaterThanOrEqual(before.updatedAt);
    expect(after.blackPlayer).toEqual({ name: original.blackPlayer.name, rating: 1536 });
  });

  it('reports duplicate for identical content and leaves the row untouched', async () => {
    const game = fixtureGame('cc-blitz-clean');
    await gamesRepository.saveGame(game);
    const before = (await db.games.get(game.id))!;

    const result = await gamesRepository.saveGame(game);
    expect(result.status).toBe('duplicate');
    expect(await db.games.count()).toBe(1);
    expect(await db.games.get(game.id)).toEqual(before);
  });

  it('coexists for different external ids and reflects hasGame', async () => {
    const a = fixtureGame('cc-bullet-blunder');
    const b = fixtureGame('li-rapid-clean');
    expect(a.id).not.toBe(b.id);
    expect((await gamesRepository.saveGame(a)).status).toBe('inserted');
    expect((await gamesRepository.saveGame(b)).status).toBe('inserted');
    expect(await gamesRepository.hasGame(a.id)).toBe(true);
    expect(await gamesRepository.hasGame(b.id)).toBe(true);
    expect(await gamesRepository.hasGame('local:missing')).toBe(false);
  });

  it('deletes a game idempotently', async () => {
    const game = fixtureGame('cc-bullet-blunder');
    await gamesRepository.saveGame(game);
    await gamesRepository.deleteGame(game.id);
    expect(await gamesRepository.getGame(game.id)).toBeUndefined();
    await gamesRepository.deleteGame(game.id);
    expect(await gamesRepository.hasGame(game.id)).toBe(false);
  });

  it('saves a batch inside one transaction with aligned results', async () => {
    const a = fixtureGame('cc-bullet-blunder');
    const b = fixtureGame('li-rapid-clean');
    await gamesRepository.saveGame(a);
    const results = await gamesRepository.saveGames([a, b, fixtureGame('cc-blitz-clean')]);
    expect(results.map((r) => r.status)).toEqual(['duplicate', 'inserted', 'inserted']);
    expect(await db.games.count()).toBe(3);
  });

  it('rolls back the whole batch when a write fails mid-way', async () => {
    const a = fixtureGame('cc-blitz-clean');
    const bad = { ...fixtureGame('local-short-unknown-tc') };
    Object.defineProperty(bad, 'pgn', {
      get() {
        throw new Error('boom');
      },
    });

    await expect(gamesRepository.saveGames([a, bad as Game])).rejects.toThrow('boom');
    expect(await db.games.count()).toBe(0);
  });

  it('guards a local id collision with idCollision and never overwrites', async () => {
    const original = fixtureGame('local-short-unknown-tc');
    await gamesRepository.saveGame(original);

    const different = localGame(
      `[Event "Other"]
[Date "2026.04.01"]
[White "someone"]
[Black "other"]
[Result "1-0"]
[TimeControl "300"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6 5. d3 d6 6. O-O O-O 7. Bg5 h6 8. Bxf6 Qxf6 9. Nbd2 1-0`,
      'white',
    );
    const collided: Game = { ...different, id: original.id };
    const result = await gamesRepository.saveGame(collided);
    expect(result.status).toBe('idCollision');
    expect(await db.games.count()).toBe(1);
    expect((await gamesRepository.getGame(original.id))!.pgn).toBe(original.pgn);
  });
});

describe('gamesRepository listing & filtering', () => {
  beforeEach(async () => {
    await db.games.clear();
  });

  it('orders by playedAt descending with nulls last and id-ascending ties', async () => {
    const dated = (day: number, tag: string) =>
      localGame(
        `[Event "x ${tag}"]
[Date "2026.01.${String(day).padStart(2, '0')}"]
[White "w"]
[Black "b"]
[Result "1-0"]

1. e4 e5 *`,
        'white',
      );

    const late = dated(20, 'late');
    const tieA = dated(10, 'tie-a');
    const tieB = dated(10, 'tie-b');
    const noDate1 = noDateGame('AAA');
    const noDate2 = noDateGame('BBB');
    for (const game of [late, tieA, tieB, noDate1, noDate2]) {
      await gamesRepository.saveGame(game);
    }

    const list = await gamesRepository.listGameSummaries();
    const ids = list.map((s) => s.id);
    const tieGroup = [tieA.id, tieB.id].sort();
    const nullGroup = [noDate1.id, noDate2.id].sort();
    expect(ids).toEqual([late.id, ...tieGroup, ...nullGroup]);
  });

  it('filters by source, time control, result, user color and date bounds', async () => {
    const ccBullet = fixtureGame('cc-bullet-blunder'); // 2026-05-25, white, 0-1, bullet
    const ccBlitz = fixtureGame('cc-blitz-clean'); // 2026-05-28, black, 0-1, blitz
    const liRapid = fixtureGame('li-rapid-clean'); // 2026-06-15, black, 1/2-1/2, rapid
    const localShort = fixtureGame('local-short-unknown-tc'); // 2026-05-26, white, 0-1, unknown
    for (const game of [ccBullet, ccBlitz, liRapid, localShort]) {
      await gamesRepository.saveGame(game);
    }

    const bySource = await gamesRepository.listGameSummaries({ source: 'lichess' });
    expect(bySource.map((s) => s.id)).toEqual([liRapid.id]);

    const byTc = await gamesRepository.listGameSummaries({ normalizedTimeControl: 'blitz' });
    expect(byTc.map((s) => s.id)).toEqual([ccBlitz.id]);

    const byResult = await gamesRepository.listGameSummaries({ result: '0-1' });
    expect(new Set(byResult.map((s) => s.id))).toEqual(
      new Set([ccBullet.id, ccBlitz.id, localShort.id]),
    );

    const byColor = await gamesRepository.listGameSummaries({ userColor: 'black' });
    expect(new Set(byColor.map((s) => s.id))).toEqual(new Set([ccBlitz.id, liRapid.id]));

    const before = await gamesRepository.listGameSummaries({
      playedBefore: '2026-05-27T00:00:00Z',
    });
    expect(new Set(before.map((s) => s.id))).toEqual(new Set([ccBullet.id, localShort.id]));

    const after = await gamesRepository.listGameSummaries({
      playedAfter: '2026-06-01T00:00:00Z',
    });
    expect(after.map((s) => s.id)).toEqual([liRapid.id]);
  });

  it('excludes dateless rows from date-bound queries', async () => {
    const dated = localGame(
      '[Date "2026.05.25"]\n[White "w"]\n[Black "b"]\n[Result "1-0"]\n\n1. e4 e5 *',
      'white',
    );
    const dateless = localGame('[White "w"]\n[Black "b"]\n[Result "*"]\n\n1. e4 e5 *', 'white');
    expect(dateless.playedAt).toBeNull();
    await gamesRepository.saveGame(dated);
    await gamesRepository.saveGame(dateless);

    const bounded = await gamesRepository.listGameSummaries({
      playedAfter: '2026-01-01T00:00:00Z',
    });
    expect(bounded.map((s) => s.id)).toEqual([dated.id]);
  });

  it('applies combined filters via the leading-index path', async () => {
    const ccBlitz = fixtureGame('cc-blitz-clean'); // chesscom, blitz, 0-1, black
    const ccBullet = fixtureGame('cc-bullet-blunder'); // chesscom, bullet, 0-1, white
    for (const game of [ccBlitz, ccBullet]) {
      await gamesRepository.saveGame(game);
    }
    const combined = await gamesRepository.listGameSummaries({
      source: 'chesscom',
      normalizedTimeControl: 'blitz',
      result: '0-1',
    });
    expect(combined.map((s) => s.id)).toEqual([ccBlitz.id]);
  });

  it('returns an empty list when nothing matches', async () => {
    const game = fixtureGame('cc-blitz-clean');
    await gamesRepository.saveGame(game);
    expect(await gamesRepository.listGameSummaries({ source: 'lichess' })).toEqual([]);
  });
});

describe('gamesRepository corruption detection & categories', () => {
  beforeEach(async () => {
    await db.games.clear();
  });

  it('throws GameCorruptionError when a stored PGN cannot be re-parsed', async () => {
    const id = makeGameId('local', null, 'not a real pgn');
    const row: GameRow = {
      id,
      source: 'local',
      externalId: null,
      playedAt: null,
      whitePlayer: player('a', null),
      blackPlayer: player('b', null),
      result: '*',
      timeControl: '',
      normalizedTimeControl: 'unknown',
      userColor: 'white',
      pgn: 'not a real pgn',
      importedAt: 1,
      updatedAt: 1,
    };
    await db.games.put(row);
    await expect(gamesRepository.getGame(id)).rejects.toBeInstanceOf(GameCorruptionError);
  });

  it('preserves the stored category for a locally imported unknown-TC game', async () => {
    const game = fixtureGame('local-short-unknown-tc');
    await gamesRepository.saveGame(game);
    const stored = await gamesRepository.getGame(game.id);
    expect(stored!.normalizedTimeControl).toBe('unknown');
    expect(stored!.timeControl).toBe('');
  });
});

function noDateGame(label: string): Game {
  const pgn = `[Event "${label}"]
[White "w"]
[Black "b"]
[Result "*"]

1. e4 e5 *`;
  return localGame(pgn, 'white');
}
