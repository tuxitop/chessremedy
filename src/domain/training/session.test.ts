import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PUZZLE_RED_MS,
  DEFAULT_SESSION_DURATION_MS,
  DEFAULT_SESSION_WARNING_MS,
  SESSION_DURATION_OPTIONS_MS,
  sessionTimerState,
  summarizeSession,
} from './session';
import { attemptRowsForCycle } from './test-support';

describe('session constants', () => {
  it('exposes the default duration, warning and puzzle-red thresholds', () => {
    expect(DEFAULT_SESSION_DURATION_MS).toBe(600_000);
    expect(DEFAULT_SESSION_WARNING_MS).toBe(30_000);
    expect(DEFAULT_PUZZLE_RED_MS).toBe(30_000);
  });

  it('lists the selectable durations in ascending minutes', () => {
    expect(SESSION_DURATION_OPTIONS_MS).toEqual([
      300_000, 600_000, 900_000, 1_200_000, 1_800_000, 2_700_000, 3_600_000,
    ]);
  });
});

describe('sessionTimerState', () => {
  it('reports an untimed session as unbounded and never expiring or warning', () => {
    expect(sessionTimerState({ now: 1_000_000, endsAt: null, warningMs: 30_000 })).toEqual({
      remainingMs: null,
      expired: false,
      warning: false,
    });
  });

  it('counts down the remaining time without warning while above the threshold', () => {
    expect(sessionTimerState({ now: 60_000, endsAt: 100_000, warningMs: 30_000 })).toEqual({
      remainingMs: 40_000,
      expired: false,
      warning: false,
    });
  });

  it('warns exactly at the threshold', () => {
    expect(sessionTimerState({ now: 70_000, endsAt: 100_000, warningMs: 30_000 })).toEqual({
      remainingMs: 30_000,
      expired: false,
      warning: true,
    });
  });

  it('does not warn one millisecond above the threshold', () => {
    expect(sessionTimerState({ now: 69_999, endsAt: 100_000, warningMs: 30_000 })).toEqual({
      remainingMs: 30_001,
      expired: false,
      warning: false,
    });
  });

  it('expires exactly at the end and stops warning', () => {
    expect(sessionTimerState({ now: 100_000, endsAt: 100_000, warningMs: 30_000 })).toEqual({
      remainingMs: 0,
      expired: true,
      warning: false,
    });
  });

  it('stays expired and clamped after the end', () => {
    expect(sessionTimerState({ now: 130_000, endsAt: 100_000, warningMs: 30_000 })).toEqual({
      remainingMs: 0,
      expired: true,
      warning: false,
    });
  });
});

describe('summarizeSession', () => {
  it('counts each puzzle outcome across first-try, help, failure and skip', () => {
    const attempts = attemptRowsForCycle({
      puzzleIds: ['p1', 'p2', 'p3', 'p4'],
      results: {
        p1: ['solvedFirstTry'],
        p2: ['solvedWithHelp'],
        p3: ['failed'],
        p4: ['skipped'],
      },
    });
    const summary = summarizeSession(attempts);
    expect(summary).toMatchObject({
      puzzlesAttempted: 4,
      solvedFirstTry: 1,
      solvedWithHelp: 1,
      failed: 1,
      skipped: 1,
      completed: 3,
      firstTryAccuracy: 1 / 3,
    });
  });

  it('counts a retried puzzle once, as solved-with-help, not first-try', () => {
    const attempts = attemptRowsForCycle({
      puzzleIds: ['p1', 'p2'],
      results: { p1: ['failed', 'solvedWithHelp'], p2: ['failed', 'failed'] },
    });
    const summary = summarizeSession(attempts);
    expect(summary).toMatchObject({
      puzzlesAttempted: 2,
      solvedFirstTry: 0,
      solvedWithHelp: 1,
      failed: 1,
      skipped: 0,
      completed: 2,
      firstTryAccuracy: 0,
    });
  });

  it('aggregates solving time over completed puzzles only', () => {
    const attempts = attemptRowsForCycle({
      puzzleIds: ['p1', 'p2', 'p3', 'p4'],
      results: {
        p1: ['solvedFirstTry'],
        p2: ['solvedWithHelp'],
        p3: ['failed'],
        p4: ['skipped'],
      },
      solvingTimes: { p1: [1_000], p2: [2_000], p3: [3_000], p4: [9_999] },
    });
    const summary = summarizeSession(attempts);
    expect(summary.totalTimeMs).toBe(6_000);
    expect(summary.averageTimeMs).toBe(2_000);
    expect(summary.medianTimeMs).toBe(2_000);
  });

  it('averages the two middle solving times for an even completed sample', () => {
    const attempts = attemptRowsForCycle({
      puzzleIds: ['p1', 'p2', 'p3', 'p4'],
      results: {
        p1: ['solvedFirstTry'],
        p2: ['solvedFirstTry'],
        p3: ['solvedFirstTry'],
        p4: ['solvedFirstTry'],
      },
      solvingTimes: { p1: [1_000], p2: [2_000], p3: [3_000], p4: [4_000] },
    });
    const summary = summarizeSession(attempts);
    expect(summary.totalTimeMs).toBe(10_000);
    expect(summary.averageTimeMs).toBe(2_500);
    expect(summary.medianTimeMs).toBe(2_500);
  });

  it('reports an empty session with zero counts, null rates and zero/null times', () => {
    expect(summarizeSession([])).toEqual({
      puzzlesAttempted: 0,
      solvedFirstTry: 0,
      solvedWithHelp: 0,
      failed: 0,
      skipped: 0,
      completed: 0,
      firstTryAccuracy: null,
      totalTimeMs: 0,
      averageTimeMs: null,
      medianTimeMs: null,
    });
  });

  it('reports null first-try accuracy when every puzzle was skipped', () => {
    const attempts = attemptRowsForCycle({
      puzzleIds: ['p1', 'p2'],
      results: { p1: ['skipped'], p2: ['skipped'] },
    });
    expect(summarizeSession(attempts)).toMatchObject({
      puzzlesAttempted: 2,
      skipped: 2,
      completed: 0,
      firstTryAccuracy: null,
      totalTimeMs: 0,
      averageTimeMs: null,
      medianTimeMs: null,
    });
  });
});
