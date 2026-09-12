/**
 * Feature 016 — sync presentation formatting (presentation-only).
 *
 * Small, locale-light formatters shared by the header indicator and the
 * Settings panel. Kept free of React and infrastructure so both components use
 * the same wording for the same status.
 */

import type { SyncStatus } from '@/domain/sync';

/** Short human label for a sync status (used in the header and panel). */
export function syncStatusLabel(status: SyncStatus): string {
  switch (status) {
    case 'syncing':
      return 'Syncing…';
    case 'offline':
      return 'Offline — changes will sync when you are back online';
    case 'error':
      return 'Sync error — open Settings to review';
    case 'conflict':
      return 'Sync conflict — a recovery backup was saved';
    case 'idle':
      return 'Synced';
    case 'disabled':
      return 'Synchronization is not configured';
    case 'disconnected':
      return 'Not connected';
  }
}

/** Compact relative time (`just now`, `5m ago`, `3h ago`, `2d ago`). */
export function relativeSyncTime(epochMillis: number, now: number = Date.now()): string {
  const delta = Math.max(0, now - epochMillis);
  if (delta < 60_000) {
    return 'just now';
  }
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Absolute date-time for a backup/last-synced row. */
export function formatSyncDateTime(epochMillis: number): string {
  return new Date(epochMillis).toLocaleString();
}
