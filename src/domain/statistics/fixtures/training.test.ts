import { describe, expect, it } from 'vitest';
import { puzzleIdOf } from '@/domain/puzzle/id';
import { blunderRowFixture, puzzleRowFixture } from '@/domain/puzzle/test-support';
import type { PuzzleRow } from '@/domain/puzzle/types';
import type { TacticalObjective } from '@/domain/tactics';
import {
  PUZZLE_FIXTURE_NOW,
  attemptRowsForCycle,
  cycleAttemptFixture,
  cycleFixture,
  setFixture,
} from '@/domain/training/test-support';
import type { PuzzleAttemptRow, TrainingResult } from '@/domain/training/types';
import {
  cycleStatsFor,
  masteredPuzzleCountForGame,
  masteredPuzzleCountForSet,
  masteredPuzzleCountsForGames,
  repeatedlyFailedPuzzles,
  setStatsFor,
  weakestCategories,
} from '../training';

// --- builders ---------------------------------------------------------------

function tacticalPuzzle(
  sourceGameId: string,
  sourcePly: number,
  objective: TacticalObjective,
): PuzzleRow {
  return {
    ...puzzleRowFixture('mate-one'),
    sourceGameId,
    sourcePly,
    origin: 'tactical',
    tacticalObjective: objective,
  };
}

function blunderPuzzle(sourceGameId: string, sourcePly: number): PuzzleRow {
  return {
    ...blunderRowFixture('correct-move'),
    sourceGameId,
    sourcePly,
    origin: 'blunder',
  };
}

function idOf(puzzle: PuzzleRow): string {
  return puzzleIdOf(puzzle.sourceGameId, puzzle.sourcePly);
}

function attemptFor(
  puzzle: PuzzleRow,
  trainingSetId: string,
  cycleId: string,
  result: TrainingResult,
): PuzzleAttemptRow {
  return cycleAttemptFixture({
    puzzleId: idOf(puzzle),
    trainingSetId,
    cycleId,
    result,
  });
}

function cleanFirstTry(
  puzzleId: string,
  trainingSetId: string,
  cycleId: string,
  presentationIndex = 1,
): PuzzleAttemptRow {
  return cycleAttemptFixture({
    puzzleId,
    trainingSetId,
    cycleId,
    presentationIndex,
    result: 'solvedFirstTry',
    hintCount: 0,
    wrongMoveCount: 0,
    restartCount: 0,
  });
}

// --- cycleStatsFor ----------------------------------------------------------

const CYCLE_SET_ID = 'set:cycle';
const CYCLE_ID = 'cycle:1';
const CYCLE_PUZZLES = ['pA', 'pB', 'pC', 'pD', 'pE'];

function cycleAttempts(): PuzzleAttemptRow[] {
  return attemptRowsForCycle({
    puzzleIds: CYCLE_PUZZLES,
    results: {
      pA: ['solvedFirstTry'],
      pB: ['solvedWithHelp'],
      pC: ['failed', 'solvedWithHelp'],
      pD: ['skipped'],
    },
    solvingTimes: { pA: [1_000], pB: [2_000], pC: [3_000, 4_000], pD: [5_000] },
    trainingSetId: CYCLE_SET_ID,
    cycleId: CYCLE_ID,
  });
}

function completedCycle() {
  return cycleFixture({
    id: CYCLE_ID,
    trainingSetId: CYCLE_SET_ID,
    cycleNumber: 1,
    status: 'completed',
    puzzleIds: CYCLE_PUZZLES,
    completedAt: PUZZLE_FIXTURE_NOW + 100_000,
  });
}

describe('cycleStatsFor', () => {
  it('reuses the canonical cycle metrics and wraps rates/times with honest samples', () => {
    const stats = cycleStatsFor({ cycle: completedCycle(), attempts: cycleAttempts() });

    expect(stats.metrics).toMatchObject({
      puzzlesAttempted: 4,
      puzzlesCompleted: 3,
      puzzlesSkipped: 1,
      firstTryAccuracy: 1 / 3,
      solveRate: 1,
      totalPresentations: 5,
      totalWrongMoves: 1,
      hintsUsed: 2,
      puzzlesRequiringHint: 2,
      retries: 1,
      puzzlesRequiringRetry: 1,
      solvingTime: { totalMs: 10_000, averageMs: 10_000 / 3, medianMs: 2_000 },
      sampleUnit: 'puzzles',
    });

    expect(stats.firstTryAccuracy).toEqual({
      value: 1 / 3,
      state: 'insufficient',
      sample: { unit: 'puzzles', n: 3 },
    });
    expect(stats.solveRate).toEqual({
      value: 1,
      state: 'insufficient',
      sample: { unit: 'puzzles', n: 3 },
    });
    expect(stats.solvingTime).toEqual({
      totalMs: 10_000,
      average: { value: 10_000 / 3, state: 'insufficient', sample: { unit: 'puzzles', n: 3 } },
      median: { value: 2_000, state: 'insufficient', sample: { unit: 'puzzles', n: 3 } },
    });
  });

  it('exposes per-puzzle resolutions in snapshot order and ignores other cycles', () => {
    const foreign = cycleAttemptFixture({
      puzzleId: 'pA',
      trainingSetId: CYCLE_SET_ID,
      cycleId: 'cycle:other',
      result: 'solvedFirstTry',
    });
    const stats = cycleStatsFor({
      cycle: completedCycle(),
      attempts: [...cycleAttempts(), foreign],
    });
    expect(stats.resolutions.map((resolution) => resolution.puzzleId)).toEqual([
      'pA',
      'pB',
      'pC',
      'pD',
    ]);
    expect(stats.metrics.puzzlesCompleted).toBe(3);
  });

  it('reports empty rate and time aggregates for zero definite puzzles', () => {
    const attempts = attemptRowsForCycle({
      puzzleIds: ['p1', 'p2'],
      results: { p1: ['skipped'], p2: ['skipped'] },
      trainingSetId: CYCLE_SET_ID,
      cycleId: CYCLE_ID,
    });
    const stats = cycleStatsFor({
      cycle: cycleFixture({
        id: CYCLE_ID,
        trainingSetId: CYCLE_SET_ID,
        puzzleIds: ['p1', 'p2'],
      }),
      attempts,
    });
    const empty = { value: null, state: 'empty', sample: { unit: 'puzzles', n: 0 } };
    expect(stats.firstTryAccuracy).toEqual(empty);
    expect(stats.solveRate).toEqual(empty);
    expect(stats.solvingTime.average).toEqual(empty);
    expect(stats.solvingTime.median).toEqual(empty);
    expect(stats.solvingTime.totalMs).toBe(0);
  });

  it('marks an inProgress cycle partial and a completed cycle not', () => {
    expect(
      cycleStatsFor({
        cycle: cycleFixture({ id: 'c', trainingSetId: CYCLE_SET_ID, status: 'inProgress' }),
        attempts: [],
      }).partial,
    ).toBe(true);
    expect(cycleStatsFor({ cycle: completedCycle(), attempts: [] }).partial).toBe(false);
  });
});

// --- setStatsFor ------------------------------------------------------------

describe('setStatsFor', () => {
  const SET_ID = 'set:main';
  const membership = ['pA', 'pB', 'pC', 'pD', 'pE'];
  const set = setFixture({ id: SET_ID, name: 'Main set', puzzleIds: membership });

  const c1 = cycleFixture({
    id: 'c1',
    trainingSetId: SET_ID,
    cycleNumber: 1,
    status: 'completed',
    puzzleIds: membership,
    completedAt: 1,
  });
  const c2 = cycleFixture({
    id: 'c2',
    trainingSetId: SET_ID,
    cycleNumber: 2,
    status: 'completed',
    puzzleIds: membership,
    completedAt: 2,
  });
  const c3 = cycleFixture({
    id: 'c3',
    trainingSetId: SET_ID,
    cycleNumber: 3,
    status: 'inProgress',
    puzzleIds: membership,
  });
  const c4 = cycleFixture({
    id: 'c4',
    trainingSetId: SET_ID,
    cycleNumber: 4,
    status: 'abandoned',
    puzzleIds: membership,
    abandonedAt: 4,
  });
  const foreign = cycleFixture({
    id: 'c-foreign',
    trainingSetId: 'other-set',
    cycleNumber: 1,
    status: 'completed',
    puzzleIds: membership,
  });

  const attempts = [
    ...attemptRowsForCycle({
      puzzleIds: ['pA'],
      results: { pA: ['solvedFirstTry'] },
      trainingSetId: SET_ID,
      cycleId: 'c1',
    }),
    ...attemptRowsForCycle({
      puzzleIds: ['pA', 'pB'],
      results: { pA: ['solvedWithHelp'], pB: ['solvedFirstTry'] },
      trainingSetId: SET_ID,
      cycleId: 'c2',
    }),
    ...attemptRowsForCycle({
      puzzleIds: ['pC'],
      results: { pC: ['solvedFirstTry'] },
      trainingSetId: SET_ID,
      cycleId: 'c3',
    }),
    ...attemptRowsForCycle({
      puzzleIds: ['pD'],
      results: { pD: ['failed'] },
      trainingSetId: SET_ID,
      cycleId: 'c4',
    }),
  ];

  it('orders cycles, separates statuses and compares the two most recent cycles', () => {
    const stats = setStatsFor({ set, cycles: [c3, c1, foreign, c4, c2], attempts });

    expect(stats.cycles.map((cycle) => cycle.cycleId)).toEqual(['c1', 'c2', 'c3', 'c4']);
    expect(stats.currentCycle?.cycleId).toBe('c4');
    expect(stats.completedCycles.map((cycle) => cycle.cycleId)).toEqual(['c1', 'c2']);
    expect(stats.inProgressCycles.map((cycle) => cycle.cycleId)).toEqual(['c3']);
    expect(stats.abandonedCycles.map((cycle) => cycle.cycleId)).toEqual(['c4']);
    expect(stats.puzzleCount).toBe(5);
    expect(stats.status).toBe('active');
    expect(stats.name).toBe('Main set');

    const comparison = stats.crossCycleComparison;
    expect(comparison).not.toBeNull();
    expect(comparison?.current).toBe(stats.cycles[3]!.metrics);
    expect(comparison?.previous).toBe(stats.cycles[2]!.metrics);
    expect(comparison?.absoluteDelta.solveRate).toBe(-1);
    expect(comparison?.relativeDelta.solveRate).toBe(-1);
  });

  it('reports an archived set with no cycles without fabricating a comparison', () => {
    const stats = setStatsFor({
      set: setFixture({ id: 'set:archived', status: 'archived' }),
      cycles: [],
      attempts: [],
    });
    expect(stats.status).toBe('archived');
    expect(stats.puzzleCount).toBe(0);
    expect(stats.cycles).toEqual([]);
    expect(stats.currentCycle).toBeNull();
    expect(stats.crossCycleComparison).toBeNull();
  });
});

// --- weakestCategories ------------------------------------------------------

describe('weakestCategories', () => {
  const wm = [1, 2, 3, 4, 5, 6].map((n) => tacticalPuzzle('game:wm', n, 'winning_material'));
  const fm = [1, 2].map((n) => tacticalPuzzle('game:fm', n, 'forcing_mate'));
  const bl = [1, 2, 3].map((n) => blunderPuzzle('game:bl', n));
  const nt = [tacticalPuzzle('game:nt', 1, 'neutralizing_threat')];
  const puzzles = [...wm, ...fm, ...bl, ...nt];
  const set = setFixture({
    id: 'set:weak',
    puzzleIds: puzzles.map((puzzle) => idOf(puzzle)),
  });

  const attempts: PuzzleAttemptRow[] = [
    ...wm.slice(0, 4).map((puzzle) => attemptFor(puzzle, set.id, 'c1', 'solvedFirstTry')),
    attemptFor(wm[4]!, set.id, 'c1', 'failed'),
    attemptFor(wm[5]!, set.id, 'c1', 'solvedWithHelp'),
    ...fm.map((puzzle) => attemptFor(puzzle, set.id, 'c1', 'failed')),
    ...bl.map((puzzle) => attemptFor(puzzle, set.id, 'c1', 'solvedFirstTry')),
    attemptFor(nt[0]!, set.id, 'c1', 'skipped'),
  ];

  it('aggregates per category, ranks only n >= MIN_SAMPLE_SIZE and orders deterministically', () => {
    const categories = weakestCategories({ set, puzzles, attempts });
    expect(categories.map((category) => category.category)).toEqual([
      'winning_material',
      'blunder',
      'forcing_mate',
      'neutralizing_threat',
    ]);

    const winning = categories[0]!;
    expect(winning).toMatchObject({
      puzzleCount: 6,
      definiteAttempts: 6,
      solved: 5,
      ranked: true,
    });
    expect(winning.firstTryAccuracy).toEqual({
      value: 4 / 6,
      state: 'ok',
      sample: { unit: 'puzzles', n: 6 },
    });
    expect(winning.solveRate).toEqual({
      value: 5 / 6,
      state: 'ok',
      sample: { unit: 'puzzles', n: 6 },
    });

    const forcing = categories[2]!;
    expect(forcing).toMatchObject({
      category: 'forcing_mate',
      puzzleCount: 2,
      definiteAttempts: 2,
      solved: 0,
      ranked: false,
    });
    expect(forcing.solveRate).toEqual({
      value: 0,
      state: 'insufficient',
      sample: { unit: 'puzzles', n: 2 },
    });

    const neutral = categories[3]!;
    expect(neutral).toMatchObject({
      category: 'neutralizing_threat',
      puzzleCount: 1,
      definiteAttempts: 0,
      solved: 0,
      ranked: false,
    });
    expect(neutral.solveRate).toEqual({
      value: null,
      state: 'empty',
      sample: { unit: 'puzzles', n: 0 },
    });
  });

  it('maps blunder-origin rows to the blunder category', () => {
    const categories = weakestCategories({ set, puzzles, attempts });
    const blunder = categories.find((category) => category.category === 'blunder')!;
    expect(blunder).toMatchObject({
      puzzleCount: 3,
      definiteAttempts: 3,
      solved: 3,
      ranked: false,
    });
    expect(blunder.solveRate.value).toBe(1);
  });
});

// --- repeatedlyFailedPuzzles ------------------------------------------------

describe('repeatedlyFailedPuzzles', () => {
  const SET_ID = 'set:rf';
  const pA = puzzleIdOf('game:rf-a', 4);
  const pB = puzzleIdOf('game:rf-b', 6);
  const pC = puzzleIdOf('game:rf-c', 8);
  const pD = puzzleIdOf('game:rf-d', 10);

  function failed(puzzleId: string, cycleId: string, endedAt: number): PuzzleAttemptRow {
    return cycleAttemptFixture({
      puzzleId,
      trainingSetId: SET_ID,
      cycleId,
      result: 'failed',
      endedAt,
    });
  }

  it('keeps puzzles failed in >= 2 distinct cycles, ordered by failures then id', () => {
    const attempts = [
      failed(pA, 'c1', 100),
      failed(pA, 'c2', 200),
      failed(pA, 'c3', 300),
      failed(pB, 'c1', 400),
      failed(pC, 'c1', 500),
      failed(pC, 'c2', 600),
      failed(pD, 'c1', 700),
      failed(pD, 'c1', 800),
      cycleAttemptFixture({
        puzzleId: pA,
        trainingSetId: 'other-set',
        cycleId: 'c9',
        result: 'failed',
      }),
    ];
    expect(repeatedlyFailedPuzzles({ trainingSetId: SET_ID, attempts })).toEqual([
      {
        puzzleId: pA,
        sourceGameId: 'game:rf-a',
        failureCount: 3,
        cycleCount: 3,
        lastFailedAt: 300,
      },
      {
        puzzleId: pC,
        sourceGameId: 'game:rf-c',
        failureCount: 2,
        cycleCount: 2,
        lastFailedAt: 600,
      },
    ]);
  });
});

// --- mastery ----------------------------------------------------------------

describe('mastery counts', () => {
  const GAME = 'game:mastery';
  const OTHER_GAME = 'game:other';
  const masteredPuzzle = idOf(tacticalPuzzle(GAME, 10, 'winning_material'));
  const restartPuzzle = idOf(tacticalPuzzle(GAME, 20, 'forcing_mate'));
  const retryPuzzle = idOf(tacticalPuzzle(GAME, 30, 'winning_material'));
  const doubleCountPuzzle = idOf(tacticalPuzzle(GAME, 40, 'winning_material'));
  const otherGamePuzzle = idOf(tacticalPuzzle(OTHER_GAME, 5, 'winning_material'));

  const attempts: PuzzleAttemptRow[] = [
    // Mastered across two sets: clean first try in three distinct cycles.
    cleanFirstTry(masteredPuzzle, 'set:A', 'c1'),
    cleanFirstTry(masteredPuzzle, 'set:B', 'c2'),
    cleanFirstTry(masteredPuzzle, 'set:B', 'c3'),
    // Restart-disqualified third cycle: no credit.
    cleanFirstTry(restartPuzzle, 'set:A', 'c1'),
    cleanFirstTry(restartPuzzle, 'set:A', 'c2'),
    cycleAttemptFixture({
      puzzleId: restartPuzzle,
      trainingSetId: 'set:A',
      cycleId: 'c3',
      presentationIndex: 1,
      result: 'solvedFirstTry',
      restartCount: 1,
    }),
    // Clean retry (presentationIndex > 1) earns no credit.
    cleanFirstTry(retryPuzzle, 'set:A', 'c1'),
    cleanFirstTry(retryPuzzle, 'set:A', 'c2'),
    cleanFirstTry(retryPuzzle, 'set:A', 'c3', 2),
    // Two rows in one cycle count once.
    cleanFirstTry(doubleCountPuzzle, 'set:A', 'c1'),
    cleanFirstTry(doubleCountPuzzle, 'set:A', 'c2'),
    cleanFirstTry(doubleCountPuzzle, 'set:A', 'c2', 2),
    // Another game's puzzle, unmastered.
    cleanFirstTry(otherGamePuzzle, 'set:A', 'c1'),
  ];

  /** The persisted cycle rows the mastery attempts above belong to. */
  const masteryCycles = ['c1', 'c2', 'c3'].map((id) => cycleFixture({ id }));

  it('counts mastered puzzles per game with a puzzles sample', () => {
    expect(masteredPuzzleCountForGame(GAME, attempts, masteryCycles)).toEqual({
      value: 1,
      state: 'insufficient',
      sample: { unit: 'puzzles', n: 4 },
    });
    expect(masteredPuzzleCountForGame(OTHER_GAME, attempts, masteryCycles)).toEqual({
      value: 0,
      state: 'insufficient',
      sample: { unit: 'puzzles', n: 1 },
    });
  });

  it('returns a map for several games, empty when a game has no attempts', () => {
    const counts = masteredPuzzleCountsForGames(
      [GAME, OTHER_GAME, 'game:none'],
      attempts,
      masteryCycles,
    );
    expect(counts.get(GAME)?.value).toBe(1);
    expect(counts.get(OTHER_GAME)?.value).toBe(0);
    expect(counts.get('game:none')).toEqual({
      value: null,
      state: 'empty',
      sample: { unit: 'puzzles', n: 0 },
    });
  });

  it('counts mastered puzzles in a set membership independent of the earning set', () => {
    const setA = setFixture({
      id: 'set:A',
      puzzleIds: [masteredPuzzle, restartPuzzle, retryPuzzle, doubleCountPuzzle],
    });
    const setB = setFixture({ id: 'set:B', puzzleIds: [masteredPuzzle, otherGamePuzzle] });
    const emptySet = setFixture({ id: 'set:empty', puzzleIds: [masteredPuzzle] });

    expect(masteredPuzzleCountForSet(setA, attempts, masteryCycles)).toEqual({
      value: 1,
      state: 'insufficient',
      sample: { unit: 'puzzles', n: 4 },
    });
    expect(masteredPuzzleCountForSet(setB, attempts, masteryCycles)).toEqual({
      value: 1,
      state: 'insufficient',
      sample: { unit: 'puzzles', n: 1 },
    });
    expect(masteredPuzzleCountForSet(emptySet, attempts, masteryCycles)).toEqual({
      value: null,
      state: 'empty',
      sample: { unit: 'puzzles', n: 0 },
    });
  });

  it('ignores an orphaned third-cycle attempt row', () => {
    const orphanedCycles = ['c1', 'c2'].map((id) => cycleFixture({ id }));
    expect(masteredPuzzleCountForGame(GAME, attempts, orphanedCycles).value).toBe(0);
    expect(masteredPuzzleCountForGame(GAME, attempts, masteryCycles).value).toBe(1);
  });
});
