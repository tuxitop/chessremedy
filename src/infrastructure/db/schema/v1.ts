import type Dexie from 'dexie';

/**
 * Schema v1 — single key/value `settings` table. The Foundation owns
 * only this table. Later features (004+) add real domain tables
 * through Dexie version upgrades.
 *
 * `key` is the primary key; `value` holds the JSON-serialised setting.
 */
export function applyV1Schema(db: Dexie): void {
  db.version(1).stores({
    settings: '&key',
  });
}
