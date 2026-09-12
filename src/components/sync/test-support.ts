/**
 * Feature 016 — sync UI test support.
 *
 * A structural `SyncServiceLike` fake for the indicator and panel tests: it
 * records calls, can emit status snapshots, and can delegate an import to a
 * real engine when a test needs genuine merge behavior.
 */

import type { SyncStatus } from '@/domain/sync';
import type { SyncServiceLike } from '@/hooks/useSync';
import type { SyncRunResult, SyncStatusSnapshot } from '@/infrastructure/sync/types';

export interface FakeSyncServiceOptions {
  readonly configured?: boolean;
  readonly connected?: boolean;
  readonly status?: SyncStatus;
  readonly lastSyncedAt?: number | null;
  readonly lastError?: string | null;
  readonly exportBytes?: Uint8Array;
  readonly exportFileName?: string;
  readonly onImport?: (bytes: Uint8Array) => Promise<void> | void;
  readonly completeConnectError?: Error;
}

/** A configurable in-memory `SyncServiceLike` for component tests. */
export class FakeSyncService implements SyncServiceLike {
  configured: boolean;
  connected: boolean;
  snapshot: SyncStatusSnapshot;
  readonly connectCalls: (string | undefined)[] = [];
  readonly completeConnectCalls: URLSearchParams[] = [];
  readonly imported: Uint8Array[] = [];
  readonly syncNowCalls: number[] = [];
  exportBytes: Uint8Array;
  exportFileName: string;
  onImport: ((bytes: Uint8Array) => Promise<void> | void) | undefined;
  completeConnectError: Error | undefined;

  private readonly listeners = new Set<(snapshot: SyncStatusSnapshot) => void>();

  constructor(options: FakeSyncServiceOptions = {}) {
    this.configured = options.configured ?? true;
    this.connected = options.connected ?? false;
    this.exportBytes = options.exportBytes ?? new Uint8Array([0x1f, 0x8b, 0x08, 0x00]);
    this.exportFileName = options.exportFileName ?? 'chessremedy-backup-test.json.gz';
    this.onImport = options.onImport;
    this.completeConnectError = options.completeConnectError;
    this.snapshot = {
      status: options.status ?? (this.connected ? 'idle' : 'disconnected'),
      providerId: 'dropbox',
      lastSyncedAt: options.lastSyncedAt ?? null,
      lastError: options.lastError ?? null,
      pending: false,
      deviceId: 'fake-device',
    };
  }

  isConfigured(): boolean {
    return this.configured;
  }

  async isConnected(): Promise<boolean> {
    return this.connected;
  }

  async connect(redirectUri?: string): Promise<void> {
    this.connectCalls.push(redirectUri);
    this.connected = true;
    this.emit({ status: 'idle', lastError: null });
  }

  async completeConnect(callback: URLSearchParams): Promise<void> {
    this.completeConnectCalls.push(callback);
    if (this.completeConnectError !== undefined) {
      this.emit({ status: 'error', lastError: this.completeConnectError.message });
      throw this.completeConnectError;
    }
    this.connected = true;
    this.emit({ status: 'idle', lastError: null, pending: true });
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.emit({ status: 'disconnected', lastError: null });
  }

  subscribe(listener: (snapshot: SyncStatusSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async getStatus(): Promise<SyncStatusSnapshot> {
    return this.snapshot;
  }

  async syncNow(): Promise<SyncRunResult> {
    this.syncNowCalls.push(Date.now());
    this.emit({ status: 'idle', lastSyncedAt: 1_700_000_000_000, lastError: null });
    return {
      outcome: 'up-to-date',
      status: 'idle',
      uploadedBytes: 0,
      downloadedBytes: 0,
      remote: null,
      backupId: null,
      error: null,
    };
  }

  async exportBackup(): Promise<{ bytes: Uint8Array; fileName: string }> {
    return { bytes: this.exportBytes, fileName: this.exportFileName };
  }

  async importBackup(bytes: Uint8Array): Promise<{ merged: true }> {
    this.imported.push(bytes);
    if (this.onImport !== undefined) {
      await this.onImport(bytes);
    }
    return { merged: true };
  }

  /** Replace the current snapshot and notify subscribers (test control). */
  emit(patch: Partial<SyncStatusSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) {
      listener(this.snapshot);
    }
  }
}
