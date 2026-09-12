/**
 * Feature 016 — browser sync assembly (infrastructure).
 *
 * Wires the Dropbox `SyncProvider` to the Dexie snapshot gateway and the three
 * sync repositories into a memoised `SyncService` singleton. There is
 * deliberately **no scheduler here yet** (that is Feature-016 stage 6); the
 * engine is usable directly from the Settings panel meanwhile.
 *
 * `createBrowserSyncService` is exported so tests can inject a fake provider or
 * gateway without touching the singleton.
 */

import type { FetchLike } from '@/infrastructure/providers/transport';
import { syncBackupsRepository } from '@/infrastructure/db/sync-backups-repository';
import { syncStateRepository } from '@/infrastructure/db/sync-state-repository';
import { tombstonesRepository } from '@/infrastructure/db/tombstones-repository';
import { DropboxProvider, readDropboxAppKey } from './dropbox';
import { syncCollectionsGateway, type SyncCollectionsGateway } from './snapshot';
import { SyncService } from './sync-service';
import type { SyncProvider } from './types';

/** Overrides for the browser assembly (tests inject fakes here). */
export interface BrowserSyncServiceOptions {
  readonly provider?: SyncProvider;
  readonly gateway?: SyncCollectionsGateway;
  readonly appKey?: string;
  readonly fetchImpl?: FetchLike;
  readonly now?: () => number;
}

/**
 * Build a `SyncService` backed by the Dexie gateway/repositories. A caller may
 * supply its own provider/gateway; otherwise the Dropbox adapter is built from
 * the public `VITE_DROPBOX_APP_KEY`.
 */
export function createBrowserSyncService(options: BrowserSyncServiceOptions = {}): SyncService {
  const appKey = options.appKey ?? readDropboxAppKey();
  const provider =
    options.provider ??
    new DropboxProvider({
      ...(appKey !== undefined ? { appKey } : {}),
      syncState: syncStateRepository,
      ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.now !== undefined ? { now: options.now } : {}),
    });

  return new SyncService({
    provider,
    gateway: options.gateway ?? syncCollectionsGateway,
    syncState: syncStateRepository,
    tombstones: tombstonesRepository,
    backups: syncBackupsRepository,
    ...(options.now !== undefined ? { now: options.now } : {}),
  });
}

let browserSyncService: SyncService | null = null;

/** Lazily-created shared sync service for the browser (memoised). */
export function getBrowserSyncService(): SyncService {
  browserSyncService ??= createBrowserSyncService();
  return browserSyncService;
}
