import type Dexie from 'dexie';
import { gameFromPgn } from '@/domain/chess/parseGame';
import { gameEndOf } from '@/domain/chess/gameEnd';
import type { GameRow } from '@/infrastructure/db/games-repository';

/**
 * Schema v6 — richer Library rows: persists each game's full-move count and a
 * board-detectable end ("checkmate", "stalemate", …) computed from the stored
 * PGN so listings never re-parse full games. See `domain/chess/gameEnd.ts`.
 *
 * The games store definition is unchanged apart from forcing a schema bump;
 * the upgrade backfills `moveCount`/`termination` for every existing row by
 * replaying its stored PGN once.
 */
export function applyV6Schema(db: Dexie): void {
  db.version(6)
    .stores({ games: '&id, source, playedAt, normalizedTimeControl, timeControl' })
    .upgrade(async (tx) => {
      const rows = await tx.table('games').toArray();
      const upgraded: unknown[] = [];
      for (const row of rows as Array<
        GameRow & { moveCount?: number; termination?: string | null }
      >) {
        try {
          const parsed = gameFromPgn(row.pgn, {
            source: row.source,
            ...(row.externalId ? { externalId: row.externalId } : {}),
            userColor: row.userColor,
          });
          if (parsed.ok) {
            const end = gameEndOf(parsed.game.moves, parsed.game.result);
            row.moveCount = end.moveCount;
            row.termination = end.termination;
          } else {
            row.moveCount = 0;
            row.termination = null;
          }
        } catch {
          row.moveCount = 0;
          row.termination = null;
        }
        upgraded.push(row);
      }
      await tx.table('games').bulkPut(upgraded);
    });
}
