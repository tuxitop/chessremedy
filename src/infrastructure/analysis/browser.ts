/**
 * Browser game-analysis service assembly (Feature 008).
 *
 * Builds the shared Feature-005 browser engine service, the persistent
 * ADR-018 position-keyed cache and the analysis repositories into an
 * `AnalysisService`. The engine identity (name/version/build) comes from the
 * constructed engine service (it resolves from the shipped manifest at build
 * time), so no Stockfish version is hard-coded here.
 */

import { createBrowserEngineService } from '@/infrastructure/engine/browser';
import type { EngineServiceImpl } from '@/infrastructure/engine/engineService';
import { gamesRepository } from '@/infrastructure/db/games-repository';
import { analysesRepository } from '@/infrastructure/db/analysis-repository';
import { analysisJobsRepository } from '@/infrastructure/db/analysis-jobs-repository';
import { engineAnalysisCacheRepository } from '@/infrastructure/db/engine-cache-repository';
import type { EngineMetadata, AnalysisProfile } from '@/domain/chess';
import { AnalysisService } from './analysisService';

function engineMetadataResolver(
  service: EngineServiceImpl,
): (profile: AnalysisProfile) => EngineMetadata {
  const identity = service.engineIdentity;
  return (profile) => ({ ...identity, profile });
}

export async function createBrowserAnalysisService(): Promise<AnalysisService> {
  const engine = await createBrowserEngineService();
  return new AnalysisService({
    games: gamesRepository,
    analyses: analysesRepository,
    jobs: analysisJobsRepository,
    engine,
    engineCache: engineAnalysisCacheRepository,
    engineMetadata: engineMetadataResolver(engine as EngineServiceImpl),
  });
}

let browserAnalysisServicePromise: Promise<AnalysisService> | null = null;

/** Lazily-created shared game-analysis service for the browser (memoised). */
export function getBrowserAnalysisService(): Promise<AnalysisService> {
  browserAnalysisServicePromise ??= createBrowserAnalysisService();
  return browserAnalysisServicePromise;
}
