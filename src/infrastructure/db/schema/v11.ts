import type Dexie from 'dexie';
import {
  parseTimeControl,
  timeControlProfileForSource,
  type TimeControl,
} from '@/domain/chess/timeControl';
import type { GameSource } from '@/domain/chess/gameSource';

/**
 * Schema v11 — platform-specific time-control re-normalization (ADR-013
 * revision, `domain/time-control.md`).
 *
 * Data-only version: no table or index is added. The `games` store definition
 * is repeated unchanged (the v6 precedent) solely to force Dexie to run the
 * one-time transactional upgrade on every existing installation. An
 * unversioned maintenance pass could be skipped and would leave
 * `categoryVersion: 1` rows behind.
 *
 * The upgrade recomputes each game's canonical category from its verbatim
 * `timeControl` and the profile selected from its `source`, writing both the
 * indexed `normalizedTimeControl` and the structured `timeControlModel`
 * (`profile`, `categoryVersion: 2`). The transform is a pure function of
 * `(timeControl, source)` and never reads the stored category, so it is
 * idempotent: re-running yields byte-identical rows. Only Chess.com games with
 * an estimate of 480–599 s (`rapid` → `blitz`) or ≥ 1500 s
 * (`classical` → `rapid`) change; `lichess`, `local` and `fixture` rows keep
 * their category.
 */
export function applyV11Schema(db: Dexie): void {
  db.version(11)
    .stores({ games: '&id, source, playedAt, normalizedTimeControl, timeControl' })
    .upgrade(async (tx) => {
      const rows = await tx.table('games').toArray();
      const upgraded = rows.map(
        (row: {
          source: GameSource;
          timeControl: string;
          normalizedTimeControl: string;
          timeControlModel?: TimeControl;
        }) => {
          const model = parseTimeControl(row.timeControl, timeControlProfileForSource(row.source));
          row.normalizedTimeControl = model.category;
          row.timeControlModel = model;
          return row;
        },
      );
      await tx.table('games').bulkPut(upgraded);
    });
}
