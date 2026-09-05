import { describe, expect, it, beforeEach } from 'vitest';
import { db } from '@/infrastructure/db/database';
import { gamesRepository } from '@/infrastructure/db/games-repository';
import { analysesRepository } from '@/infrastructure/db/analysis-repository';
import { analysisJobsRepository } from '@/infrastructure/db/analysis-jobs-repository';
import { DexieEngineAnalysisCache } from '@/infrastructure/db/engine-cache-repository';
import { summariesRepository } from '@/infrastructure/db/summaries-repository';
import { puzzleCandidatesRepository } from '@/infrastructure/db/candidates-repository';
import { fixtureGame } from '@/domain/chess/fixtures';
import { createAnalysisJob, planGameAnalysis } from '@/domain/analysis';
import { DETECTION_VERSION } from '@/domain/tactics';
import type { VerifiedTacticalCandidate } from '@/domain/tactics';
import { TacticalDetectionService } from '@/infrastructure/tactics/tacticalDetectionService';
import { AnalysisService } from './analysisService';
import {
  createFakeEngine,
  FAKE_ENGINE_META,
  type FakeEngineRig,
} from './test-support/fakeAnalysisEngine';
import type { AnalysisProfile, EngineMetadata } from '@/domain/chess';
import type { EngineAnalysisResult } from '@/infrastructure/engine/types';

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
    await db.analysisSummaries.clear();
    await db.puzzleCandidates.clear();
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

  it('a forced re-analysis bypasses the position cache and contacts the engine again', async () => {
    const gameId = await seedFixture('cc-bullet-blunder');

    // First run fills the persistent position cache for the game's positions.
    const firstRig = createFakeEngine();
    const firstService = serviceOf(firstRig);
    const first = await firstService.analyzeGames([gameId]);
    expect(first[0]!.state).toBe('completed');
    expect(firstRig.requests).toHaveLength(4);

    // Re-analyze must genuinely re-run the engine, not replay the cache.
    const reRig = createFakeEngine();
    const reService = serviceOf(reRig);
    const rerun = await reService.analyzeGames([gameId], 'normal', { force: true });
    expect(rerun[0]!.state).toBe('completed');
    expect(reRig.requests).toHaveLength(4);
    expect(await analysesRepository.countForGame(gameId)).toBe(4);
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

describe('AnalysisService — Feature-010 completion hooks', () => {
  const MISSED_MATE_ID = 'li-bullet-missed-mate';
  const MISSED_PLY = 6;

  beforeEach(async () => {
    await db.games.clear();
    await db.analyses.clear();
    await db.analysisJobs.clear();
    await db.analysisSummaries.clear();
    await db.puzzleCandidates.clear();
    await db.positionAnalysisCache.clear();
    sequence = 0;
  });

  /** An engine result that verifies the 4.Qxf7# mate White missed at `fen`. */
  function mateResult(fen: string): EngineAnalysisResult {
    return {
      jobId: 'job-tactical',
      position: fen,
      profile: 'tactical',
      lines: [
        {
          multipv: 1,
          evaluation: { mate: 1 },
          principalVariation: [{ uci: 'h5f7' }],
          wdl: { w: 1000, d: 0, l: 0 },
        },
      ],
      engine: { ...FAKE_ENGINE_META, profile: 'tactical' },
      timeMs: 5,
    };
  }

  function serviceWithDetectionOf(rig: FakeEngineRig): AnalysisService {
    const engineCache = new DexieEngineAnalysisCache();
    const detection = new TacticalDetectionService({
      engine: rig.service,
      engineCache,
      analyses: analysesRepository,
      candidates: puzzleCandidatesRepository,
      summaries: summariesRepository,
      now,
    });
    return new AnalysisService({
      games: gamesRepository,
      analyses: analysesRepository,
      jobs: analysisJobsRepository,
      engine: rig.service,
      engineCache,
      engineMetadata: (profile: AnalysisProfile): EngineMetadata => ({
        ...FAKE_ENGINE_META,
        profile,
      }),
      now,
      summaries: summariesRepository,
      candidates: puzzleCandidatesRepository,
      detection,
    });
  }

  it('writes a queued summary on completion and verifies a genuine missed tactic', async () => {
    const gameId = await seedFixture(MISSED_MATE_ID);
    const plan = planGameAnalysis(fixtureGame(MISSED_MATE_ID));
    if (!plan.ok) throw new Error(plan.message);
    const mateFen = plan.plan.moves[MISSED_PLY]!.positionFen;
    const rig = createFakeEngine({ results: new Map([[mateFen, mateResult(mateFen)]]) });
    const service = serviceWithDetectionOf(rig);

    const jobs = await service.analyzeGames([gameId]);
    const job = jobs[0]!;
    expect(job.state).toBe('completed');

    // The completed run's summary ends `completed` with the verified count.
    const summary = await summariesRepository.getForAnalysis(job.id);
    expect(summary).toBeDefined();
    expect(summary?.gameId).toBe(gameId);
    expect(summary?.userColor).toBe('white');
    expect(summary?.detectionState).toBe('completed');
    expect(summary?.missedTacticCount).toBe(1);
    expect(summary?.detectionVersion).toBe(DETECTION_VERSION);

    // The verified candidate is persisted, scoped to the run's analysis id.
    const rows = await puzzleCandidatesRepository.listForGameAndAnalysis(gameId, job.id);
    expect(rows).toHaveLength(1);
    const verified = rows[0] as VerifiedTacticalCandidate;
    expect(verified.verificationStatus).toBe('verified');
    expect(verified.sourcePly).toBe(MISSED_PLY);
    expect(verified.startingFen).toBe(mateFen);
    expect(verified.tacticalObjective).toBe('forcing_mate');
    expect(await puzzleCandidatesRepository.listVerifiedForGame(gameId)).toEqual([verified]);

    // The owning ply carries the annotation; the other records stay intact.
    const stored = await analysesRepository.listForGameAndAnalysis(gameId, job.id);
    expect(stored).toHaveLength(plan.plan.moves.length);
    const owning = stored.find((record) => record.ply === MISSED_PLY);
    expect(owning?.missedTactic).toBe(true);
    expect(owning?.detectionVersion).toBe(DETECTION_VERSION);
    for (const record of stored) {
      if (record.ply !== MISSED_PLY) {
        expect(record.missedTactic).toBe(false);
        expect(record.detectionVersion).toBeNull();
      }
    }
  });

  it('clears the summary and candidates on a forced re-analysis and re-runs fresh', async () => {
    const gameId = await seedFixture(MISSED_MATE_ID);
    const plan = planGameAnalysis(fixtureGame(MISSED_MATE_ID));
    if (!plan.ok) throw new Error(plan.message);
    const mateFen = plan.plan.moves[MISSED_PLY]!.positionFen;

    // First: a completed analysis with a verified missed tactic.
    const firstRig = createFakeEngine({ results: new Map([[mateFen, mateResult(mateFen)]]) });
    const first = await serviceWithDetectionOf(firstRig).analyzeGames([gameId]);
    expect(first[0]!.state).toBe('completed');
    expect((await summariesRepository.getForAnalysis(first[0]!.id))?.detectionState).toBe(
      'completed',
    );

    // A forced re-analysis that fails leaves no stale Feature-010 rows behind.
    const failingFen = plan.plan.analyzeFens[0]!;
    const failingRig = createFakeEngine({ failures: new Map([[failingFen, 'Engine crashed']]) });
    const forced = await serviceWithDetectionOf(failingRig).analyzeGames([gameId], 'normal', {
      force: true,
    });
    expect(forced[0]!.state).toBe('failed');
    expect(await analysesRepository.countForGame(gameId)).toBe(0);
    expect(await summariesRepository.getForAnalysis(first[0]!.id)).toBeUndefined();
    expect(await puzzleCandidatesRepository.listForGameAndAnalysis(gameId, first[0]!.id)).toEqual(
      [],
    );

    // A successful forced re-analysis re-creates the summary and candidate.
    const rerunRig = createFakeEngine({ results: new Map([[mateFen, mateResult(mateFen)]]) });
    const rerun = await serviceWithDetectionOf(rerunRig).analyzeGames([gameId], 'normal', {
      force: true,
    });
    expect(rerun[0]!.state).toBe('completed');
    expect(await analysesRepository.countForGame(gameId)).toBe(plan.plan.moves.length);
    const summary = await summariesRepository.getForAnalysis(rerun[0]!.id);
    expect(summary?.detectionState).toBe('completed');
    expect(summary?.missedTacticCount).toBe(1);
    const rerunRows = await puzzleCandidatesRepository.listForGameAndAnalysis(gameId, rerun[0]!.id);
    expect(rerunRows.map((row) => row.sourcePly)).toEqual([MISSED_PLY]);
  });

  it('keeps analyzing other games when the detection pass throws', async () => {
    const a = await seedFixture(MISSED_MATE_ID);
    const b = await seedFixture('cc-blitz-clean');
    const plan = planGameAnalysis(fixtureGame(MISSED_MATE_ID));
    if (!plan.ok) throw new Error(plan.message);
    const mateFen = plan.plan.moves[MISSED_PLY]!.positionFen;

    const rig = createFakeEngine({ results: new Map([[mateFen, mateResult(mateFen)]]) });
    const breakingDetection = {
      runPassForCompletedJob: async (): Promise<void> => {
        throw new Error('detection exploded');
      },
    } as unknown as TacticalDetectionService;
    const service = new AnalysisService({
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
      summaries: summariesRepository,
      candidates: puzzleCandidatesRepository,
      detection: breakingDetection,
    });

    const jobs = await service.analyzeGames([a, b]);
    expect(jobs.map((job) => job.state)).toEqual(['completed', 'completed']);
    expect(await analysesRepository.countForGame(a)).toBe(plan.plan.moves.length);
    expect(await analysesRepository.countForGame(b)).toBe(14);
    // The queued summary was still written before the (broken) detection hook.
    expect((await summariesRepository.getForAnalysis(jobs[0]!.id))?.detectionState).toBe('queued');
  });
});
