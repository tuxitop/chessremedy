import { describe, expect, it, beforeEach } from 'vitest';
import { db } from './database';
import {
  DexieSyncStateRepository,
  SYNC_STATE_KEYS,
  syncStateRepository,
} from './sync-state-repository';

describe('sync state repository', () => {
  beforeEach(async () => {
    await db.syncState.clear();
  });

  it('round-trips typed key/value rows and returns undefined for missing keys', async () => {
    expect(await syncStateRepository.get('missing')).toBeUndefined();

    await syncStateRepository.set('provider', 'dropbox');
    expect(await syncStateRepository.get<string>('provider')).toBe('dropbox');
  });

  it('stamps updatedAt on set', async () => {
    await syncStateRepository.set('pending', true);

    const row = await db.syncState.get('pending');
    expect(row?.value).toBe(true);
    expect(typeof row?.updatedAt).toBe('number');
  });

  it('patches an existing object value and no-ops on an absent key', async () => {
    await syncStateRepository.set('tokens', { accessToken: 'a', refreshToken: 'r' });

    const merged = await syncStateRepository.patch<{ accessToken: string; refreshToken: string }>(
      'tokens',
      { accessToken: 'a2' },
    );
    expect(merged).toEqual({ accessToken: 'a2', refreshToken: 'r' });
    expect(await syncStateRepository.get('tokens')).toEqual({
      accessToken: 'a2',
      refreshToken: 'r',
    });

    expect(await syncStateRepository.patch('missing', { x: 1 })).toBeUndefined();
  });

  it('removes one row and clears every row', async () => {
    await syncStateRepository.set('a', 1);
    await syncStateRepository.set('b', 2);

    await syncStateRepository.remove('a');
    expect(await syncStateRepository.get('a')).toBeUndefined();
    expect(await syncStateRepository.get('b')).toBe(2);

    await syncStateRepository.clear();
    expect(await syncStateRepository.get('b')).toBeUndefined();
    expect(await db.syncState.count()).toBe(0);
  });

  it('mints and persists a stable device id', async () => {
    const first = await syncStateRepository.getOrCreateDeviceId();
    const second = await syncStateRepository.getOrCreateDeviceId();

    expect(first).toMatch(/^[0-9a-f-]{36}$/i);
    expect(second).toBe(first);
    expect(await syncStateRepository.get(SYNC_STATE_KEYS.deviceId)).toBe(first);
  });

  it('works against an injected database instance', async () => {
    const repo = new DexieSyncStateRepository(db);
    await repo.set('provider', 'dropbox');
    expect(await repo.get<string>('provider')).toBe('dropbox');
  });
});
