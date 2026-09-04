/**
 * Games repository (Feature 004, Local Game Storage).
 *
 * Persists the domain `Game` aggregate into the Dexie `games` table (v2).
 * A row stores the authoritative scalar metadata (capturing import-time
 * normalization — ADR-013 consequence) plus the verbatim PGN; the chessops
 * moves tree is rebuilt from the PGN on full reads because the chessops
 * `Node<PgnNodeData>` tree is not structured-cloneable.
 */

import { gameFromPgn } from '@/domain/chess/parseGame';
import {
  makeGameId,
  type Game,
  type GameId,
  type GameResult,
  type Player,
} from '@/domain/chess/game';
import type { GameSource } from '@/domain/chess/gameSource';
import type { TimeControlCategory } from '@/domain/chess/timeControl';
import type { Color } from 'chessops/types';
import { db, type ChessRemedyDatabase } from './database';

/** Persisted row — scalar Game metadata (authoritative) + verbatim PGN. */
export interface GameRow {
  readonly id: GameId;
  readonly source: GameSource;
  readonly externalId: string | null;
  /** ISO-8601 UTC; null when unknown. */
  readonly playedAt: string | null;
  readonly whitePlayer: Player;
  readonly blackPlayer: Player;
  readonly result: GameResult;
  /** Raw provider time-control string, verbatim. */
  readonly timeControl: string;
  /** Category as normalized at import time (ADR-013 retention). */
  readonly normalizedTimeControl: TimeControlCategory;
  readonly userColor: Color;
  /** Verbatim PGN for exactly one game. */
  readonly pgn: string;
  /** Epoch millis of the first local insert. */
  readonly importedAt: number;
  /** Epoch millis of the last content change. */
  readonly updatedAt: number;
}

/** Lightweight read model for listings/filters — no PGN, no parse. */
export interface GameSummary {
  readonly id: GameId;
  readonly source: GameSource;
  readonly externalId: string | null;
  readonly playedAt: string | null;
  readonly whitePlayer: Player;
  readonly blackPlayer: Player;
  readonly result: GameResult;
  readonly timeControl: string;
  readonly normalizedTimeControl: TimeControlCategory;
  readonly userColor: Color;
  readonly importedAt: number;
  readonly updatedAt: number;
}

export type GameSaveStatus = 'inserted' | 'updated' | 'duplicate' | 'idCollision';

export interface GameSaveResult {
  readonly status: GameSaveStatus;
  readonly id: GameId;
}

export interface GameQuery {
  readonly source?: GameSource;
  readonly normalizedTimeControl?: TimeControlCategory;
  readonly result?: GameResult;
  readonly userColor?: Color;
  /** Exclusive ISO upper bound on playedAt. */
  readonly playedBefore?: string;
  /** Exclusive ISO lower bound on playedAt. */
  readonly playedAfter?: string;
}

export interface GamesRepository {
  /** Insert or update one game; content-aware duplicate detection (D4). */
  saveGame(game: Game): Promise<GameSaveResult>;
  /** Batch variant inside a single Dexie transaction; results aligned to input. */
  saveGames(games: readonly Game[]): Promise<readonly GameSaveResult[]>;
  /** Full domain Game (moves tree rebuilt from stored PGN). Undefined when absent. */
  getGame(id: GameId): Promise<Game | undefined>;
  /** Lightweight records for listings/stats; never parses PGN. Ordered per D6. */
  listGameSummaries(query?: GameQuery): Promise<readonly GameSummary[]>;
  /** Ids only, for the same query (used by Library select-all). */
  listGameIds(query?: GameQuery): Promise<readonly GameId[]>;
  /** Total number of stored games (Library header count). */
  countGames(): Promise<number>;
  /** Cheap duplicate existence check. */
  hasGame(id: GameId): Promise<boolean>;
  /** Idempotent delete; resolves when absent. */
  deleteGame(id: GameId): Promise<void>;
  /** Batch delete inside one transaction (Game Library; cascade-ready). */
  deleteGames(ids: readonly GameId[]): Promise<void>;
}

export class GameCorruptionError extends Error {
  readonly gameId: GameId;

  constructor(gameId: GameId, message: string) {
    super(`Corrupt stored game ${gameId}: ${message}`);
    this.name = 'GameCorruptionError';
    this.gameId = gameId;
  }
}

const PROVIDER_SOURCES = new Set<GameSource>(['chesscom', 'lichess']);

export class DexieGamesRepository implements GamesRepository {
  private readonly database: ChessRemedyDatabase;

  constructor(database: ChessRemedyDatabase = db) {
    this.database = database;
  }

  async saveGame(game: Game): Promise<GameSaveResult> {
    const existing = await this.database.games.get(game.id);
    if (!existing) {
      const now = Date.now();
      await this.database.games.put({
        ...contentFieldsOf(game),
        importedAt: now,
        updatedAt: now,
      });
      return { status: 'inserted', id: game.id };
    }
    if (contentEqualsRow(existing, game)) {
      return { status: 'duplicate', id: game.id };
    }
    if (PROVIDER_SOURCES.has(game.source)) {
      await this.database.games.put({
        ...existing,
        ...contentFieldsOf(game),
        importedAt: existing.importedAt,
        updatedAt: Date.now(),
      });
      return { status: 'updated', id: game.id };
    }
    // Same id but different content for a non-provider game can only be an
    // FNV-1a 32-bit hash collision (Feature-003 L3 caveat). Never overwrite.
    return { status: 'idCollision', id: game.id };
  }

  async saveGames(games: readonly Game[]): Promise<readonly GameSaveResult[]> {
    return this.database.transaction('rw', this.database.games, async () => {
      const results: GameSaveResult[] = [];
      for (const game of games) {
        results.push(await this.saveGame(game));
      }
      return results;
    });
  }

  async getGame(id: GameId): Promise<Game | undefined> {
    const row = await this.database.games.get(id);
    if (!row) {
      return undefined;
    }
    if (makeGameId(row.source, row.externalId, row.pgn) !== row.id) {
      throw new GameCorruptionError(row.id, 'recomputed id does not match stored id');
    }
    const parsed = gameFromPgn(row.pgn, {
      source: row.source,
      ...(row.externalId ? { externalId: row.externalId } : {}),
      userColor: row.userColor,
    });
    if (!parsed.ok) {
      throw new GameCorruptionError(
        row.id,
        `stored PGN cannot be re-parsed: ${parsed.error.message}`,
      );
    }
    return {
      id: row.id,
      source: row.source,
      externalId: row.externalId,
      playedAt: row.playedAt,
      whitePlayer: row.whitePlayer,
      blackPlayer: row.blackPlayer,
      result: row.result,
      timeControl: row.timeControl,
      normalizedTimeControl: row.normalizedTimeControl,
      userColor: row.userColor,
      pgn: row.pgn,
      moves: parsed.game.moves,
    };
  }

  async listGameSummaries(query?: GameQuery): Promise<readonly GameSummary[]> {
    let rows = await this.fetchRows(query);
    rows = rows.filter((row) => matchesQuery(row, query));
    return [...rows].sort(compareRows).map((row) => summaryOf(row));
  }

  async listGameIds(query?: GameQuery): Promise<readonly GameId[]> {
    const rows = await this.fetchRows(query);
    return rows.filter((row) => matchesQuery(row, query)).map((row) => row.id);
  }

  async countGames(): Promise<number> {
    return this.database.games.count();
  }

  async hasGame(id: GameId): Promise<boolean> {
    const count = await this.database.games.where(':id').equals(id).count();
    return count > 0;
  }

  async deleteGame(id: GameId): Promise<void> {
    await this.database.games.delete(id);
  }

  async deleteGames(ids: readonly GameId[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await this.database.transaction('rw', this.database.games, async () => {
      await this.database.games.bulkDelete([...ids]);
    });
  }

  private async fetchRows(query: GameQuery | undefined): Promise<GameRow[]> {
    const after = query?.playedAfter;
    const before = query?.playedBefore;
    if (after !== undefined || before !== undefined) {
      const clause = this.database.games.where('playedAt');
      if (after !== undefined && before !== undefined) {
        return clause.between(after, before, false, false).toArray();
      }
      if (after !== undefined) {
        return clause.above(after).toArray();
      }
      return clause.below(before!).toArray();
    }
    if (query?.source) {
      return this.database.games.where('source').equals(query.source).toArray();
    }
    if (query?.normalizedTimeControl) {
      return this.database.games
        .where('normalizedTimeControl')
        .equals(query.normalizedTimeControl)
        .toArray();
    }
    return this.database.games.toArray();
  }
}

/** The row's comparison set (D4/L3): everything except the timestamps. */
type ContentFields = Omit<GameRow, 'importedAt' | 'updatedAt'>;

function contentFieldsOf(game: Game): ContentFields {
  return {
    id: game.id,
    source: game.source,
    externalId: game.externalId,
    playedAt: game.playedAt,
    whitePlayer: game.whitePlayer,
    blackPlayer: game.blackPlayer,
    result: game.result,
    timeControl: game.timeControl,
    normalizedTimeControl: game.normalizedTimeControl,
    userColor: game.userColor,
    pgn: game.pgn,
  };
}

function contentEqualsRow(row: GameRow, game: Game): boolean {
  const { importedAt: _ri, updatedAt: _ru, ...rowContent } = row;
  return JSON.stringify(rowContent) === JSON.stringify(contentFieldsOf(game));
}

function matchesQuery(row: GameRow, query: GameQuery | undefined): boolean {
  if (!query) {
    return true;
  }
  if (query.source && row.source !== query.source) {
    return false;
  }
  if (query.normalizedTimeControl && row.normalizedTimeControl !== query.normalizedTimeControl) {
    return false;
  }
  if (query.result && row.result !== query.result) {
    return false;
  }
  if (query.userColor && row.userColor !== query.userColor) {
    return false;
  }
  if (row.playedAt !== null) {
    if (query.playedAfter !== undefined && !(row.playedAt > query.playedAfter)) {
      return false;
    }
    if (query.playedBefore !== undefined && !(row.playedAt < query.playedBefore)) {
      return false;
    }
  } else if (query.playedBefore !== undefined || query.playedAfter !== undefined) {
    // A dateless game never satisfies a date bound.
    return false;
  }
  return true;
}

function compareRows(a: GameRow, b: GameRow): number {
  const aNull = a.playedAt === null;
  const bNull = b.playedAt === null;
  if (aNull && bNull) {
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  }
  if (aNull) {
    return 1;
  }
  if (bNull) {
    return -1;
  }
  const byDate = b.playedAt.localeCompare(a.playedAt);
  if (byDate !== 0) {
    return byDate;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function summaryOf(row: GameRow): GameSummary {
  const { pgn: _pgn, ...summary } = row;
  return summary;
}

export const gamesRepository: GamesRepository = new DexieGamesRepository();
