/**
 * Feature 016 — sync engine (infrastructure).
 *
 * `SyncService` implements plan §8.3: it gzips the canonical local envelope,
 * compares it with the remote metadata and drives the ADR-017 push/pull/merge
 * algorithm, including the bounded 409 retry and the timestamped recovery
 * backup. It also owns the provider-independent status surface and the
 * provider-free local export/import (G4).
 *
 * Design constraints (spec / plan):
 *
 * - **Never throws for a routine sync failure.** Every failure is caught, the
 *   `error`/`offline`/`conflict` status is emitted and a `SyncRunResult` is
 *   returned; a sync never blocks a UI action.
 * - **Deterministic bytes.** The gateway stamps `exportedAt` with `Date.now()`,
 *   which would defeat the content-hash comparison; the engine re-stamps the
 *   envelope with the latest effective record timestamp before serializing, so
 *   logically unchanged data always yields identical bytes. The clock is
 *   injectable for `lastSyncedAt`, backup ids and export filenames.
 * - **Remote-change detection is relative to the last observed remote hash**
 *   (`lastRemoteContentHash`), not to `lastPushedHash`: the envelope carries the
 *   producing `deviceId`, so two devices with identical data produce different
 *   bytes. Tracking both hashes prevents an endless re-upload ping-pong.
 * - **Deletion wins the round.** Tombstones are applied by the gateway after the
 *   record upserts, through the existing ownership cascades (ADR-018 cache is
 *   never touched).
 * - **Secrets never leave `syncState`.** Only the OAuth tokens persisted by the
 *   provider live there; the envelope settings allowlist excludes them.
 */

import {
  SYNC_COLLECTION_SPECS,
  dropboxContentHash,
  parseEnvelope,
  serializeEnvelope,
  type DeviceId,
  type RemoteFileMetadata,
  type SyncCollectionName,
  type SyncEnvelopeCollectionsV1,
  type SyncEnvelopeV1,
  type SyncStatus,
} from '@/domain/sync';
import type { SyncBackupsRepository } from '@/infrastructure/db/sync-backups-repository';
import {
  SYNC_STATE_KEYS,
  type SyncStateRepository,
} from '@/infrastructure/db/sync-state-repository';
import type { TombstonesRepository } from '@/infrastructure/db/tombstones-repository';
import { gunzipBytes, gzipBytes, type ByteTransform } from './gzip';
import type { SyncCollectionsGateway } from './snapshot';
import {
  SyncProviderError,
  type SyncProvider,
  type SyncRunResult,
  type SyncStatusSnapshot,
} from './types';

/** Default number of optimistic-concurrency retries before a backup (ADR-017). */
export const SYNC_MAX_CONFLICT_RETRIES = 3;

/** Prefix of a provider-free export file (`chessremedy-backup-<iso>.json.gz`). */
export const EXPORT_FILE_PREFIX = 'chessremedy-backup-';

/** Injected dependencies of `SyncService`. */
export interface SyncServiceOptions {
  readonly provider: SyncProvider;
  readonly gateway: SyncCollectionsGateway;
  readonly syncState: SyncStateRepository;
  readonly tombstones: TombstonesRepository;
  readonly backups: SyncBackupsRepository;
  /** Gzip step (defaults to the browser-native stream transform). */
  readonly gzip?: ByteTransform;
  /** Gunzip step (defaults to the browser-native stream transform). */
  readonly gunzip?: ByteTransform;
  /** Clock injection for deterministic timestamps. Defaults to `Date.now`. */
  readonly now?: () => number;
  /** Online probe; defaults to `navigator.onLine`. Injectable for tests. */
  readonly isOnline?: () => boolean;
  /** ADR-017 conflict retries before the timestamped backup. Defaults to 3. */
  readonly maxConflictRetries?: number;
}

/** The canonical local payload plus its serialized bytes and content hash. */
interface LocalPayload {
  readonly envelope: SyncEnvelopeV1;
  readonly bytes: Uint8Array;
  readonly hash: string;
}

/** A status subscriber. */
export type SyncStatusListener = (snapshot: SyncStatusSnapshot) => void;

/**
 * Provider-independent sync engine. Constructed with injected dependencies so
 * it can be driven against the Dexie gateway in the app and against fakes in
 * tests.
 */
export class SyncService {
  private readonly provider: SyncProvider;
  private readonly gateway: SyncCollectionsGateway;
  private readonly syncState: SyncStateRepository;
  private readonly tombstones: TombstonesRepository;
  private readonly backups: SyncBackupsRepository;
  private readonly gzip: ByteTransform | undefined;
  private readonly gunzip: ByteTransform | undefined;
  private readonly now: () => number;
  private readonly isOnline: () => boolean;
  private readonly maxConflictRetries: number;

  private readonly listeners = new Set<SyncStatusListener>();
  private snapshot: SyncStatusSnapshot;
  private hydrated = false;
  private inFlight: Promise<SyncRunResult> | null = null;

  constructor(options: SyncServiceOptions) {
    this.provider = options.provider;
    this.gateway = options.gateway;
    this.syncState = options.syncState;
    this.tombstones = options.tombstones;
    this.backups = options.backups;
    this.gzip = options.gzip;
    this.gunzip = options.gunzip;
    this.now = options.now ?? Date.now;
    this.isOnline =
      options.isOnline ??
      (() => (typeof globalThis.navigator !== 'undefined' ? globalThis.navigator.onLine : true));
    this.maxConflictRetries = options.maxConflictRetries ?? SYNC_MAX_CONFLICT_RETRIES;
    this.snapshot = {
      status: 'disabled',
      providerId: options.provider.id,
      lastSyncedAt: null,
      lastError: null,
      pending: false,
      deviceId: null,
    };
  }

  /** Whether the build has the configuration needed to connect at all. */
  isConfigured(): boolean {
    return this.provider.isConfigured();
  }

  /** Whether a usable credential is currently stored. */
  isConnected(): Promise<boolean> {
    return this.provider.isConnected();
  }

  /**
   * Begin the provider authorization redirect. No-op (status `disabled`) when
   * the provider is unconfigured; failures are surfaced, never thrown.
   */
  async connect(redirectUri?: string): Promise<void> {
    try {
      if (!this.provider.isConfigured()) {
        await this.emit({ status: 'disabled', lastError: 'Synchronization is not configured.' });
        return;
      }
      await this.provider.beginConnect(redirectUri ?? this.defaultRedirectUri());
    } catch (error) {
      await this.emit({ status: 'error', lastError: asProviderError(error).message });
    }
  }

  /**
   * Complete an authorization callback (`?code=…`). The error is re-thrown so
   * the Settings panel can show it; the status is persisted either way.
   */
  async completeConnect(callback: URLSearchParams): Promise<void> {
    try {
      await this.provider.completeConnect(callback);
      await this.emit({ status: 'idle', lastError: null, pending: true });
    } catch (error) {
      await this.emit({ status: 'error', lastError: asProviderError(error).message });
      throw error;
    }
  }

  /**
   * Forget the provider credentials. Local data and tombstones are kept; the
   * `rev`/hash bookkeeping is retained so a reconnect can resume safely.
   */
  async disconnect(): Promise<void> {
    try {
      await this.provider.disconnect();
      await this.emit({ status: 'disconnected', lastError: null });
    } catch (error) {
      await this.emit({ status: 'error', lastError: asProviderError(error).message });
    }
  }

  /** Subscribe to status snapshots; returns an unsubscribe function. */
  subscribe(listener: SyncStatusListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** The current status snapshot, hydrated from persisted state on first read. */
  async getStatus(): Promise<SyncStatusSnapshot> {
    await this.hydrate();
    return this.snapshot;
  }

  /**
   * Run one synchronization round. Coalesces concurrent calls (the second
   * caller receives the in-flight result) and never rejects.
   */
  syncNow(): Promise<SyncRunResult> {
    if (this.inFlight !== null) {
      return this.inFlight;
    }
    const run = this.runSync();
    this.inFlight = run.finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /**
   * Local export (G4): the gzipped canonical envelope as a downloadable file.
   * Works with no provider configured.
   */
  async exportBackup(): Promise<{ bytes: Uint8Array; fileName: string }> {
    const envelope = await this.gateway.exportLocal();
    const bytes = await gzipBytes(new TextEncoder().encode(serializeEnvelope(envelope)), this.gzip);
    return { bytes, fileName: exportFileName(this.now()) };
  }

  /**
   * Local import (G4): gunzip, parse + migrate + validate, then merge through
   * the canonical gateway path (tombstones respected, time control recomputed).
   * Works with no provider configured.
   */
  async importBackup(bytes: Uint8Array): Promise<{ merged: true }> {
    const json = new TextDecoder().decode(await gunzipBytes(bytes, this.gunzip));
    const envelope = parseEnvelope(json);
    await this.gateway.applyEnvelope(envelope, { remoteDeviceId: envelope.deviceId });
    return { merged: true };
  }

  // --- engine -------------------------------------------------------------

  private async runSync(): Promise<SyncRunResult> {
    await this.hydrate();

    if (!this.provider.isConfigured()) {
      await this.emit({ status: 'disabled', lastError: null, pending: false });
      return makeResult({ outcome: 'disabled', status: 'disabled' });
    }
    if (!(await this.provider.isConnected())) {
      await this.emit({ status: 'disconnected', lastError: null });
      return makeResult({ outcome: 'disabled', status: 'disconnected' });
    }
    if (!this.isOnline()) {
      await this.emit({ status: 'offline', lastError: null, pending: true });
      return makeResult({ outcome: 'offline', status: 'offline' });
    }

    await this.emit({ status: 'syncing', lastError: null });
    try {
      const local = await this.buildLocalPayload();
      const [lastPushedHash, lastRemoteHash] = await Promise.all([
        this.syncState.get<string>(SYNC_STATE_KEYS.lastPushedHash),
        this.syncState.get<string>(SYNC_STATE_KEYS.lastRemoteContentHash),
      ]);
      const remote = await this.provider.getMetadata();

      // Step 3 — no remote yet: create it.
      if (remote === null) {
        const uploaded = await this.provider.upload(local.bytes, { rev: null });
        await this.commit(uploaded, local.hash, uploaded.contentHash);
        return makeResult({
          outcome: 'created',
          status: 'idle',
          uploadedBytes: local.bytes.byteLength,
          remote: uploaded,
        });
      }

      const localChanged = lastPushedHash === undefined || local.hash !== lastPushedHash;
      const remoteChanged = lastRemoteHash === undefined || remote.contentHash !== lastRemoteHash;

      // Step 4 — both sides unchanged: nothing to do.
      if (!localChanged && !remoteChanged) {
        await this.emit({
          status: 'idle',
          lastSyncedAt: this.now(),
          pending: false,
          lastError: null,
        });
        return makeResult({ outcome: 'up-to-date', status: 'idle', remote });
      }

      // Step 5 — only local changed: update with the remote rev.
      if (localChanged && !remoteChanged) {
        const uploaded = await this.provider.upload(local.bytes, { rev: remote.rev });
        await this.commit(uploaded, local.hash, uploaded.contentHash);
        return makeResult({
          outcome: 'pushed',
          status: 'idle',
          uploadedBytes: local.bytes.byteLength,
          remote: uploaded,
        });
      }

      // Step 6 — only remote changed: download, merge, apply; no upload.
      if (!localChanged && remoteChanged) {
        const downloaded = await this.provider.download();
        await this.applyRemote(downloaded);
        const after = await this.buildLocalPayload();
        await this.commit(remote, after.hash, remote.contentHash);
        return makeResult({
          outcome: 'pulled',
          status: 'idle',
          downloadedBytes: downloaded.byteLength,
          remote,
        });
      }

      // Step 7/8 — both changed: merge and upload with the bounded 409 retry.
      return await this.mergeAndPush(remote);
    } catch (error) {
      return await this.fail(error);
    }
  }

  /**
   * Both sides changed. Download + merge + apply, then update the remote with
   * the merged bytes. On a 409 the remote rev is refetched and the round is
   * retried; after `maxConflictRetries` failures the remote payload is stored in
   * `syncBackups` and the merged result is uploaded as a new file (ADR-017).
   */
  private async mergeAndPush(initialRemote: RemoteFileMetadata): Promise<SyncRunResult> {
    let remote = initialRemote;
    for (let attempt = 1; attempt <= this.maxConflictRetries; attempt += 1) {
      const downloaded = await this.provider.download();
      await this.applyRemote(downloaded);
      const merged = await this.buildLocalPayload();
      try {
        const uploaded = await this.provider.upload(merged.bytes, { rev: remote.rev });
        await this.commit(uploaded, merged.hash, uploaded.contentHash);
        return makeResult({
          outcome: 'merged',
          status: 'idle',
          downloadedBytes: downloaded.byteLength,
          uploadedBytes: merged.bytes.byteLength,
          remote: uploaded,
        });
      } catch (error) {
        if (!isConflict(error)) {
          throw error;
        }
        if (attempt >= this.maxConflictRetries) {
          return await this.exhaustConflict(remote, downloaded, merged);
        }
        const refreshed = await this.provider.getMetadata();
        if (refreshed === null) {
          // The remote vanished mid-round; create it from the merged result.
          const created = await this.provider.upload(merged.bytes, { rev: null });
          await this.commit(created, merged.hash, created.contentHash);
          return makeResult({
            outcome: 'merged',
            status: 'idle',
            downloadedBytes: downloaded.byteLength,
            uploadedBytes: merged.bytes.byteLength,
            remote: created,
          });
        }
        remote = refreshed;
      }
    }
    // `maxConflictRetries >= 1` guarantees a return inside the loop.
    throw new SyncProviderError('conflict', 'The conflict retry loop exited unexpectedly.');
  }

  /**
   * ADR-017 step 4e: preserve the remote payload locally as a timestamped
   * backup, then upload the merged result as a new file. A remote copy is not
   * uploaded because the `SyncProvider` contract exposes no backup-upload
   * operation; the local `syncBackups` row is the recovery artifact.
   */
  private async exhaustConflict(
    remote: RemoteFileMetadata,
    downloaded: Uint8Array,
    merged: LocalPayload,
  ): Promise<SyncRunResult> {
    const timestamp = this.now();
    const backupId = `backup-${new Date(timestamp).toISOString()}`;
    await this.backups.add({
      id: backupId,
      createdAt: timestamp,
      payload: downloaded,
      meta: { rev: remote.rev, contentHash: remote.contentHash, reason: 'conflict-exhausted' },
    });
    const uploaded = await this.provider.upload(merged.bytes, { rev: null, autorename: true });
    await this.commit(uploaded, merged.hash, uploaded.contentHash);
    await this.emit({
      status: 'conflict',
      lastError: 'Sync conflicts exceeded the retry limit; a timestamped backup was saved.',
      pending: false,
    });
    return makeResult({
      outcome: 'conflict-backup',
      status: 'conflict',
      downloadedBytes: downloaded.byteLength,
      uploadedBytes: merged.bytes.byteLength,
      remote: uploaded,
      backupId,
    });
  }

  /** Map any failure to an emitted `error`/`offline` status and a result. */
  private async fail(error: unknown): Promise<SyncRunResult> {
    const providerError = asProviderError(error);
    const offline = providerError.code === 'network' || providerError.code === 'aborted';
    const status: SyncStatus = offline ? 'offline' : 'error';
    await this.emit({ status, lastError: providerError.message, pending: true });
    return makeResult({
      outcome: offline ? 'offline' : 'disabled',
      status,
      error: providerError,
    });
  }

  // --- helpers ------------------------------------------------------------

  /**
   * Build the canonical local payload. `exportedAt` is re-stamped with the
   * latest effective record timestamp so logically equal data serializes to
   * identical bytes (and therefore the same content hash).
   */
  private async buildLocalPayload(): Promise<LocalPayload> {
    const exported = await this.gateway.exportLocal();
    const envelope: SyncEnvelopeV1 = {
      ...exported,
      exportedAt: new Date(latestUpdatedAt(exported.collections)).toISOString(),
    };
    const bytes = await gzipBytes(new TextEncoder().encode(serializeEnvelope(envelope)), this.gzip);
    const hash = await dropboxContentHash(bytes);
    return { envelope, bytes, hash };
  }

  /** Gunzip, parse+migrate+validate and merge a downloaded envelope locally. */
  private async applyRemote(bytes: Uint8Array): Promise<void> {
    const json = new TextDecoder().decode(await gunzipBytes(bytes, this.gunzip));
    const envelope = parseEnvelope(json);
    await this.gateway.applyEnvelope(envelope, { remoteDeviceId: envelope.deviceId });
  }

  /** Persist the remote bookkeeping and emit `idle`. */
  private async commit(
    remote: RemoteFileMetadata,
    lastPushedHash: string,
    lastRemoteHash: string,
  ): Promise<void> {
    await Promise.all([
      this.syncState.set(SYNC_STATE_KEYS.lastRemoteRev, remote.rev),
      this.syncState.set(SYNC_STATE_KEYS.lastRemoteContentHash, lastRemoteHash),
      this.syncState.set(SYNC_STATE_KEYS.lastPushedHash, lastPushedHash),
    ]);
    await this.emit({ status: 'idle', lastSyncedAt: this.now(), pending: false, lastError: null });
  }

  /** Persist the status snapshot and notify subscribers (listener-safe). */
  private async emit(patch: Partial<SyncStatusSnapshot>): Promise<void> {
    this.snapshot = { ...this.snapshot, ...patch };
    await Promise.all([
      this.syncState.set(SYNC_STATE_KEYS.status, this.snapshot.status),
      this.syncState.set(SYNC_STATE_KEYS.lastError, this.snapshot.lastError),
      this.syncState.set(SYNC_STATE_KEYS.lastSyncedAt, this.snapshot.lastSyncedAt),
      this.syncState.set(SYNC_STATE_KEYS.pending, this.snapshot.pending),
    ]);
    for (const listener of this.listeners) {
      try {
        listener(this.snapshot);
      } catch {
        // A subscriber must never break a sync round.
      }
    }
  }

  /** Load persisted status once so the surface survives a reload. */
  private async hydrate(): Promise<void> {
    if (this.hydrated) {
      return;
    }
    this.hydrated = true;
    const [status, lastError, lastSyncedAt, pending, deviceId, lastPushedHash] = await Promise.all([
      this.syncState.get<SyncStatus>(SYNC_STATE_KEYS.status),
      this.syncState.get<string>(SYNC_STATE_KEYS.lastError),
      this.syncState.get<number>(SYNC_STATE_KEYS.lastSyncedAt),
      this.syncState.get<boolean>(SYNC_STATE_KEYS.pending),
      this.syncState.get<DeviceId>(SYNC_STATE_KEYS.deviceId),
      this.syncState.get<string>(SYNC_STATE_KEYS.lastPushedHash),
    ]);
    // Never-pushed devices still have deletions to propagate (G3 offline queue).
    const hasTombstones = (await this.tombstones.listAll()).length > 0;
    this.snapshot = {
      status: status ?? (this.provider.isConfigured() ? 'disconnected' : 'disabled'),
      providerId: this.provider.id,
      lastSyncedAt: lastSyncedAt ?? null,
      lastError: lastError ?? null,
      pending: pending ?? (lastPushedHash === undefined ? hasTombstones : false),
      deviceId: deviceId ?? null,
    };
  }

  private defaultRedirectUri(): string {
    const location = globalThis.location;
    const origin =
      typeof location !== 'undefined' && location.origin.length > 0
        ? location.origin
        : 'http://localhost';
    // Keep the redirect inside the app's base path (GitHub Pages project sites
    // are served from a sub-path); `BASE_URL` is `/` for local dev.
    const base = import.meta.env.BASE_URL ?? '/';
    const prefix = base.endsWith('/') ? base : `${base}/`;
    return `${origin}${prefix}settings`;
  }
}

/** The latest effective `updatedAt` across every leaf record and tombstone. */
function latestUpdatedAt(collections: SyncEnvelopeCollectionsV1): number {
  let latest = 0;
  for (const spec of SYNC_COLLECTION_SPECS) {
    for (const record of collectionRecords(collections, spec.name)) {
      const timestamp = spec.updatedAtOf(record);
      if (timestamp > latest) {
        latest = timestamp;
      }
    }
  }
  for (const tombstone of collections.tombstones) {
    if (tombstone.deletedAt > latest) {
      latest = tombstone.deletedAt;
    }
  }
  return latest;
}

/** The leaf array of one envelope collection, by registry name. */
function collectionRecords(
  collections: SyncEnvelopeCollectionsV1,
  name: SyncCollectionName,
): readonly unknown[] {
  switch (name) {
    case 'games':
      return collections.games;
    case 'analyses':
      return collections.analysis.analyses;
    case 'analysisJobs':
      return collections.analysis.analysisJobs;
    case 'analysisSummaries':
      return collections.analysis.analysisSummaries;
    case 'puzzleCandidates':
      return collections.analysis.puzzleCandidates;
    case 'puzzles':
      return collections.puzzles;
    case 'trainingSets':
      return collections.trainingSets;
    case 'trainingCycles':
      return collections.trainingCycles;
    case 'puzzleAttempts':
      return collections.puzzleAttempts;
    case 'settings':
      return collections.settings;
  }
}

/** Whether an error is a provider 409 conflict. */
function isConflict(error: unknown): boolean {
  return error instanceof SyncProviderError && error.code === 'conflict';
}

/** Normalize any thrown value to a typed provider error. */
function asProviderError(error: unknown): SyncProviderError {
  if (error instanceof SyncProviderError) {
    return error;
  }
  const message = error instanceof Error ? error.message : 'The sync operation failed.';
  return new SyncProviderError('invalid-response', message);
}

/** A user-facing local export filename (`chessremedy-backup-<iso>.json.gz`). */
function exportFileName(epochMillis: number): string {
  const stamp = new Date(epochMillis).toISOString().replace(/[:.]/g, '-');
  return `${EXPORT_FILE_PREFIX}${stamp}.json.gz`;
}

/** Assemble a `SyncRunResult` with sensible zero/null defaults. */
function makeResult(
  partial: Partial<SyncRunResult> & Pick<SyncRunResult, 'outcome' | 'status'>,
): SyncRunResult {
  return {
    outcome: partial.outcome,
    status: partial.status,
    uploadedBytes: partial.uploadedBytes ?? 0,
    downloadedBytes: partial.downloadedBytes ?? 0,
    remote: partial.remote ?? null,
    backupId: partial.backupId ?? null,
    error: partial.error ?? null,
  };
}
