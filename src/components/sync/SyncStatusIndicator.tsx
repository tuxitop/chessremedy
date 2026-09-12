import type * as React from 'react';
import { Link } from 'react-router-dom';
import { useSync, type SyncServiceLike } from '@/hooks/useSync';
import { isSyncConfigured } from '@/infrastructure/sync/configured';
import { relativeSyncTime, syncStatusLabel } from './format';
import styles from './SyncStatusIndicator.module.css';

export interface SyncStatusIndicatorProps {
  /** Injectable sync service; defaults to the browser singleton. */
  readonly service?: SyncServiceLike;
}

/**
 * Compact header surface for the Feature-016 sync status (plan §9). It renders
 * **nothing** unless a provider is both configured and connected, so the app is
 * unchanged when sync is off; Settings always exposes the same actions, so this
 * is never the only affordance.
 *
 * States: `syncing` (spinner + polite live text), `idle`/last-synced, `offline`,
 * `error` and `conflict` (both with a link to Settings).
 */
export function SyncStatusIndicator(props: SyncStatusIndicatorProps): React.JSX.Element | null {
  // Eager header surface: when no Dropbox app key is configured, skip the hook
  // entirely so the code-split sync service (and its SDK) is never fetched. An
  // injected service (tests) bypasses the environment probe.
  if (props.service === undefined && !isSyncConfigured()) {
    return null;
  }
  return <SyncStatusIndicatorInner {...props} />;
}

function SyncStatusIndicatorInner({ service }: SyncStatusIndicatorProps): React.JSX.Element | null {
  const options = service !== undefined ? { service } : {};
  const { configured, connected, status, lastSyncedAt } = useSync(options);

  if (!configured || !connected || status === null) {
    return null;
  }

  const state = status.status;
  const actionable = state === 'error' || state === 'conflict';
  const label =
    state === 'idle' && lastSyncedAt !== null
      ? `Synced ${relativeSyncTime(lastSyncedAt)}`
      : syncStatusLabel(state);

  return (
    <div
      className={styles.indicator}
      data-testid="sync-status-indicator"
      data-status={state}
      data-actionable={actionable ? 'true' : 'false'}
      title={label}
    >
      <span
        className={[styles.icon, state === 'syncing' ? styles.spinning : '']
          .filter(Boolean)
          .join(' ')}
        aria-hidden="true"
      >
        {state === 'syncing' ? '↻' : state === 'offline' ? '⚡' : state === 'idle' ? '✓' : '!'}
      </span>
      <span role="status" aria-live="polite" className={styles.text} data-testid="sync-status-live">
        {label}
      </span>
      {actionable ? (
        <Link to="/settings" className={styles.link} data-testid="sync-status-settings-link">
          Settings
        </Link>
      ) : null}
    </div>
  );
}
