import { describe, expect, it } from 'vitest';
import { compareCycleMetrics, computeCycleMetrics } from './cycleMetrics';
import { attemptRowsForCycle } from './test-support';

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
