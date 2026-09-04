import { describe, expect, it, beforeEach } from 'vitest';
import { db } from './database';
import { analysesRepository } from './analysis-repository';
import { analysisJobsRepository } from './analysis-jobs-repository';
import { DexieEngineAnalysisCache } from './engine-cache-repository';
import { makeJob, makeRecords, TEST_ENGINE } from '@/domain/analysis/test-support';
import { markCompleted, markFailed, markInProgress } from '@/domain/analysis';

const GAME = 'lichess:abc';
const ANALYSIS_A = `${GAME}|a1|c1|p1|stockfish@18.0.8@stockfish-18-lite-single@normal`;

describe('analysis repository', () => {
  beforeEach(async () => {
    await db.analyses.clear();
    await db.analysisJobs.clear();
    await db.positionAnalysisCache.clear();
  });

  it('replaces a run atomically and queries by game and analysis identity', async () => {
    await analysesRepository.replaceAnalysis(makeRecords(GAME, ANALYSIS_A, 3));
    expect(await analysesRepository.countForGame(GAME)).toBe(3);

    const byGame = await analysesRepository.listForGame(GAME);
    expect(byGame.map((r) => r.ply)).toEqual([0, 1, 2]);

    const byPair = await analysesRepository.listForGameAndAnalysis(GAME, ANALYSIS_A);
    expect(byPair).toHaveLength(3);

    // Replacing the same analysis identity with fewer rows removes leftovers.
    await analysesRepository.replaceAnalysis(makeRecords(GAME, ANALYSIS_A, 1));
    expect(await analysesRepository.countForGame(GAME)).toBe(1);
  });

  it('keeps distinct analysis identities separate for one game', async () => {
    const other = `${ANALYSIS_A}#fast`;
    await analysesRepository.replaceAnalysis(makeRecords(GAME, ANALYSIS_A, 2));
    await analysesRepository.replaceAnalysis(makeRecords(GAME, other, 4));
    expect(await analysesRepository.countForGame(GAME)).toBe(6);
    expect(await analysesRepository.listForGameAndAnalysis(GAME, other)).toHaveLength(4);
  });

  it('deletes game-scoped records', async () => {
    await analysesRepository.replaceAnalysis(makeRecords(GAME, ANALYSIS_A, 2));
    await analysesRepository.deleteForGames([GAME]);
    expect(await analysesRepository.countForGame(GAME)).toBe(0);
    expect(await db.analyses.count()).toBe(0);
  });
});

describe('analysis jobs repository', () => {
  beforeEach(async () => {
    await db.analysisJobs.clear();
  });

  it('persists, reads and deletes one job', async () => {
    let job = makeJob(GAME, 40);
    job = markInProgress(job, 2);
    await analysisJobsRepository.putJob(job);
    expect((await analysisJobsRepository.getJob(job.id))!.state).toBe('inProgress');

    await analysisJobsRepository.deleteJob(job.id);
    expect(await analysisJobsRepository.getJob(job.id)).toBeUndefined();
  });

  it('lists jobs by game, by many games and by state', async () => {
    const a = markCompleted(makeJob(GAME, 10), 2);
    const b = markFailed(makeJob('lichess:other', 5), 'boom', 3);
    await analysisJobsRepository.putJob(a);
    await analysisJobsRepository.putJob(b);

    expect((await analysisJobsRepository.listByGame(GAME)).map((j) => j.id)).toEqual([a.id]);
    expect(
      (await analysisJobsRepository.listByGames([GAME, 'lichess:other'])).map((j) => j.id).sort(),
    ).toEqual([a.id, b.id].sort());
    expect(await analysisJobsRepository.listByState('failed')).toHaveLength(1);
  });

  it('deletes game-scoped jobs', async () => {
    await analysisJobsRepository.putJob(makeJob(GAME, 2));
    await analysisJobsRepository.deleteForGames([GAME]);
    expect(await analysisJobsRepository.listByGame(GAME)).toHaveLength(0);
  });
});

describe('engine analysis cache repository (ADR-018)', () => {
  beforeEach(async () => {
    await db.positionAnalysisCache.clear();
  });

  it('round-trips results keyed by the ADR-018 tuple', async () => {
    const cache = new DexieEngineAnalysisCache();
    await cache.put('fen|normal|stockfish@18.0.8@stockfish-18-lite-single', {
      jobId: 'j1',
      position: 'start',
      profile: 'normal',
      lines: [
        {
          multipv: 1,
          evaluation: { cp: 21 },
          principalVariation: [{ uci: 'e2e4' }],
          wdl: null,
        },
      ],
      engine: TEST_ENGINE,
      timeMs: 3,
    });
    expect(await cache.count()).toBe(1);
    const stored = await cache.get('fen|normal|stockfish@18.0.8@stockfish-18-lite-single');
    expect(stored?.lines[0]?.evaluation).toEqual({ cp: 21 });
    expect(await cache.get('missing')).toBeUndefined();
  });
});
