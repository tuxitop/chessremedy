/**
 * Feature 016 — synchronization UI (barrel).
 *
 * The header status indicator and the Settings panel, both driven by the
 * injectable `useSync` hook.
 */

export { SyncStatusIndicator, type SyncStatusIndicatorProps } from './SyncStatusIndicator';
export { SyncSettingsPanel, type SyncSettingsPanelProps } from './SyncSettingsPanel';
export { formatSyncDateTime, relativeSyncTime, syncStatusLabel } from './format';
