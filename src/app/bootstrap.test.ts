/**
 * Application bootstrap tests (Feature 013, Stage W4; Feature 016, Stage 6).
 *
 * The bootstrap runs the legacy cleanup with the default singleton repositories
 * and is best-effort: it resolves even when a dependency throws. It then starts
 * the sync scheduler only when a provider reports connected.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { bootstrap } from './bootstrap';
import { db } from '@/infrastructure/db/database';
import { settingsRepository } from '@/infrastructure/db/settings-repository';
import { SETTINGS_KEYS } from '@/config/app-config';
import type { SyncScheduler, SyncSchedulerService } from '@/infrastructure/sync/sync-scheduler';

function createScheduler(): SyncScheduler {
  return {
    start: vi.fn(async () => {}),
    stop: vi.fn(),
    triggerNow: vi.fn(),
    getLastTriggeredAt: vi.fn(() => null),
  };
}

function createService(connected: boolean): SyncSchedulerService {
  return {
    isConnected: async () => connected,
    syncNow: async () => undefined,
  };
}

describe('bootstrap', () => {
  beforeEach(async () => {
    await db.settings.clear();
    await db.trainingSets.clear();
    await db.trainingCycles.clear();
    await db.puzzleAttempts.clear();
  });

  it('runs the legacy cleanup with the default repositories', async () => {
    await expect(bootstrap()).resolves.toBeUndefined();
    expect(await settingsRepository.get(SETTINGS_KEYS.legacyAutoSetsCleaned)).toBe(true);
  });

  it('resolves even when a cleanup dependency throws', async () => {
    await expect(
      bootstrap({
        sets: {
          get: async () => {
            throw new Error('boom');
          },
          delete: async () => {},
        },
        settings: settingsRepository,
      }),
    ).resolves.toBeUndefined();
  });

  it('starts the sync scheduler when the provider is connected', async () => {
    const scheduler = createScheduler();

    await bootstrap(undefined, { service: createService(true), scheduler });

    expect(scheduler.start).toHaveBeenCalledTimes(1);
  });

  it('does not start the sync scheduler when the provider is disconnected', async () => {
    const scheduler = createScheduler();

    await bootstrap(undefined, { service: createService(false), scheduler });

    expect(scheduler.start).not.toHaveBeenCalled();
  });

  it('resolves when the sync connection probe throws', async () => {
    const scheduler = createScheduler();
    const service: SyncSchedulerService = {
      isConnected: async () => {
        throw new Error('storage unavailable');
      },
      syncNow: async () => undefined,
    };

    await expect(bootstrap(undefined, { service, scheduler })).resolves.toBeUndefined();
    expect(scheduler.start).not.toHaveBeenCalled();
  });
});
