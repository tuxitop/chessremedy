import { describe, expect, it } from 'vitest';
import {
  isCycleComplete,
  isPuzzleTerminal,
  nextCycleNumber,
  reconstructResume,
  resolvePuzzleCycle,
  snapshotCycle,
  solveHintConfigOf,
  validateCycleConfig,
} from './cycle';
import { CYCLE_METRICS_VERSION, DEFAULT_CYCLE_CONFIG, type CycleConfig } from './cycleTypes';
import type { HintLevel, PuzzleAttemptRow, TrainingResult } from './types';
import { attemptRowsForCycle, cycleAttemptFixture, setFixture } from './test-support';

function rows(
  puzzleId: string,
  results: readonly TrainingResult[],
  overrides: Partial<PuzzleAttemptRow> = {},
): PuzzleAttemptRow[] {
  return results.map((result, index) =>
    cycleAttemptFixture({
      puzzleId,
      presentationIndex: index + 1,
      result,
      ...overrides,
    }),
  );
}

describe('nextCycleNumber', () => {
  it('starts at 1 and is max + 1', () => {
    expect(nextCycleNumber([])).toBe(1);
    expect(nextCycleNumber([1, 2, 3])).toBe(4);
    expect(nextCycleNumber([5])).toBe(6);
  });

  it('ignores non-positive and non-finite values', () => {
    expect(nextCycleNumber([0, -3, 3])).toBe(4);
    expect(nextCycleNumber([Number.NaN, Number.POSITIVE_INFINITY, 2])).toBe(3);
  });
});

describe('snapshotCycle', () => {
  it('builds an inProgress cycle with the metrics version and null timestamps', () => {
    const cycle = snapshotCycle({
      id: 'cycle-1',
      set: setFixture({ id: 'set-1' }),
      cycleNumber: 3,
      puzzleIds: ['a:1', 'b:2'],
      config: DEFAULT_CYCLE_CONFIG,
      now: 1_234,
    });
    expect(cycle).toMatchObject({
      id: 'cycle-1',
      trainingSetId: 'set-1',
      cycleNumber: 3,
      status: 'inProgress',
      startedAt: 1_234,
      completedAt: null,
      abandonedAt: null,
      puzzleIds: ['a:1', 'b:2'],
      cycleMetricsVersion: CYCLE_METRICS_VERSION,
    });
    expect(cycle.config).toEqual(DEFAULT_CYCLE_CONFIG);
  });

  it('deep-copies the membership and hint levels so later mutation cannot alter it', () => {
    const puzzleIds = ['a:1'];
    const levels: HintLevel[] = [1, 2];
    const config: CycleConfig = {
      ...DEFAULT_CYCLE_CONFIG,
      hints: { enabledLevels: levels, firstHintLevel: 1 },
    };
    const cycle = snapshotCycle({
      id: 'cycle-1',
      set: setFixture(),
      cycleNumber: 1,
      puzzleIds,
      config,
      now: 0,
    });
    puzzleIds.push('b:2');
    levels.push(3);
    expect(cycle.puzzleIds).toEqual(['a:1']);
    expect(cycle.config.hints.enabledLevels).toEqual([1, 2]);
  });
});

describe('resolvePuzzleCycle', () => {
  it('resolves an unresolved (pending) puzzle', () => {
    const resolution = resolvePuzzleCycle('p1', []);
    expect(resolution).toMatchObject({
      puzzleId: 'p1',
      presentationCount: 0,
      skipped: false,
      definite: false,
      firstTrySolved: false,
      eventuallySolved: false,
      lastResult: 'skipped',
      wrongMoves: 0,
      hints: 0,
      solvingTimeMs: 0,
    });
  });

  it('resolves each definite result', () => {
    expect(resolvePuzzleCycle('p1', rows('p1', ['solvedFirstTry']))).toMatchObject({
      firstTrySolved: true,
      eventuallySolved: true,
      lastResult: 'solvedFirstTry',
    });
    expect(resolvePuzzleCycle('p1', rows('p1', ['solvedWithHelp']))).toMatchObject({
      firstTrySolved: false,
      eventuallySolved: true,
      lastResult: 'solvedWithHelp',
    });
    expect(resolvePuzzleCycle('p1', rows('p1', ['failed']))).toMatchObject({
      definite: true,
      eventuallySolved: false,
      lastResult: 'failed',
    });
  });

  it('treats an all-skipped puzzle as skipped and non-definite', () => {
    expect(resolvePuzzleCycle('p1', rows('p1', ['skipped']))).toMatchObject({
      skipped: true,
      definite: false,
      lastResult: 'skipped',
    });
  });

  it('orders presentations by index and resolves a retry pass', () => {
    const unordered = [
      cycleAttemptFixture({ puzzleId: 'p1', presentationIndex: 2, result: 'solvedWithHelp' }),
      cycleAttemptFixture({ puzzleId: 'p1', presentationIndex: 1, result: 'failed' }),
    ];
    const resolution = resolvePuzzleCycle('p1', unordered);
    expect(resolution.presentations.map((row) => row.presentationIndex)).toEqual([1, 2]);
    expect(resolution).toMatchObject({
      firstTrySolved: false,
      eventuallySolved: true,
      lastResult: 'solvedWithHelp',
      presentationCount: 2,
    });
  });

  it('sums wrong moves, hints and definite solving time', () => {
    const attempts = [
      cycleAttemptFixture({
        puzzleId: 'p1',
        presentationIndex: 1,
        result: 'failed',
        wrongMoveCount: 2,
        hintCount: 1,
        solvingTimeMs: 3_000,
      }),
      cycleAttemptFixture({
        puzzleId: 'p1',
        presentationIndex: 2,
        result: 'skipped',
        solvingTimeMs: 9_000,
      }),
    ];
    const resolution = resolvePuzzleCycle('p1', attempts);
    expect(resolution).toMatchObject({
      wrongMoves: 2,
      hints: 1,
      solvingTimeMs: 3_000,
      skipped: false,
      definite: true,
    });
  });
});

describe('isPuzzleTerminal', () => {
  const terminal = (
    results: readonly TrainingResult[],
    retryFailed: 'none' | 'endOfCycle' | 'immediate',
  ) => isPuzzleTerminal(resolvePuzzleCycle('p1', rows('p1', results)), retryFailed);

  it('is never terminal with no presentations', () => {
    expect(terminal([], 'none')).toBe(false);
    expect(terminal([], 'endOfCycle')).toBe(false);
  });

  it('is terminal when solved or skipped', () => {
    expect(terminal(['solvedFirstTry'], 'endOfCycle')).toBe(true);
    expect(terminal(['solvedWithHelp'], 'endOfCycle')).toBe(true);
    expect(terminal(['skipped'], 'endOfCycle')).toBe(true);
  });

  it('is terminal after one failure only when retries are disabled', () => {
    expect(terminal(['failed'], 'none')).toBe(true);
    expect(terminal(['failed'], 'endOfCycle')).toBe(false);
    expect(terminal(['failed'], 'immediate')).toBe(false);
  });

  it('is terminal after a re-failed retry in every retry mode', () => {
    expect(terminal(['failed', 'failed'], 'none')).toBe(true);
    expect(terminal(['failed', 'failed'], 'endOfCycle')).toBe(true);
    expect(terminal(['failed', 'failed'], 'immediate')).toBe(true);
  });
});

describe('isCycleComplete', () => {
  it('is true when every snapshot puzzle is terminal', () => {
    const attempts = attemptRowsForCycle({
      puzzleIds: ['p1', 'p2'],
      results: { p1: ['solvedFirstTry'], p2: ['skipped'] },
    });
    expect(isCycleComplete({ puzzleIds: ['p1', 'p2'], attempts, retryFailed: 'endOfCycle' })).toBe(
      true,
    );
  });

  it('is false while a puzzle is pending or awaiting its retry', () => {
    const attempts = attemptRowsForCycle({ puzzleIds: ['p1'], results: { p1: ['failed'] } });
    expect(isCycleComplete({ puzzleIds: ['p1', 'p2'], attempts, retryFailed: 'endOfCycle' })).toBe(
      false,
    );
    expect(isCycleComplete({ puzzleIds: ['p1'], attempts, retryFailed: 'endOfCycle' })).toBe(false);
    expect(isCycleComplete({ puzzleIds: ['p1'], attempts, retryFailed: 'none' })).toBe(true);
  });

  it('treats a missing puzzle row as terminal', () => {
    const attempts = attemptRowsForCycle({
      puzzleIds: ['p1'],
      results: { p1: ['solvedFirstTry'] },
    });
    expect(
      isCycleComplete({
        puzzleIds: ['p1', 'gone'],
        attempts,
        retryFailed: 'endOfCycle',
        missingPuzzleIds: new Set(['gone']),
      }),
    ).toBe(true);
  });
});

describe('reconstructResume', () => {
  it('returns the full first pass for a fresh cycle', () => {
    expect(
      reconstructResume({ puzzleIds: ['p1', 'p2', 'p3'], attempts: [], retryFailed: 'endOfCycle' }),
    ).toEqual([
      { puzzleId: 'p1', presentationIndex: 1 },
      { puzzleId: 'p2', presentationIndex: 1 },
      { puzzleId: 'p3', presentationIndex: 1 },
    ]);
  });

  it('skips solved puzzles mid-first-pass', () => {
    const attempts = attemptRowsForCycle({
      puzzleIds: ['p1'],
      results: { p1: ['solvedFirstTry'] },
    });
    expect(
      reconstructResume({ puzzleIds: ['p1', 'p2', 'p3'], attempts, retryFailed: 'endOfCycle' }),
    ).toEqual([
      { puzzleId: 'p2', presentationIndex: 1 },
      { puzzleId: 'p3', presentationIndex: 1 },
    ]);
  });

  it('front-loads pending retries for immediate mode', () => {
    const attempts = attemptRowsForCycle({ puzzleIds: ['p1'], results: { p1: ['failed'] } });
    expect(
      reconstructResume({ puzzleIds: ['p1', 'p2', 'p3'], attempts, retryFailed: 'immediate' }),
    ).toEqual([
      { puzzleId: 'p1', presentationIndex: 2 },
      { puzzleId: 'p2', presentationIndex: 1 },
      { puzzleId: 'p3', presentationIndex: 1 },
    ]);
  });

  it('appends pending retries after the first pass for end-of-cycle mode', () => {
    const attempts = attemptRowsForCycle({ puzzleIds: ['p1'], results: { p1: ['failed'] } });
    expect(
      reconstructResume({ puzzleIds: ['p1', 'p2', 'p3'], attempts, retryFailed: 'endOfCycle' }),
    ).toEqual([
      { puzzleId: 'p2', presentationIndex: 1 },
      { puzzleId: 'p3', presentationIndex: 1 },
      { puzzleId: 'p1', presentationIndex: 2 },
    ]);
  });

  it('never queues retries when retries are disabled', () => {
    const attempts = attemptRowsForCycle({ puzzleIds: ['p1'], results: { p1: ['failed'] } });
    expect(reconstructResume({ puzzleIds: ['p1', 'p2'], attempts, retryFailed: 'none' })).toEqual([
      { puzzleId: 'p2', presentationIndex: 1 },
    ]);
  });

  it('returns an empty queue for a complete cycle', () => {
    const attempts = attemptRowsForCycle({
      puzzleIds: ['p1', 'p2'],
      results: { p1: ['solvedFirstTry'], p2: ['skipped'] },
    });
    expect(
      reconstructResume({ puzzleIds: ['p1', 'p2'], attempts, retryFailed: 'endOfCycle' }),
    ).toEqual([]);
  });

  it('never queues a missing puzzle row', () => {
    const attempts = attemptRowsForCycle({
      puzzleIds: ['p1'],
      results: { p1: ['solvedFirstTry'] },
    });
    expect(
      reconstructResume({
        puzzleIds: ['p1', 'gone', 'p3'],
        attempts,
        retryFailed: 'endOfCycle',
        missingPuzzleIds: new Set(['gone']),
      }),
    ).toEqual([{ puzzleId: 'p3', presentationIndex: 1 }]);
  });

  it('is idempotent for the same persisted rows', () => {
    const attempts = attemptRowsForCycle({ puzzleIds: ['p1'], results: { p1: ['failed'] } });
    const input = { puzzleIds: ['p1', 'p2'], attempts, retryFailed: 'immediate' as const };
    expect(reconstructResume(input)).toEqual(reconstructResume(input));
  });
});

describe('solveHintConfigOf', () => {
  it('maps the cycle hint config and copies the enabled levels', () => {
    const config: CycleConfig = {
      ...DEFAULT_CYCLE_CONFIG,
      hints: { enabledLevels: [2, 4], firstHintLevel: 4 },
    };
    const solveConfig = solveHintConfigOf(config);
    expect(solveConfig).toEqual({ enabledLevels: [2, 4], firstHintLevel: 4 });
    expect(solveConfig.enabledLevels).not.toBe(config.hints.enabledLevels);
  });
});

describe('validateCycleConfig', () => {
  it('accepts the canonical default config unchanged', () => {
    const result = validateCycleConfig(DEFAULT_CYCLE_CONFIG);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config).toEqual(DEFAULT_CYCLE_CONFIG);
    }
  });

  it('rejects non-objects and unknown enums', () => {
    expect(validateCycleConfig(null).ok).toBe(false);
    expect(validateCycleConfig({ ...DEFAULT_CYCLE_CONFIG, ordering: 'random' }).ok).toBe(false);
    expect(validateCycleConfig({ ...DEFAULT_CYCLE_CONFIG, retryFailed: 'sometimes' }).ok).toBe(
      false,
    );
  });

  it('rejects malformed hint configs', () => {
    expect(
      validateCycleConfig({
        ...DEFAULT_CYCLE_CONFIG,
        hints: { enabledLevels: [5], firstHintLevel: 2 },
      }).ok,
    ).toBe(false);
    expect(
      validateCycleConfig({
        ...DEFAULT_CYCLE_CONFIG,
        hints: { enabledLevels: [1], firstHintLevel: 9 },
      }).ok,
    ).toBe(false);
  });

  it('rejects an unsupported config version', () => {
    expect(validateCycleConfig({ ...DEFAULT_CYCLE_CONFIG, configVersion: 2 }).ok).toBe(false);
  });

  it('rejects out-of-range informational targets', () => {
    expect(validateCycleConfig({ ...DEFAULT_CYCLE_CONFIG, targetAccuracy: 2 }).ok).toBe(false);
    expect(validateCycleConfig({ ...DEFAULT_CYCLE_CONFIG, targetSolvingTimeMs: -1 }).ok).toBe(
      false,
    );
    expect(validateCycleConfig({ ...DEFAULT_CYCLE_CONFIG, plannedCycles: 0 }).ok).toBe(false);
  });

  it('accepts valid optional targets', () => {
    const result = validateCycleConfig({
      ...DEFAULT_CYCLE_CONFIG,
      targetAccuracy: 0.8,
      targetSolvingTimeMs: 30_000,
      plannedCycles: 5,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.targetAccuracy).toBe(0.8);
      expect(result.config.targetSolvingTimeMs).toBe(30_000);
      expect(result.config.plannedCycles).toBe(5);
    }
  });
});
