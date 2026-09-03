import type Dexie from 'dexie';

/**
 * Schema v2 — adds the `games` table (Feature 004, Local Game Storage).
 *
 * The upgrade is purely additive over v1 (`settings`). Each later owning
 * feature (007/008/…) adds its own tables through `db.version(3)` etc.
 *
 * A game's row keeps the authoritative scalar metadata plus the verbatim
 * PGN text; the chessops `MoveList` tree is not stored directly (its nodes
 * carry prototype methods that structured clone would drop) and is rebuilt
 * from the PGN on full reads.
 */
export function applyV2Schema(db: Dexie): void {
  db.version(2).stores({
    games: '&id, source, playedAt, normalizedTimeControl',
  });
}
