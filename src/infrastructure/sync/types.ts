/**
 * Feature 016 — provider-independent sync contract (infrastructure).
 *
 * The `SyncProvider` boundary keeps the sync engine free of any concrete
 * backend (ADR-008): Dropbox is the first adapter, and a future provider only
 * has to implement this interface. `rev`/`content_hash` are provider concepts
 * and never leak past the adapter into the domain (ADR-017); they travel inside
 * the provider-owned `RemoteFileMetadata`.
 *
 * `RemoteFileMetadata` is re-exported from the pure domain module so both the
 * engine and the adapters share a single definition.
 */

import type { ProviderHttpErrorCode } from '@/infrastructure/providers/transport';
import type { DeviceId, RemoteFileMetadata, SyncStatus } from '@/domain/sync';

export type { RemoteFileMetadata } from '@/domain/sync';

/** Providers the sync engine can drive. Dropbox is the only V1 adapter. */
export type SyncProviderId = 'dropbox';

/**
 * Error codes a provider adapter may raise. They mirror the Feature-007
 * `ProviderHttpErrorCode` vocabulary (so transport failures map cleanly) and
 * add the two sync-specific cases: `conflict` (Dropbox HTTP 409 optimistic
 * concurrency) and `auth` (expired/invalid OAuth credentials).
 */
export type SyncProviderErrorCode = ProviderHttpErrorCode | 'conflict' | 'auth';

/** A typed failure raised by a `SyncProvider` implementation. */
export class SyncProviderError extends Error {
  readonly code: SyncProviderErrorCode;

  constructor(code: SyncProviderErrorCode, message: string) {
    super(message);
    this.name = 'SyncProviderError';
    this.code = code;
  }
}

/** Options for one `SyncProvider.upload`. `rev: null` creates a new file. */
export interface SyncProviderUploadOptions {
  /** Remote revision to update (`mode.update`), or `null` to create. */
  readonly rev: string | null;
  /** Ask the provider to auto-rename on a name collision instead of failing. */
  readonly autorename?: boolean;
}

/**
 * A timestamped recovery payload stored by the provider (ADR-017 step 4e).
 * The engine keeps the bytes locally in `syncBackups`; this is the remote
 * listing the Settings panel can offer for download/restore.
 */
export interface RemoteBackupInfo {
  readonly id: string;
  readonly name: string;
  readonly rev: string;
  readonly contentHash: string;
  readonly size: number;
  /** ISO-8601 server modification time. */
  readonly serverModified: string;
}

/**
 * Provider-independent sync boundary (ADR-008). An adapter is stateless from
 * the engine's point of view: connection state lives in `syncState`, and the
 * opaque `rev` is supplied back by the engine on each update.
 */
export interface SyncProvider {
  readonly id: SyncProviderId;
  /** Human-readable provider name for the Settings panel. */
  readonly label: string;
  /** Whether the build has the configuration needed to connect at all. */
  isConfigured(): boolean;
  /** Whether a usable credential is currently stored. */
  isConnected(): Promise<boolean>;
  /** Begin an authorization redirect to `redirectUri`. */
  beginConnect(redirectUri: string): Promise<void>;
  /** Complete an authorization callback (`?code=…`). */
  completeConnect(callback: URLSearchParams): Promise<void>;
  /** Forget the stored credentials (local data is untouched). */
  disconnect(): Promise<void>;
  /** Metadata for the sync file, or `null` when it does not exist yet. */
  getMetadata(): Promise<RemoteFileMetadata | null>;
  /** Download the raw (gzipped) sync file bytes. */
  download(): Promise<Uint8Array>;
  /** Upload raw bytes, updating `opts.rev` when present. */
  upload(bytes: Uint8Array, opts: SyncProviderUploadOptions): Promise<RemoteFileMetadata>;
  /** List timestamped recovery backups, when the provider supports them. */
  listBackups?(): Promise<RemoteBackupInfo[]>;
}

/**
 * What one `SyncService.syncNow()` round did. Kept provider-independent so the
 * engine can report it to the UI without exposing `rev`/`content_hash`.
 */
export type SyncRunOutcome =
  | 'disabled'
  | 'offline'
  | 'up-to-date'
  | 'created'
  | 'pushed'
  | 'pulled'
  | 'merged'
  | 'conflict-backup';

/** Result of one sync round. */
export interface SyncRunResult {
  readonly outcome: SyncRunOutcome;
  readonly status: SyncStatus;
  readonly uploadedBytes: number;
  readonly downloadedBytes: number;
  /** Remote metadata after the round, when a remote file exists. */
  readonly remote: RemoteFileMetadata | null;
  /** Local id of the recovery backup written on conflict exhaustion. */
  readonly backupId: string | null;
  readonly error: SyncProviderError | null;
}

/**
 * The status the engine emits to the UI and persists in `syncState` for
 * cross-session display (`disabled | disconnected | idle | syncing | offline |
 * error | conflict`).
 */
export interface SyncStatusSnapshot {
  readonly status: SyncStatus;
  readonly providerId: SyncProviderId | null;
  /** Epoch millis of the last successful sync, or `null`. */
  readonly lastSyncedAt: number | null;
  /** Human-readable last failure, or `null`. */
  readonly lastError: string | null;
  /** True while local changes (or tombstones) await a push. */
  readonly pending: boolean;
  readonly deviceId: DeviceId | null;
}
