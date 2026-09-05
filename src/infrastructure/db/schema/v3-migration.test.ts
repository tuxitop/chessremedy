import { describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { ChessRemedyDatabase } from '../database';
import { DexieImportJobsRepository } from '../import-jobs-repository';
import { createImportJob, markCompleted } from '@/domain/import/job';
import { DEFAULT_IMPORT_FILTERS } from '@/domain/import';
import { DexieGamesRepository } from '../games-repository';
import { fixtureGame } from '@/domain/chess/fixtures';

let sequence = 0;

function uniqueName(): string {
  sequence += 1;
  return `chessremedy-test-${Date.now()}-${sequence}`;
}

describe('v2 → v3 schema migration', () => {
  it('upgrades a v2 database in place, preserving settings and games', async () => {
    const name = uniqueName();

    // A real pre-Feature-007 database: schema v2 with settings + a game.
    const v2 = new Dexie(name);
    v2.version(1).stores({ settings: '&key' });
    v2.version(2).stores({ games: '&id, source, playedAt, normalizedTimeControl' });
    await v2.open();
    await v2.table('settings').put({ key: 'theme', value: 'dark', updatedAt: Date.now() });
    await v2.table('games').put({
      id: fixtureGame('cc-blitz-clean').id,
      source: fixtureGame('cc-blitz-clean').source,
      externalId: fixtureGame('cc-blitz-clean').externalId,
      playedAt: fixtureGame('cc-blitz-clean').playedAt,
      whitePlayer: fixtureGame('cc-blitz-clean').whitePlayer,
      blackPlayer: fixtureGame('cc-blitz-clean').blackPlayer,
      result: fixtureGame('cc-blitz-clean').result,
      timeControl: fixtureGame('cc-blitz-clean').timeControl,
      normalizedTimeControl: fixtureGame('cc-blitz-clean').normalizedTimeControl,
      userColor: fixtureGame('cc-blitz-clean').userColor,
      pgn: fixtureGame('cc-blitz-clean').pgn,
      importedAt: 1,
      updatedAt: 1,
    });
    await v2.close();

    const migrated = new ChessRemedyDatabase(name);
    try {
      await migrated.open();
      expect(migrated.verno).toBe(7);
      expect(migrated.tables.map((t) => t.name)).toEqual([
        'settings',
        'games',
        'importJobs',
        'analysisJobs',
        'analyses',
        'positionAnalysisCache',
        'analysisSummaries',
        'puzzleCandidates',
      ]);

      const theme = await migrated.settings.get('theme');
      expect(theme?.value).toBe('dark');
      expect(await migrated.games.count()).toBe(1);

      // The new importJobs table is empty and usable.
      expect(await migrated.importJobs.count()).toBe(0);
      const repo = new DexieImportJobsRepository(migrated);
      const job = markCompleted(
        createImportJob('chesscom', 'Remedy', DEFAULT_IMPORT_FILTERS, Date.now()),
        Date.now(),
      );
      await repo.putJob(job);
      expect(await migrated.importJobs.count()).toBe(1);
      expect((await repo.getJob(job.id))!.status).toBe('completed');
    } finally {
      await migrated.close();
    }
  });

  it('persists jobs across close/reopen (restart proxy)', async () => {
    const name = uniqueName();
    const job = createImportJob('lichess', 'carlsen', DEFAULT_IMPORT_FILTERS, 1);

    const first = new ChessRemedyDatabase(name);
    await first.open();
    await new DexieImportJobsRepository(first).putJob(job);
    await first.close();

    const second = new ChessRemedyDatabase(name);
    try {
      await second.open();
      const repo = new DexieImportJobsRepository(second);
      expect((await repo.getJob(job.id))!.id).toBe(job.id);
      // The games read path still works alongside the new table.
      expect(await second.games.count()).toBe(0);
      const gamesRepo = new DexieGamesRepository(second);
      const game = fixtureGame('cc-blitz-clean');
      await gamesRepo.saveGame(game);
      expect(await second.games.count()).toBe(1);
    } finally {
      await second.close();
    }
  });
});
