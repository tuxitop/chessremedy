import { describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { ChessRemedyDatabase } from '../database';
import { DexieGamesRepository } from '../games-repository';
import { fixtureGame } from '@/domain/chess/fixtures';
import type { Game } from '@/domain/chess/game';

let sequence = 0;

function uniqueName(): string {
  sequence += 1;
  return `chessremedy-test-${Date.now()}-${sequence}`;
}

describe('v1 → v2 schema migration', () => {
  it('upgrades a v1 database in place and preserves settings', async () => {
    const name = uniqueName();

    // A real pre-Feature-004 database: schema v1 only, with data.
    const v1 = new Dexie(name);
    v1.version(1).stores({ settings: '&key' });
    await v1.open();
    await v1.table('settings').put({ key: 'theme', value: 'dark', updatedAt: Date.now() });
    await v1.close();

    const migrated = new ChessRemedyDatabase(name);
    try {
      await migrated.open();
      expect(migrated.verno).toBe(3);
      expect(migrated.tables.map((t) => t.name)).toEqual(['settings', 'games', 'importJobs']);

      const theme = await migrated.settings.get('theme');
      expect(theme?.value).toBe('dark');

      // The new games table is empty and usable.
      expect(await migrated.games.count()).toBe(0);
      const repository = new DexieGamesRepository(migrated);
      const game = fixtureGame('cc-blitz-clean');
      await repository.saveGame(game);
      expect(await migrated.games.count()).toBe(1);
      expect((await repository.getGame(game.id))!.id).toBe(game.id);
    } finally {
      await migrated.close();
    }
  });
});

describe('games survive close/reopen (restart proxy)', () => {
  it('reads back identical games from a fresh connection on the same store', async () => {
    const name = uniqueName();
    const games: readonly Game[] = [fixtureGame('cc-blitz-clean'), fixtureGame('li-rapid-clean')];

    const first = new ChessRemedyDatabase(name);
    const firstRepo = new DexieGamesRepository(first);
    for (const game of games) {
      await firstRepo.saveGame(game);
    }
    await first.close();

    const second = new ChessRemedyDatabase(name);
    try {
      await second.open();
      expect(second.verno).toBe(3);
      const secondRepo = new DexieGamesRepository(second);

      expect(await second.games.count()).toBe(games.length);
      expect(await secondRepo.hasGame(games[0]!.id)).toBe(true);

      const stored = await secondRepo.getGame(games[0]!.id);
      expect(stored!.id).toBe(games[0]!.id);
      expect(stored!.pgn).toBe(games[0]!.pgn);
      expect(stored!.moves.root.children.length).toBeGreaterThan(0);

      const list = await secondRepo.listGameSummaries();
      expect(list.map((s) => s.id).sort()).toEqual(games.map((g) => g.id).sort());
    } finally {
      await second.close();
    }
  });
});
