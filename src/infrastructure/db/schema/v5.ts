import type Dexie from 'dexie';
import { parseTimeControl } from '@/domain/chess/timeControl';

/**
 * Schema v5 — stores the structured time control on each game (Feature 008
 * revision, ADR-013 / domain/time-control.md).
 *
 * The games store definition is unchanged (same primary key + indexes, the
 * `normalizedTimeControl` category index is retained). The upgrade backfills
 * `timeControlModel` from the verbatim `timeControl` string for existing
 * rows, and re-normalizes rows whose stored category was `unknown` when the
 * canonical parser yields a known category (e.g. legacy Lichess
 * correspondence imported before the day-words dialect was supported).
 */
export function applyV5Schema(db: Dexie): void {
  db.version(5)
    // The extra `timeControl` index is retained for exact-control queries and
    // guarantees the store definition changes so Dexie runs the backfill.
    .stores({ games: '&id, source, playedAt, normalizedTimeControl, timeControl' })
    .upgrade(async (tx) => {
      const rows = await tx.table('games').toArray();
      for (const row of rows as Array<{
        timeControl: string;
        timeControlModel?: unknown;
        normalizedTimeControl: string;
      }>) {
        const model = parseTimeControl(row.timeControl);
        row.timeControlModel = model;
        if (row.normalizedTimeControl === 'unknown' && model.category !== 'unknown') {
          row.normalizedTimeControl = model.category;
        }
      }
      await tx.table('games').bulkPut(rows);
    });
}
