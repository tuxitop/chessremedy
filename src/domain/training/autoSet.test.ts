import { describe, expect, it } from 'vitest';
import { puzzleIdOf } from '@/domain/puzzle/id';
import type { PuzzleRow } from '@/domain/puzzle/types';
import {
  AUTO_SET_ALL_ID,
  AUTO_SET_RANDOM_ID,
  AUTO_SET_VERSION,
  WOODPECKER_RANDOM_SIZE,
  autoSetDefinitions,
  deriveAutoSetMembership,
} from './autoSet';
import { CYCLE_CONFIG_VERSION } from './cycleTypes';
import { autoPoolRowFixture } from './test-support';

/** A pool of synthetic rows where row `index` has the given difficulty. */
function pool(...difficulties: number[]): PuzzleRow[] {
  return difficulties.map((difficulty, index) => autoPoolRowFixture(index, difficulty));
}

function ids(rows: readonly PuzzleRow[]): string[] {
  return rows.map((row) => puzzleIdOf(row.sourceGameId, row.sourcePly));
}

function derive(
  recipe: Parameters<typeof deriveAutoSetMembership>[0]['recipe'],
  poolRows: readonly PuzzleRow[],
  options: { readonly mastered?: readonly string[]; readonly setId?: string } = {},
): string[] {
  return deriveAutoSetMembership({
    recipe,
    pool: poolRows,
    masteredIds: new Set(options.mastered ?? []),
    setId: options.setId ?? AUTO_SET_RANDOM_ID,
  });
}

describe('auto-set vocabulary', () => {
  it('exposes the deterministic ids, size and version', () => {
    expect(AUTO_SET_ALL_ID).toBe('auto:all-puzzles');
    expect(AUTO_SET_RANDOM_ID).toBe('auto:woodpecker-random');
    expect(WOODPECKER_RANDOM_SIZE).toBe(200);
    expect(AUTO_SET_VERSION).toBe(1);
  });
});

describe('autoSetDefinitions', () => {
  it('defines the two seeded sets in deterministic order', () => {
    const definitions = autoSetDefinitions();
    expect(definitions.map((definition) => definition.id)).toEqual([
      AUTO_SET_ALL_ID,
      AUTO_SET_RANDOM_ID,
    ]);
    expect(definitions.map((definition) => definition.name)).toEqual([
      'All puzzles',
      'Woodpecker random',
    ]);
    expect(definitions[0]!.recipe).toEqual({ kind: 'allPuzzles' });
    expect(definitions[1]!.recipe).toEqual({ kind: 'woodpeckerRandom', size: 200 });
  });

  it('applies the fixed auto-set config presets', () => {
    for (const definition of autoSetDefinitions()) {
      expect(definition.config).toMatchObject({
        ordering: 'difficultyAsc',
        retryFailed: 'endOfCycle',
        allowSkip: true,
        targetAccuracy: 1,
        configVersion: CYCLE_CONFIG_VERSION,
      });
      expect(definition.config.hints.enabledLevels).toEqual([1, 2, 3, 4]);
      expect(definition.config.hints.firstHintLevel).toBe(2);
    }
  });

  it('returns fresh, non-aliased configs on each call', () => {
    const first = autoSetDefinitions();
    const second = autoSetDefinitions();
    expect(first[0]!.config).not.toBe(second[0]!.config);
    expect(first[0]!.config).not.toBe(first[1]!.config);
    expect(first[0]!.config.hints.enabledLevels).not.toBe(second[0]!.config.hints.enabledLevels);
  });
});

describe('deriveAutoSetMembership — allPuzzles', () => {
  it('returns every unmastered pool puzzle ordered by difficulty ascending', () => {
    const result = derive({ kind: 'allPuzzles' }, pool(30, 10, 20));
    expect(result).toEqual(['fixture:auto-1:1', 'fixture:auto-2:2', 'fixture:auto-0:0']);
  });

  it('excludes mastered puzzles', () => {
    const result = derive({ kind: 'allPuzzles' }, pool(30, 10, 20), {
      mastered: ['fixture:auto-2:2'],
    });
    expect(result).toEqual(['fixture:auto-1:1', 'fixture:auto-0:0']);
  });

  it('returns empty for an empty pool', () => {
    expect(derive({ kind: 'allPuzzles' }, [])).toEqual([]);
  });

  it('returns empty when every pool puzzle is mastered', () => {
    const rows = pool(30, 10, 20);
    expect(derive({ kind: 'allPuzzles' }, rows, { mastered: ids(rows) })).toEqual([]);
  });

  it('deduplicates repeated puzzle ids', () => {
    const rows = [autoPoolRowFixture(0, 5), { ...autoPoolRowFixture(0, 9) }];
    expect(derive({ kind: 'allPuzzles' }, rows)).toEqual(['fixture:auto-0:0']);
  });
});

describe('deriveAutoSetMembership — woodpeckerRandom', () => {
  it('selects a deterministic lowest-priority subset', () => {
    const rows = pool(0, 1, 2, 3, 4, 5);
    const result = derive({ kind: 'woodpeckerRandom', size: 3 }, rows, {
      setId: AUTO_SET_RANDOM_ID,
    });
    // Lowest hash priority indexes are 5, 4, 1; re-ordered by difficulty.
    expect(result).toEqual(['fixture:auto-1:1', 'fixture:auto-4:4', 'fixture:auto-5:5']);
  });

  it('is stable for the same pool, seed and size', () => {
    const rows = pool(0, 1, 2, 3, 4, 5);
    const recipe = { kind: 'woodpeckerRandom', size: 3 } as const;
    expect(derive(recipe, rows)).toEqual(derive(recipe, rows));
  });

  it('depends on the seed', () => {
    const rows = pool(0, 1, 2, 3, 4, 5);
    const recipe = { kind: 'woodpeckerRandom', size: 3 } as const;
    expect(derive(recipe, rows, { setId: 'other-seed' })).toEqual([
      'fixture:auto-1:1',
      'fixture:auto-2:2',
      'fixture:auto-3:3',
    ]);
  });

  it('caps the selection at the recipe size', () => {
    const result = derive({ kind: 'woodpeckerRandom', size: 2 }, pool(0, 1, 2, 3, 4));
    expect(result).toHaveLength(2);
  });

  it('returns every eligible puzzle when the pool is at or below the size', () => {
    const rows = pool(30, 10, 20);
    expect(derive({ kind: 'woodpeckerRandom', size: 10 }, rows)).toEqual([
      'fixture:auto-1:1',
      'fixture:auto-2:2',
      'fixture:auto-0:0',
    ]);
  });

  it('backfills a mastered departure to size deterministically', () => {
    const rows = pool(0, 1, 2, 3, 4, 5);
    const result = derive({ kind: 'woodpeckerRandom', size: 3 }, rows, {
      mastered: ['fixture:auto-5:5'],
    });
    expect(result).toEqual(['fixture:auto-0:0', 'fixture:auto-1:1', 'fixture:auto-4:4']);
  });

  it('returns empty for size 0', () => {
    expect(derive({ kind: 'woodpeckerRandom', size: 0 }, pool(0, 1, 2))).toEqual([]);
  });

  it('returns empty when all puzzles are mastered', () => {
    const rows = pool(0, 1, 2);
    expect(derive({ kind: 'woodpeckerRandom', size: 2 }, rows, { mastered: ids(rows) })).toEqual(
      [],
    );
  });
});

describe('deriveAutoSetMembership — determinism and purity', () => {
  it('does not mutate the input pool', () => {
    const rows = pool(30, 10, 20);
    const snapshot = rows.map((row) => ({ ...row }));
    derive({ kind: 'allPuzzles' }, rows);
    derive({ kind: 'woodpeckerRandom', size: 2 }, rows);
    expect(rows).toEqual(snapshot);
  });

  it('is deterministic across calls for both recipes', () => {
    const rows = pool(30, 10, 20, 40, 5, 25);
    expect(derive({ kind: 'allPuzzles' }, rows)).toEqual(derive({ kind: 'allPuzzles' }, rows));
    const recipe = { kind: 'woodpeckerRandom', size: 4 } as const;
    expect(derive(recipe, rows)).toEqual(derive(recipe, rows));
  });
});
