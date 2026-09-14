import { describe, expect, it, beforeEach } from 'vitest';
import { db } from './database';
import { gamesRepository } from './games-repository';
import { analysesRepository } from './analysis-repository';
import { analysisJobsRepository } from './analysis-jobs-repository';
import { summariesRepository } from './summaries-repository';
import { puzzleCandidatesRepository } from './candidates-repository';
import { puzzlesRepository } from './puzzles-repository';
import { attemptsRepository } from './attempts-repository';
import { reviewSchedulesRepository } from './review-schedules-repository';
import { trainingSetsRepository } from './training-sets-repository';
import { trainingCyclesRepository } from './training-cycles-repository';
import { DexieEngineAnalysisCache } from './engine-cache-repository';
import { fixtureGame } from '@/domain/chess/fixtures';
import { makeRecords, TEST_ENGINE } from '@/domain/analysis/test-support';
import { createAnalysisJob } from '@/domain/analysis';
import { buildAnalysisSummary } from '@/domain/analysis/summaryDerivation';
import { puzzleRowFixture } from '@/domain/puzzle/test-support';
import { puzzleIdOf } from '@/domain/puzzle/id';
import { puzzleScheduleRowFixture } from '@/domain/review/test-support';
import {
  attemptRowFixture,
  cycleContextFixture,
  cycleFixture,
  setFixture,
} from '@/domain/training/test-support';
import { CANDIDATE_GENERATION_VERSION, DETECTION_VERSION } from '@/domain/tactics';
import { tombstoneId } from '@/domain/sync';

function candidateRow(gameId: string, analysisId: string, sourcePly: number) {
  return {
    id: `${analysisId}:${sourcePly}`,
    analysisId,
    sourceGameId: gameId,
    sourcePly,
    startingFen: 'r1bqkb1r/pppp1pp1/2n2n1p/4p1N1/2B1P3/8/PPPP1PPP/RNBQK2R w KQkq - 0 5',
    userMovePlayed: 'h7h6',
    bestMove: 'g5f7',
    bestPv: ['g5f7', 'd8e7', 'f7h8'],
    wpLoss: 42.3,
    evalCpBefore: 300,
    evalCpAfterUserMove: -180,
    candidateGenerationVersion: CANDIDATE_GENERATION_VERSION,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    tacticalObjective: 'winning_material',
    candidateSolutionLength: 3,
    verificationMetadata: {
      engineName: TEST_ENGINE.engineName,
      engineVersion: TEST_ENGINE.engineVersion,
      engineBuild: TEST_ENGINE.engineBuild,
      analysisVersion: 1,
      verificationDepth: 22,
      verificationTimestamp: 1_700_000_000_000,
      wdlAfterBestLine: { w: 950, d: 40, l: 10 },
    },
    detectionVersion: DETECTION_VERSION,
    verificationStatus: 'verified',
  } as const;
}

/** A Feature-011 puzzle row at the given `(sourceGameId, sourcePly)` key. */
function puzzleRow(sourceGameId: string, analysisId: string, sourcePly: number) {
  return {
    ...puzzleRowFixture('material-combination'),
    sourceGameId,
    sourcePly,
    analysisId,
  };
}

describe('game deletion cascade (ARCHITECTURE.md §7)', () => {
  beforeEach(async () => {
    await db.games.clear();
    await db.analyses.clear();
    await db.analysisJobs.clear();
    await db.positionAnalysisCache.clear();
    await db.analysisSummaries.clear();
    await db.puzzleCandidates.clear();
    await db.puzzles.clear();
    await db.puzzleAttempts.clear();
    await db.puzzleSchedules.clear();
    await db.trainingSets.clear();
    await db.trainingCycles.clear();
    await db.syncState.clear();
    await db.syncTombstones.clear();
  });

  it('removes game-scoped MoveAnalysis, jobs, summaries, candidates, puzzles and attempts but retains the engine cache', async () => {
    const game = fixtureGame('cc-blitz-clean');
    await gamesRepository.saveGame(game);
    const other = fixtureGame('li-rapid-clean');
    await gamesRepository.saveGame(other);

    const job = createAnalysisJob(game.id, TEST_ENGINE, 14, 1);
    await analysisJobsRepository.putJob(job);
    await analysesRepository.replaceAnalysis(makeRecords(game.id, job.id, 14));

    // Feature-010 derived rows for the deleted game…
    const summary = buildAnalysisSummary(makeRecords(game.id, job.id, 14), game.userColor, {
      detectionState: 'completed',
      missedTacticCount: 1,
      detectionVersion: DETECTION_VERSION,
    });
    await summariesRepository.putForAnalysis({
      analysisId: job.id,
      gameId: game.id,
      userColor: game.userColor,
      updatedAt: 1,
      ...summary,
    });
    await puzzleCandidatesRepository.bulkPutForAnalysis([
      candidateRow(game.id, job.id, 7),
      candidateRow(game.id, job.id, 9),
    ]);
    await puzzlesRepository.addIfAbsent([
      puzzleRow(game.id, job.id, 7),
      puzzleRow(game.id, job.id, 9),
    ]);

    // Feature-012 attempt rows for the deleted game's puzzles (two
    // presentations of ply 7, one of ply 9), derived through the real
    // buildAttemptRow over those same puzzle rows.
    for (const attempt of [
      attemptRowFixture({
        row: puzzleRow(game.id, job.id, 7),
        context: cycleContextFixture('cycle:deleted', '', 1),
      }),
      attemptRowFixture({
        row: puzzleRow(game.id, job.id, 7),
        context: cycleContextFixture('cycle:deleted', '', 2),
      }),
      attemptRowFixture({
        row: puzzleRow(game.id, job.id, 9),
        context: cycleContextFixture('cycle:deleted', '', 1),
      }),
    ]) {
      await attemptsRepository.addAttempt(attempt);
    }

    // …and identical rows for a different game that must survive.
    const otherJob = createAnalysisJob(other.id, TEST_ENGINE, 6, 1);
    const otherSummary = buildAnalysisSummary(
      makeRecords(other.id, otherJob.id, 6),
      other.userColor,
      { detectionState: 'queued' },
    );
    await summariesRepository.putForAnalysis({
      analysisId: otherJob.id,
      gameId: other.id,
      userColor: other.userColor,
      updatedAt: 1,
      ...otherSummary,
    });
    await puzzleCandidatesRepository.bulkPutForAnalysis([candidateRow(other.id, otherJob.id, 1)]);
    await puzzlesRepository.addIfAbsent([puzzleRow(other.id, otherJob.id, 1)]);
    await attemptsRepository.addAttempt(
      attemptRowFixture({
        row: puzzleRow(other.id, otherJob.id, 1),
        context: cycleContextFixture('cycle:other', '', 1),
      }),
    );

    // Feature-013 sets: one containing the deleted game's puzzle ids (plus a
    // foreign id that must survive) with an immutable cycle snapshot, and one
    // containing only the other game's puzzle id.
    const deletedPuzzleIds = [puzzleIdOf(game.id, 7), puzzleIdOf(game.id, 9)];
    const foreignPuzzleId = puzzleIdOf(other.id, 1);
    await trainingSetsRepository.create(
      setFixture({
        id: 'set:deleted-game',
        puzzleIds: [...deletedPuzzleIds, foreignPuzzleId],
        updatedAt: 1,
      }),
    );
    await trainingSetsRepository.create(
      setFixture({ id: 'set:other-game', puzzleIds: [foreignPuzzleId], updatedAt: 2 }),
    );
    await trainingCyclesRepository.create(
      cycleFixture({
        id: 'cycle:deleted-set',
        trainingSetId: 'set:deleted-game',
        cycleNumber: 1,
        puzzleIds: [...deletedPuzzleIds],
      }),
    );

    // Feature-020 derived schedule rows for the deleted game's puzzles (and a
    // foreign row that must survive) — the cascade removes them by `puzzleId`.
    await reviewSchedulesRepository.bulkPut([
      puzzleScheduleRowFixture({ puzzleId: deletedPuzzleIds[0]! }),
      puzzleScheduleRowFixture({ puzzleId: deletedPuzzleIds[1]! }),
      puzzleScheduleRowFixture({ puzzleId: foreignPuzzleId }),
    ]);

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

    // A `game` tombstone is written with the cascade so a later sync
    // propagates the deletion, keyed by the deterministic `<kind>:<recordId>`.
    const tombstones = await db.syncTombstones.toArray();
    expect(tombstones).toHaveLength(1);
    expect(tombstones[0]?.id).toBe(tombstoneId('game', game.id));
    expect(tombstones[0]?.kind).toBe('game');
    expect(tombstones[0]?.recordId).toBe(game.id);
    expect(typeof tombstones[0]?.deviceId).toBe('string');
    expect(tombstones[0]!.deviceId.length).toBeGreaterThan(0);

    expect(await db.games.count()).toBe(1);
    expect(await analysesRepository.countForGame(game.id)).toBe(0);
    expect(await analysisJobsRepository.listByGame(game.id)).toHaveLength(0);
    expect(await summariesRepository.getForAnalysis(job.id)).toBeUndefined();
    expect(await puzzleCandidatesRepository.listForGameAndAnalysis(game.id, job.id)).toEqual([]);
    expect(await puzzlesRepository.countForGame(game.id)).toBe(0);
    expect(await attemptsRepository.listForCycle('cycle:deleted')).toEqual([]);
    expect(await attemptsRepository.listForPuzzle(`${game.id}:7`)).toEqual([]);
    expect(await attemptsRepository.listForPuzzle(`${game.id}:9`)).toEqual([]);
    // The engine cache is position-keyed and shared — never purged.
    expect(await cache.count()).toBe(1);
    // Another game's derived rows are untouched.
    expect(await gamesRepository.hasGame(other.id)).toBe(true);
    expect(await summariesRepository.getForAnalysis(otherJob.id)).toBeDefined();
    expect(
      await puzzleCandidatesRepository.listForGameAndAnalysis(other.id, otherJob.id),
    ).toHaveLength(1);
    expect(await puzzlesRepository.countForGame(other.id)).toBe(1);
    expect((await attemptsRepository.listForCycle('cycle:other')).map((a) => a.puzzleId)).toEqual([
      `${other.id}:1`,
    ]);

    // Feature-013 membership cleanup: the deleted game's puzzle ids are
    // stripped from every set, the foreign id survives, and the other set is
    // untouched.
    expect((await trainingSetsRepository.get('set:deleted-game'))?.puzzleIds).toEqual([
      foreignPuzzleId,
    ]);
    expect((await trainingSetsRepository.get('set:other-game'))?.puzzleIds).toEqual([
      foreignPuzzleId,
    ]);
    // Cycle snapshots are immutable and survive a game deletion (missing
    // snapshot puzzles are terminal at presentation time).
    expect(await trainingCyclesRepository.listForSet('set:deleted-game')).toHaveLength(1);
    // No attempt orphan remains: every stored attempt still references an
    // existing puzzle row.
    const storedPuzzles = new Set(
      (await db.puzzles.toArray()).map((p) => puzzleIdOf(p.sourceGameId, p.sourcePly)),
    );
    for (const attempt of await db.puzzleAttempts.toArray()) {
      expect(storedPuzzles.has(attempt.puzzleId)).toBe(true);
    }
    expect(await attemptsRepository.listForPuzzle(deletedPuzzleIds[0]!)).toEqual([]);

    // Feature-020: schedule rows cascade by puzzle id; the foreign row
    // survives and no orphan schedule row remains.
    expect(await reviewSchedulesRepository.get(deletedPuzzleIds[0]!)).toBeUndefined();
    expect(await reviewSchedulesRepository.get(deletedPuzzleIds[1]!)).toBeUndefined();
    expect(await reviewSchedulesRepository.get(foreignPuzzleId)).toBeDefined();
    for (const row of await db.puzzleSchedules.toArray()) {
      expect(storedPuzzles.has(row.puzzleId)).toBe(true);
    }
  });
});
