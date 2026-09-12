import { describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { ChessRemedyDatabase } from '../database';
import { DexieGamesRepository } from '../games-repository';
import { DexieAnalysisJobsRepository } from '../analysis-jobs-repository';
import { DexieAnalysisRepository } from '../analysis-repository';
import { DexieEngineAnalysisCache } from '../engine-cache-repository';
import { fixtureGame } from '@/domain/chess/fixtures';
import { createAnalysisJob } from '@/domain/analysis';
import { createImportJob, markCompleted } from '@/domain/import/job';
import { DEFAULT_IMPORT_FILTERS } from '@/domain/import';
import type { EngineMetadata } from '@/domain/chess';

let sequence = 0;

function uniqueName(): string {
  sequence += 1;
  return `chessremedy-test-${Date.now()}-${sequence}`;
}

const ENGINE: EngineMetadata = {
  engineName: 'stockfish',
  engineVersion: '18.0.8',
  engineBuild: 'stockfish-18-lite-single',
  profile: 'normal',
};

describe('v3 → v4 schema migration', () => {
  it('upgrades a v3 database in place, preserving settings/games/import jobs', async () => {
    const name = uniqueName();
    const game = fixtureGame('cc-blitz-clean');

    // A real pre-Feature-008 database: schema v3.
    const v3 = new Dexie(name);
    v3.version(1).stores({ settings: '&key' });
    v3.version(2).stores({ games: '&id, source, playedAt, normalizedTimeControl' });
    v3.version(3).stores({ importJobs: '&id, provider, username, status, updatedAt' });
    await v3.open();
    await v3.table('settings').put({ key: 'theme', value: 'dark', updatedAt: Date.now() });
    await v3.table('games').put({
      id: game.id,
      source: game.source,
      externalId: game.externalId,
      playedAt: game.playedAt,
      whitePlayer: game.whitePlayer,
      blackPlayer: game.blackPlayer,
      result: game.result,
      timeControl: game.timeControl,
      normalizedTimeControl: game.normalizedTimeControl,
      userColor: game.userColor,
      pgn: game.pgn,
      importedAt: 1,
      updatedAt: 1,
    });
    const importJob = markCompleted(
      createImportJob('chesscom', 'Remedy', DEFAULT_IMPORT_FILTERS, Date.now()),
      Date.now(),
    );
    await v3.table('importJobs').put(importJob);
    await v3.close();

    const migrated = new ChessRemedyDatabase(name);
    try {
      await migrated.open();
      expect(migrated.verno).toBe(11);
      expect(migrated.tables.map((t) => t.name)).toEqual([
        'settings',
        'games',
        'importJobs',
        'analysisJobs',
        'analyses',
        'positionAnalysisCache',
        'analysisSummaries',
        'puzzleCandidates',
        'puzzles',
        'puzzleAttempts',
        'trainingSets',
        'trainingCycles',
      ]);

      expect((await migrated.settings.get('theme'))?.value).toBe('dark');
      expect(await migrated.games.count()).toBe(1);
      expect(await migrated.importJobs.count()).toBe(1);

      // New tables are empty and usable.
      expect(await migrated.analysisJobs.count()).toBe(0);
      expect(await migrated.analyses.count()).toBe(0);
      expect(await migrated.positionAnalysisCache.count()).toBe(0);

      const jobs = new DexieAnalysisJobsRepository(migrated);
      const job = createAnalysisJob(game.id, ENGINE, 40, 1);
      await jobs.putJob(job);
      expect((await jobs.getJob(job.id))!.state).toBe('queued');
    } finally {
      await migrated.close();
    }
  });

  it('keeps game reads working alongside the new analysis tables (restart proxy)', async () => {
    const name = uniqueName();
    const game = fixtureGame('cc-blitz-clean');

    const first = new ChessRemedyDatabase(name);
    await first.open();
    await new DexieGamesRepository(first).saveGame(game);
    const job = createAnalysisJob(game.id, ENGINE, 2, 1);
    await new DexieAnalysisJobsRepository(first).putJob(job);
    await new DexieEngineAnalysisCache(first).put('key:1', {
      jobId: 'j1',
      position: 'start',
      profile: 'normal',
      lines: [],
      engine: ENGINE,
      timeMs: 1,
    });
    await first.close();

    const second = new ChessRemedyDatabase(name);
    try {
      await second.open();
      expect(await second.games.count()).toBe(1);
      const jobs = new DexieAnalysisJobsRepository(second);
      expect((await jobs.getJob(job.id))!.state).toBe('queued');
      const analyses = new DexieAnalysisRepository(second);
      expect(await analyses.countForGame(game.id)).toBe(0);
      const cache = new DexieEngineAnalysisCache(second);
      expect((await cache.get('key:1'))?.profile).toBe('normal');
    } finally {
      await second.close();
    }
  });
});
