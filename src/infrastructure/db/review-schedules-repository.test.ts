import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './database';
import { reviewSchedulesRepository } from './review-schedules-repository';
import { puzzleScheduleRowFixture } from '@/domain/review/test-support';

const NOW = 1_700_000_000_000;

describe('review schedules repository', () => {
  beforeEach(async () => {
    await db.puzzleSchedules.clear();
  });

  it('puts and gets a row by puzzleId', async () => {
    const row = puzzleScheduleRowFixture({ puzzleId: 'p:a', dueAt: NOW });
    await reviewSchedulesRepository.put(row);
    expect(await reviewSchedulesRepository.get('p:a')).toEqual(row);
    expect(await reviewSchedulesRepository.get('p:missing')).toBeUndefined();
  });

  it('bulkPut inserts many rows', async () => {
    await reviewSchedulesRepository.bulkPut([
      puzzleScheduleRowFixture({ puzzleId: 'p:a' }),
      puzzleScheduleRowFixture({ puzzleId: 'p:b' }),
    ]);
    expect((await reviewSchedulesRepository.listAll()).map((row) => row.puzzleId)).toEqual([
      'p:a',
      'p:b',
    ]);
    await reviewSchedulesRepository.bulkPut([]);
    expect(await db.puzzleSchedules.count()).toBe(2);
  });

  it('listDue returns rows with dueAt <= now in dueAt order, bounded by limit', async () => {
    await reviewSchedulesRepository.bulkPut([
      puzzleScheduleRowFixture({ puzzleId: 'p:late', dueAt: NOW - 1 }),
      puzzleScheduleRowFixture({ puzzleId: 'p:early', dueAt: NOW - 100 }),
      puzzleScheduleRowFixture({ puzzleId: 'p:future', dueAt: NOW + 1 }),
    ]);
    const due = await reviewSchedulesRepository.listDue(NOW, 10);
    expect(due.map((row) => row.puzzleId)).toEqual(['p:early', 'p:late']);
    expect((await reviewSchedulesRepository.listDue(NOW, 1)).map((row) => row.puzzleId)).toEqual([
      'p:early',
    ]);
    expect(await reviewSchedulesRepository.listDue(NOW, 0)).toEqual([]);
  });

  it('countDue counts the true backlog', async () => {
    await reviewSchedulesRepository.bulkPut([
      puzzleScheduleRowFixture({ puzzleId: 'p:a', dueAt: NOW - 1 }),
      puzzleScheduleRowFixture({ puzzleId: 'p:b', dueAt: NOW - 2 }),
      puzzleScheduleRowFixture({ puzzleId: 'p:c', dueAt: NOW + 5 }),
    ]);
    expect(await reviewSchedulesRepository.countDue(NOW)).toBe(2);
  });

  it('listByPuzzleIds hydrates a bounded subset', async () => {
    await reviewSchedulesRepository.bulkPut([
      puzzleScheduleRowFixture({ puzzleId: 'p:a' }),
      puzzleScheduleRowFixture({ puzzleId: 'p:b' }),
    ]);
    expect(
      (await reviewSchedulesRepository.listByPuzzleIds(['p:a', 'p:missing'])).map(
        (row) => row.puzzleId,
      ),
    ).toEqual(['p:a']);
    expect(await reviewSchedulesRepository.listByPuzzleIds([])).toEqual([]);
  });

  it('deleteForPuzzleIds removes only the given puzzles', async () => {
    await reviewSchedulesRepository.bulkPut([
      puzzleScheduleRowFixture({ puzzleId: 'p:a' }),
      puzzleScheduleRowFixture({ puzzleId: 'p:b' }),
    ]);
    await reviewSchedulesRepository.deleteForPuzzleIds(['p:a']);
    expect(await reviewSchedulesRepository.get('p:a')).toBeUndefined();
    expect(await reviewSchedulesRepository.get('p:b')).toBeDefined();
    await reviewSchedulesRepository.deleteForPuzzleIds([]);
    expect(await db.puzzleSchedules.count()).toBe(1);
  });

  it('deleteStale removes rows under an older version', async () => {
    await reviewSchedulesRepository.bulkPut([
      puzzleScheduleRowFixture({ puzzleId: 'p:current', scheduleVersion: 2 }),
      puzzleScheduleRowFixture({ puzzleId: 'p:stale', scheduleVersion: 1 }),
    ]);
    await reviewSchedulesRepository.deleteStale(2, 1);
    expect(await reviewSchedulesRepository.get('p:stale')).toBeUndefined();
    expect(await reviewSchedulesRepository.get('p:current')).toBeDefined();
  });

  it('deleteNotInPuzzleIds drops orphan rows', async () => {
    await reviewSchedulesRepository.bulkPut([
      puzzleScheduleRowFixture({ puzzleId: 'p:keep' }),
      puzzleScheduleRowFixture({ puzzleId: 'p:orphan' }),
    ]);
    await reviewSchedulesRepository.deleteNotInPuzzleIds(['p:keep']);
    expect(await reviewSchedulesRepository.get('p:orphan')).toBeUndefined();
    expect(await reviewSchedulesRepository.get('p:keep')).toBeDefined();
  });
});
