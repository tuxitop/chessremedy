/**
 * Puzzle repository (Feature 011).
 *
 * Persists the generator's immutable puzzle output as game-scoped derived data
 * (ARCHITECTURE.md §7). A row is the domain `PuzzleRow` stored verbatim — the
 * storage adds no fields — with natural key `[sourceGameId + sourcePly]`
 * (schema v8): at most one durable puzzle per (game, position), so re-analysis
 * and idempotent re-runs never overwrite an existing row. The game-scoping
 * index is the row's `sourceGameId` field.
 *
 * Rows are immutable once written. This repository is therefore add-only —
 * `addIfAbsent` is the only write path Feature-011 uses — and it deliberately
 * never exposes an update/overwrite for the row body. Deleting a game removes
 * its puzzles (cascade via `games-repository.deleteGames`).
 */

import type { PuzzleRow } from '@/domain/puzzle';
import { parsePuzzleId } from '@/domain/puzzle/id';
import type { GameId } from '@/domain/chess/game';
import { db, type ChessRemedyDatabase } from './database';

/**
 * Persisted puzzle row: the immutable domain `PuzzleRow`, stored as-is with no
 * storage-scope additions (a plain alias; kept so `database.ts` and readers
 * depend on a storage-named type like the other tables).
 */
export type PuzzlesRow = PuzzleRow;

export interface PuzzlesRepository {
  /**
   * Insert rows whose natural key `[sourceGameId, sourcePly]` is absent —
   * first write wins. Rows whose key already exists are skipped; existing rows
   * are never overwritten (a `put` would clobber an immutable row). Idempotent:
   * re-adding an already-present key is a no-op.
   *
   * @returns the number of rows actually added.
   */
  addIfAbsent(rows: readonly PuzzleRow[]): Promise<number>;
  /** One puzzle by its natural key `[sourceGameId, sourcePly]`; `undefined` when absent. */
  getPuzzle(sourceGameId: GameId, sourcePly: number): Promise<PuzzleRow | undefined>;
  /** Every puzzle of one game, ordered by `sourcePly`. */
  listForGame(sourceGameId: GameId): Promise<PuzzleRow[]>;
  /**
   * Every persisted puzzle (the training-home pool view), ordered by
   * `sourceGameId` then `sourcePly`. One bounded read, never a per-row scan.
   */
  listAll(): Promise<PuzzleRow[]>;
  /**
   * Bulk hydration of membership ids (`puzzleIdOf` values): one `bulkGet` by
   * the natural key `[sourceGameId, sourcePly]`. Ids that are malformed or
   * whose row is absent are omitted; the surviving rows keep the input order.
   */
  getPuzzles(ids: readonly string[]): Promise<PuzzleRow[]>;
  /** Number of puzzles of one game (`0` when the game has none). */
  countForGame(sourceGameId: GameId): Promise<number>;
  /**
   * Puzzle counts for the given games (Game Library pushdown — one query over
   * the `sourceGameId` index, never a per-row scan). Every input game maps to
   * its count (`0` when it has no puzzles); an empty input maps to `{}`.
   */
  countForGames(sourceGameIds: readonly GameId[]): Promise<Readonly<Record<GameId, number>>>;
  /** Remove every puzzle of the given games (game deletion cascade). */
  deleteForGames(sourceGameIds: readonly GameId[]): Promise<void>;
}

export class DexiePuzzlesRepository implements PuzzlesRepository {
  private readonly database: ChessRemedyDatabase;

  constructor(database: ChessRemedyDatabase = db) {
    this.database = database;
  }

  async addIfAbsent(rows: readonly PuzzleRow[]): Promise<number> {
    if (rows.length === 0) {
      return 0;
    }
    const keys = rows.map((row): [string, number] => [row.sourceGameId, row.sourcePly]);
    const existing = await this.database.puzzles.bulkGet(keys);
    const missing = rows.filter((_, index) => existing[index] === undefined);
    if (missing.length === 0) {
      return 0;
    }
    await this.database.puzzles.bulkAdd([...missing]);
    return missing.length;
  }

  async getPuzzle(sourceGameId: GameId, sourcePly: number): Promise<PuzzleRow | undefined> {
    return this.database.puzzles.get([sourceGameId, sourcePly]);
  }

  async listForGame(sourceGameId: GameId): Promise<PuzzleRow[]> {
    const rows = await this.database.puzzles.where('sourceGameId').equals(sourceGameId).toArray();
    return [...rows].sort((a, b) => a.sourcePly - b.sourcePly);
  }

  async listAll(): Promise<PuzzleRow[]> {
    const rows = await this.database.puzzles.toArray();
    return rows.sort(
      (a, b) => a.sourceGameId.localeCompare(b.sourceGameId) || a.sourcePly - b.sourcePly,
    );
  }

  async getPuzzles(ids: readonly string[]): Promise<PuzzleRow[]> {
    const keys: Array<[string, number]> = [];
    for (const id of ids) {
      const parsed = parsePuzzleId(id);
      if (parsed.ok) {
        keys.push([parsed.sourceGameId, parsed.sourcePly]);
      }
    }
    if (keys.length === 0) {
      return [];
    }
    const rows = await this.database.puzzles.bulkGet(keys);
    return rows.filter((row): row is PuzzleRow => row !== undefined);
  }

  async countForGame(sourceGameId: GameId): Promise<number> {
    return this.database.puzzles.where('sourceGameId').equals(sourceGameId).count();
  }

  async countForGames(sourceGameIds: readonly GameId[]): Promise<Readonly<Record<GameId, number>>> {
    if (sourceGameIds.length === 0) {
      return {};
    }
    const ids = [...sourceGameIds];
    const rows = await this.database.puzzles.where('sourceGameId').anyOf(ids).toArray();
    const counts: Record<GameId, number> = {};
    for (const id of ids) {
      counts[id] = 0;
    }
    for (const row of rows) {
      counts[row.sourceGameId] = (counts[row.sourceGameId] ?? 0) + 1;
    }
    return counts;
  }

  async deleteForGames(sourceGameIds: readonly GameId[]): Promise<void> {
    if (sourceGameIds.length === 0) {
      return;
    }
    await this.database.puzzles
      .where('sourceGameId')
      .anyOf([...sourceGameIds])
      .delete();
  }
}

export const puzzlesRepository: PuzzlesRepository = new DexiePuzzlesRepository();
