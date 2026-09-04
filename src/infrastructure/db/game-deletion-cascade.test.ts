import { describe, expect, it, beforeEach } from 'vitest';
import { db } from './database';
import { gamesRepository } from './games-repository';
import { analysesRepository } from './analysis-repository';
import { analysisJobsRepository } from './analysis-jobs-repository';
import { DexieEngineAnalysisCache } from './engine-cache-repository';
import { fixtureGame } from '@/domain/chess/fixtures';
import { makeRecords, TEST_ENGINE } from '@/domain/analysis/test-support';
import { createAnalysisJob } from '@/domain/analysis';

describe('game deletion cascade (ARCHITECTURE.md §7)', () => {
  beforeEach(async () => {
    await db.games.clear();
    await db.analyses.clear();
    await db.analysisJobs.clear();
    await db.positionAnalysisCache.clear();
  });

  it('removes game-scoped MoveAnalysis and jobs but retains the FEN engine cache', async () => {
    const game = fixtureGame('cc-blitz-clean');
    await gamesRepository.saveGame(game);

    const job = createAnalysisJob(game.id, TEST_ENGINE, 14, 1);
    await analysisJobsRepository.putJob(job);
    await analysesRepository.replaceAnalysis(makeRecords(game.id, job.id, 14));

    const cache = new DexieEngineAnalysisCache();
    await cache.put('shared-fen-key', {
      jobId: 'j-x',
      position: 'start',
      profile: 'normal',
      lines: [
        { multipv: 1, evaluation: { cp: 10 }, principalVariation: [{ uci: 'e2e4' }], wdl: null },
      ],
      engine: TEST_ENGINE,
      timeMs: 1,
    });

    await gamesRepository.deleteGames([game.id]);

    expect(await db.games.count()).toBe(0);
    expect(await analysesRepository.countForGame(game.id)).toBe(0);
    expect(await analysisJobsRepository.listByGame(game.id)).toHaveLength(0);
    // The engine cache is position-keyed and shared — never purged.
    expect(await cache.count()).toBe(1);
  });
});
