import { describe, expect, it, beforeEach } from 'vitest';
import { db } from '@/infrastructure/db/database';
import { gamesRepository } from '@/infrastructure/db/games-repository';
import { analysesRepository } from '@/infrastructure/db/analysis-repository';
import { analysisJobsRepository } from '@/infrastructure/db/analysis-jobs-repository';
import { DexieEngineAnalysisCache } from '@/infrastructure/db/engine-cache-repository';
import { fixtureGame } from '@/domain/chess/fixtures';
import { createAnalysisJob, planGameAnalysis } from '@/domain/analysis';
import { AnalysisService } from './analysisService';
import {
  createFakeEngine,
  FAKE_ENGINE_META,
  type FakeEngineRig,
} from './test-support/fakeAnalysisEngine';
import type { AnalysisProfile, EngineMetadata } from '@/domain/chess';

let sequence = 0;

function now(): number {
  sequence += 100;
  return sequence;
}

function serviceOf(rig: FakeEngineRig): AnalysisService {
  return new AnalysisService({
    games: gamesRepository,
    analyses: analysesRepository,
    jobs: analysisJobsRepository,
    engine: rig.service,
    engineCache: new DexieEngineAnalysisCache(),
    engineMetadata: (profile: AnalysisProfile): EngineMetadata => ({
      ...FAKE_ENGINE_META,
      profile,
    }),
    now,
  });
}

async function seedFixture(id: string): Promise<string> {
  const game = fixtureGame(id);
  await gamesRepository.saveGame(game);
  return game.id;
}

describe('AnalysisService batch orchestration', () => {
  beforeEach(async () => {
    await db.games.clear();
    await db.analyses.clear();
    await db.analysisJobs.clear();
    await db.positionAnalysisCache.clear();
    sequence = 0;
  });

  it('analyzes a single game end-to-end and persists MoveAnalysis records', async () => {
    const gameId = await seedFixture('cc-bullet-blunder');
    const rig = createFakeEngine();
    const service = serviceOf(rig);

    const jobsOut = await service.analyzeGames([gameId]);
    const job = jobsOut[0]!;

    expect(job.state).toBe('completed');
    expect(rig.requests).toHaveLength(4);
    expect(await analysesRepository.countForGame(gameId)).toBe(4);
    expect(await service.statusOf(gameId)).toBe('completed');
  });

  it('analyzes multiple games independently in one batch', async () => {
    const a = await seedFixture('cc-bullet-blunder');
    const b = await seedFixture('cc-blitz-clean');
    const rig = createFakeEngine();
    const service = serviceOf(rig);

    const jobs = await service.analyzeGames([a, b]);
    expect(jobs.map((j) => j.state)).toEqual(['completed', 'completed']);
    expect(await analysesRepository.countForGame(a)).toBe(4);
    expect(await analysesRepository.countForGame(b)).toBe(14);
  });

  it('lets one game fail without aborting the rest of the batch', async () => {
    const a = await seedFixture('cc-bullet-blunder');
    const b = await seedFixture('li-blitz-blunder');

    const planB = planGameAnalysis(fixtureGame('li-blitz-blunder'));
    if (!planB.ok) throw new Error(planB.message);
    // A position unique to game B (its final position) so game A is unaffected.
    const failingFen = planB.plan.analyzeFens[planB.plan.analyzeFens.length - 1]!;

    const rig = createFakeEngine({ failures: new Map([[failingFen, 'Engine crashed']]) });
    const service = serviceOf(rig);

    const jobs = await service.analyzeGames([a, b]);
    expect(jobs[0]!.state).toBe('completed');
    expect(jobs[1]!.state).toBe('failed');
    expect(jobs[1]!.lastError).toBe('Engine crashed');
    expect(await analysesRepository.countForGame(a)).toBe(4);
    expect(await analysesRepository.countForGame(b)).toBe(0);
  });

  it('cancels queued jobs when a batch is cancelled before running', async () => {
    const a = await seedFixture('cc-bullet-blunder');
    const b = await seedFixture('cc-blitz-clean');
    const rig = createFakeEngine();
    const service = serviceOf(rig);
    const controller = new AbortController();
    controller.abort();

    const jobs = await service.analyzeGames([a, b], 'normal', { signal: controller.signal });
    expect(jobs.map((j) => j.state)).toEqual(['cancelled', 'cancelled']);
    expect(rig.requests).toHaveLength(0);
    expect(await service.statusOf(a)).toBe('cancelled');
  });

  it('cancels a queued job via cancelGame and leaves completed work untouched', async () => {
    const a = await seedFixture('cc-bullet-blunder');
    const service = serviceOf(createFakeEngine());
    const queuedA = createAnalysisJob(a, FAKE_ENGINE_META, 4, now());
    await analysisJobsRepository.putJob(queuedA);
    // A completed job from an earlier identity must survive a per-row cancel.
    const other = createAnalysisJob(a, { ...FAKE_ENGINE_META, profile: 'deep' }, 4, now());
    await analysisJobsRepository.putJob({ ...other, state: 'completed' });

    await service.cancelGame(a);
    const jobs = await analysisJobsRepository.listByGame(a);
    const byId = new Map(jobs.map((job) => [job.id, job]));
    expect(byId.get(queuedA.id)?.state).toBe('cancelled');
    expect(byId.get(other.id)?.state).toBe('completed');

    // Cancelling again is idempotent.
    await service.cancelGame(a);
    expect((await analysisJobsRepository.getJob(queuedA.id))?.state).toBe('cancelled');
  });

  it('force re-analyzes an already-completed game (fresh engine run)', async () => {
    const game = fixtureGame('cc-bullet-blunder');
    const gameId = await seedFixture('cc-bullet-blunder');
    const plan = planGameAnalysis(game);
    if (!plan.ok) throw new Error(plan.message);
    const failingFen = plan.plan.analyzeFens[0]!;

    const rig = createFakeEngine();
    const service = serviceOf(rig);
    const first = await service.analyzeGames([gameId]);
    expect(first[0]!.state).toBe('completed');
    expect(await analysesRepository.countForGame(gameId)).toBe(4);

    // A plain re-run of a completed game is a no-op...
    await service.analyzeGames([gameId]);
    expect(await analysesRepository.countForGame(gameId)).toBe(4);

    // ...but a forced run actually re-runs the engine (no cache): make it fail
    // on the first position to prove the work was redone.
    const failingRig = createFakeEngine({ failures: new Map([[failingFen, 'Engine crashed']]) });
    const forcedService = new AnalysisService({
      games: gamesRepository,
      analyses: analysesRepository,
      jobs: analysisJobsRepository,
      engine: failingRig.service,
      engineMetadata: (profile: AnalysisProfile): EngineMetadata => ({
        ...FAKE_ENGINE_META,
        profile,
      }),
      now,
    });
    const forced = await forcedService.analyzeGames([gameId], 'normal', { force: true });
    expect(forced[0]!.state).toBe('failed');
    expect(forced[0]!.lastError).toBe('Engine crashed');
    // The old records were cleared before the forced run.
    expect(await analysesRepository.countForGame(gameId)).toBe(0);
  });

  it('does not create duplicate work for repeated or already-completed games', async () => {
    const gameId = await seedFixture('cc-blitz-clean');
    const rig = createFakeEngine();
    const service = serviceOf(rig);

    const first = await service.analyzeGames([gameId, gameId]);
    expect(first).toHaveLength(1);
    expect(rig.requests).toHaveLength(14);

    const secondRig = createFakeEngine();
    const secondService = serviceOf(secondRig);
    const again = await secondService.analyzeGames([gameId]);
    expect(again[0]!.state).toBe('completed');
    expect(secondRig.requests).toHaveLength(0);
  });

  it('retries a failed game under the same job identity', async () => {
    const gameId = await seedFixture('li-blitz-blunder');
    const plan = planGameAnalysis(fixtureGame('li-blitz-blunder'));
    if (!plan.ok) throw new Error(plan.message);

    const failingRig = createFakeEngine({
      failures: new Map([[plan.plan.analyzeFens[0]!, 'transient']]),
    });
    const service = serviceOf(failingRig);
    const failedOut = await service.analyzeGames([gameId]);
    const failed = failedOut[0]!;
    expect(failed.state).toBe('failed');

    const retryRig = createFakeEngine({});
    const retryService = serviceOf(retryRig);
    const retriedOut = await retryService.analyzeGames([gameId]);
    const retried = retriedOut[0]!;
    expect(retried.state).toBe('completed');
    expect(retried.id).toBe(failed.id);
    expect(await analysesRepository.countForGame(gameId)).toBe(11);
  });

  it('serves repeated positions from the ADR-018 cache without engine traffic', async () => {
    const gameId = await seedFixture('cc-blitz-clean');

    // First run populates the persistent position cache.
    const rig = createFakeEngine();
    const service = serviceOf(rig);
    await service.analyzeGames([gameId]);
    expect(rig.requests.length).toBeGreaterThan(0);

    // Drop the job/metadata but keep MoveAnalysis + the position cache: a
    // "restart" re-creates the job while every position is served from cache.
    await analysisJobsRepository.deleteForGames([gameId]);

    const failEverything = createFakeEngine({
      failures: new Map(rig.requests.map((fen) => [fen, 'engine dead after restart'])),
    });
    const restartedService = serviceOf(failEverything);
    const restartedOut = await restartedService.analyzeGames([gameId]);
    const restarted = restartedOut[0]!;
    expect(restarted.state).toBe('completed');
    expect(failEverything.requests).toHaveLength(0);
  });

  it('marks missing games as failed without aborting the rest of the batch', async () => {
    const ok = await seedFixture('cc-bullet-blunder');
    const missing = await seedFixture('cc-blitz-clean');
    await gamesRepository.deleteGames([missing]);

    const rig = createFakeEngine();
    const service = serviceOf(rig);
    const jobs = await service.analyzeGames([ok, missing]);
    expect(jobs[0]!.state).toBe('completed');
    expect(jobs[1]!.state).toBe('failed');
    expect(jobs[1]!.lastError).toContain('no longer exists');
  });
});
