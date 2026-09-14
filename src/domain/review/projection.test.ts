import { describe, expect, it } from 'vitest';
import { SCHEDULE_VERSION, SCHEDULER_PARAMS_VERSION } from './constants';
import { gradeForAttempt } from './grade';
import {
  applyGrade,
  isScheduleCorrupt,
  isScheduleStale,
  scheduleFromHistory,
  scheduleRowFrom,
} from './projection';
import { DAY_MS, fakeScheduler, reviewAttemptFixture, scheduleStateFixture } from './test-support';

function chain() {
  const base = 1_700_000_000_000;
  return [
    reviewAttemptFixture({ puzzleId: 'p:1', endedAt: base, solvingTimeMs: 5_000 }),
    reviewAttemptFixture({
      puzzleId: 'p:1',
      endedAt: base + DAY_MS,
      solvingTimeMs: 20_000,
    }),
    reviewAttemptFixture({
      puzzleId: 'p:1',
      endedAt: base + 3 * DAY_MS,
      solvingTimeMs: 30_000,
      result: 'solvedWithHelp',
    }),
  ];
}

describe('scheduleFromHistory / applyGrade (Feature 020 §Projection)', () => {
  it('folds chronologically and equals the incremental path', () => {
    const attempts = chain();
    const full = scheduleFromHistory(fakeScheduler, attempts);
    expect(full).not.toBeNull();

    let incremental = fakeScheduler.initialState(attempts[0]!.endedAt);
    for (const attempt of attempts) {
      const grade = gradeForAttempt(attempt);
      expect(grade).not.toBeNull();
      incremental = applyGrade(fakeScheduler, incremental, grade!, attempt.endedAt);
    }
    expect(incremental).toEqual(full);
  });

  it('is insensitive to input order (sorts by endedAt then presentationIndex)', () => {
    const attempts = chain();
    const shuffled = [attempts[2]!, attempts[0]!, attempts[1]!];
    expect(scheduleFromHistory(fakeScheduler, shuffled)).toEqual(
      scheduleFromHistory(fakeScheduler, attempts),
    );
  });

  it('returns null for a skipped-only history', () => {
    expect(
      scheduleFromHistory(fakeScheduler, [
        reviewAttemptFixture({ result: 'skipped' }),
        reviewAttemptFixture({ result: 'skipped', presentationIndex: 2 }),
      ]),
    ).toBeNull();
  });

  it('returns null for an empty history', () => {
    expect(scheduleFromHistory(fakeScheduler, [])).toBeNull();
  });

  it('ignores skipped rows inside a gradeable history', () => {
    const base = 1_700_000_000_000;
    const withSkip = [
      reviewAttemptFixture({ puzzleId: 'p:1', endedAt: base }),
      reviewAttemptFixture({ puzzleId: 'p:1', endedAt: base + 1, result: 'skipped' }),
    ];
    expect(scheduleFromHistory(fakeScheduler, withSkip)).toEqual(
      scheduleFromHistory(fakeScheduler, [withSkip[0]!]),
    );
  });
});

describe('schedule staleness / corruption', () => {
  it('detects a version mismatch as stale', () => {
    const row = scheduleRowFrom(scheduleStateFixture(), 'p:1', 'good', 1);
    expect(isScheduleStale(row)).toBe(false);
    expect(isScheduleStale({ ...row, scheduleVersion: SCHEDULE_VERSION + 1 })).toBe(true);
    expect(isScheduleStale({ ...row, schedulerParamsVersion: SCHEDULER_PARAMS_VERSION + 1 })).toBe(
      true,
    );
  });

  it('detects malformed rows as corrupt', () => {
    expect(isScheduleCorrupt(scheduleStateFixture())).toBe(false);
    expect(isScheduleCorrupt({ ...scheduleStateFixture(), dueAt: Number.NaN })).toBe(true);
    expect(isScheduleCorrupt({ ...scheduleStateFixture(), state: 'nope' as never })).toBe(true);
    expect(
      isScheduleCorrupt({ ...scheduleStateFixture(), lastReviewedAt: undefined as never }),
    ).toBe(true);
  });
});

describe('serializable ScheduleState', () => {
  it('contains no Date instances and round-trips through JSON', () => {
    const state = scheduleFromHistory(fakeScheduler, chain())!;
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    expect(hasDateInstance(state)).toBe(false);
  });
});

function hasDateInstance(value: unknown): boolean {
  if (value instanceof Date) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some(hasDateInstance);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).some(hasDateInstance);
  }
  return false;
}
