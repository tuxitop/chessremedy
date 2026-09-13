import { describe, expect, it, vi, beforeEach } from 'vitest';
import { db } from '@/infrastructure/db/database';
import { gamesRepository } from '@/infrastructure/db/games-repository';
import { analysesRepository } from '@/infrastructure/db/analysis-repository';
import { analysisJobsRepository } from '@/infrastructure/db/analysis-jobs-repository';
import { DexieEngineAnalysisCache } from '@/infrastructure/db/engine-cache-repository';
import { summariesRepository } from '@/infrastructure/db/summaries-repository';
import { puzzleCandidatesRepository } from '@/infrastructure/db/candidates-repository';
import { puzzlesRepository } from '@/infrastructure/db/puzzles-repository';
import { fixtureGame } from '@/domain/chess/fixtures';
import {
  analysisJobId,
  createAnalysisJob,
  markCompleted,
  planGameAnalysis,
  type AnalysisJob,
} from '@/domain/analysis';
import { TEST_ENGINE } from '@/domain/analysis/test-support';
import { DETECTION_VERSION } from '@/domain/tactics';
import type { VerifiedTacticalCandidate } from '@/domain/tactics';
import { PUZZLE_GENERATOR_VERSION } from '@/domain/puzzle';
import { puzzleRowFixture } from '@/domain/puzzle/test-support';
import type { Color } from 'chessops/types';
import type { MoveAnalysis } from '@/domain/chess';
import { TacticalDetectionService } from '@/infrastructure/tactics/tacticalDetectionService';
import { PuzzleGenerationService } from '@/infrastructure/puzzles';
import { AnalysisService } from './analysisService';
import {
  createFakeEngine,
  FAKE_ENGINE_META,
  type FakeEngineRig,
} from './test-support/fakeAnalysisEngine';
import type { AnalysisProfile, EngineMetadata } from '@/domain/chess';
import type { EngineAnalysisResult } from '@/infrastructure/engine/types';
import type { AnalysisSummaryRow } from '@/infrastructure/db/summaries-repository';

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

/** Let pending microtasks / timer work run once. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Yield ticks until `predicate` holds (capped); lets async prep make progress. */
async function waitFor(predicate: () => boolean | Promise<boolean>): Promise<void> {
  for (let i = 0; i < 200 && !(await predicate()); i += 1) {
    await tick();
  }
  expect(await predicate()).toBe(true);
}

/**
 * Drive a held fake engine to completion: repeatedly release every held job and
 * yield until `promise` (an `analyzeGames` call) settles.
 */
async function drainHeld<T>(rig: FakeEngineRig, promise: Promise<T>): Promise<T> {
  let settled = false;
  promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  for (let i = 0; i < 300 && !(settled && rig.held.length === 0); i += 1) {
    rig.releaseAll();
    await tick();
  }
  return promise;
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

  it('queues a second batch instead of cancelling the running one, then completes both in order', async () => {
    const a = await seedFixture('cc-bullet-blunder');
    const b = await seedFixture('cc-blitz-clean');
    const planA = planGameAnalysis(fixtureGame('cc-bullet-blunder'));
    const planB = planGameAnalysis(fixtureGame('cc-blitz-clean'));
    if (!planA.ok || !planB.ok) throw new Error('plans must be ok');
    // FENs that only game B produces (game A never submits them).
    const bExclusive = planB.plan.analyzeFens.filter(
      (fen) => !planA.plan.analyzeFens.includes(fen),
    );
    expect(bExclusive.length).toBeGreaterThan(0);
    const rig = createFakeEngine({ hold: true });
    const service = serviceOf(rig);

    const first = service.analyzeGames([a]);
    await waitFor(() => rig.requests.length > 0);
    // The first batch starts immediately and is a prefix of A's planned fens.
    expect(rig.requests).toEqual(planA.plan.analyzeFens.slice(0, rig.requests.length));

    const second = service.analyzeGames([b]);
    await tick();
    // The second batch is queued behind the first: it has not started (no B-only
    // FEN submitted) and has not cancelled the running batch.
    expect(rig.requests.some((fen) => bExclusive.includes(fen))).toBe(false);

    const jobsA = await drainHeld(rig, first);
    expect(jobsA.map((job) => job.state)).toEqual(['completed']);
    // Every one of A's planned positions was searched before B ran.
    expect(rig.requests.slice(0, planA.plan.analyzeFens.length)).toEqual(planA.plan.analyzeFens);

    const jobsB = await drainHeld(rig, second);
    expect(jobsB.map((job) => job.state)).toEqual(['completed']);
    expect(await service.statusOf(a)).toBe('completed');
    expect(await service.statusOf(b)).toBe('completed');
  });

  it('an explicit cancel stops the running batch but lets a separately-queued request proceed', async () => {
    const a = await seedFixture('cc-bullet-blunder');
    const b = await seedFixture('cc-blitz-clean');
    const rig = createFakeEngine({ hold: true });
    const service = serviceOf(rig);

    const controller = new AbortController();
    const first = service.analyzeGames([a], 'normal', { signal: controller.signal });
    await waitFor(() => rig.requests.length > 0);
    const second = service.analyzeGames([b]);
    await tick();

    // Cancel the running batch (explicit cancel); its jobs are persisted cancelled.
    controller.abort();
    const jobsA = await drainHeld(rig, first);
    expect(jobsA.map((job) => job.state)).toEqual(['cancelled']);
    expect(await service.statusOf(a)).toBe('cancelled');

    // The queued request (its own live signal) then runs to completion.
    const jobsB = await drainHeld(rig, second);
    expect(jobsB.map((job) => job.state)).toEqual(['completed']);
    expect(await service.statusOf(b)).toBe('completed');
  });

  it('a queued batch whose signal is aborted before it starts runs nothing and persists cancelled jobs', async () => {
    const a = await seedFixture('cc-bullet-blunder');
    const b = await seedFixture('cc-blitz-clean');
    const planA = planGameAnalysis(fixtureGame('cc-bullet-blunder'));
    const planB = planGameAnalysis(fixtureGame('cc-blitz-clean'));
    if (!planA.ok || !planB.ok) throw new Error('plans must be ok');
    // FENs that only game B produces (the shared starting position is not a
    // signal that B started).
    const bExclusive = planB.plan.analyzeFens.filter(
      (fen) => !planA.plan.analyzeFens.includes(fen),
    );
    const rig = createFakeEngine({ hold: true });
    const service = serviceOf(rig);

    const first = service.analyzeGames([a]);
    await waitFor(() => rig.requests.length > 0);
    const controller = new AbortController();
    const second = service.analyzeGames([b], 'normal', { signal: controller.signal });
    controller.abort();
    await tick();

    const jobsA = await drainHeld(rig, first);
    expect(jobsA.map((job) => job.state)).toEqual(['completed']);
    // B never touched the engine and ended cancelled.
    const jobsB = await drainHeld(rig, second);
    expect(jobsB.map((job) => job.state)).toEqual(['cancelled']);
    expect(rig.requests.some((fen) => bExclusive.includes(fen))).toBe(false);
    expect(await service.statusOf(b)).toBe('cancelled');
  });

  it('a fully analysed game is never persisted completed when a position was missed', async () => {
    const gameId = await seedFixture('cc-bullet-blunder');
    const plan = planGameAnalysis(fixtureGame('cc-bullet-blunder'));
    if (!plan.ok) throw new Error(plan.message);
    // Fail every engine request for the final planned position so the batch
    // would otherwise have to choose between partial-complete and failed.
    const lastFen = plan.plan.analyzeFens[plan.plan.analyzeFens.length - 1]!;
    const rig = createFakeEngine({ failures: new Map([[lastFen, 'Engine crashed']]) });
    const service = serviceOf(rig);

    const jobs = await service.analyzeGames([gameId]);
    expect(jobs[0]!.state).toBe('failed');
    expect(jobs[0]!.lastError).toMatch(/Engine crashed/);
    expect(await service.statusOf(gameId)).toBe('failed');
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

  it('threads Game-analysis depth/time overrides into engine options, cache key and job identity', async () => {
    const gameId = await seedFixture('cc-bullet-blunder');
    const rig = createFakeEngine();
    const service = serviceOf(rig);

    const jobs = await service.analyzeGames([gameId], 'normal', {
      config: { maxDepth: 25, movetimeMs: 3000 },
    });
    const job = jobs[0]!;
    expect(job.state).toBe('completed');
    expect(job.config).toEqual({ maxDepth: 25, movetimeMs: 3000 });
    // The override run is a distinct analysis identity from a plain normal run.
    const plainId = analysisJobId(gameId, FAKE_ENGINE_META);
    expect(job.id).not.toBe(plainId);
    // Every engine request carried the override options.
    for (const handle of rig.activeJobs) {
      expect(handle.options.maxDepth).toBe(25);
      expect(handle.options.movetimeMs).toBe(3000);
    }
  });

  it('keeps the plain identity and cache scope when no overrides apply', async () => {
    const gameId = await seedFixture('cc-bullet-blunder');
    const rig = createFakeEngine();
    const service = serviceOf(rig);

    const jobs = await service.analyzeGames([gameId], 'normal', {});
    const job = jobs[0]!;
    expect(job.id).toBe(analysisJobId(gameId, FAKE_ENGINE_META));
    expect(job.config).toBeUndefined();
    for (const handle of rig.activeJobs) {
      expect(handle.options.maxDepth).toBeUndefined();
      expect(handle.options.movetimeMs).toBeUndefined();
    }
  });

  it('reports a completed run as outdated when the settings profile/overrides changed', async () => {
    const gameId = await seedFixture('cc-bullet-blunder');
    const rig = createFakeEngine();
    const service = serviceOf(rig);

    // Run under a depth override; then the user removes it → run reads outdated.
    await service.analyzeGames([gameId], 'normal', { config: { maxDepth: 30 } });
    expect(await service.statusesOf([gameId])).toEqual({ [gameId]: 'completed' });
    expect(
      await service.statusesOf([gameId], { profile: 'normal', config: { maxDepth: 30 } }),
    ).toEqual({ [gameId]: 'completed' });
    expect(await service.statusesOf([gameId], { profile: 'normal' })).toEqual({
      [gameId]: 'outdated',
    });

    // A profile change (deep) also reads outdated against a normal-settings run.
    expect(await service.statusesOf([gameId], { profile: 'deep' })).toEqual({
      [gameId]: 'outdated',
    });
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

    // Detection is detached from the analysis queue (Feature 008 §10): the run
    // resolves `completed` before the background pass settles, so wait for it.
    await waitFor(async () => {
      const summary = await summariesRepository.getForAnalysis(job.id);
      return summary?.detectionState === 'completed';
    });
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

  it('registers a game as actively detecting only while its pass runs (P7)', async () => {
    const gameId = await seedFixture('cc-bullet-blunder');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = vi.fn();
    const detection = {
      async runPassForCompletedJob(): Promise<void> {
        started();
        await gate;
      },
    } as unknown as TacticalDetectionService;
    const service = new AnalysisService({
      games: gamesRepository,
      analyses: analysesRepository,
      jobs: analysisJobsRepository,
      engine: createFakeEngine().service,
      engineCache: new DexieEngineAnalysisCache(),
      engineMetadata: (profile: AnalysisProfile): EngineMetadata => ({
        ...FAKE_ENGINE_META,
        profile,
      }),
      summaries: summariesRepository,
      candidates: puzzleCandidatesRepository,
      detection,
      now,
    });

    // The analysis run resolves `completed` while the detached pass is still
    // blocked on our gate → the game must read as "actively detecting".
    const run = service.analyzeGames([gameId]);
    await waitFor(() => started.mock.calls.length > 0);
    expect(await service.activeDetectionGames()).toEqual([gameId]);

    // Once the pass finishes the registry is cleared, so the UI never keeps
    // showing "scan in progress" for a pass that is no longer running.
    release();
    await run;
    await waitFor(async () => (await service.activeDetectionGames()).length === 0);
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
    await waitFor(async () => {
      const summary = await summariesRepository.getForAnalysis(first[0]!.id);
      return summary?.detectionState === 'completed';
    });

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
    await waitFor(async () => {
      const summary = await summariesRepository.getForAnalysis(rerun[0]!.id);
      return summary?.detectionState === 'completed';
    });
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
    // A crashed pass is surfaced as `failed` (never silently stuck in progress)
    // once the detached detection hook settles.
    await waitFor(async () => {
      const summary = await summariesRepository.getForAnalysis(jobs[0]!.id);
      return summary?.detectionState === 'failed';
    });
    const summary = await summariesRepository.getForAnalysis(jobs[0]!.id);
    expect(summary?.detectionState).toBe('failed');
    expect(summary?.missedTacticCount).toBeNull();
  });

  it('starts the next game as soon as the previous analysis completes (detection never holds the queue)', async () => {
    const a = await seedFixture('cc-bullet-blunder');
    const b = await seedFixture('cc-blitz-clean');
    let detectionStarted = false;
    let releaseDetection!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseDetection = resolve;
    });
    const detection = {
      runPassForCompletedJob: async (): Promise<void> => {
        detectionStarted = true;
        await gate;
      },
    } as unknown as TacticalDetectionService;
    const rig = createFakeEngine();
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
      detection,
    });

    // A's detection pass is gated (never settles) yet the batch must still
    // advance to B and resolve both jobs `completed` — detection is derived
    // data that runs detached from the analysis queue.
    const jobs = await service.analyzeGames([a, b]);
    expect(detectionStarted).toBe(true);
    expect(jobs.map((job) => job.state)).toEqual(['completed', 'completed']);
    expect(await analysesRepository.countForGame(a)).toBe(4);
    expect(await analysesRepository.countForGame(b)).toBe(14);
    releaseDetection();
  });
});

describe('AnalysisService — resumable scans & orphan reconciliation (plan 012, WP-A)', () => {
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

  function serviceWithDetectionOf(
    rig: FakeEngineRig,
    detectionOverride?: TacticalDetectionService,
  ): AnalysisService {
    const engineCache = new DexieEngineAnalysisCache();
    const detection =
      detectionOverride ??
      new TacticalDetectionService({
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

  const noopDetection = {
    runPassForCompletedJob: async (): Promise<void> => undefined,
  } as unknown as TacticalDetectionService;

  it('scanGame resumes an interrupted tactics scan without re-analyzing positions', async () => {
    const gameId = await seedFixture(MISSED_MATE_ID);
    const plan = planGameAnalysis(fixtureGame(MISSED_MATE_ID));
    if (!plan.ok) throw new Error(plan.message);
    const mateFen = plan.plan.moves[MISSED_PLY]!.positionFen;

    // First analysis completes but its detection pass never ran (an earlier
    // session scheduled the pass and vanished) → summary stuck `queued`.
    const firstRig = createFakeEngine({ results: new Map([[mateFen, mateResult(mateFen)]]) });
    const first = await serviceWithDetectionOf(firstRig, noopDetection).analyzeGames([gameId]);
    const job = first[0]!;
    expect(job.state).toBe('completed');
    expect((await summariesRepository.getForAnalysis(job.id))?.detectionState).toBe('queued');
    expect(await puzzleCandidatesRepository.listForGameAndAnalysis(gameId, job.id)).toEqual([]);
    expect(await serviceWithDetectionOf(createFakeEngine()).activeDetectionGames()).toEqual([]);

    // The scan-only entry resumes just the detection pass for the latest
    // completed analysis — no new analysis job, no position re-searches.
    const scanRig = createFakeEngine({ results: new Map([[mateFen, mateResult(mateFen)]]) });
    const service = serviceWithDetectionOf(scanRig);
    expect(await service.scanGame(gameId)).toBe('started');

    await waitFor(async () => {
      const summary = await summariesRepository.getForAnalysis(job.id);
      return summary?.detectionState === 'completed';
    });
    const summary = await summariesRepository.getForAnalysis(job.id);
    expect(summary?.detectionState).toBe('completed');
    expect(summary?.missedTacticCount).toBe(1);
    expect(summary?.detectionVersion).toBe(DETECTION_VERSION);
    const rows = await puzzleCandidatesRepository.listForGameAndAnalysis(gameId, job.id);
    expect(rows).toHaveLength(1);
    expect((rows[0] as VerifiedTacticalCandidate).sourcePly).toBe(MISSED_PLY);
    // Only the tactical verification search ran — the game was not re-analyzed.
    expect(scanRig.requests).toEqual([mateFen]);
    expect(await analysisJobsRepository.listByGame(gameId)).toHaveLength(1);
    expect(await analysesRepository.countForGame(gameId)).toBe(plan.plan.moves.length);
  });

  it('scanGame is a no-op once the detection pass already completed', async () => {
    const gameId = await seedFixture(MISSED_MATE_ID);
    const plan = planGameAnalysis(fixtureGame(MISSED_MATE_ID));
    if (!plan.ok) throw new Error(plan.message);
    const mateFen = plan.plan.moves[MISSED_PLY]!.positionFen;

    const rig = createFakeEngine({ results: new Map([[mateFen, mateResult(mateFen)]]) });
    const service = serviceWithDetectionOf(rig);
    const jobs = await service.analyzeGames([gameId]);
    await waitFor(async () => {
      const summary = await summariesRepository.getForAnalysis(jobs[0]!.id);
      return summary?.detectionState === 'completed';
    });
    const requestsBefore = rig.requests.length;

    expect(await service.scanGame(gameId)).toBe('already-completed');
    expect(rig.requests.length).toBe(requestsBefore);
    expect(await service.activeDetectionGames()).toEqual([]);
  });

  it('scanGame force bypasses the completed/current no-op (explicit re-scan path)', async () => {
    const gameId = await seedFixture(MISSED_MATE_ID);
    const plan = planGameAnalysis(fixtureGame(MISSED_MATE_ID));
    if (!plan.ok) throw new Error(plan.message);
    const mateFen = plan.plan.moves[MISSED_PLY]!.positionFen;

    const rig = createFakeEngine({ results: new Map([[mateFen, mateResult(mateFen)]]) });
    const completed = serviceWithDetectionOf(rig);
    const jobs = await completed.analyzeGames([gameId]);
    await waitFor(async () => {
      const summary = await summariesRepository.getForAnalysis(jobs[0]!.id);
      return summary?.detectionState === 'completed';
    });

    // With a spy detection, a forced scan must invoke the pass (rather than the
    // `already-completed` no-op) and thread `{ force: true }` through.
    const scanOptions: Array<{ force?: boolean } | undefined> = [];
    const spyDetection = {
      runPassForCompletedJob: async (
        _job: unknown,
        _game: unknown,
        _records: unknown,
        _signal: unknown,
        options?: { force?: boolean },
      ): Promise<void> => {
        scanOptions.push(options);
      },
    } as unknown as TacticalDetectionService;
    const service = serviceWithDetectionOf(rig, spyDetection);

    expect(await service.scanGame(gameId, { force: true })).toBe('started');
    await waitFor(() => scanOptions.length === 1);
    expect(scanOptions[0]).toEqual({ force: true });
  });

  it('scanGame re-runs the detection pass when the completed result is from an older version (plan 015)', async () => {
    const gameId = await seedFixture(MISSED_MATE_ID);
    const plan = planGameAnalysis(fixtureGame(MISSED_MATE_ID));
    if (!plan.ok) throw new Error(plan.message);
    const mateFen = plan.plan.moves[MISSED_PLY]!.positionFen;

    const rig = createFakeEngine({ results: new Map([[mateFen, mateResult(mateFen)]]) });
    const service = serviceWithDetectionOf(rig);
    const jobs = await service.analyzeGames([gameId]);
    await waitFor(async () => {
      const summary = await summariesRepository.getForAnalysis(jobs[0]!.id);
      return summary?.detectionState === 'completed';
    });
    const summary = (await summariesRepository.getForAnalysis(jobs[0]!.id))!;
    expect(summary.detectionVersion).toBe(DETECTION_VERSION);

    // The plan-015 symptom: a completed detection persisted by an older build
    // carries an older detectionVersion. scanGame must not call it done — it
    // re-runs the pass so stale rows/annotations are wiped and re-derived.
    await summariesRepository.putForAnalysis({ ...summary, detectionVersion: 1 });
    expect(await service.scanGame(gameId)).toBe('started');

    await waitFor(async () => {
      const refreshed = await summariesRepository.getForAnalysis(jobs[0]!.id);
      return (
        refreshed?.detectionState === 'completed' &&
        refreshed.detectionVersion === DETECTION_VERSION
      );
    });
    const rows = await puzzleCandidatesRepository.listForGameAndAnalysis(gameId, jobs[0]!.id);
    expect(rows.some((row) => row.verificationStatus === 'verified')).toBe(true);
    expect(await service.activeDetectionGames()).toEqual([]);
  });

  it('runs one tactics scan at a time and queues the next', async () => {
    const a = await seedFixture('cc-bullet-blunder');
    const b = await seedFixture('cc-blitz-clean');
    const setupRig = createFakeEngine();
    const setup = serviceWithDetectionOf(setupRig);
    const jobs = await setup.analyzeGames([a, b]);
    await waitFor(async () => {
      const summaries = await Promise.all(
        jobs.map((job) => summariesRepository.getForAnalysis(job.id)),
      );
      return summaries.every((summary) => summary?.detectionState === 'completed');
    });
    // Make both completed passes stale so `scanGame` re-runs them.
    for (const job of jobs) {
      const summary = (await summariesRepository.getForAnalysis(job.id))!;
      await summariesRepository.putForAnalysis({ ...summary, detectionVersion: 1 });
    }

    const jobA = jobs.find((job) => job.gameId === a)!;
    const jobB = jobs.find((job) => job.gameId === b)!;
    const starts: string[] = [];
    const releases: Array<() => void> = [];
    const spyDetection = {
      runPassForCompletedJob: async (job: AnalysisJob): Promise<void> => {
        starts.push(job.id);
        await new Promise<void>((resolve) => releases.push(resolve));
      },
    } as unknown as TacticalDetectionService;
    const service = serviceWithDetectionOf(setupRig, spyDetection);

    expect(await service.scanGame(a)).toBe('started');
    expect(await service.scanGame(b)).toBe('started');

    // Only the first scan runs; the second waits in the queue.
    await waitFor(() => starts.length === 1);
    expect(starts).toEqual([jobA.id]);

    releases[0]!();
    await waitFor(() => starts.length === 2);
    expect(starts).toEqual([jobA.id, jobB.id]);
    releases[1]!();
    await waitFor(async () => (await service.activeDetectionGames()).length === 0);
  });

  it('scanGame refuses when there is no completed analysis or a live analysis', async () => {
    const clean = await seedFixture('cc-blitz-clean');
    const service = serviceWithDetectionOf(createFakeEngine());
    expect(await service.scanGame(clean)).toBe('no-completed-analysis');

    // A queued/in-progress analysis job supersedes a scan of an older run.
    const busy = await seedFixture('cc-bullet-blunder');
    const job = createAnalysisJob(busy, { ...FAKE_ENGINE_META, profile: 'normal' }, 4, now());
    await analysisJobsRepository.putJob(job);
    expect(await service.scanGame(busy)).toBe('analysis-in-progress');
  });

  it('reconcileOrphans pauses owner-less detection without auto-resuming analysis jobs', async () => {
    // An owner-less in-progress analysis job (earlier session vanished). It
    // must NOT be silently re-run: reconcile is engine-free and leaves it
    // paused for an explicit Analyze/Retry (which resumes it in place).
    const a = await seedFixture('cc-bullet-blunder');
    const orphan = {
      ...createAnalysisJob(a, { ...FAKE_ENGINE_META, profile: 'normal' }, 4, now()),
      state: 'inProgress' as const,
      completedPositions: 2,
      startedAt: now(),
    };
    await analysisJobsRepository.putJob(orphan);

    // An owner-less in-progress detection summary for a second completed game.
    const b = await seedFixture('cc-blitz-clean');
    const analysisRig = createFakeEngine();
    await serviceWithDetectionOf(analysisRig, noopDetection).analyzeGames([b]);
    const bJobs = await analysisJobsRepository.listByGame(b);
    const bLatest = [...bJobs].sort((x, y) => y.updatedAt - x.updatedAt)[0]!;
    const stuck = (await summariesRepository.getForAnalysis(bLatest.id))!;
    await summariesRepository.putForAnalysis({ ...stuck, detectionState: 'inProgress' });

    const service = serviceWithDetectionOf(createFakeEngine(), noopDetection);
    const result = await service.reconcileOrphans();
    expect(result.resumedAnalysisJobs).toBe(0);
    expect(result.pausedDetections).toBe(1);

    // No engine work happened: the orphan analysis job is untouched (paused).
    const [stored] = await analysisJobsRepository.listByGame(a);
    expect(stored?.state).toBe('inProgress');
    expect((await summariesRepository.getForAnalysis(bLatest.id))?.detectionState).toBe('queued');
    // A second reconcile is a no-op (guarded once per service instance).
    expect(await service.reconcileOrphans()).toEqual(result);
  });

  it('reconcile relabels an owner-less inProgress puzzle generation to queued', async () => {
    const gameId = await seedFixture(MISSED_MATE_ID);
    const plan = planGameAnalysis(fixtureGame(MISSED_MATE_ID));
    if (!plan.ok) throw new Error(plan.message);
    const mateFen = plan.plan.moves[MISSED_PLY]!.positionFen;

    // A completed analysis whose detection pass settled (no generation wired —
    // an earlier session with a generation service vanished mid-pass).
    const rig = createFakeEngine({ results: new Map([[mateFen, mateResult(mateFen)]]) });
    await serviceWithDetectionOf(rig).analyzeGames([gameId]);
    const jobs = await analysisJobsRepository.listByGame(gameId);
    const latest = [...jobs].sort((x, y) => y.updatedAt - x.updatedAt)[0]!;
    await waitFor(async () => {
      const summary = await summariesRepository.getForAnalysis(latest.id);
      return summary?.detectionState === 'completed';
    });
    const completed = (await summariesRepository.getForAnalysis(latest.id))!;
    await summariesRepository.putForAnalysis({
      ...completed,
      puzzleState: 'inProgress',
      puzzleProgress: { done: 1, total: 2 },
    });

    const service = serviceWithDetectionOf(createFakeEngine(), noopDetection);
    const result = await service.reconcileOrphans();
    expect(result.resumedAnalysisJobs).toBe(0);
    expect(result.pausedDetections).toBe(0);
    expect(result.pausedGenerations).toBe(1);

    const summary = (await summariesRepository.getForAnalysis(latest.id))!;
    expect(summary.puzzleState).toBe('queued');
    expect(summary.puzzleProgress).toEqual({ done: 1, total: 2 });
    // Detection fields are untouched by the generation-state relabel.
    expect(summary.detectionState).toBe('completed');
    expect(summary.detectionVersion).toBe(DETECTION_VERSION);
    expect(summary.missedTacticCount).toBe(1);
  });

  it('clearPausedAnalysisJobs removes stuck runs without touching games or completed analyses', async () => {
    // A healthy completed run that must survive.
    const done = await seedFixture(MISSED_MATE_ID);
    const completedRig = createFakeEngine();
    const completed = await serviceWithDetectionOf(completedRig, noopDetection).analyzeGames([
      done,
    ]);
    const completedId = completed[0]!.id;

    // A stuck paused run from an earlier session.
    const stuckGame = await seedFixture('cc-bullet-blunder');
    const orphan = {
      ...createAnalysisJob(stuckGame, { ...FAKE_ENGINE_META, profile: 'normal' }, 4, now()),
      state: 'inProgress' as const,
      completedPositions: 2,
      startedAt: now(),
    };
    await analysisJobsRepository.putJob(orphan);
    await summariesRepository.putForAnalysis({
      analysisId: orphan.id,
      gameId: stuckGame,
      userColor: 'white',
      classificationCounts: { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 },
      userMoves: 0,
      totalMoves: 0,
      accuracy: null,
      accuracyMoves: 0,
      detectionState: 'queued',
      missedTacticCount: null,
      detectionVersion: null,
      updatedAt: now(),
    });

    const service = serviceWithDetectionOf(createFakeEngine(), noopDetection);
    const cleared = await service.clearPausedAnalysisJobs();

    expect(cleared).toBe(1);
    expect(await analysisJobsRepository.listByGame(stuckGame)).toEqual([]);
    expect(await analysesRepository.countForGame(done)).toBeGreaterThan(0);
    const [kept] = await analysisJobsRepository.listByGame(done);
    expect(kept?.state).toBe('completed');
    expect(kept?.id).toBe(completedId);
    expect(await summariesRepository.getForAnalysis(completedId)).toBeDefined();
  });

  it('a forced re-analysis cancels the live scan of the superseded run (no ghost pass)', async () => {
    const gameId = await seedFixture(MISSED_MATE_ID);
    let invocations = 0;
    const aborted = vi.fn();
    const gatedDetection = {
      runPassForCompletedJob: (
        _job: AnalysisJob,
        _game: { id: string; userColor: Color },
        _records: MoveAnalysis[],
        signal?: AbortSignal,
      ): Promise<void> =>
        new Promise((resolve) => {
          invocations += 1;
          if (!signal) {
            resolve();
            return;
          }
          const onAbort = (): void => {
            signal?.removeEventListener('abort', onAbort);
            aborted();
            resolve();
          };
          if (signal.aborted) {
            aborted();
            resolve();
          } else {
            signal.addEventListener('abort', onAbort);
          }
        }),
    } as unknown as TacticalDetectionService;

    const service = serviceWithDetectionOf(createFakeEngine(), gatedDetection);
    const jobs = await service.analyzeGames([gameId]);
    const job = jobs[0]!;
    await waitFor(() => invocations === 1);
    expect(await service.activeDetectionGames()).toEqual([gameId]);

    const before = (await analysisJobsRepository.listByGame(gameId)).length;
    const forced = await service.analyzeGames([gameId], 'normal', { force: true });
    expect(forced[0]!.state).toBe('completed');
    // The live scan was aborted (its engine work cancelled) ahead of the cleanup.
    expect(aborted).toHaveBeenCalledTimes(1);
    // The superseded run's Feature-010 rows are gone: the forced run restarts
    // the same analysis identity, so only its fresh queued summary exists —
    // never a stale completed state or verified rows, and no duplicate job.
    const refreshed = await summariesRepository.getForAnalysis(job.id);
    expect(refreshed?.detectionState).toBe('queued');
    expect(refreshed?.missedTacticCount).toBeNull();
    expect(refreshed?.detectionVersion).toBeNull();
    expect(await puzzleCandidatesRepository.listForGameAndAnalysis(gameId, job.id)).toEqual([]);
    expect(await analysisJobsRepository.listByGame(gameId)).toHaveLength(before);
  });
});

describe('AnalysisService — Feature-011 puzzle-generation hook (Stage C)', () => {
  const MISSED_MATE_ID = 'li-bullet-missed-mate';
  const MISSED_PLY = 6;

  beforeEach(async () => {
    await db.games.clear();
    await db.analyses.clear();
    await db.analysisJobs.clear();
    await db.analysisSummaries.clear();
    await db.puzzleCandidates.clear();
    await db.puzzles.clear();
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

  /** Real detection + real engine-free generation over the shared repos. */
  function serviceWithDetectionAndGenerationOf(rig: FakeEngineRig): AnalysisService {
    const engineCache = new DexieEngineAnalysisCache();
    const detection = new TacticalDetectionService({
      engine: rig.service,
      engineCache,
      analyses: analysesRepository,
      candidates: puzzleCandidatesRepository,
      summaries: summariesRepository,
      now,
    });
    const generation = new PuzzleGenerationService({
      puzzles: puzzlesRepository,
      candidates: puzzleCandidatesRepository,
      analyses: analysesRepository,
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
      generation,
    });
  }

  it('auto-triggers generation once a detection pass settles completed and persists puzzles', async () => {
    const gameId = await seedFixture(MISSED_MATE_ID);
    const plan = planGameAnalysis(fixtureGame(MISSED_MATE_ID));
    if (!plan.ok) throw new Error(plan.message);
    const mateFen = plan.plan.moves[MISSED_PLY]!.positionFen;
    const rig = createFakeEngine({ results: new Map([[mateFen, mateResult(mateFen)]]) });
    const service = serviceWithDetectionAndGenerationOf(rig);

    const jobs = await service.analyzeGames([gameId]);
    const job = jobs[0]!;
    expect(job.state).toBe('completed');

    // Detection is detached; generation is detached behind it — wait for the
    // generation pass to settle `completed` (its freshness gate requires the
    // detection verdict it auto-triggered from).
    await waitFor(async () => {
      const summary = await summariesRepository.getForAnalysis(job.id);
      return summary?.puzzleState === 'completed';
    });
    const summary = (await summariesRepository.getForAnalysis(job.id))!;
    expect(summary.puzzleState).toBe('completed');
    // The missed-mate ply (4.d3) is BOTH the verified candidate and a user
    // blunder in the run's MoveAnalysis. Under the missed-tactic exclusivity
    // rule the blunder-origin input excludes candidate-owned plies, so the pass
    // settles a single item and still produces one row.
    expect(summary.puzzleProgress).toEqual({ done: 1, total: 1 });
    expect(summary.puzzleGeneratorVersion).toBe(PUZZLE_GENERATOR_VERSION);
    // Detection fields were never clobbered by the generation writes.
    expect(summary.detectionState).toBe('completed');
    expect(summary.missedTacticCount).toBe(1);
    expect(summary.detectionVersion).toBe(DETECTION_VERSION);

    // The verified candidate became one durable, immutable puzzle row.
    expect(await puzzlesRepository.countForGame(gameId)).toBe(1);
    const row = await puzzlesRepository.getPuzzle(gameId, MISSED_PLY);
    expect(row?.analysisId).toBe(job.id);
    expect(row?.startingFen).toBe(mateFen);
    expect(row?.bestMove).toBe('h5f7');
    expect(row?.sideToMove).toBe('white');
    expect(row?.puzzleGeneratorVersion).toBe(PUZZLE_GENERATOR_VERSION);
    expect(row?.detectionVersion).toBe(DETECTION_VERSION);
    // The settled pass left no live entry behind.
    expect(await service.activeGenerationGames()).toEqual(new Set());
  });

  it('a forced re-analysis cancels a live generation pass and existing puzzles survive', async () => {
    const gameId = await seedFixture(MISSED_MATE_ID);
    // An immutable puzzle already generated for the game (must survive the
    // forced re-analysis — the add-only repository never deletes rows).
    await puzzlesRepository.addIfAbsent([
      { ...puzzleRowFixture('mate-one'), sourceGameId: gameId, sourcePly: MISSED_PLY },
    ]);

    let invocations = 0;
    const aborted = vi.fn();
    const gatedGeneration = {
      runPassForAnalysis: (
        _analysisId: string,
        _game: { id: string; userColor: Color },
        signal?: AbortSignal,
      ): Promise<void> =>
        new Promise((resolve) => {
          invocations += 1;
          if (!signal) {
            resolve();
            return;
          }
          const onAbort = (): void => {
            signal?.removeEventListener('abort', onAbort);
            aborted();
            resolve();
          };
          if (signal.aborted) {
            aborted();
            resolve();
          } else {
            signal.addEventListener('abort', onAbort);
          }
        }),
    } as unknown as PuzzleGenerationService;

    const plan = planGameAnalysis(fixtureGame(MISSED_MATE_ID));
    if (!plan.ok) throw new Error(plan.message);
    const mateFen = plan.plan.moves[MISSED_PLY]!.positionFen;
    const rig = createFakeEngine({ results: new Map([[mateFen, mateResult(mateFen)]]) });
    const engineCache = new DexieEngineAnalysisCache();
    const detection = new TacticalDetectionService({
      engine: rig.service,
      engineCache,
      analyses: analysesRepository,
      candidates: puzzleCandidatesRepository,
      summaries: summariesRepository,
      now,
    });
    const service = new AnalysisService({
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
      generation: gatedGeneration,
    });

    // First analysis: detection completes → the gated generation pass starts
    // (live) and stays pending until the forced re-analysis cancels it.
    await service.analyzeGames([gameId]);
    await waitFor(() => invocations === 1);
    expect(await service.activeGenerationGames()).toEqual(new Set([gameId]));

    const forced = await service.analyzeGames([gameId], 'normal', { force: true });
    expect(forced[0]!.state).toBe('completed');
    // The live generation pass was aborted + settled ahead of the cleanup.
    expect(aborted).toHaveBeenCalledTimes(1);
    expect(await service.activeGenerationGames()).toEqual(new Set());
    // Existing puzzle rows survive the forced re-analysis (supersede never
    // deletes them); the new run starts its own pass from absent instead.
    expect(await puzzlesRepository.countForGame(gameId)).toBe(1);
  });

  describe('generatePuzzles on-demand outcomes', () => {
    /** A completed analysis job + its summary for a seeded game. */
    async function seedSummary(
      gameId: string,
      overrides: Partial<AnalysisSummaryRow> = {},
    ): Promise<AnalysisJob> {
      const job = markCompleted(createAnalysisJob(gameId, TEST_ENGINE, 2, now()), now());
      await analysisJobsRepository.putJob(job);
      await summariesRepository.putForAnalysis({
        analysisId: job.id,
        gameId,
        userColor: 'white',
        classificationCounts: { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 },
        userMoves: 0,
        totalMoves: 0,
        accuracy: null,
        accuracyMoves: 0,
        detectionState: 'completed',
        missedTacticCount: 0,
        detectionVersion: DETECTION_VERSION,
        updatedAt: now(),
        ...overrides,
      });
      return job;
    }

    /** Real engine-free generation over the shared repos; no engine needed. */
    function serviceWithGeneration(): AnalysisService {
      const generation = new PuzzleGenerationService({
        puzzles: puzzlesRepository,
        candidates: puzzleCandidatesRepository,
        analyses: analysesRepository,
        summaries: summariesRepository,
        now,
      });
      return new AnalysisService({
        games: gamesRepository,
        analyses: analysesRepository,
        jobs: analysisJobsRepository,
        engine: createFakeEngine().service,
        engineCache: new DexieEngineAnalysisCache(),
        engineMetadata: (profile: AnalysisProfile): EngineMetadata => ({
          ...FAKE_ENGINE_META,
          profile,
        }),
        now,
        summaries: summariesRepository,
        generation,
      });
    }

    it('reports already-current for a completed pass at the current generator version', async () => {
      const gameId = await seedFixture('cc-bullet-blunder');
      await seedSummary(gameId, {
        puzzleState: 'completed',
        puzzleProgress: { done: 1, total: 1 },
        puzzleGeneratorVersion: PUZZLE_GENERATOR_VERSION,
      });
      const service = serviceWithGeneration();

      expect(await service.generatePuzzles(gameId)).toBe('already-current');
      // No pass was scheduled: nothing live, nothing written.
      expect(await service.activeGenerationGames()).toEqual(new Set());
      expect(await puzzlesRepository.countForGame(gameId)).toBe(0);
    });

    it('schedules a regeneration for an outdated completed pass and reports started, then already-current once settled', async () => {
      const gameId = await seedFixture('li-blitz-blunder');
      // A completed pass from the older v1 generator under fresh detection.
      const job = await seedSummary(gameId, {
        puzzleState: 'completed',
        puzzleProgress: { done: 0, total: 0 },
        puzzleGeneratorVersion: 1,
      });
      const service = serviceWithGeneration();

      expect(await service.generatePuzzles(gameId)).toBe('started');

      // The engine-free pass settles at the current version (over an empty
      // candidate/blunder input set here: a completed zero-row regeneration).
      await waitFor(async () => {
        const current = await summariesRepository.getForAnalysis(job.id);
        return current?.puzzleState === 'completed';
      });
      await waitFor(async () => (await service.activeGenerationGames()).size === 0);
      const settled = (await summariesRepository.getForAnalysis(job.id))!;
      expect(settled.puzzleGeneratorVersion).toBe(PUZZLE_GENERATOR_VERSION);

      // Once current, the on-demand entry is a no-op.
      expect(await service.generatePuzzles(gameId)).toBe('already-current');
    });

    it('keeps reporting detection-not-ready until detection is completed and current', async () => {
      const gameId = await seedFixture('cc-rapid-missed-tactic');
      // A completed generation pass cannot mask a stale/absent detection: the
      // freshness gate governs (plan R-6) and nothing is scheduled.
      await seedSummary(gameId, { detectionVersion: 1 });
      const service = serviceWithGeneration();

      expect(await service.generatePuzzles(gameId)).toBe('detection-not-ready');
      expect(await service.activeGenerationGames()).toEqual(new Set());
      expect(await puzzlesRepository.countForGame(gameId)).toBe(0);
    });
  });
});
