/**
 * Position-keyed engine analysis cache (Feature 008, ADR-018).
 *
 * The persistent, IndexedDB-backed implementation of the
 * `EngineAnalysisCache` seam that Feature 005/006 left for the feature that
 * persists analyses. Keyed by the ADR-018 `(position, profile, engineName,
 * engineVersion, engineBuild)` tuple (serialized by `analysisCacheKey`) so
 * entries are implicitly invalidated on engine upgrade (ADR-020).
 *
 * The cache is a performance store, never game-scoped: deleting a game never
 * purges it and it is never synced (Feature 016).
 */

import type { EngineAnalysisResult } from '@/infrastructure/engine/types';
import type { EngineAnalysisCache } from '@/infrastructure/engine/cache';
import { db, type ChessRemedyDatabase } from './database';

/** Persisted row for one cached engine analysis (ADR-018 table). */
export interface EngineCacheRow {
  readonly key: string;
  readonly analysis: EngineAnalysisResult;
  readonly profile: string;
  readonly engineName: string;
  readonly engineVersion: string;
  readonly engineBuild: string;
  /** Unix epoch millis. */
  readonly analyzedAt: number;
}

export interface EngineAnalysisCacheRepository extends EngineAnalysisCache {
  /** Count of entries (test/observability helper). */
  count(): Promise<number>;
}

/** Dexie-backed `EngineAnalysisCache` (ADR-018). */
export class DexieEngineAnalysisCache implements EngineAnalysisCacheRepository {
  private readonly database: ChessRemedyDatabase;

  constructor(database: ChessRemedyDatabase = db) {
    this.database = database;
  }

  async get(key: string): Promise<EngineAnalysisResult | undefined> {
    const row = await this.database.positionAnalysisCache.get(key);
    return row?.analysis;
  }

  async put(key: string, result: EngineAnalysisResult): Promise<void> {
    const row: EngineCacheRow = {
      key,
      analysis: result,
      profile: result.engine.profile,
      engineName: result.engine.engineName,
      engineVersion: result.engine.engineVersion,
      engineBuild: result.engine.engineBuild,
      analyzedAt: Date.now(),
    };
    await this.database.positionAnalysisCache.put(row);
  }

  async count(): Promise<number> {
    return this.database.positionAnalysisCache.count();
  }
}

export const engineAnalysisCacheRepository: EngineAnalysisCacheRepository =
  new DexieEngineAnalysisCache();
