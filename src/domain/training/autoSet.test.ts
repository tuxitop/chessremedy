import { describe, expect, it } from 'vitest';
import { puzzleIdOf } from '@/domain/puzzle/id';
import { puzzleRowFixture } from '@/domain/puzzle/test-support';
import type { PuzzleRow } from '@/domain/puzzle/types';
import {
  BLOCK_RECIPE_VERSION,
  BLOCK_SIZE_OPTIONS,
  DEFAULT_BLOCK_SIZE,
  QUICK_TRAIN_SET_ID,
  RECOMMENDED_MIN_BLOCK_SIZE,
  WOODPECKER_PLAN_CYCLES,
  derivePool,
  formWoodpeckerBlock,
} from './autoSet';

const baseRow = puzzleRowFixture('mate-one');

/** A synthetic row with overridable provenance/difficulty (all other fields fixed). */
function row(sourceGameId: string, sourcePly: number, difficulty: number): PuzzleRow {
  return { ...baseRow, sourceGameId, sourcePly, difficulty };
}

function idOf(puzzle: PuzzleRow): string {
  return puzzleIdOf(puzzle.sourceGameId, puzzle.sourcePly);
}

function ids(rows: readonly PuzzleRow[]): string[] {
  return rows.map(idOf);
}

describe('block vocabulary', () => {
  it('exposes the default size, options, guidance and version', () => {
    expect(DEFAULT_BLOCK_SIZE).toBe(200);
    expect([...BLOCK_SIZE_OPTIONS]).toEqual([100, 200, 400]);
    expect(RECOMMENDED_MIN_BLOCK_SIZE).toBe(100);
    expect(WOODPECKER_PLAN_CYCLES).toBe(6);
    expect(QUICK_TRAIN_SET_ID).toBe('__quick_train__');
    expect(BLOCK_RECIPE_VERSION).toBe(1);
  });
});

describe('derivePool', () => {
  function pool(): PuzzleRow[] {
    return [row('g', 1, 10), row('g', 2, 20), row('g', 3, 30)];
  }

  it('returns every owned puzzle not mastered and not in the open block', () => {
    const result = derivePool({
      puzzles: pool(),
      masteredIds: new Set(),
      openBlockPuzzleIds: new Set(),
    });
    expect(ids(result)).toEqual(['g:1', 'g:2', 'g:3']);
  });

  it('excludes mastered puzzles', () => {
    const result = derivePool({
      puzzles: pool(),
      masteredIds: new Set(['g:2']),
      openBlockPuzzleIds: new Set(),
    });
    expect(ids(result)).toEqual(['g:1', 'g:3']);
  });

  it('excludes the currently-open block members', () => {
    const result = derivePool({
      puzzles: pool(),
      masteredIds: new Set(),
      openBlockPuzzleIds: new Set(['g:1', 'g:3']),
    });
    expect(ids(result)).toEqual(['g:2']);
  });

  it('excludes both mastered and open-block puzzles', () => {
    const result = derivePool({
      puzzles: pool(),
      masteredIds: new Set(['g:1']),
      openBlockPuzzleIds: new Set(['g:2']),
    });
    expect(ids(result)).toEqual(['g:3']);
  });

  it('deduplicates repeated puzzle ids (first occurrence wins)', () => {
    const result = derivePool({
      puzzles: [row('g', 1, 10), row('g', 1, 99)],
      masteredIds: new Set(),
      openBlockPuzzleIds: new Set(),
    });
    expect(ids(result)).toEqual(['g:1']);
    expect(result[0]?.difficulty).toBe(10);
  });

  it('returns empty for an empty pool or a fully-excluded pool', () => {
    expect(
      derivePool({ puzzles: [], masteredIds: new Set(), openBlockPuzzleIds: new Set() }),
    ).toEqual([]);
    const all = pool();
    expect(
      derivePool({
        puzzles: all,
        masteredIds: new Set(ids(all)),
        openBlockPuzzleIds: new Set(),
      }),
    ).toEqual([]);
  });

  it('does not mutate the input rows', () => {
    const input = pool();
    const snapshot = input.map((puzzle) => ({ ...puzzle }));
    derivePool({ puzzles: input, masteredIds: new Set(), openBlockPuzzleIds: new Set() });
    expect(input).toEqual(snapshot);
  });
});

describe('formWoodpeckerBlock', () => {
  it('orders the selected ids by difficulty ascending', () => {
    const pool = [row('g', 1, 30), row('g', 2, 10), row('g', 3, 20)];
    expect(formWoodpeckerBlock({ pool, masteredIds: new Set(), size: 3 })).toEqual([
      'g:2',
      'g:3',
      'g:1',
    ]);
  });

  it('breaks difficulty ties by sourcePly then puzzleId', () => {
    const pool = [row('b', 2, 10), row('a', 5, 10), row('a', 2, 10), row('b', 1, 10)];
    expect(formWoodpeckerBlock({ pool, masteredIds: new Set(), size: 10 })).toEqual([
      'b:1',
      'a:2',
      'b:2',
      'a:5',
    ]);
  });

  it('caps the selection at the requested size', () => {
    const pool = [row('g', 1, 1), row('g', 2, 2), row('g', 3, 3), row('g', 4, 4)];
    expect(formWoodpeckerBlock({ pool, masteredIds: new Set(), size: 2 })).toEqual(['g:1', 'g:2']);
  });

  it('takes all of the pool when it is smaller than size', () => {
    const pool = [row('g', 1, 30), row('g', 2, 10)];
    expect(formWoodpeckerBlock({ pool, masteredIds: new Set(), size: DEFAULT_BLOCK_SIZE })).toEqual(
      ['g:2', 'g:1'],
    );
  });

  it('excludes mastered puzzles defensively', () => {
    const pool = [row('g', 1, 10), row('g', 2, 20)];
    expect(formWoodpeckerBlock({ pool, masteredIds: new Set(['g:1']), size: 10 })).toEqual(['g:2']);
  });

  it('returns empty for an empty pool, size 0 or a fully-mastered pool', () => {
    expect(formWoodpeckerBlock({ pool: [], masteredIds: new Set(), size: 200 })).toEqual([]);
    const pool = [row('g', 1, 10)];
    expect(formWoodpeckerBlock({ pool, masteredIds: new Set(), size: 0 })).toEqual([]);
    expect(formWoodpeckerBlock({ pool, masteredIds: new Set(ids(pool)), size: 10 })).toEqual([]);
  });

  it('is deterministic and does not mutate the input', () => {
    const pool = [row('g', 1, 30), row('g', 2, 10), row('g', 3, 20)];
    const snapshot = pool.map((puzzle) => ({ ...puzzle }));
    const first = formWoodpeckerBlock({ pool, masteredIds: new Set(), size: 3 });
    expect(formWoodpeckerBlock({ pool, masteredIds: new Set(), size: 3 })).toEqual(first);
    expect(pool).toEqual(snapshot);
  });
});
