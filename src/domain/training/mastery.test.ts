import { describe, expect, it } from 'vitest';
import type { PuzzleAttemptRow } from './types';
import {
  MASTERY_REQUIRED_CYCLES,
  MASTERY_VERSION,
  isLegitimateFirstTry,
  masteredPuzzleIds,
  masteryOf,
} from './mastery';
import { cycleAttemptFixture, legitimateFirstTryRows, masteryAttemptFixture } from './test-support';

const PUZZLE = 'fixture:puzzle:1';
const OTHER = 'fixture:puzzle:2';

/** N clean first-try rows for `PUZZLE`, one per distinct cycle id. */
function credits(...cycleIds: string[]): PuzzleAttemptRow[] {
  return legitimateFirstTryRows(PUZZLE, cycleIds);
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
    expect(masteryOf(PUZZLE, [])).toBe(false);
    expect(masteryOf(PUZZLE, credits('c1'))).toBe(false);
    expect(masteryOf(PUZZLE, credits('c1', 'c2'))).toBe(false);
    expect(masteryOf(PUZZLE, credits('c1', 'c2', 'c3'))).toBe(true);
    expect(masteryOf(PUZZLE, credits('c1', 'c2', 'c3', 'c4'))).toBe(true);
  });

  it('counts a cycle once no matter how many clean rows it holds', () => {
    const rows = [
      masteryAttemptFixture({ puzzleId: PUZZLE, cycleId: 'c1' }),
      masteryAttemptFixture({ puzzleId: PUZZLE, cycleId: 'c1' }),
      masteryAttemptFixture({ puzzleId: PUZZLE, cycleId: 'c1' }),
    ];
    expect(masteryOf(PUZZLE, rows)).toBe(false);
  });

  it('never credits a retry presentation', () => {
    const rows = [
      ...credits('c1', 'c2'),
      cycleAttemptFixture({ puzzleId: PUZZLE, cycleId: 'c3', presentationIndex: 2 }),
    ];
    expect(masteryOf(PUZZLE, rows)).toBe(false);
  });

  it('ignores hint, wrong-move and restart rows', () => {
    expect(
      masteryOf(PUZZLE, [
        ...credits('c1', 'c2'),
        cycleAttemptFixture({
          puzzleId: PUZZLE,
          cycleId: 'c3',
          result: 'solvedFirstTry',
          hintCount: 1,
        }),
      ]),
    ).toBe(false);
    expect(
      masteryOf(PUZZLE, [
        ...credits('c1', 'c2'),
        cycleAttemptFixture({
          puzzleId: PUZZLE,
          cycleId: 'c3',
          result: 'solvedFirstTry',
          wrongMoveCount: 1,
        }),
      ]),
    ).toBe(false);
    expect(
      masteryOf(PUZZLE, [
        ...credits('c1', 'c2'),
        cycleAttemptFixture({
          puzzleId: PUZZLE,
          cycleId: 'c3',
          result: 'solvedFirstTry',
          restartCount: 1,
        }),
      ]),
    ).toBe(false);
  });

  it('is monotonic: a later failure never un-masters', () => {
    const rows = [
      ...credits('c1', 'c2', 'c3'),
      cycleAttemptFixture({ puzzleId: PUZZLE, cycleId: 'c4', result: 'failed' }),
      cycleAttemptFixture({ puzzleId: PUZZLE, cycleId: 'c5', result: 'skipped' }),
    ];
    expect(masteryOf(PUZZLE, rows)).toBe(true);
  });

  it('is global across sets (trainingSetId does not scope mastery)', () => {
    const rows = [
      masteryAttemptFixture({ puzzleId: PUZZLE, cycleId: 'c1', trainingSetId: 'set-a' }),
      masteryAttemptFixture({ puzzleId: PUZZLE, cycleId: 'c2', trainingSetId: 'set-b' }),
      masteryAttemptFixture({ puzzleId: PUZZLE, cycleId: 'c3', trainingSetId: 'set-c' }),
    ];
    expect(masteryOf(PUZZLE, rows)).toBe(true);
  });

  it('ignores rows for another puzzle', () => {
    const rows = [
      ...credits('c1', 'c2', 'c3'),
      masteryAttemptFixture({ puzzleId: OTHER, cycleId: 'c4' }),
    ];
    expect(masteryOf(PUZZLE, rows)).toBe(true);
    expect(masteryOf(OTHER, rows)).toBe(false);
  });

  it('ignores malformed rows with a blank cycle id', () => {
    const malformed = [
      { ...masteryAttemptFixture({ puzzleId: PUZZLE, cycleId: 'c1' }), cycleId: '' },
      { ...masteryAttemptFixture({ puzzleId: PUZZLE, cycleId: 'c2' }), cycleId: '' },
      { ...masteryAttemptFixture({ puzzleId: PUZZLE, cycleId: 'c3' }), cycleId: '' },
    ] as PuzzleAttemptRow[];
    expect(masteryOf(PUZZLE, malformed)).toBe(false);
  });
});

describe('masteredPuzzleIds', () => {
  it('returns an empty set when nothing is mastered', () => {
    expect([...masteredPuzzleIds(credits('c1', 'c2'))]).toEqual([]);
  });

  it('returns only the mastered puzzles', () => {
    const rows = [...credits('c1', 'c2', 'c3'), ...legitimateFirstTryRows(OTHER, ['c1', 'c2'])];
    expect([...masteredPuzzleIds(rows)]).toEqual([PUZZLE]);
  });

  it('is deterministic across calls', () => {
    const rows = [
      ...credits('c1', 'c2', 'c3'),
      ...legitimateFirstTryRows(OTHER, ['c4', 'c5', 'c6']),
    ];
    expect([...masteredPuzzleIds(rows)].sort()).toEqual([PUZZLE, OTHER].sort());
    expect(masteredPuzzleIds(rows)).toEqual(masteredPuzzleIds(rows));
  });
});
