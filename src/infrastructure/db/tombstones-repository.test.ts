import { describe, expect, it, beforeEach } from 'vitest';
import { db } from './database';
import { DexieTombstonesRepository, tombstonesRepository } from './tombstones-repository';
import { makeTombstone } from '@/domain/sync';

describe('tombstones repository', () => {
  beforeEach(async () => {
    await db.syncTombstones.clear();
  });

  it('puts and gets a tombstone by its deterministic id', async () => {
    const tombstone = makeTombstone('game', 'g1', 10, 'device-a');
    await tombstonesRepository.put(tombstone);

    expect(await tombstonesRepository.get(tombstone.id)).toEqual(tombstone);
    expect(await tombstonesRepository.get('missing')).toBeUndefined();
  });

  it('putMany writes a batch; listAll orders by deletedAt then id', async () => {
    await tombstonesRepository.putMany([
      makeTombstone('trainingSet', 's1', 20, 'device-a'),
      makeTombstone('game', 'g2', 10, 'device-a'),
      makeTombstone('game', 'g1', 10, 'device-a'),
    ]);

    expect((await tombstonesRepository.listAll()).map((t) => t.id)).toEqual([
      'game:g1',
      'game:g2',
      'trainingSet:s1',
    ]);

    await tombstonesRepository.putMany([]);
    expect(await tombstonesRepository.listAll()).toHaveLength(3);
  });

  it('listForKind filters by kind', async () => {
    await tombstonesRepository.putMany([
      makeTombstone('game', 'g1', 1, 'd'),
      makeTombstone('game', 'g2', 2, 'd'),
      makeTombstone('trainingSet', 's1', 3, 'd'),
    ]);

    expect((await tombstonesRepository.listForKind('game')).map((t) => t.recordId)).toEqual([
      'g1',
      'g2',
    ]);
    expect((await tombstonesRepository.listForKind('trainingSet')).map((t) => t.recordId)).toEqual([
      's1',
    ]);
  });

  it('removes the given ids and clears the table', async () => {
    await tombstonesRepository.putMany([
      makeTombstone('game', 'g1', 1, 'd'),
      makeTombstone('game', 'g2', 2, 'd'),
    ]);

    await tombstonesRepository.remove(['game:g1']);
    expect((await tombstonesRepository.listAll()).map((t) => t.id)).toEqual(['game:g2']);

    await tombstonesRepository.remove([]);
    await tombstonesRepository.clear();
    expect(await tombstonesRepository.listAll()).toEqual([]);
  });

  it('works against an injected database instance', async () => {
    const repo = new DexieTombstonesRepository(db);
    const tombstone = makeTombstone('trainingSet', 's1', 5, 'd');
    await repo.put(tombstone);
    expect(await repo.get(tombstone.id)).toEqual(tombstone);
  });
});
