import { describe, expect, it, beforeEach } from 'vitest';
import { db } from './database';
import { trainingSetsRepository } from './training-sets-repository';
import { trainingCyclesRepository } from './training-cycles-repository';
import { attemptsRepository } from './attempts-repository';
import { puzzlesRepository } from './puzzles-repository';
import { puzzleRowFixture } from '@/domain/puzzle/test-support';
import {
  blockSetFixture,
  cycleAttemptFixture,
  cycleFixture,
  legacyAutoSetFixture,
  setFixture,
} from '@/domain/training/test-support';

describe('training sets repository', () => {
  beforeEach(async () => {
    await db.trainingSets.clear();
    await db.trainingCycles.clear();
    await db.puzzleAttempts.clear();
    await db.puzzles.clear();
  });

  it('creates, gets and lists sets filtered by status (default active) in createdAt order', async () => {
    const early = setFixture({ id: 'set:early', createdAt: 1, updatedAt: 1 });
    const late = setFixture({ id: 'set:late', createdAt: 2, updatedAt: 2 });
    const archived = setFixture({
      id: 'set:archived',
      createdAt: 3,
      updatedAt: 3,
      status: 'archived',
    });
    await trainingSetsRepository.create(late);
    await trainingSetsRepository.create(early);
    await trainingSetsRepository.create(archived);

    expect(await trainingSetsRepository.get('set:early')).toEqual(early);
    expect(await trainingSetsRepository.get('set:missing')).toBeUndefined();

    // Default filter is active; archived sets are hidden.
    expect((await trainingSetsRepository.list()).map((s) => s.id)).toEqual([
      'set:early',
      'set:late',
    ]);
    expect((await trainingSetsRepository.list({ status: 'archived' })).map((s) => s.id)).toEqual([
      'set:archived',
    ]);
  });

  it('update merges the patch and bumps updatedAt; an absent id is a no-op', async () => {
    const set = setFixture({ id: 'set:edit', name: 'Before', createdAt: 1, updatedAt: 1 });
    await trainingSetsRepository.create(set);

    const updated = await trainingSetsRepository.update('set:edit', {
      name: 'After',
      status: 'archived',
      puzzleIds: ['puzzle:a'],
    });
    expect(updated?.name).toBe('After');
    expect(updated?.status).toBe('archived');
    expect(updated?.puzzleIds).toEqual(['puzzle:a']);
    expect(updated?.updatedAt).toBeGreaterThan(set.updatedAt);
    expect(updated?.createdAt).toBe(set.createdAt);
    expect(await trainingSetsRepository.get('set:edit')).toEqual(updated);

    expect(await trainingSetsRepository.update('set:missing', { name: 'x' })).toBeUndefined();
  });

  it('delete cascades its cycles and attempts but leaves puzzles and other sets untouched', async () => {
    const setA = setFixture({ id: 'set:a', puzzleIds: ['fixture:mate-one:6'] });
    const setB = setFixture({ id: 'set:b', puzzleIds: ['fixture:mate-two:10'] });
    await trainingSetsRepository.create(setA);
    await trainingSetsRepository.create(setB);

    await trainingCyclesRepository.create(
      cycleFixture({ id: 'cycle:a1', trainingSetId: 'set:a', cycleNumber: 1 }),
    );
    await trainingCyclesRepository.create(
      cycleFixture({ id: 'cycle:b1', trainingSetId: 'set:b', cycleNumber: 1 }),
    );
    await attemptsRepository.addAttempt(
      cycleAttemptFixture({ cycleId: 'cycle:a1', trainingSetId: 'set:a', puzzleId: 'fixture:a:6' }),
    );
    await attemptsRepository.addAttempt(
      cycleAttemptFixture({ cycleId: 'cycle:b1', trainingSetId: 'set:b', puzzleId: 'fixture:b:6' }),
    );
    await puzzlesRepository.addIfAbsent([puzzleRowFixture('mate-one')]);

    await trainingSetsRepository.delete('set:a');

    // The set, its cycles and its attempts are gone.
    expect(await trainingSetsRepository.get('set:a')).toBeUndefined();
    expect(await trainingCyclesRepository.listForSet('set:a')).toEqual([]);
    expect(await attemptsRepository.listForCycle('cycle:a1')).toEqual([]);

    // Another set's rows are untouched.
    expect(await trainingSetsRepository.get('set:b')).toEqual(setB);
    expect(await trainingCyclesRepository.listForSet('set:b')).toHaveLength(1);
    expect(await attemptsRepository.listForCycle('cycle:b1')).toHaveLength(1);

    // Puzzles are never touched by a set deletion.
    expect(await puzzlesRepository.countForGame('fixture:mate-one')).toBe(1);
  });

  it('removePuzzleIds strips membership from every set and bumps only changed rows', async () => {
    const setA = setFixture({ id: 'set:a', puzzleIds: ['p1', 'p2'], updatedAt: 1 });
    const setB = setFixture({ id: 'set:b', puzzleIds: ['p2', 'p3'], updatedAt: 2 });
    const setC = setFixture({ id: 'set:c', puzzleIds: ['p4'], updatedAt: 3 });
    await trainingSetsRepository.create(setA);
    await trainingSetsRepository.create(setB);
    await trainingSetsRepository.create(setC);

    await trainingSetsRepository.removePuzzleIds(['p2']);

    const a = await trainingSetsRepository.get('set:a');
    const b = await trainingSetsRepository.get('set:b');
    const c = await trainingSetsRepository.get('set:c');
    expect(a?.puzzleIds).toEqual(['p1']);
    expect(b?.puzzleIds).toEqual(['p3']);
    expect(a?.updatedAt).toBeGreaterThan(setA.updatedAt);
    expect(b?.updatedAt).toBeGreaterThan(setB.updatedAt);
    // A set that did not contain the removed id is untouched.
    expect(c).toEqual(setC);

    // An empty input is a no-op.
    await trainingSetsRepository.removePuzzleIds([]);
    expect(await trainingSetsRepository.get('set:a')).toEqual(a);
  });

  it('lists the sets containing a given puzzle id in createdAt order', async () => {
    await trainingSetsRepository.create(
      setFixture({ id: 'set:late', createdAt: 2, updatedAt: 2, puzzleIds: ['p2', 'p3'] }),
    );
    await trainingSetsRepository.create(
      setFixture({ id: 'set:early', createdAt: 1, updatedAt: 1, puzzleIds: ['p1', 'p2'] }),
    );
    await trainingSetsRepository.create(
      setFixture({ id: 'set:other', createdAt: 3, updatedAt: 3, puzzleIds: ['p4'] }),
    );

    expect((await trainingSetsRepository.listContainingPuzzle('p2')).map((s) => s.id)).toEqual([
      'set:early',
      'set:late',
    ]);
    expect(await trainingSetsRepository.listContainingPuzzle('missing')).toEqual([]);
  });

  it('getOpenBlock returns the single active auto block; closeBlock archives it', async () => {
    const block = blockSetFixture({
      id: 'block:one',
      createdAt: 2,
      updatedAt: 2,
      puzzleIds: ['p1'],
    });
    await trainingSetsRepository.create(
      setFixture({ id: 'set:custom', createdAt: 1, updatedAt: 1 }),
    );
    await trainingSetsRepository.create(block);
    await trainingSetsRepository.create(
      blockSetFixture({ id: 'block:archived', status: 'archived', createdAt: 3, updatedAt: 3 }),
    );
    // A legacy active auto row (no recipe) must never be read as the open block.
    await trainingSetsRepository.create(
      legacyAutoSetFixture('auto:all-puzzles', { createdAt: 4, updatedAt: 4, puzzleIds: ['p1'] }),
    );

    expect(await trainingSetsRepository.getOpenBlock()).toEqual(block);

    const closed = await trainingSetsRepository.closeBlock('block:one', 999);
    expect(closed?.status).toBe('archived');
    expect(closed?.updatedAt).toBe(999);
    expect(closed?.puzzleIds).toEqual(['p1']);
    expect(await trainingSetsRepository.getOpenBlock()).toBeUndefined();
    expect(await trainingSetsRepository.closeBlock('missing', 999)).toBeUndefined();
  });

  it('delete cascades a Woodpecker block, its cycles and attempts, leaving puzzles and siblings', async () => {
    const block = blockSetFixture({
      id: 'block:del',
      puzzleIds: ['fixture:mate-one:6', 'fixture:mate-two:10'],
    });
    const sibling = setFixture({ id: 'set:sibling', puzzleIds: ['fixture:mate-one:6'] });
    await trainingSetsRepository.create(block);
    await trainingSetsRepository.create(sibling);
    await trainingCyclesRepository.create(
      cycleFixture({ id: 'block:del:c1', trainingSetId: 'block:del', cycleNumber: 1 }),
    );
    await trainingCyclesRepository.create(
      cycleFixture({ id: 'block:del:c2', trainingSetId: 'block:del', cycleNumber: 2 }),
    );
    await trainingCyclesRepository.create(
      cycleFixture({ id: 'sibling:c1', trainingSetId: 'set:sibling', cycleNumber: 1 }),
    );
    await attemptsRepository.addAttempt(
      cycleAttemptFixture({
        cycleId: 'block:del:c1',
        trainingSetId: 'block:del',
        puzzleId: 'fixture:mate-one:6',
      }),
    );
    await attemptsRepository.addAttempt(
      cycleAttemptFixture({
        cycleId: 'block:del:c2',
        trainingSetId: 'block:del',
        puzzleId: 'fixture:mate-two:10',
      }),
    );
    await attemptsRepository.addAttempt(
      cycleAttemptFixture({
        cycleId: 'sibling:c1',
        trainingSetId: 'set:sibling',
        puzzleId: 'fixture:mate-one:6',
      }),
    );
    await puzzlesRepository.addIfAbsent([
      puzzleRowFixture('mate-one'),
      puzzleRowFixture('mate-two'),
    ]);

    await trainingSetsRepository.delete('block:del');

    // The block, its two cycles and both attempts are gone.
    expect(await trainingSetsRepository.get('block:del')).toBeUndefined();
    expect(await trainingCyclesRepository.listForSet('block:del')).toEqual([]);
    expect(await attemptsRepository.listForCycle('block:del:c1')).toEqual([]);
    expect(await attemptsRepository.listForCycle('block:del:c2')).toEqual([]);
    expect(await trainingSetsRepository.getOpenBlock()).toBeUndefined();

    // The sibling set and its cycle/attempt are untouched.
    expect(await trainingSetsRepository.get('set:sibling')).toEqual(sibling);
    expect(await trainingCyclesRepository.listForSet('set:sibling')).toHaveLength(1);
    expect(await attemptsRepository.listForCycle('sibling:c1')).toHaveLength(1);

    // Puzzles are never touched by a block deletion.
    expect(await puzzlesRepository.countForGame('fixture:mate-one')).toBe(1);
    expect(await puzzlesRepository.countForGame('fixture:mate-two')).toBe(1);
  });
});
