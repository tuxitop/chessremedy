import { describe, expect, it } from 'vitest';
import { blunderRowFixture, puzzleRowFixture } from '@/domain/puzzle/test-support';
import { puzzleIdOf } from '@/domain/puzzle/id';
import type { PuzzleRow } from '@/domain/puzzle/types';
import type { SetSource } from './cycleTypes';
import { orderPuzzles, resolveSetMembership, setSourceLabel } from './set';
import { poolEntryFixture } from './test-support';

const baseRow = puzzleRowFixture('mate-one');

/** A synthetic row with overridable provenance/difficulty (all other fields fixed). */
function row(sourceGameId: string, sourcePly: number, difficulty: number): PuzzleRow {
  return { ...baseRow, sourceGameId, sourcePly, difficulty };
}

function idOf(puzzle: PuzzleRow): string {
  return puzzleIdOf(puzzle.sourceGameId, puzzle.sourcePly);
}

describe('orderPuzzles', () => {
  it('orders by difficulty ascending and breaks ties by puzzle id', () => {
    const rows = [row('b', 1, 5), row('a', 1, 5), row('c', 1, 1)];
    expect(orderPuzzles(rows, 'difficultyAsc').map(idOf)).toEqual(['c:1', 'a:1', 'b:1']);
  });

  it('orders by source game id then source ply', () => {
    const rows = [row('b', 2, 1), row('a', 9, 1), row('a', 3, 1)];
    expect(orderPuzzles(rows, 'sourcePly').map(idOf)).toEqual(['a:3', 'a:9', 'b:2']);
  });

  it('preserves the provided base order for manual', () => {
    const rows = [row('c', 1, 9), row('a', 5, 1), row('b', 2, 5)];
    expect(orderPuzzles(rows, 'manual').map(idOf)).toEqual(['c:1', 'a:5', 'b:2']);
  });

  it('does not mutate the input array', () => {
    const rows = [row('b', 1, 5), row('a', 1, 1)];
    const snapshot = rows.map(idOf);
    orderPuzzles(rows, 'difficultyAsc');
    expect(rows.map(idOf)).toEqual(snapshot);
  });
});

describe('resolveSetMembership', () => {
  it('resolves a game source, orders it and applies the target-size cap', () => {
    const puzzles = [row('g', 4, 50), row('g', 2, 10), row('g', 6, 30)];
    const ids = resolveSetMembership({
      source: { kind: 'game', gameId: 'g' },
      puzzles,
      ordering: 'difficultyAsc',
      targetSize: 2,
    });
    expect(ids).toEqual(['g:2', 'g:6']);
  });

  it('uses source-ply as the game base order for a manual policy', () => {
    const puzzles = [row('g', 6, 1), row('g', 2, 1), row('g', 4, 1)];
    const ids = resolveSetMembership({
      source: { kind: 'game', gameId: 'g' },
      puzzles,
      ordering: 'manual',
      targetSize: 10,
    });
    expect(ids).toEqual(['g:2', 'g:4', 'g:6']);
  });

  it('resolves a pool source through its filters and base puzzle-id order', () => {
    const entries = [
      poolEntryFixture({
        puzzle: row('g', 3, 20),
        platform: 'lichess',
        timeControlCategory: 'blitz',
      }),
      poolEntryFixture({
        puzzle: row('g', 1, 20),
        platform: 'lichess',
        timeControlCategory: 'rapid',
      }),
      poolEntryFixture({
        puzzle: row('g', 2, 20),
        platform: 'chesscom',
        timeControlCategory: 'blitz',
      }),
    ];
    const ids = resolveSetMembership({
      source: { kind: 'pool', filters: { platform: 'lichess', timeControlCategory: 'blitz' } },
      puzzles: [],
      poolEntries: entries,
      ordering: 'manual',
      targetSize: 10,
    });
    expect(ids).toEqual(['g:3']);
  });

  it('filters a pool source by origin, objective, difficulty and game', () => {
    const tactical = puzzleRowFixture('mate-one');
    const blunder = blunderRowFixture('correct-move');
    const entries = [poolEntryFixture({ puzzle: tactical }), poolEntryFixture({ puzzle: blunder })];
    expect(
      resolveSetMembership({
        source: { kind: 'pool', filters: { origin: 'blunder' } },
        puzzles: [],
        poolEntries: entries,
        ordering: 'manual',
        targetSize: 10,
      }),
    ).toEqual([idOf(blunder)]);
    expect(
      resolveSetMembership({
        source: { kind: 'pool', filters: { tacticalObjective: 'forcing_mate' } },
        puzzles: [],
        poolEntries: entries,
        ordering: 'manual',
        targetSize: 10,
      }),
    ).toEqual([idOf(tactical)]);
    expect(
      resolveSetMembership({
        source: { kind: 'pool', filters: { sourceGameId: 'fixture:mate-one' } },
        puzzles: [],
        poolEntries: entries,
        ordering: 'manual',
        targetSize: 10,
      }),
    ).toEqual([idOf(tactical)]);
  });

  it('applies an explicit origin filter to a game source', () => {
    const tactical = puzzleRowFixture('mate-one');
    const blunder = blunderRowFixture('correct-move');
    const ids = resolveSetMembership({
      source: { kind: 'game', gameId: 'g' },
      puzzles: [tactical, blunder],
      ordering: 'manual',
      targetSize: 10,
      originFilter: 'blunder',
    });
    expect(ids).toEqual([idOf(blunder)]);
  });

  it('keeps a manual selection order and drops unknown ids', () => {
    const puzzles = [row('g', 2, 10), row('g', 6, 30)];
    const ids = resolveSetMembership({
      source: { kind: 'manual' },
      puzzles,
      manualIds: ['g:6', 'missing:1', 'g:2'],
      ordering: 'manual',
      targetSize: 10,
    });
    expect(ids).toEqual(['g:6', 'g:2']);
  });

  it('returns an empty membership when nothing resolves', () => {
    expect(
      resolveSetMembership({
        source: { kind: 'game', gameId: 'g' },
        puzzles: [],
        ordering: 'difficultyAsc',
        targetSize: 10,
      }),
    ).toEqual([]);
  });

  it('caps at targetSize and never exceeds it', () => {
    const puzzles = [row('g', 1, 1), row('g', 2, 2), row('g', 3, 3)];
    expect(
      resolveSetMembership({
        source: { kind: 'game', gameId: 'g' },
        puzzles,
        ordering: 'sourcePly',
        targetSize: 0,
      }),
    ).toEqual([]);
    expect(
      resolveSetMembership({
        source: { kind: 'game', gameId: 'g' },
        puzzles,
        ordering: 'sourcePly',
        targetSize: 2,
      }),
    ).toEqual(['g:1', 'g:2']);
  });
});

describe('setSourceLabel', () => {
  it('labels manual, game and unfiltered pool sources', () => {
    expect(setSourceLabel({ kind: 'manual' })).toBe('Manual selection');
    expect(setSourceLabel({ kind: 'game', gameId: 'abc' })).toBe('Game abc');
    expect(setSourceLabel({ kind: 'pool', filters: {} })).toBe('Puzzle pool');
  });

  it('spells out non-empty pool filters deterministically', () => {
    const source: SetSource = {
      kind: 'pool',
      filters: { origin: 'blunder', platform: 'lichess', timeControlCategory: 'blitz' },
    };
    expect(setSourceLabel(source)).toBe(
      'Puzzle pool (origin: blunder, platform: Lichess, time control: blitz)',
    );
  });
});

describe('block sources', () => {
  it('labels the Woodpecker block recipe with its size', () => {
    expect(setSourceLabel({ kind: 'auto', recipe: { kind: 'woodpeckerBlock', size: 200 } })).toBe(
      'Woodpecker block (200)',
    );
    expect(setSourceLabel({ kind: 'auto', recipe: { kind: 'woodpeckerBlock', size: 100 } })).toBe(
      'Woodpecker block (100)',
    );
  });

  it('never resolves a block source here (membership is a stored frozen snapshot)', () => {
    const puzzles = [row('g', 1, 1), row('g', 2, 2)];
    expect(
      resolveSetMembership({
        source: { kind: 'auto', recipe: { kind: 'woodpeckerBlock', size: 200 } },
        puzzles,
        ordering: 'difficultyAsc',
        targetSize: 10,
      }),
    ).toEqual([]);
  });

  it('labels a legacy/malformed auto source without a size instead of throwing', () => {
    expect(setSourceLabel({ kind: 'auto' } as unknown as SetSource)).toBe('Woodpecker block');
    expect(setSourceLabel({ kind: 'auto', recipe: {} } as unknown as SetSource)).toBe(
      'Woodpecker block',
    );
  });
});
