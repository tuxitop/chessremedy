/**
 * Feature 016 — synced-settings allowlist (domain, pure).
 *
 * Only user preferences cross the wire. Device-local bookkeeping
 * (`training.legacyAutoSetsCleaned`) and any OAuth / sync secret are excluded;
 * tokens live exclusively in the non-synced `syncState` table (ADR-015,
 * plan §6.3). The allowlist is derived from `SETTINGS_KEYS` so a new preference
 * must be added here deliberately.
 */

import { SETTINGS_KEYS } from '@/config/app-config';

/** Settings keys that are safe to sync between a user's devices. */
export const SYNCED_SETTINGS_KEYS: readonly string[] = [
  SETTINGS_KEYS.theme,
  SETTINGS_KEYS.engineDefaults,
  SETTINGS_KEYS.boardAppearance,
  SETTINGS_KEYS.analysisGame,
  SETTINGS_KEYS.analysisTacticalDetection,
  SETTINGS_KEYS.chessComUsername,
  SETTINGS_KEYS.lichessUsername,
  SETTINGS_KEYS.chessComFilters,
  SETTINGS_KEYS.lichessFilters,
  SETTINGS_KEYS.puzzleTimer,
  SETTINGS_KEYS.defaultHintConfig,
];

/** Defensive patterns: a settings key that looks like a credential never syncs. */
const SECRET_SETTING_KEY_PATTERNS: readonly RegExp[] = [
  /token/i,
  /secret/i,
  /oauth/i,
  /password/i,
  /credential/i,
  /refresh/i,
  /^auth[._-]/i,
  /^sync[._-]/i,
];

/** True when a settings key must never enter the sync envelope. */
export function isSecretSettingKey(key: string): boolean {
  return SECRET_SETTING_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

/** Drop every credential-shaped row, whether or not it is allowlisted. */
export function excludeSyncSecrets<T extends { readonly key: string }>(
  rows: readonly T[],
): readonly T[] {
  return rows.filter((row) => !isSecretSettingKey(row.key));
}

/** Keep only allowlisted, non-secret settings rows. */
export function selectSyncedSettings<T extends { readonly key: string }>(
  rows: readonly T[],
): readonly T[] {
  return excludeSyncSecrets(rows).filter((row) => SYNCED_SETTINGS_KEYS.includes(row.key));
}
