/**
 * TacticalDetectionService tests (Feature 010, Milestone A).
 *
 * Exercises the orchestration over the real `li-bullet-missed-mate` fixture
 * game (the user, White, misses 4.Qxf7# by playing 4.d3 — ply 6). Records are
 * built from the fixture's real analysis plan (`planGameAnalysis`) so every
 * candidate `startingFen` is a genuine game position the fake engine can walk;
 * Stage-2 engine results are hand-authored tactical-profile shapes keyed by
 * the candidate FEN.
 *
 * Coverage: an empty candidate pass completes with a real zero; a genuine
 * missed tactic verifies end-to-end (candidate persisted, owning `MoveAnalysis`
 * annotated, summary `completed`); an engine failure marks that candidate
 * `failed` while the rest of the pass continues; an aborted pass persists
 * partial progress and resumes on the next run without re-running verified
 * candidates; the ADR-018 cache serves Stage-2 without an engine call; the
 * Milestone-B lazy backfill creates `absent`-detection summaries.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { db } from '@/infrastructure/db/database';
import { analysesRepository } from '@/infrastructure/db/analysis-repository';
import { analysisJobsRepository } from '@/infrastructure/db/analysis-jobs-repository';
import { puzzleCandidatesRepository } from '@/infrastructure/db/candidates-repository';
import { summariesRepository } from '@/infrastructure/db/summaries-repository';
import { gamesRepository } from '@/infrastructure/db/games-repository';
import { SessionAnalysisCache, analysisCacheKey } from '@/infrastructure/engine/cache';
import { AnalysisJobHandle } from '@/infrastructure/engine/engineService';
import { profileConfig } from '@/infrastructure/engine/engineProfiles';
import type {
  EngineAnalysisResult,
  EngineService,
  EngineServiceStatus,
} from '@/infrastructure/engine/types';
import type { AnalysisOptions } from '@/infrastructure/engine/types';
import type { AnalysisJob } from '@/domain/analysis';
import { markCompleted, planGameAnalysis } from '@/domain/analysis';
import { makeJob, makeMove } from '@/domain/analysis/test-support';
import type { GameAnalysisPlan } from '@/domain/analysis';
import { fixtureGame } from '@/domain/chess/fixtures';
import type { EngineMetadata, MoveAnalysis } from '@/domain/chess';
import type { Game } from '@/domain/chess/game';
import { DETECTION_VERSION } from '@/domain/tactics';
import type { VerifiedTacticalCandidate } from '@/domain/tactics';
import {
  createFakeEngine,
  FAKE_ENGINE_META,
} from '@/infrastructure/analysis/test-support/fakeAnalysisEngine';
import { TacticalDetectionService } from './tacticalDetectionService';

const NOW = 1_700_000_000_000;
const BULLET_ID = 'li-bullet-missed-mate';
const TACTICAL_DEPTH = profileConfig('tactical').depth;

/** Engine identity of a `tactical`-profile run against the fake engine. */
const TACTICAL_ENGINE: EngineMetadata = { ...FAKE_ENGINE_META, profile: 'tactical' };

function planOf(game: Game): GameAnalysisPlan {
  const result = planGameAnalysis(game);
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.plan;
}

function completedJobFor(game: Game): AnalysisJob {
  return markCompleted(makeJob(game.id), NOW);
}

function serviceOf(
  engine: EngineService,
  extra: Partial<ConstructorParameters<typeof TacticalDetectionService>[0]> = {},
): TacticalDetectionService {
  return new TacticalDetectionService({
    engine,
    analyses: analysesRepository,
    candidates: puzzleCandidatesRepository,
    summaries: summariesRepository,
    now: () => NOW,
    ...extra,
  });
}

/** The bullet fixture's full plan-based record set (real positions). */
function bulletRecords(
  analysisId: string,
  overrides: ReadonlyMap<number, Partial<MoveAnalysis>> = new Map(),
): {
  readonly game: Game;
  readonly records: readonly MoveAnalysis[];
  readonly plan: GameAnalysisPlan;
} {
  const game = fixtureGame(BULLET_ID);
  const plan = planOf(game);
  const records = plan.moves.map((move) =>
    makeMove(move.ply, {
      gameId: game.id,
      analysisId,
      side: move.side,
      playedMove: move.playedMove,
      positionFen: move.positionFen,
      legalMovesCount: move.legalMovesCount,
      gamePhase: move.gamePhase,
      ...(overrides.get(move.ply) ?? {}),
    }),
  );
  return { game, records, plan };
}

/** Overrides turning ply 6 (4.d3, user White) into a genuine missed mate. */
function missedMateOverride(positionFen: string): Partial<MoveAnalysis> {
  return {
    bestMove: { san: 'Qxf7#', uci: 'h5f7' },
    bestPv: ['h5f7'],
    positionFen,
    evalBefore: { cp: null, mate: 1 },
    evalAfter: { cp: -10, mate: null },
    classification: 'blunder',
  };
}

/**
 * A fabricated extra user (White) blunder appended past the game's real plies
 * (the pipeline only consumes records; its FEN/evals just need Stage-1 to emit
 * a candidate and — when the engine is asked — a walkable position).
 */
function fabricatedWhiteBlunder(
  gameId: string,
  analysisId: string,
  ply: number,
  positionFen: string,
): MoveAnalysis {
  return makeMove(ply, {
    gameId,
    analysisId,
    side: 'white',
    playedMove: { san: 'd4', uci: 'd2d4' },
    bestMove: { san: 'e4', uci: 'e2e4' },
    bestPv: ['e2e4'],
    positionFen,
    evalBefore: { cp: 300, mate: null },
    evalAfter: { cp: -180, mate: null },
    classification: 'blunder',
    gamePhase: 'opening',
    legalMovesCount: 20,
  });
}

/** A tactical-profile result that verifies the 4.Qxf7# mate at the given FEN. */
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
    engine: TACTICAL_ENGINE,
    timeMs: 5,
  };
}

/** A tactical-profile result with a quiet line that reaches no objective. */
function quietResult(fen: string): EngineAnalysisResult {
  return {
    jobId: 'job-tactical',
    position: fen,
    profile: 'tactical',
    lines: [
      {
        multipv: 1,
        evaluation: { cp: 20 },
        principalVariation: [{ uci: 'b1c3' }, { uci: 'g8f6' }],
        wdl: { w: 540, d: 430, l: 30 },
      },
    ],
    engine: TACTICAL_ENGINE,
    timeMs: 5,
  };
}

describe('TacticalDetectionService — pass orchestration', () => {
  beforeEach(async () => {
    await db.games.clear();
    await db.analyses.clear();
    await db.analysisJobs.clear();
    await db.analysisSummaries.clear();
    await db.puzzleCandidates.clear();
    await db.positionAnalysisCache.clear();
  });

  it('completes an empty pass: summary `completed` with a real zero, no candidates, no engine work', async () => {
    const game = fixtureGame(BULLET_ID);
    const job = completedJobFor(game);
    // Every ply records the played move as the engine's best choice, so Stage-1
    // emits nothing even though the game contains a tactical idea.
    const { records } = bulletRecords(job.id);
    const rig = createFakeEngine();
    const service = serviceOf(rig.service);

    await service.runPassForCompletedJob(job, game, records);

    const summary = await summariesRepository.getForAnalysis(job.id);
    expect(summary?.detectionState).toBe('completed');
    expect(summary?.missedTacticCount).toBe(0);
    expect(summary?.detectionVersion).toBe(DETECTION_VERSION);
    expect(await puzzleCandidatesRepository.listForGameAndAnalysis(game.id, job.id)).toEqual([]);
    expect(rig.requests).toEqual([]);
  });

  it('is idempotent: an already-completed pass is not re-run', async () => {
    const game = fixtureGame(BULLET_ID);
    const job = completedJobFor(game);
    const { records } = bulletRecords(job.id);
    const rig = createFakeEngine();
    const service = serviceOf(rig.service);

    await service.runPassForCompletedJob(job, game, records);
    await service.runPassForCompletedJob(job, game, records);

    expect(rig.requests).toEqual([]);
    const summary = await summariesRepository.getForAnalysis(job.id);
    expect(summary?.detectionState).toBe('completed');
  });

  it('verifies a genuine missed tactic end-to-end and annotates the owning move', async () => {
    const game = fixtureGame(BULLET_ID);
    const job = completedJobFor(game);
    const plan = planOf(game);
    const missedPly = 6;
    const startingFen = plan.moves[missedPly]!.positionFen;
    const { records } = bulletRecords(
      job.id,
      new Map([[missedPly, missedMateOverride(startingFen)]]),
    );
    const rig = createFakeEngine({ results: new Map([[startingFen, mateResult(startingFen)]]) });
    const service = serviceOf(rig.service);

    await service.runPassForCompletedJob(job, game, records);

    // One Stage-2 engine run, on exactly the candidate's starting FEN.
    expect(rig.requests).toEqual([startingFen]);

    const rows = await puzzleCandidatesRepository.listForGameAndAnalysis(game.id, job.id);
    expect(rows).toHaveLength(1);
    const verified = rows[0] as VerifiedTacticalCandidate;
    expect(verified.verificationStatus).toBe('verified');
    expect(verified.sourcePly).toBe(missedPly);
    expect(verified.startingFen).toBe(startingFen);
    expect(verified.userMovePlayed).toBe('d2d3');
    expect(verified.tacticalObjective).toBe('forcing_mate');
    expect(verified.candidateSolutionLength).toBe(1);
    expect(verified.bestMove).toBe('h5f7');
    expect(verified.bestPv).toEqual(['h5f7']);
    expect(verified.verificationMetadata).toMatchObject({
      engineName: FAKE_ENGINE_META.engineName,
      engineVersion: FAKE_ENGINE_META.engineVersion,
      engineBuild: FAKE_ENGINE_META.engineBuild,
      verificationDepth: TACTICAL_DEPTH,
      verificationTimestamp: NOW,
      wdlAfterBestLine: { w: 1000, d: 0, l: 0 },
    });
    expect(verified.detectionVersion).toBe(DETECTION_VERSION);
    expect(await puzzleCandidatesRepository.listVerifiedForGame(game.id)).toEqual([verified]);

    // The owning ply is annotated; every other record is left intact.
    const stored = await analysesRepository.listForGameAndAnalysis(game.id, job.id);
    expect(stored).toHaveLength(plan.moves.length);
    const owning = stored.find((record) => record.ply === missedPly);
    expect(owning?.missedTactic).toBe(true);
    expect(owning?.detectionVersion).toBe(DETECTION_VERSION);
    for (const record of stored) {
      if (record.ply !== missedPly) {
        expect(record.missedTactic).toBe(false);
        expect(record.detectionVersion).toBeNull();
      }
    }

    const summary = await summariesRepository.getForAnalysis(job.id);
    expect(summary?.detectionState).toBe('completed');
    expect(summary?.missedTacticCount).toBe(1);
    expect(summary?.detectionVersion).toBe(DETECTION_VERSION);
  });

  it('marks an engine-failed candidate `failed` and lets the rest of the pass continue', async () => {
    const game = fixtureGame(BULLET_ID);
    const job = completedJobFor(game);
    const plan = planOf(game);
    const missedPly = 6;
    const startingFen = plan.moves[missedPly]!.positionFen;
    // A second candidate (fabricated extra White ply) whose engine run fails.
    const failingPly = 10;
    const failingFen = plan.moves[4]!.positionFen;
    const { records } = bulletRecords(
      job.id,
      new Map([[missedPly, missedMateOverride(startingFen)]]),
    );
    const withSecond = [
      ...records,
      fabricatedWhiteBlunder(game.id, job.id, failingPly, failingFen),
    ];
    const rig = createFakeEngine({
      results: new Map([[startingFen, mateResult(startingFen)]]),
      failures: new Map([[failingFen, 'Engine crashed']]),
    });
    const service = serviceOf(rig.service);

    await service.runPassForCompletedJob(job, game, withSecond);

    expect(rig.requests).toEqual([startingFen, failingFen]);

    const rows = await puzzleCandidatesRepository.listForGameAndAnalysis(game.id, job.id);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => [row.sourcePly, row.verificationStatus])).toEqual([
      [missedPly, 'verified'],
      [failingPly, 'failed'],
    ]);

    // The verified candidate is still annotated even though the pass is failed.
    const owning = (await analysesRepository.listForGameAndAnalysis(game.id, job.id)).find(
      (record) => record.ply === missedPly,
    );
    expect(owning?.missedTactic).toBe(true);

    const summary = await summariesRepository.getForAnalysis(job.id);
    expect(summary?.detectionState).toBe('failed');
    expect(summary?.missedTacticCount).toBeNull();
    expect(summary?.detectionVersion).toBeNull();
  });

  it('resumes an aborted pass on the next run without re-running verified candidates', async () => {
    const game = fixtureGame(BULLET_ID);
    const job = completedJobFor(game);
    const plan = planOf(game);
    const missedPly = 6;
    const startingFen = plan.moves[missedPly]!.positionFen;
    const secondPly = 10;
    const secondFen = plan.moves[4]!.positionFen;
    const { records } = bulletRecords(
      job.id,
      new Map([[missedPly, missedMateOverride(startingFen)]]),
    );
    const withSecond = [...records, fabricatedWhiteBlunder(game.id, job.id, secondPly, secondFen)];

    const rig = createGatedEngine(new Map([[startingFen, mateResult(startingFen)]]), [secondFen]);
    const service = serviceOf(rig.service);

    const controller = new AbortController();
    const firstPass = service.runPassForCompletedJob(job, game, withSecond, controller.signal);
    // Wait until the first candidate is verified and the second is in flight,
    // then abort: the pass must stop at the next candidate boundary.
    await waitFor(() => rig.requests.length === 2);
    controller.abort();
    await firstPass;

    // Partial progress persisted: the first candidate verified, the summary is
    // back to `queued` (pass scheduled again, not settled), the second is raw.
    let rows = await puzzleCandidatesRepository.listForGameAndAnalysis(game.id, job.id);
    expect(rows.map((row) => [row.sourcePly, row.verificationStatus])).toEqual([
      [missedPly, 'verified'],
      [secondPly, 'raw'],
    ]);
    let summary = await summariesRepository.getForAnalysis(job.id);
    expect(summary?.detectionState).toBe('queued');
    expect(summary?.missedTacticCount).toBeNull();

    // Resume: the already-verified candidate is reused (no engine call) and the
    // remaining raw candidate settles as discarded.
    const secondPass = service.runPassForCompletedJob(job, game, withSecond);
    await waitFor(() => rig.requests.length === 3);
    rig.release(secondFen, quietResult(secondFen));
    await secondPass;

    expect(rig.requests).toEqual([startingFen, secondFen, secondFen]);

    rows = await puzzleCandidatesRepository.listForGameAndAnalysis(game.id, job.id);
    expect(rows.map((row) => [row.sourcePly, row.verificationStatus])).toEqual([
      [missedPly, 'verified'],
      [secondPly, 'failed'],
    ]);
    const owning = (await analysesRepository.listForGameAndAnalysis(game.id, job.id)).find(
      (record) => record.ply === missedPly,
    );
    expect(owning?.missedTactic).toBe(true);

    summary = await summariesRepository.getForAnalysis(job.id);
    expect(summary?.detectionState).toBe('completed');
    expect(summary?.missedTacticCount).toBe(1);
    expect(summary?.detectionVersion).toBe(DETECTION_VERSION);
  });

  it('serves Stage-2 from the ADR-018 cache without touching the engine', async () => {
    const game = fixtureGame(BULLET_ID);
    const job = completedJobFor(game);
    const plan = planOf(game);
    const missedPly = 6;
    const startingFen = plan.moves[missedPly]!.positionFen;
    const { records } = bulletRecords(
      job.id,
      new Map([[missedPly, missedMateOverride(startingFen)]]),
    );

    const cache = new SessionAnalysisCache();
    const engineIdentity = {
      engineName: FAKE_ENGINE_META.engineName,
      engineVersion: FAKE_ENGINE_META.engineVersion,
      engineBuild: FAKE_ENGINE_META.engineBuild,
    };
    await cache.put(
      analysisCacheKey(startingFen, { profile: 'tactical' }, engineIdentity),
      mateResult(startingFen),
    );

    const rig = createFakeEngine();
    const service = serviceOf(rig.service, { engineCache: cache });

    await service.runPassForCompletedJob(job, game, records);

    expect(rig.requests).toEqual([]);
    const rows = await puzzleCandidatesRepository.listForGameAndAnalysis(game.id, job.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.verificationStatus).toBe('verified');
    const summary = await summariesRepository.getForAnalysis(job.id);
    expect(summary?.detectionState).toBe('completed');
    expect(summary?.missedTacticCount).toBe(1);
  });

  it('backfills `absent`-detection summaries for completed analyses without a pass', async () => {
    const game = fixtureGame(BULLET_ID);
    await gamesRepository.saveGame(game);
    const job = completedJobFor(game);
    await analysisJobsRepository.putJob(job);
    const records = bulletRecords(job.id).records;
    await analysesRepository.replaceAnalysis(records);
    const service = serviceOf(createFakeEngine().service, {
      jobs: analysisJobsRepository,
      games: gamesRepository,
    });

    expect(await service.ensureSummariesForRows([game.id])).toBe(1);
    const stored = await summariesRepository.getForAnalysis(job.id);
    expect(stored?.gameId).toBe(game.id);
    expect(stored?.detectionState).toBe('absent');
    expect(stored?.missedTacticCount).toBeNull();
    expect(stored?.detectionVersion).toBeNull();
    expect(stored?.accuracy).not.toBeNull();
    expect(stored?.userColor).toBe('white');

    // Idempotent: an existing summary (absent or not) is never overwritten.
    expect(await service.ensureSummariesForRows([game.id])).toBe(0);
    expect(await service.ensureSummariesForRows(['lichess:nope'])).toBe(0);
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

/** An engine whose jobs settle on a microtask except for held FENs. */
interface GatedEngineRig {
  readonly service: EngineService;
  readonly requests: string[];
  release(fen: string, result: EngineAnalysisResult): void;
}

function createGatedEngine(
  results: ReadonlyMap<string, EngineAnalysisResult>,
  heldFens: readonly string[] = [],
): GatedEngineRig {
  const requests: string[] = [];
  const pending = new Map<string, AnalysisJobHandle>();
  const held = new Set(heldFens);
  const status: EngineServiceStatus = {
    lifecycle: 'ready',
    engine: FAKE_ENGINE_META,
    build: 'lite-single',
    activeJobId: null,
    queued: 0,
  };

  const service: EngineService = {
    analyze(fen: string, options?: Partial<AnalysisOptions>) {
      const handle = new AnalysisJobHandle(
        fen,
        { profile: options?.profile ?? 'normal', ...options },
        () => handle.cancelFinish(),
      );
      requests.push(fen);
      if (held.has(fen)) {
        pending.set(fen, handle);
      } else {
        const result = results.get(fen) ?? quietResult(fen);
        queueMicrotask(() => {
          if (handle.cancelRequested || handle.status !== 'queued') {
            return;
          }
          handle.setStatus('running');
          handle.complete(result);
        });
      }
      return handle;
    },
    cancel(jobId: string) {
      const job = [...pending.values()].find((j) => j.id === jobId);
      job?.cancelFinish();
    },
    cancelAll() {
      for (const job of [...pending.values()]) {
        job.cancelFinish();
      }
    },
    getStatus() {
      return status;
    },
    onStatusChange() {
      return () => undefined;
    },
    dispose() {
      return Promise.resolve();
    },
  };

  return {
    service,
    requests,
    release(fen: string, result: EngineAnalysisResult): void {
      const handle = pending.get(fen);
      if (handle) {
        handle.complete(result);
        pending.delete(fen);
      }
    },
  };
}
