/**
 * Feature 014 Stage D — StatisticsService tests.
 *
 * Real Dexie over fake-indexeddb (shared test setup) with a deterministic
 * injected clock. Covers eligible-analysis selection, fixture exclusion,
 * diagnostics, dimension partitions, accuracy/trend/rating reads, training
 * reads, memo hit/miss, injected backfill and the Worker-vs-inline seam. No
 * engine, no network.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalysisJob } from '@/domain/analysis/job';
import { puzzleIdOf } from '@/domain/puzzle/id';
import { blunderRowFixture, puzzleRowFixture } from '@/domain/puzzle/test-support';
import { moveAnalysis } from '@/domain/statistics/fixtures/builders';
import { DETECTION_VERSION } from '@/domain/tactics/types';
import { cycleAttemptFixture, cycleFixture, setFixture } from '@/domain/training/test-support';
import { analysisJobsRepository } from '@/infrastructure/db/analysis-jobs-repository';
import { analysesRepository } from '@/infrastructure/db/analysis-repository';
import { attemptsRepository } from '@/infrastructure/db/attempts-repository';
import { db } from '@/infrastructure/db/database';
import { gamesRepository, type GameRow } from '@/infrastructure/db/games-repository';
import { puzzlesRepository } from '@/infrastructure/db/puzzles-repository';
import {
  summariesRepository,
  type AnalysisSummaryRow,
} from '@/infrastructure/db/summaries-repository';
import { trainingCyclesRepository } from '@/infrastructure/db/training-cycles-repository';
import { trainingSetsRepository } from '@/infrastructure/db/training-sets-repository';
import {
  StatisticsService,
  type StatisticsServiceOptions,
  type StatisticsServiceQuery,
} from './statistics-service';
import { createInlineStatisticsCompute } from './worker-client';
import type { StatisticsCompute } from './worker-protocol';

const NOW = Date.parse('2026-09-15T12:00:00.000Z');

function gameRow(overrides: Partial<GameRow> = {}): GameRow {
  return {
    id: 'lichess:g1',
    source: 'lichess',
    externalId: 'g1',
    playedAt: '2026-09-01T12:00:00.000Z',
    whitePlayer: { name: 'me', rating: 1500 },
    blackPlayer: { name: 'opp', rating: 1400 },
    result: '1-0',
    timeControl: '600+0',
    normalizedTimeControl: 'rapid',
    userColor: 'white',
    pgn: '1. e4 e5 *',
    moveCount: 2,
    termination: null,
    importedAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function jobRow(overrides: Partial<AnalysisJob> = {}): AnalysisJob {
  return {
    id: 'a1',
    gameId: 'lichess:g1',
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
    updatedAt: 1,
    startedAt: 1,
    completedAt: 1,
    ...overrides,
  };
}

function summaryRow(overrides: Partial<AnalysisSummaryRow> = {}): AnalysisSummaryRow {
  return {
    analysisId: 'a1',
    gameId: 'lichess:g1',
    userColor: 'white',
    classificationCounts: { best: 10, good: 15, inaccuracy: 2, mistake: 1, blunder: 1 },
    userMoves: 30,
    totalMoves: 60,
    accuracy: 90,
    accuracyMoves: 30,
    detectionState: 'completed',
    missedTacticCount: 0,
    detectionVersion: DETECTION_VERSION,
    updatedAt: 1,
    ...overrides,
  };
}

function makeService(overrides: Partial<StatisticsServiceOptions> = {}): StatisticsService {
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
    ...overrides,
  });
}

function query(overrides: Partial<StatisticsServiceQuery> = {}): StatisticsServiceQuery {
  return {
    platform: 'all',
    timeControl: 'all',
    side: 'all',
    result: 'all',
    dateRange: { preset: 'all' },
    now: NOW,
    ...overrides,
  };
}

async function seedGame(overrides: Partial<GameRow> = {}): Promise<GameRow> {
  const row = gameRow(overrides);
  await db.games.put(row);
  return row;
}

async function seedJob(overrides: Partial<AnalysisJob> = {}): Promise<AnalysisJob> {
  const row = jobRow(overrides);
  await db.analysisJobs.put(row);
  return row;
}

async function seedSummary(
  overrides: Partial<AnalysisSummaryRow> = {},
): Promise<AnalysisSummaryRow> {
  const row = summaryRow(overrides);
  await db.analysisSummaries.put(row);
  return row;
}

function countingCompute(): { readonly compute: StatisticsCompute; readonly calls: () => number } {
  const inline = createInlineStatisticsCompute();
  let calls = 0;
  return {
    compute: {
      compute: (request) => {
        calls += 1;
        return inline.compute(request);
      },
    },
    calls: () => calls,
  };
}

describe('StatisticsService', () => {
  beforeEach(async () => {
    await db.games.clear();
    await db.analysisJobs.clear();
    await db.analysisSummaries.clear();
    await db.analyses.clear();
    await db.puzzles.clear();
    await db.puzzleAttempts.clear();
    await db.trainingSets.clear();
    await db.trainingCycles.clear();
  });

  it('selects the latest completed analysis and keeps history during a pending re-analysis', async () => {
    await seedGame({ id: 'lichess:g1' });
    await seedJob({ id: 'a1', gameId: 'lichess:g1', state: 'completed', updatedAt: 1 });
    await seedSummary({ analysisId: 'a1', gameId: 'lichess:g1', accuracy: 70, accuracyMoves: 10 });
    await seedJob({ id: 'a2', gameId: 'lichess:g1', state: 'completed', updatedAt: 2 });
    await seedSummary({ analysisId: 'a2', gameId: 'lichess:g1', accuracy: 95, accuracyMoves: 20 });
    await seedJob({ id: 'a3', gameId: 'lichess:g1', state: 'queued', updatedAt: 3 });

    const result = await makeService().gameMetrics(query());

    if (!result.ok) throw new Error('expected ok');
    expect(result.result.partitions).toHaveLength(1);
    const partition = result.result.partitions[0]!;
    expect(partition.entries[0]!.analysisId).toBe('a2');
    expect(partition.entries[0]!.accuracy).toBe(95);
    expect(partition.metrics.games.analyzed).toBe(1);
    expect(result.result.diagnostics.pendingAnalysis).toBe(1);
  });

  it('excludes a game whose latest completed analysis has no summary and counts it', async () => {
    await seedGame({ id: 'lichess:g1' });
    await seedJob({ id: 'a1', gameId: 'lichess:g1', state: 'completed' });

    const result = await makeService().gameMetrics(query());

    if (!result.ok) throw new Error('expected ok');
    expect(result.result.partitions[0]!.metrics.games.analyzed).toBe(0);
    expect(result.result.diagnostics.missingSummary).toBe(1);
  });

  it('excludes fixture sources from production results unless opted in', async () => {
    await seedGame({ id: 'fixture:g1', source: 'fixture', externalId: null });
    await seedJob({ id: 'fa1', gameId: 'fixture:g1', state: 'completed' });
    await seedSummary({ analysisId: 'fa1', gameId: 'fixture:g1' });

    const excluded = await makeService().gameMetrics(query());
    if (!excluded.ok) throw new Error('expected ok');
    expect(excluded.result.partitions).toEqual([]);

    const included = await makeService({ includeFixtureSources: true }).gameMetrics(query());
    if (!included.ok) throw new Error('expected ok');
    expect(included.result.partitions[0]!.metrics.games.total).toBe(1);
  });

  it('returns dimensioned partitions and never silently merges', async () => {
    await seedGame({ id: 'l-blitz', source: 'lichess', normalizedTimeControl: 'blitz' });
    await seedGame({ id: 'l-rapid', source: 'lichess', normalizedTimeControl: 'rapid' });
    await seedGame({ id: 'c-rapid', source: 'chesscom', normalizedTimeControl: 'rapid' });

    const all = await makeService().gameMetrics(query());
    if (!all.ok) throw new Error('expected ok');
    expect(all.result.partitions.map((p) => `${p.platform}/${p.timeControl}`)).toEqual([
      'lichess/blitz',
      'lichess/rapid',
      'chesscom/rapid',
    ]);
    expect(all.result.partitions.every((p) => p.combined === false)).toBe(true);

    const rapid = await makeService().gameMetrics(query({ timeControl: 'rapid' }));
    if (!rapid.ok) throw new Error('expected ok');
    expect(rapid.result.partitions.map((p) => `${p.platform}/${p.timeControl}`)).toEqual([
      'lichess/rapid',
      'chesscom/rapid',
    ]);
  });

  it('aggregates accuracy as the ADR-024 move-weighted mean', async () => {
    await seedGame({ id: 'lichess:g1' });
    await seedJob({ id: 'a1', gameId: 'lichess:g1', state: 'completed' });
    await seedSummary({ analysisId: 'a1', gameId: 'lichess:g1', accuracy: 90, accuracyMoves: 10 });
    await seedGame({ id: 'lichess:g2' });
    await seedJob({ id: 'a2', gameId: 'lichess:g2', state: 'completed' });
    await seedSummary({ analysisId: 'a2', gameId: 'lichess:g2', accuracy: 80, accuracyMoves: 30 });

    const result = await makeService().gameMetrics(query());

    if (!result.ok) throw new Error('expected ok');
    const accuracy = result.result.partitions[0]!.metrics.accuracy;
    expect(accuracy.value).toBeCloseTo(82.5);
    expect(accuracy.weightMoves).toBe(40);
    expect(accuracy.sample.n).toBe(2);
  });

  it('emits every trend period with explicit empty gaps', async () => {
    await seedGame({ id: 'lichess:w1', playedAt: '2026-08-31T12:00:00.000Z' });
    await seedGame({ id: 'lichess:w2', playedAt: '2026-09-07T12:00:00.000Z' });
    await seedGame({ id: 'lichess:w4', playedAt: '2026-09-21T12:00:00.000Z' });

    const result = await makeService().trendSeries('gamesPlayed', query(), {
      granularity: 'week',
    });

    if (!result.ok) throw new Error('expected ok');
    expect(result.result.series).toHaveLength(1);
    const points = result.result.series[0]!.points;
    expect(points.length).toBeGreaterThanOrEqual(3);
    expect(points.some((point) => point.state === 'empty')).toBe(true);
    const keys = points.map((point) => point.periodKey);
    expect([...keys].sort()).toEqual(keys);
  });

  it('keeps rating histories separate per platform/time control and skips null ratings', async () => {
    await seedGame({
      id: 'l1',
      source: 'lichess',
      normalizedTimeControl: 'rapid',
      whitePlayer: { name: 'me', rating: 2000 },
    });
    await seedGame({
      id: 'c1',
      source: 'chesscom',
      normalizedTimeControl: 'rapid',
      whitePlayer: { name: 'me', rating: 1500 },
    });
    await seedGame({
      id: 'l2',
      source: 'lichess',
      normalizedTimeControl: 'rapid',
      whitePlayer: { name: 'me', rating: null },
    });

    const result = await makeService().ratingHistories(query());

    if (!result.ok) throw new Error('expected ok');
    expect(result.result.histories.map((h) => `${h.platform}/${h.timeControl}`)).toEqual([
      'lichess/rapid',
      'chesscom/rapid',
    ]);
    const lichess = result.result.histories.find((h) => h.platform === 'lichess')!;
    expect(lichess.points).toHaveLength(1);
    expect(lichess.points[0]!.rating).toBe(2000);
  });

  it('computes per-phase metrics from eligible analyses only', async () => {
    await seedGame({ id: 'lichess:g1' });
    await seedJob({ id: 'a1', gameId: 'lichess:g1', state: 'completed' });
    await seedSummary({ analysisId: 'a1', gameId: 'lichess:g1' });
    await analysesRepository.replaceAnalysis([
      moveAnalysis({
        analysisId: 'a1',
        gameId: 'lichess:g1',
        ply: 0,
        side: 'white',
        gamePhase: 'opening',
        classification: 'blunder',
      }),
      moveAnalysis({
        analysisId: 'a1',
        gameId: 'lichess:g1',
        ply: 2,
        side: 'white',
        gamePhase: 'opening',
        classification: 'best',
      }),
      moveAnalysis({
        analysisId: 'a1',
        gameId: 'lichess:g1',
        ply: 4,
        side: 'white',
        gamePhase: 'middlegame',
        classification: 'mistake',
        missedTactic: true,
      }),
      moveAnalysis({
        analysisId: 'a1',
        gameId: 'lichess:g1',
        ply: 1,
        side: 'black',
        gamePhase: 'opening',
        classification: 'blunder',
      }),
    ]);

    const result = await makeService().phaseMetrics(query());

    if (!result.ok) throw new Error('expected ok');
    expect(result.result.partitions).toHaveLength(1);
    const phases = result.result.partitions[0]!.phases;
    const opening = phases.find((phase) => phase.phase === 'opening')!;
    expect(opening.userMovesInPhase).toBe(2);
    expect(opening.counts.blunders.value).toBe(1);
    const middlegame = phases.find((phase) => phase.phase === 'middlegame')!;
    expect(middlegame.userMovesInPhase).toBe(1);
    expect(middlegame.counts.missedTactics.value).toBe(1);
  });

  it('reads training set stats, weakest categories, repeated failures and mastered counts', async () => {
    const tactical = puzzleRowFixture('mate-one');
    const blunder = blunderRowFixture('correct-move');
    const tacticalId = puzzleIdOf(tactical.sourceGameId, tactical.sourcePly);
    const blunderId = puzzleIdOf(blunder.sourceGameId, blunder.sourcePly);
    await puzzlesRepository.addIfAbsent([tactical, blunder]);

    const setId = 'set:one';
    const puzzleIds = [tacticalId, blunderId];
    await trainingSetsRepository.create(setFixture({ id: setId, puzzleIds }));
    for (const [index, cycleId] of ['c1', 'c2', 'c3'].entries()) {
      await trainingCyclesRepository.create(
        cycleFixture({
          id: cycleId,
          trainingSetId: setId,
          cycleNumber: index + 1,
          puzzleIds,
        }),
      );
    }
    for (const cycleId of ['c1', 'c2', 'c3']) {
      await attemptsRepository.addAttempt(
        cycleAttemptFixture({
          cycleId,
          trainingSetId: setId,
          puzzleId: tacticalId,
          presentationIndex: 1,
          result: 'solvedFirstTry',
        }),
      );
    }
    for (const cycleId of ['c1', 'c2']) {
      await attemptsRepository.addAttempt(
        cycleAttemptFixture({
          cycleId,
          trainingSetId: setId,
          puzzleId: blunderId,
          presentationIndex: 1,
          result: 'failed',
        }),
      );
    }

    const service = makeService();

    const stats = await service.trainingSetStats(setId);
    if (!stats.ok) throw new Error('expected ok');
    expect(stats.result.puzzleCount).toBe(2);
    expect(stats.result.cycles).toHaveLength(3);

    const categories = await service.weakestCategories(setId);
    if (!categories.ok) throw new Error('expected ok');
    expect(categories.result.map((category) => category.category).sort()).toEqual([
      'blunder',
      'forcing_mate',
    ]);

    const repeated = await service.repeatedlyFailed(setId);
    if (!repeated.ok) throw new Error('expected ok');
    expect(repeated.result).toHaveLength(1);
    expect(repeated.result[0]!.puzzleId).toBe(blunderId);
    expect(repeated.result[0]!.failureCount).toBe(2);
    expect(repeated.result[0]!.cycleCount).toBe(2);

    const mastered = await service.masteredPuzzleCounts([tactical.sourceGameId]);
    if (!mastered.ok) throw new Error('expected ok');
    expect(mastered.result.get(tactical.sourceGameId)?.value).toBe(1);

    const none = await service.masteredPuzzleCounts(['fixture:none']);
    if (!none.ok) throw new Error('expected ok');
    expect(none.result.get('fixture:none')?.state).toBe('empty');
  });

  it('reports a missing training set as a typed not-found', async () => {
    const result = await makeService().trainingSetStats('set:missing');
    expect(result).toEqual({ ok: false, reason: 'not-found' });
  });

  it('memoizes by (queryKey, dataVersionKey) and never depends on the cache', async () => {
    await seedGame({ id: 'lichess:g1' });
    await seedJob({ id: 'a1', gameId: 'lichess:g1', state: 'completed' });
    await seedSummary({ analysisId: 'a1', gameId: 'lichess:g1' });

    const { compute, calls } = countingCompute();
    const service = makeService({ worker: compute, workerRowThreshold: 0 });

    const first = await service.gameMetrics(query(), { dataVersionKey: 'v1' });
    expect(calls()).toBe(1);
    const second = await service.gameMetrics(query(), { dataVersionKey: 'v1' });
    expect(calls()).toBe(1);
    expect(second).toEqual(first);

    await service.gameMetrics(query(), { dataVersionKey: 'v2' });
    expect(calls()).toBe(2);

    await service.gameMetrics(query());
    await service.gameMetrics(query());
    expect(calls()).toBe(4);
  });

  it('falls back inline when the worker errors or throws', async () => {
    await seedGame({ id: 'lichess:g1' });
    await seedJob({ id: 'a1', gameId: 'lichess:g1', state: 'completed' });
    await seedSummary({ analysisId: 'a1', gameId: 'lichess:g1' });

    const erroring: StatisticsCompute = {
      compute: async (request) => ({ id: request.id, ok: false, error: 'nope' }),
    };
    const errorResult = await makeService({ worker: erroring, workerRowThreshold: 0 }).gameMetrics(
      query(),
    );
    expect(errorResult.ok).toBe(true);

    const throwing: StatisticsCompute = {
      compute: async () => {
        throw new Error('transport down');
      },
    };
    const throwResult = await makeService({ worker: throwing, workerRowThreshold: 0 }).gameMetrics(
      query(),
    );
    if (!throwResult.ok) throw new Error('expected ok');
    expect(throwResult.result.partitions).toHaveLength(1);
  });

  it('invokes the injected backfill and counts created summaries', async () => {
    await seedGame({ id: 'lichess:g1' });
    await seedJob({ id: 'a1', gameId: 'lichess:g1', state: 'completed' });
    const ensure = vi.fn(async () => {
      await seedSummary({ analysisId: 'a1', gameId: 'lichess:g1' });
      return 1;
    });
    const service = makeService({ ensureSummariesForRows: ensure });

    const result = await service.gameMetrics(query(), { backfill: true });

    expect(ensure).toHaveBeenCalledWith(['lichess:g1']);
    if (!result.ok) throw new Error('expected ok');
    expect(result.result.diagnostics.backfillCreated).toBe(1);
    expect(result.result.diagnostics.missingSummary).toBe(0);
    expect(result.result.partitions[0]!.metrics.games.analyzed).toBe(1);
  });

  it('swallows a backfill failure and counts it', async () => {
    await seedGame({ id: 'lichess:g1' });
    await seedJob({ id: 'a1', gameId: 'lichess:g1', state: 'completed' });
    const service = makeService({
      ensureSummariesForRows: async () => {
        throw new Error('backfill down');
      },
    });

    const result = await service.gameMetrics(query(), { backfill: true });

    if (!result.ok) throw new Error('expected ok');
    expect(result.result.diagnostics.backfillFailures).toBe(1);
    expect(result.result.diagnostics.missingSummary).toBe(1);
  });

  it('returns a typed error for a malformed or reversed date range', async () => {
    const service = makeService();

    const malformed = await service.gameMetrics(
      query({ dateRange: { preset: 'custom', from: '2026-13-01', to: '2026-01-01' } }),
    );
    expect(malformed).toEqual({
      ok: false,
      reason: 'invalid-date-range',
      message: 'Invalid date — use yyyy-mm-dd.',
    });

    const reversed = await service.gameMetrics(
      query({ dateRange: { preset: 'custom', from: '2026-09-10', to: '2026-09-01' } }),
    );
    expect(reversed.ok).toBe(false);
    if (reversed.ok) return;
    expect(reversed.reason).toBe('invalid-date-range');
  });
});
