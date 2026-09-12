import type * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import type { SyncBackupRow } from '@/infrastructure/db/sync-backups-repository';
import {
  useSync,
  type SyncBackupsLike,
  type SyncDownloadFile,
  type SyncServiceLike,
  type UseSyncOptions,
} from '@/hooks/useSync';
import { formatSyncDateTime, relativeSyncTime, syncStatusLabel } from './format';
import styles from './SyncSettingsPanel.module.css';

export interface SyncSettingsPanelProps {
  /** Injectable sync service; defaults to the browser singleton. */
  readonly service?: SyncServiceLike;
  /** Injectable recovery-backup store; defaults to the Dexie repository. */
  readonly backups?: SyncBackupsLike;
  /** Reload after a successful import; defaults to `location.reload()`. */
  readonly reload?: () => void;
  /** File saver; defaults to a Blob anchor download. */
  readonly saveFile?: (file: SyncDownloadFile) => void;
}

/**
 * The Feature-016 Settings surface (plan §9). It replaces the old placeholder
 * and provides:
 *
 * - **Not connected:** an explanation and a "Connect Dropbox" PKCE redirect.
 * - **Connected:** account state, last-synced, status, "Sync now"/"Disconnect"
 *   and the local recovery-backup list (Restore/Download).
 * - **OAuth return:** detects `?code=`/`?state=` on mount, completes the
 *   connection, cleans the URL and reports the result.
 * - **Local export/import (G4):** a provider-free gzip backup download and a
 *   file-picker import that merges through the canonical path and reloads.
 *
 * Every control is a labelled, keyboard/touch-reachable native control; the
 * panel is theme-token based and stacks on narrow screens.
 */
export function SyncSettingsPanel({
  service,
  backups,
  reload,
  saveFile,
}: SyncSettingsPanelProps): React.JSX.Element {
  const options: UseSyncOptions = {
    ...(service !== undefined ? { service } : {}),
    ...(backups !== undefined ? { backups } : {}),
    ...(reload !== undefined ? { reload } : {}),
    ...(saveFile !== undefined ? { saveFile } : {}),
  };
  const sync = useSync(options);
  const {
    configured,
    connected,
    isLoading,
    status,
    lastSyncedAt,
    error,
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
  } = sync;

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handledOAuthRef = useRef(false);
  const [oauthResult, setOauthResult] = useState<'connected' | 'failed' | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);

  // OAuth return: `?code=`/`?state=` is handled once, then removed from the URL.
  useEffect(() => {
    // Wait for the lazily-imported sync service to resolve: the callback must
    // not be consumed while `service` is still null, or the exchange would be
    // skipped and the one-shot ref would prevent a retry.
    if (isLoading) {
      return;
    }
    if (handledOAuthRef.current) {
      return;
    }
    const location = globalThis.location;
    if (typeof location === 'undefined') {
      return;
    }
    const params = new URLSearchParams(location.search);
    if (!params.has('code') && !params.has('state')) {
      return;
    }
    handledOAuthRef.current = true;
    void (async () => {
      const ok = await completeConnect(params);
      if (mountedRef.current) {
        setOauthResult(ok ? 'connected' : 'failed');
      }
      cleanOAuthUrl();
    })();
  }, [completeConnect, isLoading]);

  const onImportFile = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    // Reset so picking the same file again still fires `change`.
    event.target.value = '';
    if (file === undefined) {
      return;
    }
    setImportMessage(null);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const ok = await importBackup(bytes);
    if (ok && mountedRef.current) {
      setImportMessage('Backup imported. Reloading…');
    }
  };

  const onRestore = async (id: string): Promise<void> => {
    setImportMessage(null);
    const ok = await restore(id);
    if (ok && mountedRef.current) {
      setImportMessage('Recovery backup restored. Reloading…');
    }
  };

  const onDownload = (row: SyncBackupRow): void => {
    downloadFile({ bytes: row.payload, fileName: `${row.id}.json.gz` });
  };

  const state = status?.status ?? 'disconnected';

  return (
    <div className={styles.panel} data-testid="sync-settings-panel" data-status={state}>
      {oauthResult === 'connected' ? (
        <p role="status" className={styles.success} data-testid="sync-oauth-success">
          Dropbox connected.
        </p>
      ) : null}
      {oauthResult === 'failed' ? (
        <p role="alert" className={styles.error} data-testid="sync-oauth-error">
          Could not complete the Dropbox connection. Please try again.
          {error !== null ? ` (${error})` : ''}
        </p>
      ) : null}

      {connected ? (
        <div className={styles.block}>
          <p className={styles.connection} data-testid="sync-connection-state">
            Connected to Dropbox
          </p>
          <p className={styles.meta} data-testid="sync-last-synced">
            {lastSyncedAt !== null
              ? `Last synced ${formatSyncDateTime(lastSyncedAt)} (${relativeSyncTime(lastSyncedAt)})`
              : 'Not synced yet'}
          </p>
          <p
            role="status"
            aria-live="polite"
            className={styles.meta}
            data-testid="sync-status-text"
          >
            {syncStatusLabel(state)}
          </p>
          <div className={styles.actions}>
            <Button
              onClick={() => void syncNow()}
              disabled={state === 'syncing'}
              data-testid="sync-now"
            >
              {state === 'syncing' ? 'Syncing…' : 'Sync now'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void disconnect()}
              data-testid="sync-disconnect"
            >
              Disconnect
            </Button>
          </div>
        </div>
      ) : (
        <div className={styles.block}>
          <p className={styles.help} data-testid="sync-connect-help">
            Connect Dropbox to back up and sync your library across devices. Only the app folder is
            used; no ChessRemedy server is involved.
          </p>
          <div className={styles.actions}>
            <Button
              onClick={() => void connect()}
              disabled={!configured}
              data-testid="sync-connect"
            >
              Connect Dropbox
            </Button>
          </div>
          {!configured ? (
            <p className={styles.help} data-testid="sync-unconfigured">
              Synchronization is not configured in this build. Local export and import below still
              work.
            </p>
          ) : null}
        </div>
      )}

      {error !== null ? (
        <p role="alert" className={styles.error} data-testid="sync-panel-error">
          {error}
        </p>
      ) : null}

      {connected ? (
        <div className={styles.block}>
          <h3 className={styles.sectionTitle}>Recovery backups</h3>
          {backupsLoading ? (
            <p className={styles.help}>Loading recovery backups…</p>
          ) : backupRows.length === 0 ? (
            <p className={styles.help} data-testid="sync-backups-empty">
              No recovery backups yet.
            </p>
          ) : (
            <ul className={styles.backupList} data-testid="sync-backups">
              {backupRows.map((row) => (
                <li
                  key={row.id}
                  className={styles.backupItem}
                  data-testid={`sync-backup-${row.id}`}
                >
                  <span className={styles.backupMeta}>{formatSyncDateTime(row.createdAt)}</span>
                  <div className={styles.backupActions}>
                    <Button
                      variant="secondary"
                      onClick={() => void onRestore(row.id)}
                      data-testid={`sync-backup-restore-${row.id}`}
                    >
                      Restore
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => onDownload(row)}
                      data-testid={`sync-backup-download-${row.id}`}
                    >
                      Download
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <div className={styles.block}>
        <h3 className={styles.sectionTitle}>Local backup</h3>
        <p className={styles.help} data-testid="sync-local-help">
          Export or import a backup file. This works without a provider and never includes engine
          caches or OAuth tokens.
        </p>
        <div className={styles.actions}>
          <Button
            variant="secondary"
            onClick={() => void exportBackup()}
            data-testid="sync-export-backup"
          >
            Export backup
          </Button>
          <label className={styles.fileLabel}>
            <span className={styles.fileLabelText}>Import backup</span>
            <input
              type="file"
              accept=".gz,application/gzip"
              className={styles.fileInput}
              onChange={(event) => void onImportFile(event)}
              data-testid="sync-import-input"
            />
          </label>
        </div>
        {importMessage !== null ? (
          <p role="status" className={styles.success} data-testid="sync-import-result">
            {importMessage}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Remove the OAuth query parameters while preserving the path and hash. */
function cleanOAuthUrl(): void {
  const location = globalThis.location;
  if (typeof location === 'undefined' || typeof globalThis.history === 'undefined') {
    return;
  }
  globalThis.history.replaceState(
    globalThis.history.state,
    '',
    `${location.pathname}${location.hash}`,
  );
}
