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

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { db } from '@/infrastructure/db/database';
import { analysesRepository } from '@/infrastructure/db/analysis-repository';
import { analysisJobsRepository } from '@/infrastructure/db/analysis-jobs-repository';
import { puzzleCandidatesRepository } from '@/infrastructure/db/candidates-repository';
import { summariesRepository } from '@/infrastructure/db/summaries-repository';
import { gamesRepository } from '@/infrastructure/db/games-repository';
import { SessionAnalysisCache, analysisCacheKey } from '@/infrastructure/engine/cache';
import { AnalysisJobHandle } from '@/infrastructure/engine/engineService';
import { VERIFICATION_THREADS } from '@/infrastructure/engine/capabilities';
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
import { PUZZLE_GENERATOR_VERSION } from '@/domain/puzzle';
import type { VerifiedTacticalCandidate } from '@/domain/tactics';
import {
  createFakeEngine,
  FAKE_ENGINE_META,
} from '@/infrastructure/analysis/test-support/fakeAnalysisEngine';
import { TacticalDetectionService, VERIFY_MOVETIME_MS } from './tacticalDetectionService';
import { DEFAULT_VERIFICATION_DEPTH } from './verificationDepth';

const NOW = 1_700_000_000_000;
const BULLET_ID = 'li-bullet-missed-mate';

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

  it('wipes and re-derives a completed detection persisted by an older version (plan 015)', async () => {
    const game = fixtureGame(BULLET_ID);
    const job = completedJobFor(game);
    const plan = planOf(game);
    const missedPly = 6;
    const startingFen = plan.moves[missedPly]!.positionFen;
    const rig = createFakeEngine({ results: new Map([[startingFen, mateResult(startingFen)]]) });
    const service = serviceOf(rig.service);
    const { records } = bulletRecords(
      job.id,
      new Map([[missedPly, missedMateOverride(startingFen)]]),
    );

    // First run under the current version: completed summary, verified row,
    // owning record annotated.
    await service.runPassForCompletedJob(job, game, records);
    expect((await summariesRepository.getForAnalysis(job.id))?.detectionVersion).toBe(
      DETECTION_VERSION,
    );

    // Replay the plan-015 symptom: an older build's completed result. The
    // verified row AND the summary carry an older detectionVersion, and a
    // ghost annotation lingers on a ply that the current Stage-1 no longer
    // emits as a candidate (the 28.Rd1 case: never re-verified, never pruned).
    const storedRows = await puzzleCandidatesRepository.listForGameAndAnalysis(game.id, job.id);
    const staleVerified = storedRows.filter(
      (row): row is VerifiedTacticalCandidate => row.verificationStatus === 'verified',
    );
    await puzzleCandidatesRepository.bulkPutForAnalysis(
      staleVerified.map((row) => ({ ...row, detectionVersion: 1 })),
    );
    const summary = (await summariesRepository.getForAnalysis(job.id))!;
    await summariesRepository.putForAnalysis({ ...summary, detectionVersion: 1 });
    const ghostPly = plan.moves.length - 1;
    const staleRecords = (await analysesRepository.listForGameAndAnalysis(game.id, job.id)).map(
      (record) =>
        record.ply === missedPly || record.ply === ghostPly
          ? { ...record, missedTactic: true, detectionVersion: 1 }
          : record,
    );

    // A fresh pass on that stale state must NOT trust the old-version result:
    // it wipes the stale row/annotation and re-runs Stage 2 from scratch.
    const rig2 = createFakeEngine({ results: new Map([[startingFen, mateResult(startingFen)]]) });
    const service2 = serviceOf(rig2.service);
    await service2.runPassForCompletedJob(job, game, staleRecords);

    const refreshed = await summariesRepository.getForAnalysis(job.id);
    expect(refreshed?.detectionState).toBe('completed');
    expect(refreshed?.detectionVersion).toBe(DETECTION_VERSION);
    expect(refreshed?.missedTacticCount).toBe(1);

    const rows = await puzzleCandidatesRepository.listForGameAndAnalysis(game.id, job.id);
    expect(rows).toHaveLength(1);
    const verified = rows[0] as VerifiedTacticalCandidate;
    expect(verified.verificationStatus).toBe('verified');
    expect(verified.sourcePly).toBe(missedPly);
    expect(verified.detectionVersion).toBe(DETECTION_VERSION);

    // The genuine miss is re-annotated under the current version…
    const stored = await analysesRepository.listForGameAndAnalysis(game.id, job.id);
    const owning = stored.find((record) => record.ply === missedPly);
    expect(owning?.missedTactic).toBe(true);
    expect(owning?.detectionVersion).toBe(DETECTION_VERSION);
    // …and the ghost marker on the no-longer-candidate ply is cleared.
    const ghost = stored.find((record) => record.ply === ghostPly);
    expect(ghost?.missedTactic).toBe(false);
    expect(ghost?.detectionVersion).toBeNull();
  });

  it('does not count a verified missed tactic in the blunder bucket (ADR-023 exclusivity reaches the summary)', async () => {
    const game = fixtureGame(BULLET_ID);
    const job = completedJobFor(game);
    const plan = planOf(game);
    const missedPly = 6;
    const startingFen = plan.moves[missedPly]!.positionFen;
    const rig = createFakeEngine({ results: new Map([[startingFen, mateResult(startingFen)]]) });
    const service = serviceOf(rig.service);
    const { records } = bulletRecords(
      job.id,
      new Map([[missedPly, missedMateOverride(startingFen)]]),
    );

    await service.runPassForCompletedJob(job, game, records);

    const summary = (await summariesRepository.getForAnalysis(job.id))!;
    // The ply is a verified miss: counted once as a missed tactic…
    expect(summary.missedTacticCount).toBe(1);
    // …and NOT also in the raw blunder bucket. (Regression: the completed
    // summary used to be built from the un-annotated records, so a verified
    // miss stayed counted as a blunder.)
    expect(summary.classificationCounts.blunder).toBe(0);
  });

  it('resets puzzle-generation fields when it starts a fresh (re)derivation and never resurrects them (R-2)', async () => {
    const game = fixtureGame(BULLET_ID);
    const job = completedJobFor(game);
    const plan = planOf(game);
    const missedPly = 6;
    const startingFen = plan.moves[missedPly]!.positionFen;
    const rig = createFakeEngine({ results: new Map([[startingFen, mateResult(startingFen)]]) });
    const service = serviceOf(rig.service);
    const { records } = bulletRecords(
      job.id,
      new Map([[missedPly, missedMateOverride(startingFen)]]),
    );

    // First run completes detection at the current version.
    await service.runPassForCompletedJob(job, game, records);
    expect((await summariesRepository.getForAnalysis(job.id))?.detectionState).toBe('completed');

    // Simulate an already-generated analysis (Feature 011): the summary carries
    // a completed puzzle pass… persisted under an older detection version. The
    // old puzzle verdict is stale, so a fresh detection pass must reset the
    // puzzle fields at its first write and never carry the pre-pass values
    // through its later writes (plan R-2).
    const completed = (await summariesRepository.getForAnalysis(job.id))!;
    await summariesRepository.putForAnalysis({
      ...completed,
      detectionVersion: 1,
      puzzleState: 'completed',
      puzzleProgress: { done: 1, total: 1 },
      puzzleGeneratorVersion: PUZZLE_GENERATOR_VERSION,
    });
    const rig2 = createFakeEngine({ results: new Map([[startingFen, mateResult(startingFen)]]) });
    await serviceOf(rig2.service).runPassForCompletedJob(job, game, records);

    const refreshed = (await summariesRepository.getForAnalysis(job.id))!;
    expect(refreshed.detectionState).toBe('completed');
    expect(refreshed.detectionVersion).toBe(DETECTION_VERSION);
    expect(refreshed.missedTacticCount).toBe(1);
    // The stale pre-pass puzzle verdict was reset at the (re)derivation start:
    // `absent`/`null`, never the pre-pass `completed` values (the next
    // generation pass — auto-triggered once detection settles — restarts from
    // absent).
    expect(refreshed.puzzleState).toBe('absent');
    expect(refreshed.puzzleProgress).toBeNull();
    expect(refreshed.puzzleGeneratorVersion).toBeNull();
    // The verified row was re-derived under the current version.
    const rows = await puzzleCandidatesRepository.listForGameAndAnalysis(game.id, job.id);
    expect(rows).toHaveLength(1);
    const verified = rows.filter((row) => row.verificationStatus === 'verified');
    expect(verified[0]?.detectionVersion).toBe(DETECTION_VERSION);
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
      verificationDepth: DEFAULT_VERIFICATION_DEPTH,
      verificationTimestamp: NOW,
      wdlAfterBestLine: { w: 1000, d: 0, l: 0 },
    });
    expect(verified.detectionVersion).toBe(DETECTION_VERSION);
    // Feature-011 follow-up: the verified candidate persists the ADR-025
    // difficulty and the accepted solving move(s) for puzzle assembly.
    expect(typeof verified.difficulty).toBe('number');
    expect(verified.difficulty).toBeGreaterThanOrEqual(15);
    expect(verified.acceptedFirstMoves).toContain('h5f7');
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

  it('fast-paths a decisive stored mate with no tactical engine run (WP-C)', async () => {
    const game = fixtureGame(BULLET_ID);
    const job = completedJobFor(game);
    const plan = planOf(game);
    const missedPly = 6;
    const startingFen = plan.moves[missedPly]!.positionFen;
    // The run's stored analysis is a deep, decisive mate line (same engine).
    const { records } = bulletRecords(
      job.id,
      new Map([[missedPly, { ...missedMateOverride(startingFen), depth: 20, profile: 'normal' }]]),
    );
    // No tactical results at all: the fast path must never touch the engine.
    const rig = createFakeEngine();
    const service = serviceOf(rig.service);

    await service.runPassForCompletedJob(job, game, records);

    expect(rig.requests).toEqual([]);

    const rows = await puzzleCandidatesRepository.listForGameAndAnalysis(game.id, job.id);
    expect(rows).toHaveLength(1);
    const verified = rows[0] as VerifiedTacticalCandidate;
    expect(verified.verificationStatus).toBe('verified');
    expect(verified.tacticalObjective).toBe('forcing_mate');
    expect(verified.verificationSource).toBe('stored-analysis');
    expect(verified.bestPv).toEqual(['h5f7']);
    expect(verified.candidateSolutionLength).toBe(1);
    // Honest provenance: verified at the stored line's depth, never the
    // tactical profile's depth (which would fabricate a deeper search).
    expect(verified.verificationMetadata).toMatchObject({
      engineName: FAKE_ENGINE_META.engineName,
      engineVersion: FAKE_ENGINE_META.engineVersion,
      engineBuild: FAKE_ENGINE_META.engineBuild,
      verificationDepth: 20,
      wdlAfterBestLine: null,
    });
    // Feature-011 follow-up: the stored-mate fast path also persists a
    // difficulty estimate and the mating move as the accepted solving move.
    expect(typeof verified.difficulty).toBe('number');
    expect(verified.acceptedFirstMoves).toEqual(['h5f7']);

    const summary = await summariesRepository.getForAnalysis(job.id);
    expect(summary?.detectionState).toBe('completed');
    expect(summary?.missedTacticCount).toBe(1);
    expect(summary?.detectionVersion).toBe(DETECTION_VERSION);
  });

  it('defers an engine-failing candidate after a bounded retry and finishes the rest (plan-13 fix A)', async () => {
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

    // The failing candidate is attempted once, then retried once (bounded),
    // while the verifying candidate settles before it.
    expect(rig.requests).toEqual([startingFen, failingFen, failingFen]);

    const rows = await puzzleCandidatesRepository.listForGameAndAnalysis(game.id, job.id);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => [row.sourcePly, row.verificationStatus])).toEqual([
      [missedPly, 'verified'],
      [failingPly, 'failed'],
    ]);
    // The engine-failed candidate carries NO guard rejection reason (it is
    // unresolved/deferred, not a definitive Stage-2 verdict).
    const deferredRow = rows.find((row) => row.sourcePly === failingPly);
    expect(
      (deferredRow as { rejectionReason?: string } | undefined)?.rejectionReason,
    ).toBeUndefined();

    // The verified candidate is still annotated even though the pass is failed
    // (the deferred candidate must be retried by the next scan).
    const owning = (await analysesRepository.listForGameAndAnalysis(game.id, job.id)).find(
      (record) => record.ply === missedPly,
    );
    expect(owning?.missedTactic).toBe(true);

    const summary = await summariesRepository.getForAnalysis(job.id);
    expect(summary?.detectionState).toBe('failed');
    expect(summary?.missedTacticCount).toBeNull();
    expect(summary?.detectionVersion).toBeNull();
  });

  it('recovers from a transient engine failure on the retry and completes (plan-13 fix A)', async () => {
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

    const rig = createFakeEngine({
      results: new Map([[startingFen, mateResult(startingFen)]]),
      hold: true,
    });
    rig.setFailure(secondFen, 'transient crash');
    const service = serviceOf(rig.service);

    const pass = service.runPassForCompletedJob(job, game, withSecond);
    // Release the first (verifying) candidate.
    await waitFor(() => rig.requests.length === 1);
    rig.releaseAll(1);
    // First attempt of the flaky candidate fails, so it is retried once.
    await waitFor(() => rig.requests.length === 2);
    rig.releaseAll(1);
    await waitFor(() => rig.requests.length === 3);
    // The retry succeeds (the transient crash cleared).
    rig.clearFailures();
    rig.releaseAll(1);
    await pass;

    expect(rig.requests).toEqual([startingFen, secondFen, secondFen]);
    const summary = await summariesRepository.getForAnalysis(job.id);
    expect(summary?.detectionState).toBe('completed');
    expect(summary?.missedTacticCount).toBe(1);
    expect(summary?.detectionVersion).toBe(DETECTION_VERSION);
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
    // The guard-rejected candidate persists WHY it was rejected (scan report).
    const rejectedRow = rows.find((row) => row.sourcePly === secondPly);
    expect(
      (rejectedRow as { rejectionReason?: string } | undefined)?.rejectionReason,
    ).toBeDefined();
    const owning = (await analysesRepository.listForGameAndAnalysis(game.id, job.id)).find(
      (record) => record.ply === missedPly,
    );
    expect(owning?.missedTactic).toBe(true);

    summary = await summariesRepository.getForAnalysis(job.id);
    expect(summary?.detectionState).toBe('completed');
    expect(summary?.missedTacticCount).toBe(1);
    expect(summary?.detectionVersion).toBe(DETECTION_VERSION);
  });

  it('persists monotonic scan progress as candidates settle (plan 013 W3)', async () => {
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

    const pass = service.runPassForCompletedJob(job, game, withSecond);
    // The first candidate (mate) verified quickly; the second is held in flight.
    await waitFor(() => rig.requests.length === 2);

    // Progress persisted mid-pass: 1 of 2 candidates settled while `inProgress`.
    let summary = await summariesRepository.getForAnalysis(job.id);
    expect(summary?.detectionState).toBe('inProgress');
    expect(summary?.scanProgress).toEqual({ done: 1, total: 2 });

    rig.release(secondFen, quietResult(secondFen));
    await pass;

    summary = await summariesRepository.getForAnalysis(job.id);
    expect(summary?.detectionState).toBe('completed');
    expect(summary?.missedTacticCount).toBe(1);
    expect(summary?.scanProgress).toEqual({ done: 2, total: 2 });
  });

  it('restores its scan totals when an interrupted pass resumes (plan 013 W3)', async () => {
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
    await waitFor(() => rig.requests.length === 2);
    controller.abort();
    await firstPass;

    // Interrupted pass: the already-verified candidate stays counted.
    let summary = await summariesRepository.getForAnalysis(job.id);
    expect(summary?.detectionState).toBe('queued');
    expect(summary?.scanProgress).toEqual({ done: 1, total: 2 });

    // Resume: totals restored before any new engine work, then settle fully.
    const secondPass = service.runPassForCompletedJob(job, game, withSecond);
    await waitFor(() => rig.requests.length === 3);
    summary = await summariesRepository.getForAnalysis(job.id);
    expect(summary?.detectionState).toBe('inProgress');
    expect(summary?.scanProgress).toEqual({ done: 1, total: 2 });

    rig.release(secondFen, quietResult(secondFen));
    await secondPass;

    summary = await summariesRepository.getForAnalysis(job.id);
    expect(summary?.detectionState).toBe('completed');
    expect(summary?.missedTacticCount).toBe(1);
    expect(summary?.scanProgress).toEqual({ done: 2, total: 2 });
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
      analysisCacheKey(
        startingFen,
        {
          profile: 'tactical',
          maxDepth: DEFAULT_VERIFICATION_DEPTH,
          movetimeMs: VERIFY_MOVETIME_MS,
          threads: VERIFICATION_THREADS,
        },
        engineIdentity,
      ),
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

  it('records the effective verification depth as provenance on the summary and candidate', async () => {
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

    const summary = await summariesRepository.getForAnalysis(job.id);
    expect(summary?.verificationDepth).toBe(DEFAULT_VERIFICATION_DEPTH);
    const rows = await puzzleCandidatesRepository.listForGameAndAnalysis(game.id, job.id);
    expect((rows[0] as VerifiedTacticalCandidate).verificationMetadata.verificationDepth).toBe(
      DEFAULT_VERIFICATION_DEPTH,
    );
  });

  it('resolves the live verification depth once per pass and uses it for the search and cache scope', async () => {
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
    let calls = 0;
    const service = serviceOf(rig.service, {
      resolveVerificationDepth: () => {
        calls += 1;
        return 30;
      },
    });

    await service.runPassForCompletedJob(job, game, records);

    // Resolved once for the whole pass; the engine search carries the depth and
    // the verification engine's own 1-thread count.
    expect(calls).toBe(1);
    expect(rig.activeJobs[0]?.options.maxDepth).toBe(30);
    expect(rig.activeJobs[0]?.options.threads).toBe(VERIFICATION_THREADS);
    const rows = await puzzleCandidatesRepository.listForGameAndAnalysis(game.id, job.id);
    expect((rows[0] as VerifiedTacticalCandidate).verificationMetadata.verificationDepth).toBe(30);
    expect((await summariesRepository.getForAnalysis(job.id))?.verificationDepth).toBe(30);
  });

  it('does not serve a cached verification produced at a different depth', async () => {
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
    // Seed at the default depth; a depth-30 pass must not reuse it.
    await cache.put(
      analysisCacheKey(
        startingFen,
        {
          profile: 'tactical',
          maxDepth: DEFAULT_VERIFICATION_DEPTH,
          movetimeMs: VERIFY_MOVETIME_MS,
          threads: VERIFICATION_THREADS,
        },
        engineIdentity,
      ),
      mateResult(startingFen),
    );

    const rig = createFakeEngine({ results: new Map([[startingFen, mateResult(startingFen)]]) });
    const service = serviceOf(rig.service, { engineCache: cache, verificationDepth: 30 });

    await service.runPassForCompletedJob(job, game, records);

    // A fresh search ran at depth 30 (the depth-22 entry was not served).
    expect(rig.requests).toEqual([startingFen]);
    expect(rig.activeJobs[0]?.options.maxDepth).toBe(30);
    expect((await summariesRepository.getForAnalysis(job.id))?.verificationDepth).toBe(30);
  });

  it('treats depth as provenance, not freshness: a completed pass stays current at another depth', async () => {
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
    await serviceOf(rig.service).runPassForCompletedJob(job, game, records);
    expect((await summariesRepository.getForAnalysis(job.id))?.verificationDepth).toBe(
      DEFAULT_VERIFICATION_DEPTH,
    );

    // A non-forced invocation at a different depth is a no-op: the completed
    // pass is current on its detectionVersion alone. Changing the depth never
    // marks it outdated and never auto-runs a scan.
    const rig2 = createFakeEngine();
    await serviceOf(rig2.service, { verificationDepth: 30 }).runPassForCompletedJob(
      job,
      game,
      records,
    );

    expect(rig2.requests).toEqual([]);
    expect((await summariesRepository.getForAnalysis(job.id))?.verificationDepth).toBe(
      DEFAULT_VERIFICATION_DEPTH,
    );
  });

  it('force re-scans at a changed depth without reusing the old-depth verified row', async () => {
    const game = fixtureGame(BULLET_ID);
    const job = completedJobFor(game);
    const plan = planOf(game);
    const missedPly = 6;
    const startingFen = plan.moves[missedPly]!.positionFen;
    const { records } = bulletRecords(
      job.id,
      new Map([[missedPly, missedMateOverride(startingFen)]]),
    );

    // First pass at the default depth verifies the mate and annotates the ply.
    const rig1 = createFakeEngine({ results: new Map([[startingFen, mateResult(startingFen)]]) });
    await serviceOf(rig1.service).runPassForCompletedJob(job, game, records);
    expect(
      (await puzzleCandidatesRepository.listForGameAndAnalysis(game.id, job.id)).some(
        (row) => row.verificationStatus === 'verified',
      ),
    ).toBe(true);

    // A forced re-scan at depth 30 must not reuse the depth-22 verdict: the
    // stale row is wiped, the annotation cleared, and a fresh search runs.
    const annotated = await analysesRepository.listForGameAndAnalysis(game.id, job.id);
    const rig2 = createFakeEngine({ results: new Map([[startingFen, quietResult(startingFen)]]) });
    await serviceOf(rig2.service, { verificationDepth: 30 }).runPassForCompletedJob(
      job,
      game,
      annotated,
      undefined,
      { force: true },
    );

    expect(rig2.requests).toEqual([startingFen]);
    const rows = await puzzleCandidatesRepository.listForGameAndAnalysis(game.id, job.id);
    expect(rows.some((row) => row.verificationStatus === 'verified')).toBe(false);
    const owning = (await analysesRepository.listForGameAndAnalysis(game.id, job.id)).find(
      (record) => record.ply === missedPly,
    );
    expect(owning?.missedTactic).toBe(false);
    const summary = await summariesRepository.getForAnalysis(job.id);
    expect(summary?.detectionState).toBe('completed');
    expect(summary?.missedTacticCount).toBe(0);
    expect(summary?.verificationDepth).toBe(30);
  });

  it('never inherits the analysis run threads override', async () => {
    const game = fixtureGame(BULLET_ID);
    const baseJob = completedJobFor(game);
    const job: AnalysisJob = { ...baseJob, config: { threads: 4 } };
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

    // The dedicated verification engine uses its own 1-thread count, not the
    // Game-analysis run's `threads: 4` override.
    expect(rig.activeJobs[0]?.options.threads).toBe(VERIFICATION_THREADS);
  });

  it('dispose() delegates to the injected verification engine', async () => {
    const rig = createFakeEngine();
    const disposed = vi.fn(async () => undefined);
    const service = serviceOf({ ...rig.service, dispose: disposed });

    await service.dispose();

    expect(disposed).toHaveBeenCalledTimes(1);
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
