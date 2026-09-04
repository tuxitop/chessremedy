import type Dexie from 'dexie';

/**
 * Schema v3 — adds the `importJobs` table (Feature 007, Game Import).
 *
 * Purely additive over v2 (`settings`, `games`): each import job is one row
 * holding the full domain `ImportJob` (filters, cursor, counters, error
 * samples) as JSON. The row id is `${provider}:${username.toLowerCase()}`.
 */
export function applyV3Schema(db: Dexie): void {
  db.version(3).stores({
    importJobs: '&id, provider, username, status, updatedAt',
  });
}
