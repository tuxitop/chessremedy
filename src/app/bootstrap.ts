/**
 * Feature 013/016 — application bootstrap (composition root seam).
 *
 * Awaited once in `main.tsx` before the first render so infrastructure data
 * remediation completes before any route — including the training surfaces —
 * reads `trainingSets`. It runs the one-time legacy auto-set cleanup and then
 * starts the Feature-016 sync scheduler when a provider reports connected.
 *
 * It is deliberately best-effort: neither `runLegacyAutoSetCleanup` nor the
 * sync scheduler throws, and `bootstrap` additionally swallows any rejection
 * so a storage or connection failure still renders the app.
 */

import {
  runLegacyAutoSetCleanup,
  type LegacyAutoSetCleanupDeps,
} from '@/infrastructure/training/legacy-auto-set-cleanup';
import {
  createSyncScheduler,
  type SyncScheduler,
  type SyncSchedulerService,
} from '@/infrastructure/sync/sync-scheduler';

/** Injectable sync wiring for `bootstrap` (tests supply fakes). */
export interface BootstrapSyncDeps {
  /** The service whose connection gates the scheduler. Defaults to the browser singleton. */
  readonly service?: SyncSchedulerService;
  /** A pre-built scheduler; otherwise one is created from `service`. */
  readonly scheduler?: SyncScheduler;
}

/**
 * Run startup remediation. Resolves once it has been attempted; it never
 * rejects, even when a dependency throws. The sync scheduler only starts when
 * `service.isConnected()` reports a usable credential.
 */
export async function bootstrap(
  deps?: LegacyAutoSetCleanupDeps,
  syncDeps?: BootstrapSyncDeps,
): Promise<void> {
  try {
    await runLegacyAutoSetCleanup(deps);
  } catch {
    // Best-effort: never block startup.
  }

  try {
    // Dynamic import keeps the Dropbox SDK out of the initial bundle; it is
    // only loaded once the app actually needs the sync service.
    const service =
      syncDeps?.service ?? (await import('@/infrastructure/sync/browser')).getBrowserSyncService();
    if (!(await service.isConnected())) {
      return;
    }
    const scheduler = syncDeps?.scheduler ?? createSyncScheduler({ service });
    await scheduler.start();
  } catch {
    // Best-effort: a sync failure must never block startup.
  }
}
