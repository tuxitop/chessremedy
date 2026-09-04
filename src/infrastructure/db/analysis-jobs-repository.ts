/**
 * Analysis queue repository (Feature 008).
 *
 * Persistent per-game analysis jobs (`queued | inProgress | completed |
 * cancelled | failed`). A job row doubles as the analysis metadata for its
 * completed run (engine/profile/version/timestamps).
 */

import type { AnalysisJob } from '@/domain/analysis';
import type { AnalysisJobState } from '@/domain/chess';
import type { GameId } from '@/domain/chess/game';
import { db, type ChessRemedyDatabase } from './database';

export interface AnalysisJobsRepository {
  getJob(id: string): Promise<AnalysisJob | undefined>;
  putJob(job: AnalysisJob): Promise<void>;
  deleteJob(id: string): Promise<void>;
  listByGame(gameId: GameId): Promise<readonly AnalysisJob[]>;
  listByGames(gameIds: readonly GameId[]): Promise<readonly AnalysisJob[]>;
  listByState(state: AnalysisJobState): Promise<readonly AnalysisJob[]>;
  deleteForGames(gameIds: readonly GameId[]): Promise<void>;
}

export class DexieAnalysisJobsRepository implements AnalysisJobsRepository {
  private readonly database: ChessRemedyDatabase;

  constructor(database: ChessRemedyDatabase = db) {
    this.database = database;
  }

  async getJob(id: string): Promise<AnalysisJob | undefined> {
    return this.database.analysisJobs.get(id);
  }

  async putJob(job: AnalysisJob): Promise<void> {
    await this.database.analysisJobs.put(job);
  }

  async deleteJob(id: string): Promise<void> {
    await this.database.analysisJobs.delete(id);
  }

  async listByGame(gameId: GameId): Promise<readonly AnalysisJob[]> {
    return this.database.analysisJobs.where('gameId').equals(gameId).toArray();
  }

  async listByGames(gameIds: readonly GameId[]): Promise<readonly AnalysisJob[]> {
    if (gameIds.length === 0) {
      return [];
    }
    return this.database.analysisJobs
      .where('gameId')
      .anyOf([...gameIds])
      .toArray();
  }

  async listByState(state: AnalysisJobState): Promise<readonly AnalysisJob[]> {
    return this.database.analysisJobs.where('state').equals(state).toArray();
  }

  async deleteForGames(gameIds: readonly GameId[]): Promise<void> {
    if (gameIds.length === 0) {
      return;
    }
    await this.database.analysisJobs
      .where('gameId')
      .anyOf([...gameIds])
      .delete();
  }
}

export const analysisJobsRepository: AnalysisJobsRepository = new DexieAnalysisJobsRepository();
