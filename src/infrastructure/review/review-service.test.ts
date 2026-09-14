import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/infrastructure/db/database';
import { attemptsRepository } from '@/infrastructure/db/attempts-repository';
import { puzzlesRepository } from '@/infrastructure/db/puzzles-repository';
import { trainingCyclesRepository } from '@/infrastructure/db/training-cycles-repository';
import { trainingSetsRepository } from '@/infrastructure/db/training-sets-repository';
import { reviewSchedulesRepository } from '@/infrastructure/db/review-schedules-repository';
import type { ReviewSchedulesRepository } from '@/infrastructure/db/review-schedules-repository';
import { settingsRepository } from '@/infrastructure/db/settings-repository';
import { SETTINGS_KEYS } from '@/config/app-config';
import { puzzleIdOf } from '@/domain/puzzle/id';
import { REVIEW_SET_ID, SCHEDULE_VERSION, type PuzzleScheduleRow } from '@/domain/review';
import {
  fakeScheduler,
  puzzleScheduleRowFixture,
  reviewAttemptFixture,
  reviewCycleFixture,
} from '@/domain/review/test-support';
import { cycleFixture } from '@/domain/training/test-support';
import { reviewPoolRowFixture } from '@/domain/review/test-support';
import { ReviewService } from './review-service';

const NOW = new Date(2023, 10, 14, 12, 0, 0).getTime();

const PUZZLE_A = reviewPoolRowFixture(1, 10);
const PUZZLE_B = reviewPoolRowFixture(2, 20);
const PUZZLE_C = reviewPoolRowFixture(3, 30);
const ID_A = puzzleIdOf(PUZZLE_A.sourceGameId, PUZZLE_A.sourcePly);
const ID_B = puzzleIdOf(PUZZLE_B.sourceGameId, PUZZLE_B.sourcePly);

function makeService(
  overrides: Partial<ConstructorParameters<typeof ReviewService>[0]> = {},
): ReviewService {
  return new ReviewService({
    cycles: trainingCyclesRepository,
    sets: trainingSetsRepository,
    puzzles: puzzlesRepository,
    attempts: attemptsRepository,
    schedules: reviewSchedulesRepository,
    settings: settingsRepository,
    scheduler: fakeScheduler,
    now: () => NOW,
    newId: () => 'review:new',
    ...overrides,
  });
}

describe('ReviewService (Feature 020 §Infrastructure)', () => {
  beforeEach(async () => {
    await db.puzzleSchedules.clear();
    await db.puzzles.clear();
    await db.puzzleAttempts.clear();
    await db.trainingCycles.clear();
    await db.trainingSets.clear();
    await db.settings.clear();
  });

  it('reports an empty overview with no fabricated retention', async () => {
    const service = makeService();
    const overview = await service.overview(NOW);
    expect(overview).toMatchObject({
      dueNow: 0,
      newCount: 0,
      retention: null,
      nextDueAt: null,
      pendingRebuild: 0,
    });
    expect(overview.queue).toEqual([]);
  });

  it('counts new intake under the daily cap and applies the stored caps', async () => {
    await puzzlesRepository.addIfAbsent([PUZZLE_A, PUZZLE_B, PUZZLE_C]);
    await settingsRepository.set(SETTINGS_KEYS.reviewDailyNewCap, 2);
    const service = makeService();
    const overview = await service.overview(NOW);
    expect(overview.newCount).toBe(2);
    expect(overview.queue).toHaveLength(2);
    expect(overview.caps.newCap).toBe(2);
  });

  it('reports due reviews and retention over the bounded set', async () => {
    await puzzlesRepository.addIfAbsent([PUZZLE_A]);
    await reviewSchedulesRepository.put(
      puzzleScheduleRowFixture({
        puzzleId: ID_A,
        dueAt: NOW - 1_000,
        lastReviewedAt: NOW - 2 * 24 * 60 * 60 * 1000,
        scheduledDays: 2,
        lastGrade: 'good',
      }),
    );
    const service = makeService();
    const overview = await service.overview(NOW);
    expect(overview.dueNow).toBe(1);
    expect(overview.queue.map((entry) => entry.puzzleId)).toEqual([ID_A]);
    expect(overview.retention).not.toBeNull();
    expect(overview.nextDueAt).toBeNull();
  });

  it('reports the earliest future due as nextDueAt', async () => {
    await puzzlesRepository.addIfAbsent([PUZZLE_A]);
    await reviewSchedulesRepository.put(
      puzzleScheduleRowFixture({ puzzleId: ID_A, dueAt: NOW + 5 * 86_400_000 }),
    );
    const service = makeService();
    expect((await service.overview(NOW)).nextDueAt).toBe(NOW + 5 * 86_400_000);
  });

  it('startSession snapshots the queue under REVIEW_SET_ID and abandons an in-progress review cycle', async () => {
    await puzzlesRepository.addIfAbsent([PUZZLE_A, PUZZLE_B]);
    await trainingCyclesRepository.create(
      reviewCycleFixture({ id: 'review:old', cycleNumber: 1, status: 'inProgress' }),
    );
    const service = makeService();
    const result = await service.startSession(NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.cycle.trainingSetId).toBe(REVIEW_SET_ID);
    expect(result.cycle.puzzleIds).toHaveLength(2);
    expect(result.cycle.config.retryFailed).toBe('none');
    expect(result.set.id).toBe(REVIEW_SET_ID);
    expect(result.puzzles.size).toBe(2);

    const old = await trainingCyclesRepository.get('review:old');
    expect(old?.status).toBe('abandoned');
  });

  it('startSession refuses an empty queue', async () => {
    const service = makeService();
    expect(await service.startSession(NOW)).toEqual({ ok: false, reason: 'empty-queue' });
  });

  it('applyOutcome writes one grade and reports the next due instant', async () => {
    await puzzlesRepository.addIfAbsent([PUZZLE_A]);
    const attempt = reviewAttemptFixture({
      puzzleId: ID_A,
      cycleId: 'review:new',
      endedAt: NOW,
      solvingTimeMs: 30_000,
    });
    await attemptsRepository.addAttempt(attempt);
    const service = makeService();
    const result = await service.applyOutcome(attempt);
    expect(result.applied).toBe(true);
    const row = await reviewSchedulesRepository.get(ID_A);
    expect(row).toBeDefined();
    expect(row!.lastGrade).toBe('good');
    expect(row!.lastReviewedAt).toBe(NOW);
    expect(result.nextDueAt).toBe(row!.dueAt);
  });

  it('applyOutcome applies no grade for a skipped presentation', async () => {
    await puzzlesRepository.addIfAbsent([PUZZLE_A]);
    const attempt = reviewAttemptFixture({ puzzleId: ID_A, result: 'skipped', endedAt: NOW });
    await attemptsRepository.addAttempt(attempt);
    const service = makeService();
    expect(await service.applyOutcome(attempt)).toEqual({ applied: false, nextDueAt: null });
    expect(await reviewSchedulesRepository.get(ID_A)).toBeUndefined();
  });

  it('applyOutcome never crashes on a schedule-write failure and reconcile repairs it', async () => {
    await puzzlesRepository.addIfAbsent([PUZZLE_A]);
    const attempt = reviewAttemptFixture({ puzzleId: ID_A, endedAt: NOW });
    await attemptsRepository.addAttempt(attempt);

    let failing = true;
    const flaky: ReviewSchedulesRepository = {
      get: (id) => reviewSchedulesRepository.get(id),
      put: async (row: PuzzleScheduleRow) => {
        if (failing) {
          throw new Error('disk full');
        }
        await reviewSchedulesRepository.put(row);
      },
      bulkPut: (rows) => reviewSchedulesRepository.bulkPut(rows),
      listDue: (now, limit) => reviewSchedulesRepository.listDue(now, limit),
      countDue: (now) => reviewSchedulesRepository.countDue(now),
      listAll: () => reviewSchedulesRepository.listAll(),
      listByPuzzleIds: (ids) => reviewSchedulesRepository.listByPuzzleIds(ids),
      deleteForPuzzleIds: (ids) => reviewSchedulesRepository.deleteForPuzzleIds(ids),
      deleteStale: (a, b) => reviewSchedulesRepository.deleteStale(a, b),
      deleteNotInPuzzleIds: (ids) => reviewSchedulesRepository.deleteNotInPuzzleIds(ids),
    };
    const service = makeService({ schedules: flaky });
    expect(await service.applyOutcome(attempt)).toEqual({ applied: false, nextDueAt: null });

    failing = false;
    const reconcile = await service.reconcile();
    expect(reconcile.rebuilt).toBe(1);
    expect(await reviewSchedulesRepository.get(ID_A)).toBeDefined();
  });

  it('reconcile drops orphan rows and rebuilds missing/stale/corrupt rows', async () => {
    await puzzlesRepository.addIfAbsent([PUZZLE_A, PUZZLE_B]);
    // A missing row for A (has a gradeable attempt).
    await attemptsRepository.addAttempt(
      reviewAttemptFixture({ puzzleId: ID_A, cycleId: 'review:new', endedAt: NOW }),
    );
    // A stale row for B.
    await reviewSchedulesRepository.put(
      puzzleScheduleRowFixture({
        puzzleId: ID_B,
        scheduleVersion: SCHEDULE_VERSION + 1,
        lastReviewedAt: NOW - 1_000,
      }),
    );
    // An orphan row for a puzzle that no longer exists.
    await reviewSchedulesRepository.put(puzzleScheduleRowFixture({ puzzleId: 'fixture:gone:9' }));

    const service = makeService();
    const result = await service.reconcile();
    expect(result.dropped).toBe(1);
    expect(result.rebuilt).toBe(1);
    expect(await reviewSchedulesRepository.get('fixture:gone:9')).toBeUndefined();
    const rebuiltA = await reviewSchedulesRepository.get(ID_A);
    expect(rebuiltA).toBeDefined();
    expect(rebuiltA!.scheduleVersion).toBe(SCHEDULE_VERSION);
  });

  it('rebuildPuzzle drops the row when there is no gradeable history', async () => {
    await puzzlesRepository.addIfAbsent([PUZZLE_A]);
    await reviewSchedulesRepository.put(puzzleScheduleRowFixture({ puzzleId: ID_A }));
    const service = makeService();
    expect(await service.rebuildPuzzle(ID_A)).toBeNull();
    expect(await reviewSchedulesRepository.get(ID_A)).toBeUndefined();
  });

  it('keeps a mastered puzzle out of intake but still reviews a due row', async () => {
    await puzzlesRepository.addIfAbsent([PUZZLE_A]);
    // Three distinct legitimate first-try cycles make A mastered.
    for (const [index, cycleId] of ['c1', 'c2', 'c3'].entries()) {
      await trainingCyclesRepository.create(
        cycleFixture({ id: cycleId, trainingSetId: 'set:1', cycleNumber: index + 1 }),
      );
      await attemptsRepository.addAttempt(
        reviewAttemptFixture({
          puzzleId: ID_A,
          cycleId,
          trainingSetId: 'set:1',
          result: 'solvedFirstTry',
          endedAt: NOW - 10 * 86_400_000 + index,
        }),
      );
    }
    await reviewSchedulesRepository.put(
      puzzleScheduleRowFixture({ puzzleId: ID_A, dueAt: NOW - 1 }),
    );
    const service = makeService();
    const overview = await service.overview(NOW);
    expect(overview.newCount).toBe(0);
    expect(overview.queue.map((entry) => entry.puzzleId)).toEqual([ID_A]);
  });
});
