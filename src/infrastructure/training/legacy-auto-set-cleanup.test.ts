/**
 * Legacy auto-set cleanup tests (Feature 013, Stage W4).
 *
 * Real Dexie over fake-indexeddb (shared test setup). Covers: the fresh-DB
 * no-op (marker written, no row created), removal of exactly the two legacy
 * ids and their cycles/attempts alongside untouched custom/block/puzzle data,
 * idempotence, an orphaned legacy row, the guard marker, and best-effort
 * failure (no marker, no data touched).
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { db } from '@/infrastructure/db/database';
import { trainingSetsRepository } from '@/infrastructure/db/training-sets-repository';
import { trainingCyclesRepository } from '@/infrastructure/db/training-cycles-repository';
import { attemptsRepository } from '@/infrastructure/db/attempts-repository';
import { puzzlesRepository } from '@/infrastructure/db/puzzles-repository';
import { settingsRepository } from '@/infrastructure/db/settings-repository';
import { SETTINGS_KEYS } from '@/config/app-config';
import { puzzleRowFixture } from '@/domain/puzzle/test-support';
import {
  blockSetFixture,
  cycleAttemptFixture,
  cycleFixture,
  legacyAutoSetFixture,
  setFixture,
} from '@/domain/training/test-support';
import { LEGACY_AUTO_SET_IDS, runLegacyAutoSetCleanup } from './legacy-auto-set-cleanup';

describe('runLegacyAutoSetCleanup', () => {
  beforeEach(async () => {
    await db.trainingSets.clear();
    await db.trainingCycles.clear();
    await db.puzzleAttempts.clear();
    await db.puzzles.clear();
    await db.settings.clear();
  });

  it('exposes exactly the two deterministic legacy ids', () => {
    expect([...LEGACY_AUTO_SET_IDS]).toEqual(['auto:all-puzzles', 'auto:woodpecker-random']);
  });

  it('is a no-op on a fresh DB and writes the guard marker without creating rows', async () => {
    const result = await runLegacyAutoSetCleanup();

    expect(result).toEqual({ status: 'cleaned', removed: 0 });
    expect(await settingsRepository.get(SETTINGS_KEYS.legacyAutoSetsCleaned)).toBe(true);
    expect(await trainingSetsRepository.list({ status: 'active' })).toEqual([]);
    expect(await trainingSetsRepository.list({ status: 'archived' })).toEqual([]);
  });

  it('removes exactly the two legacy rows and their cycles/attempts, touching nothing else', async () => {
    const legacyA = legacyAutoSetFixture('auto:all-puzzles', { puzzleIds: ['fixture:mate-one:6'] });
    const legacyB = legacyAutoSetFixture('auto:woodpecker-random', {
      puzzleIds: ['fixture:mate-two:10'],
    });
    const custom = setFixture({ id: 'set:custom', puzzleIds: ['fixture:mate-one:6'] });
    const block = blockSetFixture({ id: 'block:open', puzzleIds: ['fixture:mate-two:10'] });
    await trainingSetsRepository.create(legacyA);
    await trainingSetsRepository.create(legacyB);
    await trainingSetsRepository.create(custom);
    await trainingSetsRepository.create(block);

    await trainingCyclesRepository.create(
      cycleFixture({ id: 'legacy-a:c1', trainingSetId: 'auto:all-puzzles', cycleNumber: 1 }),
    );
    await trainingCyclesRepository.create(
      cycleFixture({
        id: 'legacy-b:c1',
        trainingSetId: 'auto:woodpecker-random',
        cycleNumber: 1,
      }),
    );
    await trainingCyclesRepository.create(
      cycleFixture({ id: 'custom:c1', trainingSetId: 'set:custom', cycleNumber: 1 }),
    );
    await trainingCyclesRepository.create(
      cycleFixture({ id: 'block:c1', trainingSetId: 'block:open', cycleNumber: 1 }),
    );
    await attemptsRepository.addAttempt(
      cycleAttemptFixture({
        cycleId: 'legacy-a:c1',
        trainingSetId: 'auto:all-puzzles',
        puzzleId: 'fixture:mate-one:6',
      }),
    );
    await attemptsRepository.addAttempt(
      cycleAttemptFixture({
        cycleId: 'legacy-b:c1',
        trainingSetId: 'auto:woodpecker-random',
        puzzleId: 'fixture:mate-two:10',
      }),
    );
    await attemptsRepository.addAttempt(
      cycleAttemptFixture({
        cycleId: 'custom:c1',
        trainingSetId: 'set:custom',
        puzzleId: 'fixture:mate-one:6',
      }),
    );
    await attemptsRepository.addAttempt(
      cycleAttemptFixture({
        cycleId: 'block:c1',
        trainingSetId: 'block:open',
        puzzleId: 'fixture:mate-two:10',
      }),
    );
    await puzzlesRepository.addIfAbsent([
      puzzleRowFixture('mate-one'),
      puzzleRowFixture('mate-two'),
    ]);

    const result = await runLegacyAutoSetCleanup();

    expect(result).toEqual({ status: 'cleaned', removed: 2 });
    expect(await trainingSetsRepository.get('auto:all-puzzles')).toBeUndefined();
    expect(await trainingSetsRepository.get('auto:woodpecker-random')).toBeUndefined();
    expect(await trainingCyclesRepository.listForSet('auto:all-puzzles')).toEqual([]);
    expect(await trainingCyclesRepository.listForSet('auto:woodpecker-random')).toEqual([]);
    expect(await attemptsRepository.listForCycle('legacy-a:c1')).toEqual([]);
    expect(await attemptsRepository.listForCycle('legacy-b:c1')).toEqual([]);

    // Everything else is byte-identical.
    expect(await trainingSetsRepository.get('set:custom')).toEqual(custom);
    expect(await trainingSetsRepository.get('block:open')).toEqual(block);
    expect(await trainingCyclesRepository.listForSet('set:custom')).toHaveLength(1);
    expect(await trainingCyclesRepository.listForSet('block:open')).toHaveLength(1);
    expect(await attemptsRepository.listForCycle('custom:c1')).toHaveLength(1);
    expect(await attemptsRepository.listForCycle('block:c1')).toHaveLength(1);
    expect(await puzzlesRepository.countForGame('fixture:mate-one')).toBe(1);
    expect(await puzzlesRepository.countForGame('fixture:mate-two')).toBe(1);
    expect(await settingsRepository.get(SETTINGS_KEYS.legacyAutoSetsCleaned)).toBe(true);
  });

  it('is idempotent: a second run is already-clean and changes nothing', async () => {
    await trainingSetsRepository.create(legacyAutoSetFixture('auto:all-puzzles'));

    expect(await runLegacyAutoSetCleanup()).toEqual({ status: 'cleaned', removed: 1 });
    expect(await runLegacyAutoSetCleanup()).toEqual({ status: 'already-clean', removed: 0 });
  });

  it('still removes a legacy row whose cycles/attempts are already gone', async () => {
    await trainingSetsRepository.create(legacyAutoSetFixture('auto:woodpecker-random'));

    expect(await runLegacyAutoSetCleanup()).toEqual({ status: 'cleaned', removed: 1 });
    expect(await trainingSetsRepository.get('auto:woodpecker-random')).toBeUndefined();
  });

  it('honours the guard marker and leaves legacy rows untouched when already clean', async () => {
    await settingsRepository.set(SETTINGS_KEYS.legacyAutoSetsCleaned, true);
    await trainingSetsRepository.create(legacyAutoSetFixture('auto:all-puzzles'));

    expect(await runLegacyAutoSetCleanup()).toEqual({ status: 'already-clean', removed: 0 });
    expect(await trainingSetsRepository.get('auto:all-puzzles')).toBeDefined();
  });

  it('is best-effort: a failing delete reports failed, writes no marker and touches nothing', async () => {
    const custom = setFixture({ id: 'set:custom' });
    await trainingSetsRepository.create(custom);
    await trainingSetsRepository.create(legacyAutoSetFixture('auto:all-puzzles'));

    const result = await runLegacyAutoSetCleanup({
      sets: {
        get: (id: string) => trainingSetsRepository.get(id),
        delete: async (): Promise<void> => {
          throw new Error('disk on fire');
        },
      },
      settings: settingsRepository,
    });

    expect(result).toEqual({ status: 'failed', removed: 0 });
    expect(await settingsRepository.get(SETTINGS_KEYS.legacyAutoSetsCleaned)).toBeUndefined();
    expect(await trainingSetsRepository.get('set:custom')).toEqual(custom);
    expect(await trainingSetsRepository.get('auto:all-puzzles')).toBeDefined();
  });
});
