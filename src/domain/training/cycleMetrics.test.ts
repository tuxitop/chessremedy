import { describe, expect, it } from 'vitest';
import {
  compareCycleMetrics,
  computeCycleMetrics,
  cycleTimeGoal,
  isSameLocalCalendarDay,
  spacingNudgeFor,
} from './cycleMetrics';
import { attemptRowsForCycle, cycleFixture } from './test-support';

describe('computeCycleMetrics', () => {
  it('computes every canonical aggregate from a scripted cycle', () => {
    const attempts = attemptRowsForCycle({
      puzzleIds: ['p1', 'p2', 'p3'],
      results: {
        p1: ['solvedFirstTry'],
        p2: ['solvedWithHelp'],
        p3: ['failed', 'solvedWithHelp'],
      },
      solvingTimes: { p1: [1_000], p2: [2_000], p3: [3_000, 4_000] },
    });
    const metrics = computeCycleMetrics({ puzzleIds: ['p1', 'p2', 'p3'], attempts });
    expect(metrics).toEqual({
      puzzlesAttempted: 3,
      puzzlesCompleted: 3,
      puzzlesSkipped: 0,
      firstTryAccuracy: 1 / 3,
      solveRate: 1,
      totalPresentations: 4,
      totalWrongMoves: 1,
      hintsUsed: 2,
      puzzlesRequiringHint: 2,
      retries: 1,
      puzzlesRequiringRetry: 1,
      solvingTime: { totalMs: 10_000, averageMs: 10_000 / 3, medianMs: 2_000 },
      sampleUnit: 'puzzles',
    });
  });

  it('reports empty (null) rate and time aggregates for a cycle with no attempts', () => {
    const metrics = computeCycleMetrics({ puzzleIds: ['p1', 'p2'], attempts: [] });
    expect(metrics).toMatchObject({
      puzzlesAttempted: 0,
      puzzlesCompleted: 0,
      puzzlesSkipped: 0,
      firstTryAccuracy: null,
      solveRate: null,
      totalPresentations: 0,
      solvingTime: { totalMs: 0, averageMs: null, medianMs: null },
    });
  });

  it('keeps skipped puzzles out of the denominators and reports them separately', () => {
    const attempts = attemptRowsForCycle({
      puzzleIds: ['p1', 'p2'],
      results: { p1: ['skipped'], p2: ['skipped'] },
    });
    const metrics = computeCycleMetrics({ puzzleIds: ['p1', 'p2'], attempts });
    expect(metrics).toMatchObject({
      puzzlesAttempted: 2,
      puzzlesCompleted: 0,
      puzzlesSkipped: 2,
      firstTryAccuracy: null,
      solveRate: null,
      totalPresentations: 2,
      solvingTime: { totalMs: 0, averageMs: null, medianMs: null },
    });
  });

  it('averages the two middle values for an even median sample', () => {
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
    const metrics = computeCycleMetrics({ puzzleIds: ['p1', 'p2', 'p3', 'p4'], attempts });
    expect(metrics.solvingTime.medianMs).toBe(2_500);
    expect(metrics.solvingTime.averageMs).toBe(2_500);
  });

  it('excludes missing puzzle rows and attempts outside the snapshot', () => {
    const attempts = attemptRowsForCycle({
      puzzleIds: ['p1', 'gone', 'outside'],
      results: { p1: ['solvedFirstTry'], gone: ['solvedFirstTry'], outside: ['failed'] },
    });
    const metrics = computeCycleMetrics({
      puzzleIds: ['p1', 'gone'],
      attempts,
      missingPuzzleIds: new Set(['gone']),
    });
    expect(metrics).toMatchObject({
      puzzlesAttempted: 1,
      puzzlesCompleted: 1,
      totalPresentations: 1,
      totalWrongMoves: 0,
    });
  });
});

describe('compareCycleMetrics', () => {
  const previous = computeCycleMetrics({
    puzzleIds: ['p1'],
    attempts: attemptRowsForCycle({ puzzleIds: ['p1'], results: { p1: ['failed'] } }),
  });
  const current = computeCycleMetrics({
    puzzleIds: ['p1'],
    attempts: attemptRowsForCycle({ puzzleIds: ['p1'], results: { p1: ['solvedFirstTry'] } }),
  });

  it('reports measured absolute deltas for the same set and definition', () => {
    const comparison = compareCycleMetrics(current, previous);
    expect(comparison.current).toBe(current);
    expect(comparison.previous).toBe(previous);
    expect(comparison.absoluteDelta.solveRate).toBe(1);
    expect(comparison.absoluteDelta.totalWrongMoves).toBe(-1);
    expect(comparison.absoluteDelta.puzzlesCompleted).toBe(0);
  });

  it('reports relative deltas only when the previous value is non-zero', () => {
    const comparison = compareCycleMetrics(current, previous);
    expect(comparison.relativeDelta.solveRate).toBeNull();
    expect(comparison.relativeDelta.totalWrongMoves).toBe(-1);
    expect(comparison.relativeDelta.puzzlesCompleted).toBe(0);
  });

  it('reports null deltas when either side is empty', () => {
    const empty = computeCycleMetrics({ puzzleIds: [], attempts: [] });
    const comparison = compareCycleMetrics(empty, previous);
    expect(comparison.absoluteDelta.firstTryAccuracy).toBeNull();
    expect(comparison.relativeDelta.firstTryAccuracy).toBeNull();
    expect(comparison.absoluteDelta.solvingTimeAverageMs).toBeNull();
  });
});

describe('cycleTimeGoal', () => {
  function measured(solvingMs: number) {
    return computeCycleMetrics({
      puzzleIds: ['p1'],
      attempts: attemptRowsForCycle({
        puzzleIds: ['p1'],
        results: { p1: ['solvedFirstTry'] },
        solvingTimes: { p1: [solvingMs] },
      }),
    });
  }

  it('frames the first cycle without a fabricated target or delta', () => {
    const goal = cycleTimeGoal(measured(6_000), null);
    expect(goal).toEqual({
      currentTotalMs: 6_000,
      currentMeasured: true,
      previousTotalMs: null,
      deltaMs: null,
      targetMs: null,
    });
  });

  it('derives the half-time target and delta from a measured previous cycle', () => {
    const goal = cycleTimeGoal(measured(4_000), measured(10_000));
    expect(goal.previousTotalMs).toBe(10_000);
    expect(goal.targetMs).toBe(5_000);
    expect(goal.deltaMs).toBe(-6_000);
  });

  it('treats a previous cycle with no definite puzzle as no previous time', () => {
    const empty = computeCycleMetrics({ puzzleIds: [], attempts: [] });
    const goal = cycleTimeGoal(measured(4_000), empty);
    expect(goal.previousTotalMs).toBeNull();
    expect(goal.targetMs).toBeNull();
    expect(goal.deltaMs).toBeNull();
  });

  it('marks the current cycle unmeasured when it has no definite puzzle', () => {
    const empty = computeCycleMetrics({ puzzleIds: [], attempts: [] });
    const goal = cycleTimeGoal(empty, measured(10_000));
    expect(goal.currentMeasured).toBe(false);
    expect(goal.deltaMs).toBeNull();
    expect(goal.targetMs).toBe(5_000);
  });
});

describe('isSameLocalCalendarDay', () => {
  function at(year: number, month: number, day: number, hour: number, minute = 0): number {
    return new Date(year, month, day, hour, minute).getTime();
  }

  it('is true for two instants on the same local calendar date', () => {
    expect(isSameLocalCalendarDay(at(2023, 0, 1, 0, 0), at(2023, 0, 1, 23, 59))).toBe(true);
  });

  it('is false across midnight and across a year boundary', () => {
    expect(isSameLocalCalendarDay(at(2023, 0, 1, 23, 30), at(2023, 0, 2, 0, 30))).toBe(false);
    expect(isSameLocalCalendarDay(at(2023, 11, 31, 23, 30), at(2024, 0, 1, 0, 30))).toBe(false);
  });
});

describe('spacingNudgeFor', () => {
  function at(year: number, month: number, day: number, hour: number, minute = 0): number {
    return new Date(year, month, day, hour, minute).getTime();
  }

  function previousCycle(overrides: Parameters<typeof cycleFixture>[0] = {}) {
    return cycleFixture({ id: 'c1', cycleNumber: 1, status: 'completed', ...overrides });
  }

  it('nudges when the previous cycle ended earlier on the same local day', () => {
    const previous = previousCycle({
      startedAt: at(2023, 0, 1, 8),
      completedAt: at(2023, 0, 1, 9),
    });
    const current = cycleFixture({ id: 'c2', cycleNumber: 2, startedAt: at(2023, 0, 1, 11) });
    const nudge = spacingNudgeFor([previous, current], current);
    expect(nudge).toEqual({
      previousCycleNumber: 1,
      previousEndedAt: at(2023, 0, 1, 9),
      elapsedMs: 2 * 60 * 60 * 1000,
    });
  });

  it('does not nudge once the previous cycle ended on an earlier local day', () => {
    const previous = previousCycle({ completedAt: at(2023, 0, 1, 9) });
    const current = cycleFixture({ id: 'c2', cycleNumber: 2, startedAt: at(2023, 0, 2, 11) });
    expect(spacingNudgeFor([previous, current], current)).toBeNull();
  });

  it('does not nudge when the gap crosses midnight into the next date', () => {
    const previous = previousCycle({ completedAt: at(2023, 0, 1, 23, 30) });
    const current = cycleFixture({ id: 'c2', cycleNumber: 2, startedAt: at(2023, 0, 2, 1, 30) });
    expect(spacingNudgeFor([previous, current], current)).toBeNull();
  });

  it('does not nudge across a year boundary even within a few hours', () => {
    const previous = previousCycle({ completedAt: at(2023, 11, 31, 23, 30) });
    const current = cycleFixture({ id: 'c2', cycleNumber: 2, startedAt: at(2024, 0, 1, 1, 30) });
    expect(spacingNudgeFor([previous, current], current)).toBeNull();
  });

  it('uses an abandoned previous cycle end and the immediately preceding cycle', () => {
    const first = previousCycle({ id: 'c1', cycleNumber: 1, completedAt: at(2023, 0, 1, 8) });
    const second = previousCycle({
      id: 'c2',
      cycleNumber: 2,
      status: 'abandoned',
      startedAt: at(2023, 0, 1, 8, 1),
      completedAt: null,
      abandonedAt: at(2023, 0, 1, 8, 2),
    });
    const current = cycleFixture({ id: 'c3', cycleNumber: 3, startedAt: at(2023, 0, 1, 9) });
    const nudge = spacingNudgeFor([first, second, current], current);
    expect(nudge?.previousCycleNumber).toBe(2);
    expect(nudge?.previousEndedAt).toBe(at(2023, 0, 1, 8, 2));
  });

  it('does not nudge without a previous cycle or when it never ended', () => {
    const current = cycleFixture({ id: 'c2', cycleNumber: 2, startedAt: at(2023, 0, 1, 9) });
    expect(spacingNudgeFor([current], current)).toBeNull();

    const running = cycleFixture({
      id: 'c1',
      cycleNumber: 1,
      status: 'inProgress',
      startedAt: at(2023, 0, 1, 8),
    });
    expect(spacingNudgeFor([running, current], current)).toBeNull();
  });
});
