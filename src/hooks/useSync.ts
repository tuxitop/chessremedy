/**
 * Feature 016 — sync UI hook.
 *
 * Subscribes to the provider-independent `SyncService` and exposes the
 * connection/status surface plus the provider-free local export/import actions
 * (G4). The service is injectable so components and tests can drive a fake;
 * the default is the memoised browser singleton.
 *
 * Honesty contract:
 *
 * - Every action is wrapped: a failure is recorded as a user-facing `error` and
 *   never thrown into React (an OAuth `completeConnect` rejection is the one
 *   exception the service re-throws; this hook catches it too).
 * - Loading is explicit (`isLoading`, `backupsLoading`); the hook never claims a
 *   state it has not read.
 * - Nothing here blocks the UI: actions are async and the app stays usable when
 *   sync is disconnected or failing (spec Constraint).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  syncBackupsRepository,
  type SyncBackupRow,
} from '@/infrastructure/db/sync-backups-repository';
import type { SyncRunResult, SyncStatusSnapshot } from '@/infrastructure/sync/types';

/** The `SyncService` surface `useSync` drives (structural, so tests can fake it). */
export interface SyncServiceLike {
  isConfigured(): boolean;
  isConnected(): Promise<boolean>;
  connect(redirectUri?: string): Promise<void>;
  completeConnect(callback: URLSearchParams): Promise<void>;
  disconnect(): Promise<void>;
  subscribe(listener: (snapshot: SyncStatusSnapshot) => void): () => void;
  getStatus(): Promise<SyncStatusSnapshot>;
  syncNow(): Promise<SyncRunResult>;
  exportBackup(): Promise<{ bytes: Uint8Array; fileName: string }>;
  importBackup(bytes: Uint8Array): Promise<{ merged: true }>;
}

/** The local recovery-backup store surface (structural, for tests). */
export interface SyncBackupsLike {
  list(): Promise<SyncBackupRow[]>;
  get(id: string): Promise<SyncBackupRow | undefined>;
}

/** A file the hook offers to the user for download. */
export interface SyncDownloadFile {
  readonly bytes: Uint8Array;
  readonly fileName: string;
}

export interface UseSyncOptions {
  /** Sync service; defaults to the browser singleton. */
  readonly service?: SyncServiceLike;
  /** Local recovery-backup store; defaults to the Dexie repository. */
  readonly backups?: SyncBackupsLike;
  /** Reload the app after a successful import; defaults to `location.reload()`. */
  readonly reload?: () => void;
  /** Save a downloadable file; defaults to a Blob anchor download. */
  readonly saveFile?: (file: SyncDownloadFile) => void;
}

export interface UseSync {
  /** Whether the build has the configuration needed to connect at all. */
  readonly configured: boolean;
  /** Whether a usable credential is currently stored. */
  readonly connected: boolean;
  /** True while the initial connection/status read is in flight. */
  readonly isLoading: boolean;
  /** The latest status snapshot, or `null` before the first read. */
  readonly status: SyncStatusSnapshot | null;
  /** Epoch millis of the last successful sync, or `null`. */
  readonly lastSyncedAt: number | null;
  /** The most recent action/status error, or `null`. */
  readonly error: string | null;
  /** Local recovery backups, newest first. */
  readonly backups: readonly SyncBackupRow[];
  /** True while the backup list is loading. */
  readonly backupsLoading: boolean;
  connect(redirectUri?: string): Promise<void>;
  /** Complete an OAuth callback; returns whether it succeeded. */
  completeConnect(callback: URLSearchParams): Promise<boolean>;
  disconnect(): Promise<void>;
  syncNow(): Promise<void>;
  /** Export the local envelope and offer it as a gzip download. */
  exportBackup(): Promise<void>;
  /** Import a gzip envelope; reloads on success. Returns success. */
  importBackup(bytes: Uint8Array): Promise<boolean>;
  /** Restore a stored recovery backup by id; reloads on success. */
  restore(id: string): Promise<boolean>;
  /** Save an arbitrary gzip payload as a download. */
  downloadFile(file: SyncDownloadFile): void;
  reload(): void;
  refreshBackups(): Promise<void>;
}

/**
 * Subscribe to a `SyncService` and expose its status plus the sync and
 * export/import actions. Never throws; failures surface through `error`.
 */
export function useSync(options: UseSyncOptions = {}): UseSync {
  const injectedService = options.service;
  const backups = useMemo(() => options.backups ?? syncBackupsRepository, [options.backups]);
  const reloadImpl = options.reload ?? defaultReload;
  const saveFile = options.saveFile ?? defaultSaveFile;

  const [loadedService, setLoadedService] = useState<SyncServiceLike | null>(null);
  const service = injectedService ?? loadedService;
  const configured = useMemo(
    () => injectedService?.isConfigured() ?? loadedService?.isConfigured() ?? false,
    [injectedService, loadedService],
  );
  const [connected, setConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [status, setStatus] = useState<SyncStatusSnapshot | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [backupRows, setBackupRows] = useState<readonly SyncBackupRow[]>([]);
  const [backupsLoading, setBackupsLoading] = useState(true);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Resolve the default (browser) service lazily. The dynamic import keeps the
  // Dropbox SDK out of the initial bundle; an injected service is used as-is.
  useEffect(() => {
    if (injectedService !== undefined) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const module = await import('@/infrastructure/sync');
        const resolved = module.getBrowserSyncService();
        if (!cancelled) {
          setLoadedService(resolved);
        }
      } catch (error) {
        if (!cancelled) {
          setActionError(messageOf(error));
          setIsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [injectedService]);

  const refreshBackups = useCallback(async () => {
    try {
      const rows = await backups.list();
      if (mountedRef.current) {
        setBackupRows(rows);
      }
    } catch (error) {
      if (mountedRef.current) {
        setActionError(messageOf(error));
      }
    } finally {
      if (mountedRef.current) {
        setBackupsLoading(false);
      }
    }
  }, [backups]);

  const refresh = useCallback(async () => {
    if (service === null) {
      return;
    }
    try {
      const [isConnected, snapshot] = await Promise.all([
        service.isConnected(),
        service.getStatus(),
      ]);
      if (!mountedRef.current) {
        return;
      }
      setConnected(isConnected);
      setStatus(snapshot);
    } catch (error) {
      if (mountedRef.current) {
        setActionError(messageOf(error));
      }
    }
  }, [service]);

  useEffect(() => {
    if (service === null) {
      return undefined;
    }
    let cancelled = false;
    const unsubscribe = service.subscribe((snapshot) => {
      if (!cancelled) {
        setStatus(snapshot);
      }
    });
    void (async () => {
      try {
        const [isConnected, snapshot] = await Promise.all([
          service.isConnected(),
          service.getStatus(),
        ]);
        if (cancelled) {
          return;
        }
        setConnected(isConnected);
        setStatus(snapshot);
      } catch (error) {
        if (!cancelled) {
          setActionError(messageOf(error));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();
    void (async () => {
      await refreshBackups();
    })();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [service, refreshBackups]);

  const connect = useCallback(
    async (redirectUri?: string) => {
      setActionError(null);
      if (service === null) {
        return;
      }
      try {
        await service.connect(redirectUri);
      } catch (error) {
        if (mountedRef.current) {
          setActionError(messageOf(error));
        }
      }
      await refresh();
    },
    [service, refresh],
  );

  const completeConnect = useCallback(
    async (callback: URLSearchParams): Promise<boolean> => {
      setActionError(null);
      if (service === null) {
        return false;
      }
      try {
        await service.completeConnect(callback);
      } catch (error) {
        if (mountedRef.current) {
          setActionError(messageOf(error));
        }
        await refresh();
        return false;
      }
      await refresh();
      return true;
    },
    [service, refresh],
  );

  const disconnect = useCallback(async () => {
    setActionError(null);
    if (service === null) {
      return;
    }
    try {
      await service.disconnect();
    } catch (error) {
      if (mountedRef.current) {
        setActionError(messageOf(error));
      }
    }
    await refresh();
  }, [service, refresh]);

  const syncNow = useCallback(async () => {
    setActionError(null);
    if (service === null) {
      return;
    }
    try {
      await service.syncNow();
    } catch (error) {
      if (mountedRef.current) {
        setActionError(messageOf(error));
      }
    }
    await refresh();
    await refreshBackups();
  }, [service, refresh, refreshBackups]);

  const downloadFile = useCallback(
    (file: SyncDownloadFile) => {
      saveFile(file);
    },
    [saveFile],
  );

  const exportBackup = useCallback(async () => {
    setActionError(null);
    if (service === null) {
      return;
    }
    try {
      const file = await service.exportBackup();
      saveFile(file);
    } catch (error) {
      if (mountedRef.current) {
        setActionError(messageOf(error));
      }
    }
  }, [service, saveFile]);

  const importBackup = useCallback(
    async (bytes: Uint8Array): Promise<boolean> => {
      setActionError(null);
      if (service === null) {
        return false;
      }
      try {
        await service.importBackup(bytes);
        reloadImpl();
        return true;
      } catch (error) {
        if (mountedRef.current) {
          setActionError(messageOf(error));
        }
        return false;
      }
    },
    [service, reloadImpl],
  );

  const restore = useCallback(
    async (id: string): Promise<boolean> => {
      setActionError(null);
      try {
        const row = await backups.get(id);
        if (row === undefined) {
          if (mountedRef.current) {
            setActionError('That recovery backup no longer exists.');
          }
          return false;
        }
        return await importBackup(row.payload);
      } catch (error) {
        if (mountedRef.current) {
          setActionError(messageOf(error));
        }
        return false;
      }
    },
    [backups, importBackup],
  );

  return {
    configured,
    connected,
    isLoading,
    status,
    lastSyncedAt: status?.lastSyncedAt ?? null,
    error: actionError ?? status?.lastError ?? null,
    backups: backupRows,
    backupsLoading,
    connect,
    completeConnect,
    disconnect,
    syncNow,
    exportBackup,
    importBackup,
    restore,
    downloadFile,
    reload: reloadImpl,
    refreshBackups,
  };
}

/** Normalize any thrown value to a user-facing message. */
function messageOf(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return 'The sync operation failed.';
}

/** Default reload: a full page reload so the merged data is re-read. */
function defaultReload(): void {
  if (typeof globalThis.location !== 'undefined') {
    globalThis.location.reload();
  }
}

/** Default file save: a Blob object URL anchor download. */
function defaultSaveFile(file: SyncDownloadFile): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') {
    return;
  }
  const blob = new Blob([new Uint8Array(file.bytes).buffer], { type: 'application/gzip' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.fileName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
