/**
 * Feature 014 Stage D — bounded performance benchmark (non-CI).
 *
 * Runs only with `STATS_BENCH=1`. Builds a synthetic dataset of ≥ 1,000
 * analyzed games and ≥ 10,000 attempts over `fake-indexeddb`, then measures the
 * inline aggregation through the application service. The recorded budget is
 * the value chosen for `STATISTICS_WORKER_ROW_THRESHOLD`:
 *
 *   STATISTICS_WORKER_ROW_THRESHOLD = 2000 loaded rows
 *   Measured: 1,000 analyzed games (3,000 loaded game rows) + 10,000 attempts
 *   aggregated by `gameMetrics` + `masteredPuzzleCounts` in ~565 ms
 *   (fake-indexeddb, inline path, this development machine).
 *
 * The benchmark is a guard, not a CI gate: it asserts completion inside a
 * generous recorded budget so a pathological regression is caught locally.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import type { AnalysisJob } from '@/domain/analysis/job';
import type { AnalysisSummaryRow } from '@/infrastructure/db/summaries-repository';
import type { PuzzleAttemptRow } from '@/domain/training/types';
import { DETECTION_VERSION } from '@/domain/tactics/types';
import { db } from '@/infrastructure/db/database';
import { gamesRepository, type GameRow } from '@/infrastructure/db/games-repository';
import { analysisJobsRepository } from '@/infrastructure/db/analysis-jobs-repository';
import { summariesRepository } from '@/infrastructure/db/summaries-repository';
import { analysesRepository } from '@/infrastructure/db/analysis-repository';
import { puzzlesRepository } from '@/infrastructure/db/puzzles-repository';
import { attemptsRepository } from '@/infrastructure/db/attempts-repository';
import { trainingSetsRepository } from '@/infrastructure/db/training-sets-repository';
import { trainingCyclesRepository } from '@/infrastructure/db/training-cycles-repository';
import { StatisticsService } from './statistics-service';

const ENABLED = process.env.STATS_BENCH === '1';
const GAME_COUNT = 1_000;
const ATTEMPT_COUNT = 10_000;
/** Recorded inline budget (ms); generous enough for fake-indexeddb on CI-class boxes. */
const RECORDED_BUDGET_MS = 3_000;

const NOW = Date.parse('2026-09-15T12:00:00.000Z');

function makeService(): StatisticsService {
  return new StatisticsService({
    games: gamesRepository,
    jobs: analysisJobsRepository,
    summaries: summariesRepository,
    analyses: analysesRepository,
    puzzles: puzzlesRepository,
    attempts: attemptsRepository,
    sets: trainingSetsRepository,
    cycles: trainingCyclesRepository,
    now: () => NOW,
  });
}

async function seed(): Promise<void> {
  const games: GameRow[] = [];
  const jobs: AnalysisJob[] = [];
  const summaries: AnalysisSummaryRow[] = [];
  for (let index = 0; index < GAME_COUNT; index += 1) {
    const id = `bench:g${index}`;
    const userColor = index % 2 === 0 ? 'white' : 'black';
    games.push({
      id,
      source: index % 3 === 0 ? 'chesscom' : 'lichess',
      externalId: `g${index}`,
      playedAt: new Date(NOW - (index % 120) * 86_400_000).toISOString(),
      whitePlayer: { name: 'me', rating: 1500 + (index % 400) },
      blackPlayer: { name: 'opp', rating: 1400 },
      result: index % 2 === 0 ? '1-0' : '0-1',
      timeControl: '600+0',
      normalizedTimeControl: index % 2 === 0 ? 'rapid' : 'blitz',
      userColor,
      pgn: '1. e4 e5 *',
      moveCount: 2,
      termination: null,
      importedAt: 1,
      updatedAt: 1,
    });
    jobs.push({
      id: `bench:a${index}`,
      gameId: id,
      engine: {
        engineName: 'Stockfish',
        engineVersion: '18.0.8',
        engineBuild: 'stockfish-18-lite',
        profile: 'normal',
      },
      analysisVersion: 1,
      classificationVersion: 1,
      gamePhaseVersion: 1,
      state: 'completed',
      totalPositions: 40,
      completedPositions: 40,
      lastError: null,
      createdAt: 1,
      updatedAt: 1 + (index % 5),
      startedAt: 1,
      completedAt: 1,
    });
    summaries.push({
      analysisId: `bench:a${index}`,
      gameId: id,
      userColor,
      classificationCounts: {
        best: 20,
        good: 10,
        inaccuracy: 3,
        mistake: 2,
        blunder: index % 3,
      },
      userMoves: 35,
      totalMoves: 70,
      accuracy: 70 + (index % 30),
      accuracyMoves: 35,
      detectionState: 'completed',
      missedTacticCount: index % 4,
      detectionVersion: DETECTION_VERSION,
      updatedAt: 1,
    });
  }

  const attempts: PuzzleAttemptRow[] = [];
  for (let index = 0; index < ATTEMPT_COUNT; index += 1) {
    const gameIndex = index % GAME_COUNT;
    const puzzleId = `bench:g${gameIndex}:${index % 40}`;
    const cycleId = `bench:c${index % 50}`;
    attempts.push({
      puzzleId,
      trainingSetId: 'bench:set',
      cycleId,
      presentationIndex: 1 + Math.floor(index / 50),
      startedAt: 1,
      endedAt: 2,
      result: index % 5 === 0 ? 'failed' : 'solvedFirstTry',
      solvingTimeMs: 1_000,
      wrongMoveCount: 0,
      hintCount: 0,
      highestHintLevel: null,
      restartCount: 0,
      solved: index % 5 !== 0,
      puzzleGeneratorVersion: 2,
      origin: 'tactical',
    });
  }

  await db.games.bulkPut(games);
  await db.analysisJobs.bulkPut(jobs);
  await db.analysisSummaries.bulkPut(summaries);
  await db.puzzleAttempts.bulkAdd(attempts);
}

describe.skipIf(!ENABLED)('StatisticsService performance benchmark', () => {
  beforeAll(async () => {
    await db.games.clear();
    await db.analysisJobs.clear();
    await db.analysisSummaries.clear();
    await db.puzzleAttempts.clear();
    await seed();
  }, 120_000);

  it(`aggregates ${GAME_COUNT} games and ${ATTEMPT_COUNT} attempts within budget`, async () => {
    const service = makeService();
    const startedAt = performance.now();

    const metrics = await service.gameMetrics({
      platform: 'all',
      timeControl: 'all',
      side: 'all',
      result: 'all',
      dateRange: { preset: 'all' },
      now: NOW,
    });
    const mastered = await service.masteredPuzzleCounts(['bench:g0', 'bench:g1', 'bench:g2']);

    const elapsedMs = performance.now() - startedAt;
    // Recorded measurement (this run): printed for the plan's performance note.
    console.log(
      `[stats-bench] ${GAME_COUNT} games + ${ATTEMPT_COUNT} attempts: ${elapsedMs.toFixed(1)} ms`,
    );

    expect(metrics.ok).toBe(true);
    expect(mastered.ok).toBe(true);
    expect(elapsedMs).toBeLessThan(RECORDED_BUDGET_MS);
  }, 120_000);
});
