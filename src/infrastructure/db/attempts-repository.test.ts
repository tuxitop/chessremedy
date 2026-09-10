import { describe, expect, it, beforeEach } from 'vitest';
import { db } from './database';
import { attemptsRepository } from './attempts-repository';
import type { PuzzleAttemptRow } from '@/domain/training';
import { attemptRowFixture } from '@/domain/training/test-support';

/** An attempt row at explicit natural-key coordinates over deterministic defaults. */
function attemptRow(
  overrides: Partial<PuzzleAttemptRow> &
    Pick<PuzzleAttemptRow, 'cycleId' | 'puzzleId' | 'presentationIndex'>,
): PuzzleAttemptRow {
  return { ...attemptRowFixture(), ...overrides };
}

describe('puzzle attempts repository', () => {
  beforeEach(async () => {
    await db.puzzleAttempts.clear();
  });

  it('addAttempt is first-write-wins and leaves an already-present row immutable', async () => {
    const original = attemptRow({
      cycleId: 'cycle:one',
      puzzleId: 'puzzle:a',
      presentationIndex: 1,
    });
    expect(await attemptsRepository.addAttempt(original)).toBe('added');

    // Re-adding the identical row is a no-op reported as 'already-present'…
    expect(await attemptsRepository.addAttempt(original)).toBe('already-present');

    // …and so is a 'corrected' row at an already-present key: the immutable
    // original is never overwritten (a corrected outcome is a new
    // presentation with an incremented presentationIndex).
    const corrected = {
      ...original,
      result: 'solvedWithHelp' as const,
      wrongMoveCount: 2,
    };
    expect(await attemptsRepository.addAttempt(corrected)).toBe('already-present');
    expect(await attemptsRepository.getAttempt('cycle:one', 'puzzle:a', 1)).toEqual(original);
    expect(await db.puzzleAttempts.count()).toBe(1);
  });

  it('a re-presentation writes an additional row, never an overwrite', async () => {
    const first = attemptRow({
      cycleId: 'cycle:one',
      puzzleId: 'puzzle:a',
      presentationIndex: 1,
      result: 'failed',
      solved: false,
    });
    const retry = attemptRow({
      cycleId: 'cycle:one',
      puzzleId: 'puzzle:a',
      presentationIndex: 2,
      result: 'solvedFirstTry',
      solved: true,
    });

    expect(await attemptsRepository.addAttempt(first)).toBe('added');
    expect(await attemptsRepository.addAttempt(retry)).toBe('added');
    expect(await db.puzzleAttempts.count()).toBe(2);
    expect(await attemptsRepository.getAttempt('cycle:one', 'puzzle:a', 1)).toEqual(first);
    expect(await attemptsRepository.getAttempt('cycle:one', 'puzzle:a', 2)).toEqual(retry);
  });

  it('round-trips by natural key and lists scoped and ordered', async () => {
    await attemptsRepository.addAttempt(
      attemptRow({ cycleId: 'cycle:a', puzzleId: 'puzzle:m', presentationIndex: 2 }),
    );
    await attemptsRepository.addAttempt(
      attemptRow({ cycleId: 'cycle:a', puzzleId: 'puzzle:z', presentationIndex: 1 }),
    );
    await attemptsRepository.addAttempt(
      attemptRow({ cycleId: 'cycle:a', puzzleId: 'puzzle:z', presentationIndex: 3 }),
    );
    await attemptsRepository.addAttempt(
      attemptRow({ cycleId: 'cycle:b', puzzleId: 'puzzle:z', presentationIndex: 1 }),
    );

    // getAttempt round-trips by natural key; absent keys are undefined.
    expect((await attemptsRepository.getAttempt('cycle:a', 'puzzle:z', 1))?.presentationIndex).toBe(
      1,
    );
    expect(await attemptsRepository.getAttempt('cycle:a', 'puzzle:z', 2)).toBeUndefined();
    expect(await attemptsRepository.getAttempt('cycle:none', 'puzzle:z', 1)).toBeUndefined();

    // listForCycle is scoped to one cycle, ordered by puzzleId then index.
    expect(
      (await attemptsRepository.listForCycle('cycle:a')).map((r) => [
        r.puzzleId,
        r.presentationIndex,
      ]),
    ).toEqual([
      ['puzzle:m', 2],
      ['puzzle:z', 1],
      ['puzzle:z', 3],
    ]);
    expect(await attemptsRepository.listForCycle('cycle:none')).toEqual([]);

    // listForCycleAndPuzzle returns one puzzle's retry-pass rows by index.
    expect(
      (await attemptsRepository.listForCycleAndPuzzle('cycle:a', 'puzzle:z')).map(
        (r) => r.presentationIndex,
      ),
    ).toEqual([1, 3]);

    // listForPuzzle spans cycles, ordered by cycleId then index.
    expect(
      (await attemptsRepository.listForPuzzle('puzzle:z')).map((r) => [
        r.cycleId,
        r.presentationIndex,
      ]),
    ).toEqual([
      ['cycle:a', 1],
      ['cycle:a', 3],
      ['cycle:b', 1],
    ]);
    expect(await attemptsRepository.listForPuzzle('puzzle:none')).toEqual([]);
  });

  it('listAll returns every attempt ordered by cycleId, puzzleId then presentationIndex', async () => {
    expect(await attemptsRepository.listAll()).toEqual([]);

    await attemptsRepository.addAttempt(
      attemptRow({ cycleId: 'cycle:b', puzzleId: 'puzzle:a', presentationIndex: 1 }),
    );
    await attemptsRepository.addAttempt(
      attemptRow({ cycleId: 'cycle:a', puzzleId: 'puzzle:z', presentationIndex: 3 }),
    );
    await attemptsRepository.addAttempt(
      attemptRow({ cycleId: 'cycle:a', puzzleId: 'puzzle:z', presentationIndex: 1 }),
    );
    await attemptsRepository.addAttempt(
      attemptRow({ cycleId: 'cycle:a', puzzleId: 'puzzle:m', presentationIndex: 1 }),
    );

    expect(
      (await attemptsRepository.listAll()).map((row) => [
        row.cycleId,
        row.puzzleId,
        row.presentationIndex,
      ]),
    ).toEqual([
      ['cycle:a', 'puzzle:m', 1],
      ['cycle:a', 'puzzle:z', 1],
      ['cycle:a', 'puzzle:z', 3],
      ['cycle:b', 'puzzle:a', 1],
    ]);
  });

  it('deleteForPuzzleIds removes every attempt of the given puzzles and nothing else', async () => {
    await attemptsRepository.addAttempt(
      attemptRow({ cycleId: 'cycle:a', puzzleId: 'puzzle:a', presentationIndex: 1 }),
    );
    await attemptsRepository.addAttempt(
      attemptRow({ cycleId: 'cycle:a', puzzleId: 'puzzle:a', presentationIndex: 2 }),
    );
    await attemptsRepository.addAttempt(
      attemptRow({ cycleId: 'cycle:b', puzzleId: 'puzzle:a', presentationIndex: 1 }),
    );
    await attemptsRepository.addAttempt(
      attemptRow({ cycleId: 'cycle:a', puzzleId: 'puzzle:b', presentationIndex: 1 }),
    );

    await attemptsRepository.deleteForPuzzleIds(['puzzle:a']);
    expect(await db.puzzleAttempts.count()).toBe(1);
    expect(await attemptsRepository.listForPuzzle('puzzle:a')).toEqual([]);
    expect((await attemptsRepository.listForPuzzle('puzzle:b')).map((r) => r.cycleId)).toEqual([
      'cycle:a',
    ]);

    // An empty puzzle set is a no-op.
    await attemptsRepository.deleteForPuzzleIds([]);
    expect(await db.puzzleAttempts.count()).toBe(1);
  });

  it('deleteForTrainingSetIds removes every attempt of the given sets and nothing else', async () => {
    await attemptsRepository.addAttempt(
      attemptRow({
        cycleId: 'cycle:a',
        puzzleId: 'puzzle:a',
        presentationIndex: 1,
        trainingSetId: 'set:a',
      }),
    );
    await attemptsRepository.addAttempt(
      attemptRow({
        cycleId: 'cycle:a',
        puzzleId: 'puzzle:b',
        presentationIndex: 1,
        trainingSetId: 'set:a',
      }),
    );
    await attemptsRepository.addAttempt(
      attemptRow({
        cycleId: 'cycle:b',
        puzzleId: 'puzzle:a',
        presentationIndex: 1,
        trainingSetId: 'set:b',
      }),
    );

    await attemptsRepository.deleteForTrainingSetIds(['set:a']);
    expect(await db.puzzleAttempts.count()).toBe(1);
    expect(await attemptsRepository.listForCycle('cycle:a')).toEqual([]);
    expect((await attemptsRepository.listForCycle('cycle:b')).map((r) => r.puzzleId)).toEqual([
      'puzzle:a',
    ]);

    // An empty set-id input is a no-op.
    await attemptsRepository.deleteForTrainingSetIds([]);
    expect(await db.puzzleAttempts.count()).toBe(1);
  });
});
