/**
 * Browser tactical-detection service assembly (Feature 010).
 *
 * Wires the Feature-010 repositories (per-analysis summaries, puzzle
 * candidates, MoveAnalysis), the analysis jobs + games repositories (for the
 * Milestone-B lazy backfill), the shared Feature-005 browser engine service
 * and the persistent ADR-018 engine-analysis cache into a
 * `TacticalDetectionService`. Reused by the analysis-service assembly once the
 * Feature-008 integration lands.
 */

import { createBrowserEngineService } from '@/infrastructure/engine/browser';
import { analysesRepository } from '@/infrastructure/db/analysis-repository';
import { analysisJobsRepository } from '@/infrastructure/db/analysis-jobs-repository';
import { puzzleCandidatesRepository } from '@/infrastructure/db/candidates-repository';
import { gamesRepository } from '@/infrastructure/db/games-repository';
import { summariesRepository } from '@/infrastructure/db/summaries-repository';
import { engineAnalysisCacheRepository } from '@/infrastructure/db/engine-cache-repository';
import { TacticalDetectionService } from './tacticalDetectionService';

export async function createBrowserTacticalDetectionService(): Promise<TacticalDetectionService> {
  const engine = await createBrowserEngineService();
  return new TacticalDetectionService({
    engine,
    engineCache: engineAnalysisCacheRepository,
    analyses: analysesRepository,
    candidates: puzzleCandidatesRepository,
    summaries: summariesRepository,
    jobs: analysisJobsRepository,
    games: gamesRepository,
  });
}

let browserTacticalDetectionServicePromise: Promise<TacticalDetectionService> | null = null;

/** Lazily-created shared tactical-detection service for the browser (memoised). */
export function getBrowserTacticalDetectionService(): Promise<TacticalDetectionService> {
  browserTacticalDetectionServicePromise ??= createBrowserTacticalDetectionService();
  return browserTacticalDetectionServicePromise;
}
