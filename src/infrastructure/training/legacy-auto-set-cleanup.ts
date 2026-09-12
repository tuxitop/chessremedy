/**
 * Feature 013 — one-time legacy auto-set cleanup (infrastructure).
 *
 * Before the explicit block model the app seeded two system-managed auto sets
 * with deterministic ids (`auto:all-puzzles`, `auto:woodpecker-random`) and
 * stored their cycles/attempts under those ids. They are dead data under the
 * current model, so a **one-time, idempotent, guarded** startup step removes
 * exactly those `trainingSets` rows and their cycles/attempts, reusing the
 * existing `trainingSetsRepository.delete(id)` transaction (the only cascade).
 *
 * It is **not** a Dexie schema migration (`PERSISTENCE_SCHEMA_VERSION` stays
 * 10), never creates a row, and is best-effort: a failure leaves the marker
 * unwritten so the next startup retries, and it never throws. The guard marker
 * `training.legacyAutoSetsCleaned` is written only after a successful run.
 */

import { SETTINGS_KEYS } from '@/config/app-config';
import type { TrainingSetsRepository } from '@/infrastructure/db/training-sets-repository';
import { trainingSetsRepository } from '@/infrastructure/db/training-sets-repository';
import type { SettingsRepository } from '@/infrastructure/db/settings-repository';
import { settingsRepository } from '@/infrastructure/db/settings-repository';

/** The deterministic ids of the pre-block-model auto sets. */
export const LEGACY_AUTO_SET_IDS = ['auto:all-puzzles', 'auto:woodpecker-random'] as const;

/** The minimal repositories the cleanup needs (injectable for tests). */
export interface LegacyAutoSetCleanupDeps {
  readonly sets: Pick<TrainingSetsRepository, 'get' | 'delete'>;
  readonly settings: Pick<SettingsRepository, 'get' | 'set'>;
}

/** Outcome of a cleanup run. */
export interface LegacyAutoSetCleanupResult {
  /** `cleaned` when the run happened, `already-clean` when the guard was set, `failed` on error. */
  readonly status: 'cleaned' | 'already-clean' | 'failed';
  /** Number of legacy `trainingSets` rows removed (cycles/attempts cascade with them). */
  readonly removed: number;
}

/**
 * Run the guarded legacy auto-set cleanup. Idempotent and best-effort: when the
 * settings marker is already `true` it is a no-op; otherwise it removes each
 * present legacy row (a row whose cycles/attempts are already gone is still
 * removed), then writes the marker. Any error yields `{ status: 'failed' }`
 * without writing the marker, so the next startup retries safely. Never throws.
 */
export async function runLegacyAutoSetCleanup(
  deps: LegacyAutoSetCleanupDeps = {
    sets: trainingSetsRepository,
    settings: settingsRepository,
  },
): Promise<LegacyAutoSetCleanupResult> {
  try {
    const cleaned = await deps.settings.get<boolean>(SETTINGS_KEYS.legacyAutoSetsCleaned);
    if (cleaned === true) {
      return { status: 'already-clean', removed: 0 };
    }
    let removed = 0;
    for (const id of LEGACY_AUTO_SET_IDS) {
      const existing = await deps.sets.get(id);
      if (existing !== undefined) {
        await deps.sets.delete(id);
        removed += 1;
      }
    }
    await deps.settings.set(SETTINGS_KEYS.legacyAutoSetsCleaned, true);
    return { status: 'cleaned', removed };
  } catch {
    return { status: 'failed', removed: 0 };
  }
}
