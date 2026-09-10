import { describe, expect, it, beforeEach } from 'vitest';
import { db } from './database';
import { trainingCyclesRepository } from './training-cycles-repository';
import { cycleFixture } from '@/domain/training/test-support';

describe('training cycles repository', () => {
  beforeEach(async () => {
    await db.trainingCycles.clear();
  });

  it('creates, gets and lists a set’s cycles in cycle-number order', async () => {
    const cycle1 = cycleFixture({ id: 'cycle:1', trainingSetId: 'set:a', cycleNumber: 1 });
    const cycle2 = cycleFixture({ id: 'cycle:2', trainingSetId: 'set:a', cycleNumber: 2 });
    const other = cycleFixture({ id: 'cycle:other', trainingSetId: 'set:b', cycleNumber: 1 });
    await trainingCyclesRepository.create(cycle2);
    await trainingCyclesRepository.create(cycle1);
    await trainingCyclesRepository.create(other);

    expect(await trainingCyclesRepository.get('cycle:1')).toEqual(cycle1);
    expect(await trainingCyclesRepository.get('cycle:missing')).toBeUndefined();

    expect((await trainingCyclesRepository.listForSet('set:a')).map((c) => c.id)).toEqual([
      'cycle:1',
      'cycle:2',
    ]);
    expect(await trainingCyclesRepository.listForSet('set:missing')).toEqual([]);
  });

  it('getByNumber reads the compound [trainingSetId+cycleNumber] key', async () => {
    const cycle = cycleFixture({ id: 'cycle:1', trainingSetId: 'set:a', cycleNumber: 1 });
    await trainingCyclesRepository.create(cycle);

    expect(await trainingCyclesRepository.getByNumber('set:a', 1)).toEqual(cycle);
    expect(await trainingCyclesRepository.getByNumber('set:a', 2)).toBeUndefined();
    expect(await trainingCyclesRepository.getByNumber('set:b', 1)).toBeUndefined();
  });

  it('enforces the unique [trainingSetId+cycleNumber] key', async () => {
    await trainingCyclesRepository.create(
      cycleFixture({ id: 'cycle:1', trainingSetId: 'set:a', cycleNumber: 1 }),
    );
    await expect(
      trainingCyclesRepository.create(
        cycleFixture({ id: 'cycle:duplicate', trainingSetId: 'set:a', cycleNumber: 1 }),
      ),
    ).rejects.toThrow();
    expect(await trainingCyclesRepository.listForSet('set:a')).toHaveLength(1);
  });

  it('updateStatus merges lifecycle fields and no-ops on an absent id', async () => {
    const cycle = cycleFixture({ id: 'cycle:1', trainingSetId: 'set:a', cycleNumber: 1 });
    await trainingCyclesRepository.create(cycle);

    const completed = await trainingCyclesRepository.updateStatus('cycle:1', {
      status: 'completed',
      completedAt: 123,
    });
    expect(completed?.status).toBe('completed');
    expect(completed?.completedAt).toBe(123);
    expect(completed?.abandonedAt).toBeNull();
    // Snapshot fields are untouched by a status change.
    expect(completed?.puzzleIds).toEqual(cycle.puzzleIds);
    expect(completed?.config).toEqual(cycle.config);
    expect(await trainingCyclesRepository.get('cycle:1')).toEqual(completed);

    expect(
      await trainingCyclesRepository.updateStatus('cycle:missing', { status: 'abandoned' }),
    ).toBeUndefined();
  });

  it('deleteForSet removes every cycle of one set and nothing else', async () => {
    await trainingCyclesRepository.create(
      cycleFixture({ id: 'cycle:a1', trainingSetId: 'set:a', cycleNumber: 1 }),
    );
    await trainingCyclesRepository.create(
      cycleFixture({ id: 'cycle:a2', trainingSetId: 'set:a', cycleNumber: 2 }),
    );
    await trainingCyclesRepository.create(
      cycleFixture({ id: 'cycle:b1', trainingSetId: 'set:b', cycleNumber: 1 }),
    );

    await trainingCyclesRepository.deleteForSet('set:a');

    expect(await trainingCyclesRepository.listForSet('set:a')).toEqual([]);
    expect((await trainingCyclesRepository.listForSet('set:b')).map((c) => c.id)).toEqual([
      'cycle:b1',
    ]);
  });
});
