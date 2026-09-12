/**
 * Feature 016 — sync infrastructure (barrel).
 *
 * Provider-independent sync surface: the `SyncProvider` contract and typed
 * errors, the gzip byte helpers, the Dexie snapshot gateway, the `SyncService`
 * engine (push/pull/merge/409-retry/backup + local export/import), the
 * best-effort scheduler and the browser assembly.
 */

export {
  SyncProviderError,
  type RemoteBackupInfo,
  type RemoteFileMetadata,
  type SyncProvider,
  type SyncProviderErrorCode,
  type SyncProviderId,
  type SyncProviderUploadOptions,
  type SyncRunOutcome,
  type SyncRunResult,
  type SyncStatusSnapshot,
} from './types';

export { GZIP_MIME_TYPE, gzipBytes, gunzipBytes, type ByteTransform } from './gzip';

export {
  DexieSyncCollectionsGateway,
  syncCollectionsGateway,
  type ApplyEnvelopeOptions,
  type SyncCollectionsGateway,
} from './snapshot';

export {
  EXPORT_FILE_PREFIX,
  SYNC_MAX_CONFLICT_RETRIES,
  SyncService,
  type SyncServiceOptions,
  type SyncStatusListener,
} from './sync-service';

export {
  createBrowserSyncService,
  getBrowserSyncService,
  type BrowserSyncServiceOptions,
} from './browser';

export {
  SYNC_SCHEDULER_DEFAULT_DEBOUNCE_MS,
  SYNC_SCHEDULER_DEFAULT_INTERVAL_MS,
  createSyncScheduler,
  type SyncScheduler,
  type SyncSchedulerDocument,
  type SyncSchedulerEventSource,
  type SyncSchedulerOptions,
  type SyncSchedulerService,
} from './sync-scheduler';
