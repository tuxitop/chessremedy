/**
 * Analysis repository (Feature 008).
 *
 * Persists the per-ply `MoveAnalysis` records (the authoritative game-scoped
 * analysis data, ARCHITECTURE.md §7). Rows are keyed by `[analysisId, ply]`
 * and queryable by game id and by (game, analysis identity). A completed run
 * is written atomically per analysis identity.
 */

import type { MoveAnalysis } from '@/domain/chess';
import type { GameId } from '@/domain/chess/game';
import { db, type ChessRemedyDatabase } from './database';

export interface AnalysisRepository {
  /** Atomically replace every record of a run with the given records. */
  replaceAnalysis(records: readonly MoveAnalysis[]): Promise<void>;
  /** Every persisted record of a game (any analysis identity), by ply. */
  listForGame(gameId: GameId): Promise<readonly MoveAnalysis[]>;
  /** Records of one game + analysis identity, ordered by ply. */
  listForGameAndAnalysis(gameId: GameId, analysisId: string): Promise<readonly MoveAnalysis[]>;
  /** Number of persisted records for a game. */
  countForGame(gameId: GameId): Promise<number>;
  /** Remove all game-scoped records (game deletion cascade). */
  deleteForGames(gameIds: readonly GameId[]): Promise<void>;
}

export class DexieAnalysisRepository implements AnalysisRepository {
  private readonly database: ChessRemedyDatabase;

  constructor(database: ChessRemedyDatabase = db) {
    this.database = database;
  }

  async replaceAnalysis(records: readonly MoveAnalysis[]): Promise<void> {
    if (records.length === 0) {
      return;
    }
    const analysisId = records[0]!.analysisId;
    await this.database.transaction('rw', this.database.analyses, async () => {
      await this.database.analyses.where('analysisId').equals(analysisId).delete();
      await this.database.analyses.bulkPut([...records]);
    });
  }

  async listForGame(gameId: GameId): Promise<readonly MoveAnalysis[]> {
    return this.sortByPly(await this.database.analyses.where('gameId').equals(gameId).toArray());
  }

  async listForGameAndAnalysis(
    gameId: GameId,
    analysisId: string,
  ): Promise<readonly MoveAnalysis[]> {
    const rows = await this.database.analyses
      .where('[gameId+analysisId]')
      .equals([gameId, analysisId])
      .toArray();
    return this.sortByPly(rows);
  }

  async countForGame(gameId: GameId): Promise<number> {
    return this.database.analyses.where('gameId').equals(gameId).count();
  }

  async deleteForGames(gameIds: readonly GameId[]): Promise<void> {
    if (gameIds.length === 0) {
      return;
    }
    await this.database.analyses
      .where('gameId')
      .anyOf([...gameIds])
      .delete();
  }

  private sortByPly(rows: readonly MoveAnalysis[]): readonly MoveAnalysis[] {
    return [...rows].sort((a, b) => a.ply - b.ply);
  }
}

export const analysesRepository: AnalysisRepository = new DexieAnalysisRepository();
