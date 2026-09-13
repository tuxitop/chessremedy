import { describe, expect, it } from 'vitest';
import { cycleFixture } from '@/domain/training/test-support';
import { normalizeTrainingCycleNumbers } from './cycleNumbers';

describe('normalizeTrainingCycleNumbers', () => {
  it('returns non-conflicting cycles by reference', () => {
    const a = cycleFixture({ id: 'a', trainingSetId: 'set-1', cycleNumber: 1 });
    const b = cycleFixture({ id: 'b', trainingSetId: 'set-1', cycleNumber: 2 });
    const result = normalizeTrainingCycleNumbers([a, b]);
    expect(result).toHaveLength(2);
    expect(result).toContain(a);
    expect(result).toContain(b);
  });

  it('keeps the most recently updated row on the contested number', () => {
    const older = cycleFixture({
      id: 'older',
      trainingSetId: 'set-1',
      cycleNumber: 1,
      updatedAt: 10,
    });
    const newer = cycleFixture({
      id: 'newer',
      trainingSetId: 'set-1',
      cycleNumber: 1,
      updatedAt: 20,
    });

    const result = normalizeTrainingCycleNumbers([older, newer]);
    const numbers = new Map(result.map((row) => [row.id, row.cycleNumber]));

    expect(numbers.get('newer')).toBe(1);
    expect(numbers.get('older')).toBe(2);
    // No row lost and the pair is now unique.
    expect(new Set(result.map((row) => row.cycleNumber)).size).toBe(2);
  });

  it('breaks an updatedAt tie by the lower id and renumbers above the set maximum', () => {
    const first = cycleFixture({ id: 'aaa', trainingSetId: 'set-1', cycleNumber: 3, updatedAt: 5 });
    const second = cycleFixture({
      id: 'bbb',
      trainingSetId: 'set-1',
      cycleNumber: 3,
      updatedAt: 5,
    });
    const later = cycleFixture({ id: 'ccc', trainingSetId: 'set-1', cycleNumber: 4, updatedAt: 1 });

    const result = normalizeTrainingCycleNumbers([first, second, later]);
    const numbers = new Map(result.map((row) => [row.id, row.cycleNumber]));

    expect(numbers.get('aaa')).toBe(3);
    expect(numbers.get('bbb')).toBe(5);
    expect(numbers.get('ccc')).toBe(4);
  });

  it('renumbers every loser of a three-way collision deterministically', () => {
    const rows = [
      cycleFixture({ id: 'c1', trainingSetId: 'set-1', cycleNumber: 2, updatedAt: 30 }),
      cycleFixture({ id: 'c2', trainingSetId: 'set-1', cycleNumber: 2, updatedAt: 20 }),
      cycleFixture({ id: 'c3', trainingSetId: 'set-1', cycleNumber: 2, updatedAt: 10 }),
    ];

    const result = normalizeTrainingCycleNumbers(rows);
    const numbers = new Map(result.map((row) => [row.id, row.cycleNumber]));

    expect(numbers.get('c1')).toBe(2);
    expect(numbers.get('c2')).toBe(3);
    expect(numbers.get('c3')).toBe(4);
    expect(new Set(result.map((row) => row.cycleNumber)).size).toBe(3);
  });

  it('treats the same number on different sets as non-conflicting', () => {
    const a = cycleFixture({ id: 'a', trainingSetId: 'set-1', cycleNumber: 1 });
    const b = cycleFixture({ id: 'b', trainingSetId: 'set-2', cycleNumber: 1 });

    const result = normalizeTrainingCycleNumbers([a, b]);
    expect(result).toContain(a);
    expect(result).toContain(b);
  });

  it('does not mutate the input rows', () => {
    const older = cycleFixture({ id: 'older', trainingSetId: 'set-1', cycleNumber: 1 });
    const newer = cycleFixture({
      id: 'newer',
      trainingSetId: 'set-1',
      cycleNumber: 1,
      updatedAt: 99,
    });

    normalizeTrainingCycleNumbers([older, newer]);

    expect(older.cycleNumber).toBe(1);
    expect(newer.cycleNumber).toBe(1);
  });
});
