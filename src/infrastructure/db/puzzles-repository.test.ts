import { describe, expect, it, beforeEach } from 'vitest';
import { db } from './database';
import { puzzlesRepository } from './puzzles-repository';
import { puzzleRowFixture } from '@/domain/puzzle/test-support';
import { puzzleIdOf } from '@/domain/puzzle/id';
import type { PuzzleRow } from '@/domain/puzzle/types';

/** A fixture row relocated to the given `(sourceGameId, sourcePly)` key. */
function rowFor(sourceGameId: string, sourcePly: number): PuzzleRow {
  return { ...puzzleRowFixture('mate-one'), sourceGameId, sourcePly };
}

describe('puzzles repository (Feature-013 pool/membership reads)', () => {
  beforeEach(async () => {
    await db.puzzles.clear();
  });

  it('listAll returns every puzzle ordered by sourceGameId then sourcePly', async () => {
    await puzzlesRepository.addIfAbsent([
      rowFor('game:b', 8),
      rowFor('game:a', 10),
      rowFor('game:a', 4),
    ]);

    const all = await puzzlesRepository.listAll();
    expect(all.map((row) => puzzleIdOf(row.sourceGameId, row.sourcePly))).toEqual([
      'game:a:4',
      'game:a:10',
      'game:b:8',
    ]);
  });

  it('getPuzzles hydrates membership ids in input order and omits absent/malformed ids', async () => {
    await puzzlesRepository.addIfAbsent([rowFor('game:a', 4), rowFor('game:b', 8)]);

    const hydrated = await puzzlesRepository.getPuzzles([
      'game:b:8',
      'missing:1',
      'not-an-id',
      'game:a:4',
      '',
    ]);
    expect(hydrated.map((row) => puzzleIdOf(row.sourceGameId, row.sourcePly))).toEqual([
      'game:b:8',
      'game:a:4',
    ]);
  });

  it('getPuzzles handles an empty or all-invalid input without a read', async () => {
    expect(await puzzlesRepository.getPuzzles([])).toEqual([]);
    expect(await puzzlesRepository.getPuzzles(['nonsense'])).toEqual([]);
  });
});
