import { describe, expect, it } from 'vitest';
import { puzzleIdOf } from '@/domain/puzzle/id';
import { cycleFixture } from '@/domain/training/test-support';
import { dayUsageOf } from './dayUsage';
import { reviewAttemptFixture, reviewCycleFixture } from './test-support';

const NOW = new Date(2023, 10, 14, 12, 0, 0).getTime();
const DAY_MS = 24 * 60 * 60 * 1000;

const PUZZLE_A = puzzleIdOf('fixture:a', 1);
const PUZZLE_B = puzzleIdOf('fixture:b', 2);

describe('dayUsageOf (Feature 020 §Day usage)', () => {
  it('classifies a first-ever puzzle as new and a previously-graded puzzle as review', () => {
    const todayCycle = reviewCycleFixture({ id: 'review:today', startedAt: NOW - 3_600_000 });
    const priorCycle = cycleFixture({
      id: 'set:prior',
      trainingSetId: 'set:1',
      startedAt: NOW - 2 * DAY_MS,
    });
    const attempts = [
      reviewAttemptFixture({
        puzzleId: PUZZLE_A,
        cycleId: priorCycle.id,
        endedAt: NOW - 2 * DAY_MS,
      }),
      reviewAttemptFixture({
        puzzleId: PUZZLE_A,
        cycleId: todayCycle.id,
        endedAt: NOW - 3_500_000,
      }),
      reviewAttemptFixture({
        puzzleId: PUZZLE_B,
        cycleId: todayCycle.id,
        endedAt: NOW - 3_400_000,
      }),
    ];
    const usage = dayUsageOf({ cycles: [todayCycle, priorCycle], attempts, now: NOW });
    expect(usage).toEqual({ newCount: 1, reviewCount: 1 });
  });

  it('counts a puzzle presented in several today sessions once', () => {
    const first = reviewCycleFixture({ id: 'review:first', startedAt: NOW - 4 * 3_600_000 });
    const second = reviewCycleFixture({ id: 'review:second', startedAt: NOW - 3_600_000 });
    const attempts = [
      reviewAttemptFixture({
        puzzleId: PUZZLE_A,
        cycleId: first.id,
        endedAt: NOW - 4 * 3_600_000 + 1,
      }),
      reviewAttemptFixture({ puzzleId: PUZZLE_A, cycleId: second.id, endedAt: NOW - 3_500_000 }),
    ];
    const usage = dayUsageOf({ cycles: [first, second], attempts, now: NOW });
    expect(usage).toEqual({ newCount: 1, reviewCount: 0 });
  });

  it('resets on the local calendar day boundary', () => {
    const yesterday = reviewCycleFixture({ id: 'review:yesterday', startedAt: NOW - DAY_MS });
    const attempts = [
      reviewAttemptFixture({
        puzzleId: PUZZLE_A,
        cycleId: yesterday.id,
        endedAt: NOW - DAY_MS + 1,
      }),
    ];
    expect(dayUsageOf({ cycles: [yesterday], attempts, now: NOW })).toEqual({
      newCount: 0,
      reviewCount: 0,
    });
  });

  it('counts a skip-only presentation as new (no gradeable history)', () => {
    const todayCycle = reviewCycleFixture({ id: 'review:today', startedAt: NOW - 3_600_000 });
    const attempts = [
      reviewAttemptFixture({
        puzzleId: PUZZLE_A,
        cycleId: todayCycle.id,
        result: 'skipped',
        endedAt: NOW - 3_500_000,
      }),
    ];
    expect(dayUsageOf({ cycles: [todayCycle], attempts, now: NOW })).toEqual({
      newCount: 1,
      reviewCount: 0,
    });
  });

  it('ignores attempts from non-review cycles for the day presentation set', () => {
    const setCycle = cycleFixture({
      id: 'set:today',
      trainingSetId: 'set:1',
      startedAt: NOW - 3_600_000,
    });
    const attempts = [
      reviewAttemptFixture({ puzzleId: PUZZLE_A, cycleId: setCycle.id, endedAt: NOW - 3_500_000 }),
    ];
    expect(dayUsageOf({ cycles: [setCycle], attempts, now: NOW })).toEqual({
      newCount: 0,
      reviewCount: 0,
    });
  });
});
