import { describe, expect, it, beforeEach } from 'vitest';
import { db } from './database';
import { DexieSyncBackupsRepository, syncBackupsRepository } from './sync-backups-repository';

function backup(id: string, createdAt: number, bytes: readonly number[] = [1, 2, 3]) {
  return { id, createdAt, payload: new Uint8Array(bytes) };
}

describe('sync backups repository', () => {
  beforeEach(async () => {
    await db.syncBackups.clear();
  });

  it('adds and gets a backup with its gzip payload bytes', async () => {
    const row = backup('backup-a', 10, [7, 8, 9]);
    await syncBackupsRepository.add(row);

    const stored = await syncBackupsRepository.get('backup-a');
    expect(stored?.id).toBe('backup-a');
    expect(stored?.createdAt).toBe(10);
    expect(stored?.payload).toBeInstanceOf(Uint8Array);
    expect([...stored!.payload]).toEqual([7, 8, 9]);
    expect(await syncBackupsRepository.get('missing')).toBeUndefined();
  });

  it('carries optional recovery metadata', async () => {
    await syncBackupsRepository.add({
      id: 'backup-meta',
      createdAt: 20,
      payload: new Uint8Array([1]),
      meta: { rev: 'r1', contentHash: 'h1', reason: 'conflict-exhausted' },
    });

    const stored = await syncBackupsRepository.get('backup-meta');
    expect(stored?.meta).toEqual({ rev: 'r1', contentHash: 'h1', reason: 'conflict-exhausted' });
  });

  it('lists backups newest first and ties by id', async () => {
    await syncBackupsRepository.add(backup('backup-old', 10));
    await syncBackupsRepository.add(backup('backup-b', 20));
    await syncBackupsRepository.add(backup('backup-a', 20));

    expect((await syncBackupsRepository.list()).map((b) => b.id)).toEqual([
      'backup-a',
      'backup-b',
      'backup-old',
    ]);
  });

  it('removes the given ids and clears the table', async () => {
    await syncBackupsRepository.add(backup('backup-a', 10));
    await syncBackupsRepository.add(backup('backup-b', 20));

    await syncBackupsRepository.remove(['backup-a']);
    expect((await syncBackupsRepository.list()).map((b) => b.id)).toEqual(['backup-b']);

    await syncBackupsRepository.remove([]);
    await syncBackupsRepository.clear();
    expect(await syncBackupsRepository.list()).toEqual([]);
  });

  it('works against an injected database instance', async () => {
    const repo = new DexieSyncBackupsRepository(db);
    await repo.add(backup('backup-injected', 1));
    expect((await repo.get('backup-injected'))?.id).toBe('backup-injected');
  });
});
