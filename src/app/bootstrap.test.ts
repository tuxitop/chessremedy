/**
 * Application bootstrap tests (Feature 013, Stage W4).
 *
 * The bootstrap runs the legacy cleanup with the default singleton repositories
 * and is best-effort: it resolves even when a dependency throws.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { bootstrap } from './bootstrap';
import { db } from '@/infrastructure/db/database';
import { settingsRepository } from '@/infrastructure/db/settings-repository';
import { SETTINGS_KEYS } from '@/config/app-config';

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
});
