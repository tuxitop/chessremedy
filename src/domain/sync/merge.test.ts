import { describe, expect, it } from 'vitest';
import type { SettingRow } from '@/infrastructure/db/database';
import {
  mergeCollection,
  mergeSettings,
  mergeTombstones,
  resolveAgainstTombstone,
  type MergeAccessors,
} from './merge';
import { SYNCED_SETTINGS_KEYS, selectSyncedSettings } from './settings';
import { makeTombstone } from './tombstone';
import type { SyncTombstone } from './types';

interface Row {
  readonly id: string;
  readonly updatedAt: number;
  readonly value: string;
}

const accessors: MergeAccessors<Row> = {
  keyOf: (row) => row.id,
  updatedAtOf: (row) => row.updatedAt,
  tombstoneKind: null,
};

const gameAccessors: MergeAccessors<Row> = { ...accessors, tombstoneKind: 'game' };

function row(id: string, updatedAt: number, value: string): Row {
  return { id, updatedAt, value };
}

describe('mergeCollection', () => {
  it('keeps the record with the newer updatedAt', () => {
    const local = [row('a', 10, 'local')];
    const remote = [row('a', 20, 'remote')];
    expect(mergeCollection(local, remote, accessors, [], 'dev-a', 'dev-b').records).toEqual([
      row('a', 20, 'remote'),
    ]);
    expect(mergeCollection(remote, local, accessors, [], 'dev-b', 'dev-a').records).toEqual([
      row('a', 20, 'remote'),
    ]);
  });

  it('breaks updatedAt ties by the lexicographically smaller deviceId, converging both ways', () => {
    const fromA = [row('a', 10, 'from-a')];
    const fromB = [row('a', 10, 'from-b')];
    const aMerges = mergeCollection(fromA, fromB, accessors, [], 'device-a', 'device-b').records;
    const bMerges = mergeCollection(fromB, fromA, accessors, [], 'device-b', 'device-a').records;
    expect(aMerges).toEqual([row('a', 10, 'from-a')]);
    expect(bMerges).toEqual(aMerges);
  });

  it('accepts one-sided records from either side', () => {
    const merged = mergeCollection(
      [row('a', 1, 'local')],
      [row('b', 2, 'remote')],
      accessors,
      [],
      'dev-a',
      'dev-b',
    );
    expect(merged.records).toEqual([row('a', 1, 'local'), row('b', 2, 'remote')]);
  });

  it('orders merged records by key regardless of input order', () => {
    const merged = mergeCollection(
      [row('c', 1, 'c'), row('a', 1, 'a')],
      [row('b', 1, 'b')],
      accessors,
      [],
      'dev-a',
      'dev-b',
    );
    expect(merged.records.map((record) => record.id)).toEqual(['a', 'b', 'c']);
  });

  it('deletes a record when a tombstone is at least as new as the record', () => {
    const tombstone = makeTombstone('game', 'a', 100, 'dev-a');
    const merged = mergeCollection(
      [row('a', 100, 'local')],
      [],
      gameAccessors,
      [tombstone],
      'a',
      'b',
    );
    expect(merged.records).toEqual([]);
    expect(merged.discardedTombstoneIds).toEqual([]);
  });

  it('deletes a one-sided record that only exists locally', () => {
    const tombstone = makeTombstone('game', 'a', 200, 'dev-b');
    const merged = mergeCollection(
      [row('a', 100, 'local')],
      [],
      gameAccessors,
      [tombstone],
      'a',
      'b',
    );
    expect(merged.records).toEqual([]);
  });

  it('lets a strictly newer record win as a recreation and discards the tombstone', () => {
    const tombstone = makeTombstone('game', 'a', 100, 'dev-b');
    const merged = mergeCollection(
      [row('a', 150, 'recreated')],
      [],
      gameAccessors,
      [tombstone],
      'a',
      'b',
    );
    expect(merged.records).toEqual([row('a', 150, 'recreated')]);
    expect(merged.discardedTombstoneIds).toEqual([tombstone.id]);
  });

  it('ignores tombstones of another kind', () => {
    const setTombstone = makeTombstone('trainingSet', 'a', 500, 'dev-b');
    const merged = mergeCollection(
      [row('a', 100, 'local')],
      [],
      gameAccessors,
      [setTombstone],
      'a',
      'b',
    );
    expect(merged.records).toEqual([row('a', 100, 'local')]);
  });
});

describe('resolveAgainstTombstone', () => {
  it('keeps a record without a tombstone', () => {
    expect(resolveAgainstTombstone(10, undefined)).toEqual({ action: 'keep' });
  });

  it('deletes at the inclusive boundary and recreates strictly above it', () => {
    const tombstone = makeTombstone('game', 'a', 100, 'dev-a');
    expect(resolveAgainstTombstone(100, tombstone)).toEqual({
      action: 'delete',
      tombstoneId: tombstone.id,
    });
    expect(resolveAgainstTombstone(101, tombstone)).toEqual({
      action: 'recreate',
      tombstoneId: tombstone.id,
    });
  });
});

describe('mergeTombstones', () => {
  it('keeps the newer deletion', () => {
    const local = [makeTombstone('game', 'a', 10, 'dev-a')];
    const remote = [makeTombstone('game', 'a', 20, 'dev-b')];
    expect(mergeTombstones(local, remote, 'dev-a', 'dev-b')).toEqual([
      makeTombstone('game', 'a', 20, 'dev-b'),
    ]);
  });

  it('converges on a tie by deviceId in both directions', () => {
    const fromA = [makeTombstone('game', 'a', 10, 'device-a')];
    const fromB = [makeTombstone('game', 'a', 10, 'device-b')];
    const aMerges = mergeTombstones(fromA, fromB, 'device-a', 'device-b');
    const bMerges = mergeTombstones(fromB, fromA, 'device-b', 'device-a');
    expect(aMerges).toEqual([makeTombstone('game', 'a', 10, 'device-a')]);
    expect(bMerges).toEqual(aMerges);
  });

  it('accepts one-sided tombstones and orders by id', () => {
    const merged = mergeTombstones(
      [makeTombstone('game', 'z', 1, 'dev-a')],
      [makeTombstone('trainingSet', 'a', 2, 'dev-b')],
      'dev-a',
      'dev-b',
    );
    expect(merged.map((tombstone) => tombstone.id)).toEqual([
      makeTombstone('game', 'z', 1, 'dev-a').id,
      makeTombstone('trainingSet', 'a', 2, 'dev-b').id,
    ]);
  });
});

describe('mergeSettings', () => {
  const theme: SettingRow = { key: 'theme', value: 'dark', updatedAt: 1 };
  const engine: SettingRow = { key: 'engine.defaults', value: {}, updatedAt: 5 };
  const refreshToken: SettingRow = { key: 'sync.refreshToken', value: 'secret', updatedAt: 9 };
  const oauthToken: SettingRow = { key: 'oauth.accessToken', value: 'secret', updatedAt: 9 };

  it('never lets a credential row cross the wire', () => {
    const merged = mergeSettings([theme, refreshToken, oauthToken], [engine], 'dev-a', 'dev-b');
    expect(merged.records.map((setting) => setting.key).sort()).toEqual([
      'engine.defaults',
      'theme',
    ]);
  });

  it('selectSyncedSettings keeps allowlisted preferences and drops secrets/bookkeeping', () => {
    const bookkeeping: SettingRow = {
      key: 'training.legacyAutoSetsCleaned',
      value: true,
      updatedAt: 3,
    };
    const selected = selectSyncedSettings([theme, engine, refreshToken, oauthToken, bookkeeping]);
    expect(selected.map((setting) => setting.key).sort()).toEqual(['engine.defaults', 'theme']);
  });

  it('exposes the allowlist as the source of truth', () => {
    expect(SYNCED_SETTINGS_KEYS).toContain('theme');
    expect(SYNCED_SETTINGS_KEYS).not.toContain('sync.refreshToken');
  });
});

describe('tombstone helpers', () => {
  it('mints a deterministic id and keeps the kind/recordId/device', () => {
    const tombstone: SyncTombstone = makeTombstone('trainingSet', 'set-1', 42, 'dev-a');
    expect(tombstone).toEqual({
      id: 'trainingSet:set-1',
      kind: 'trainingSet',
      recordId: 'set-1',
      deletedAt: 42,
      deviceId: 'dev-a',
    });
  });
});
