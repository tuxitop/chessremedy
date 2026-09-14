import { describe, expect, it } from 'vitest';
import type { TrainingCycleRow } from './cycleTypes';
import type { PuzzleAttemptRow } from './types';
import {
  MASTERY_REQUIRED_CYCLES,
  MASTERY_VERSION,
  isLegitimateFirstTry,
  masteredPuzzleIds,
  masteryOf,
} from './mastery';
import {
  cycleAttemptFixture,
  cycleFixture,
  legitimateFirstTryRows,
  masteryAttemptFixture,
} from './test-support';
import { QUICK_TRAIN_SET_ID, REVIEW_SET_ID } from './autoSet';

const PUZZLE = 'fixture:puzzle:1';
const OTHER = 'fixture:puzzle:2';

/** N clean first-try rows for `PUZZLE`, one per distinct cycle id. */
function credits(...cycleIds: string[]): PuzzleAttemptRow[] {
  return legitimateFirstTryRows(PUZZLE, cycleIds);
}

/** The persisted cycle rows for a list of cycle ids. */
function cycles(...cycleIds: string[]): TrainingCycleRow[] {
  return cycleIds.map((id) => cycleFixture({ id }));
}

/** Quick-train sentinel cycle rows for a list of cycle ids. */
function quickTrainCycles(...cycleIds: string[]): TrainingCycleRow[] {
  return cycleIds.map((id) => cycleFixture({ id, trainingSetId: QUICK_TRAIN_SET_ID }));
}

/** A clean first-try row for `PUZZLE` under a Quick-train sentinel cycle. */
function quickTrainCredit(cycleId: string): PuzzleAttemptRow {
  return masteryAttemptFixture({
    puzzleId: PUZZLE,
    cycleId,
    trainingSetId: QUICK_TRAIN_SET_ID,
  });
}

/** A row without the optional `restartCount` field (a legacy persisted row). */
function withoutRestartCount(row: PuzzleAttemptRow): PuzzleAttemptRow {
  const { restartCount: _restartCount, ...rest } = row;
  return rest as PuzzleAttemptRow;
}

describe('mastery vocabulary', () => {
  it('exposes the versioned 3-distinct-cycle threshold', () => {
    expect(MASTERY_VERSION).toBe(1);
    expect(MASTERY_REQUIRED_CYCLES).toBe(3);
  });
});

describe('isLegitimateFirstTry', () => {
  it('accepts a clean first presentation', () => {
    expect(isLegitimateFirstTry(masteryAttemptFixture({ puzzleId: PUZZLE }))).toBe(true);
  });

  it('rejects a retry presentation even when its row is a clean solve', () => {
    expect(
      isLegitimateFirstTry(
        cycleAttemptFixture({ puzzleId: PUZZLE, presentationIndex: 2, result: 'solvedFirstTry' }),
      ),
    ).toBe(false);
  });

  it('rejects non-clean results', () => {
    expect(isLegitimateFirstTry(cycleAttemptFixture({ puzzleId: PUZZLE, result: 'failed' }))).toBe(
      false,
    );
    expect(isLegitimateFirstTry(cycleAttemptFixture({ puzzleId: PUZZLE, result: 'skipped' }))).toBe(
      false,
    );
    expect(
      isLegitimateFirstTry(cycleAttemptFixture({ puzzleId: PUZZLE, result: 'solvedWithHelp' })),
    ).toBe(false);
  });

  it('rejects a first-try row carrying a hint, wrong move or restart (defensive)', () => {
    expect(
      isLegitimateFirstTry(
        cycleAttemptFixture({ puzzleId: PUZZLE, result: 'solvedFirstTry', hintCount: 1 }),
      ),
    ).toBe(false);
    expect(
      isLegitimateFirstTry(
        cycleAttemptFixture({ puzzleId: PUZZLE, result: 'solvedFirstTry', wrongMoveCount: 1 }),
      ),
    ).toBe(false);
    expect(
      isLegitimateFirstTry(
        cycleAttemptFixture({ puzzleId: PUZZLE, result: 'solvedFirstTry', restartCount: 1 }),
      ),
    ).toBe(false);
  });

  it('normalizes an absent restartCount to 0 (legacy rows)', () => {
    const legacy = withoutRestartCount(masteryAttemptFixture({ puzzleId: PUZZLE }));
    expect(legacy.restartCount).toBeUndefined();
    expect(isLegitimateFirstTry(legacy)).toBe(true);
  });
});

describe('masteryOf', () => {
  it('requires three distinct-cycle legitimate credits', () => {
    expect(masteryOf(PUZZLE, [], [])).toBe(false);
    expect(masteryOf(PUZZLE, credits('c1'), cycles('c1'))).toBe(false);
    expect(masteryOf(PUZZLE, credits('c1', 'c2'), cycles('c1', 'c2'))).toBe(false);
    expect(masteryOf(PUZZLE, credits('c1', 'c2', 'c3'), cycles('c1', 'c2', 'c3'))).toBe(true);
    expect(masteryOf(PUZZLE, credits('c1', 'c2', 'c3', 'c4'), cycles('c1', 'c2', 'c3', 'c4'))).toBe(
      true,
    );
  });

  it('counts a cycle once no matter how many clean rows it holds', () => {
    const rows = [
      masteryAttemptFixture({ puzzleId: PUZZLE, cycleId: 'c1' }),
      masteryAttemptFixture({ puzzleId: PUZZLE, cycleId: 'c1' }),
      masteryAttemptFixture({ puzzleId: PUZZLE, cycleId: 'c1' }),
    ];
    expect(masteryOf(PUZZLE, rows, cycles('c1'))).toBe(false);
  });

  it('never credits a retry presentation', () => {
    const rows = [
      ...credits('c1', 'c2'),
      cycleAttemptFixture({ puzzleId: PUZZLE, cycleId: 'c3', presentationIndex: 2 }),
    ];
    expect(masteryOf(PUZZLE, rows, cycles('c1', 'c2', 'c3'))).toBe(false);
  });

  it('ignores hint, wrong-move and restart rows', () => {
    expect(
      masteryOf(
        PUZZLE,
        [
          ...credits('c1', 'c2'),
          cycleAttemptFixture({
            puzzleId: PUZZLE,
            cycleId: 'c3',
            result: 'solvedFirstTry',
            hintCount: 1,
          }),
        ],
        cycles('c1', 'c2', 'c3'),
      ),
    ).toBe(false);
    expect(
      masteryOf(
        PUZZLE,
        [
          ...credits('c1', 'c2'),
          cycleAttemptFixture({
            puzzleId: PUZZLE,
            cycleId: 'c3',
            result: 'solvedFirstTry',
            wrongMoveCount: 1,
          }),
        ],
        cycles('c1', 'c2', 'c3'),
      ),
    ).toBe(false);
    expect(
      masteryOf(
        PUZZLE,
        [
          ...credits('c1', 'c2'),
          cycleAttemptFixture({
            puzzleId: PUZZLE,
            cycleId: 'c3',
            result: 'solvedFirstTry',
            restartCount: 1,
          }),
        ],
        cycles('c1', 'c2', 'c3'),
      ),
    ).toBe(false);
  });

  it('is monotonic: a later failure never un-masters', () => {
    const rows = [
      ...credits('c1', 'c2', 'c3'),
      cycleAttemptFixture({ puzzleId: PUZZLE, cycleId: 'c4', result: 'failed' }),
      cycleAttemptFixture({ puzzleId: PUZZLE, cycleId: 'c5', result: 'skipped' }),
    ];
    expect(masteryOf(PUZZLE, rows, cycles('c1', 'c2', 'c3', 'c4', 'c5'))).toBe(true);
  });

  it('is global across sets (trainingSetId does not scope mastery)', () => {
    const rows = [
      masteryAttemptFixture({ puzzleId: PUZZLE, cycleId: 'c1', trainingSetId: 'set-a' }),
      masteryAttemptFixture({ puzzleId: PUZZLE, cycleId: 'c2', trainingSetId: 'set-b' }),
      masteryAttemptFixture({ puzzleId: PUZZLE, cycleId: 'c3', trainingSetId: 'set-c' }),
    ];
    expect(masteryOf(PUZZLE, rows, cycles('c1', 'c2', 'c3'))).toBe(true);
  });

  it('ignores rows for another puzzle', () => {
    const rows = [
      ...credits('c1', 'c2', 'c3'),
      masteryAttemptFixture({ puzzleId: OTHER, cycleId: 'c4' }),
    ];
    expect(masteryOf(PUZZLE, rows, cycles('c1', 'c2', 'c3', 'c4'))).toBe(true);
    expect(masteryOf(OTHER, rows, cycles('c1', 'c2', 'c3', 'c4'))).toBe(false);
  });

  it('ignores malformed rows with a blank cycle id', () => {
    const malformed = [
      { ...masteryAttemptFixture({ puzzleId: PUZZLE, cycleId: 'c1' }), cycleId: '' },
      { ...masteryAttemptFixture({ puzzleId: PUZZLE, cycleId: 'c2' }), cycleId: '' },
      { ...masteryAttemptFixture({ puzzleId: PUZZLE, cycleId: 'c3' }), cycleId: '' },
    ] as PuzzleAttemptRow[];
    expect(masteryOf(PUZZLE, malformed, cycles('c1', 'c2', 'c3'))).toBe(false);
  });

  it('ignores an orphaned attempt whose cycle row no longer exists', () => {
    const rows = credits('c1', 'c2', 'c3');
    expect(masteryOf(PUZZLE, rows, cycles('c1', 'c2'))).toBe(false);
    expect(masteryOf(PUZZLE, rows, cycles('c1', 'c2', 'c3'))).toBe(true);
  });
});

describe('masteryOf — Quick-train exclusion', () => {
  it('never masters from three Quick-train sentinel cycles', () => {
    const rows = [quickTrainCredit('qt-1'), quickTrainCredit('qt-2'), quickTrainCredit('qt-3')];
    expect(masteryOf(PUZZLE, rows, quickTrainCycles('qt-1', 'qt-2', 'qt-3'))).toBe(false);
    expect(masteredPuzzleIds(rows, quickTrainCycles('qt-1', 'qt-2', 'qt-3'))).toEqual(new Set());
  });

  it('counts only real cycles when sentinel and real cycles are mixed', () => {
    const twoRealPlusSentinel = [...credits('c1', 'c2'), quickTrainCredit('qt-1')];
    expect(
      masteryOf(PUZZLE, twoRealPlusSentinel, [...cycles('c1', 'c2'), ...quickTrainCycles('qt-1')]),
    ).toBe(false);

    const threeReal = credits('c1', 'c2', 'c3');
    expect(masteryOf(PUZZLE, threeReal, cycles('c1', 'c2', 'c3'))).toBe(true);
  });
});

describe('masteryOf — Review-sentinel exclusion (Feature 020)', () => {
  function reviewCycles(...cycleIds: string[]): TrainingCycleRow[] {
    return cycleIds.map((id) => cycleFixture({ id, trainingSetId: REVIEW_SET_ID }));
  }

  function reviewCredit(cycleId: string): PuzzleAttemptRow {
    return masteryAttemptFixture({
      puzzleId: PUZZLE,
      cycleId,
      trainingSetId: REVIEW_SET_ID,
    });
  }

  it('never masters from three Review sentinel cycles', () => {
    const rows = [reviewCredit('r-1'), reviewCredit('r-2'), reviewCredit('r-3')];
    expect(masteryOf(PUZZLE, rows, reviewCycles('r-1', 'r-2', 'r-3'))).toBe(false);
    expect(masteredPuzzleIds(rows, reviewCycles('r-1', 'r-2', 'r-3'))).toEqual(new Set());
  });

  it('counts only real cycles when Review and real cycles are mixed', () => {
    const twoRealPlusReview = [...credits('c1', 'c2'), reviewCredit('r-1')];
    expect(
      masteryOf(PUZZLE, twoRealPlusReview, [...cycles('c1', 'c2'), ...reviewCycles('r-1')]),
    ).toBe(false);
  });
});

describe('masteredPuzzleIds', () => {
  it('returns an empty set when nothing is mastered', () => {
    expect([...masteredPuzzleIds(credits('c1', 'c2'), cycles('c1', 'c2'))]).toEqual([]);
  });

  it('returns only the mastered puzzles', () => {
    const rows = [...credits('c1', 'c2', 'c3'), ...legitimateFirstTryRows(OTHER, ['c1', 'c2'])];
    expect([...masteredPuzzleIds(rows, cycles('c1', 'c2', 'c3'))]).toEqual([PUZZLE]);
  });

  it('is deterministic across calls', () => {
    const rows = [
      ...credits('c1', 'c2', 'c3'),
      ...legitimateFirstTryRows(OTHER, ['c4', 'c5', 'c6']),
    ];
    const allCycles = cycles('c1', 'c2', 'c3', 'c4', 'c5', 'c6');
    expect([...masteredPuzzleIds(rows, allCycles)].sort()).toEqual([PUZZLE, OTHER].sort());
    expect(masteredPuzzleIds(rows, allCycles)).toEqual(masteredPuzzleIds(rows, allCycles));
  });

  it('never credits a puzzle whose third cycle row is orphaned', () => {
    const rows = credits('c1', 'c2', 'c3');
    expect([...masteredPuzzleIds(rows, cycles('c1', 'c2'))]).toEqual([]);
    expect([...masteredPuzzleIds(rows, cycles('c1', 'c2', 'c3'))]).toEqual([PUZZLE]);
  });
});
