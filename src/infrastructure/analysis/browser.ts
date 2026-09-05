/**
 * Browser game-analysis service assembly (Feature 008).
 *
 * Builds the shared Feature-005 browser engine service, the persistent
 * ADR-018 position-keyed cache and the analysis repositories into an
 * `AnalysisService`. The engine identity (name/version/build) comes from the
 * constructed engine service (it resolves from the shipped manifest at build
 * time), so no Stockfish version is hard-coded here.
 *
 * The same engine service and cache instance are shared with the Feature-010
 * `TacticalDetectionService` (constructed here rather than by the standalone
 * tactics assembly) so detection never spins up a second engine worker and
 * reads/writes the same ADR-018 position cache.
 */

import { createBrowserEngineService } from '@/infrastructure/engine/browser';
import type { EngineServiceImpl } from '@/infrastructure/engine/engineService';
import { gamesRepository } from '@/infrastructure/db/games-repository';
import { analysesRepository } from '@/infrastructure/db/analysis-repository';
import { analysisJobsRepository } from '@/infrastructure/db/analysis-jobs-repository';
import { engineAnalysisCacheRepository } from '@/infrastructure/db/engine-cache-repository';
import { summariesRepository } from '@/infrastructure/db/summaries-repository';
import { puzzleCandidatesRepository } from '@/infrastructure/db/candidates-repository';
import { TacticalDetectionService } from '@/infrastructure/tactics/tacticalDetectionService';
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
  const detection = new TacticalDetectionService({
    engine,
    engineCache: engineAnalysisCacheRepository,
    analyses: analysesRepository,
    candidates: puzzleCandidatesRepository,
    summaries: summariesRepository,
    jobs: analysisJobsRepository,
    games: gamesRepository,
  });
  return new AnalysisService({
    games: gamesRepository,
    analyses: analysesRepository,
    jobs: analysisJobsRepository,
    engine,
    engineCache: engineAnalysisCacheRepository,
    engineMetadata: engineMetadataResolver(engine as EngineServiceImpl),
    summaries: summariesRepository,
    candidates: puzzleCandidatesRepository,
    detection,
  });
}

let browserAnalysisServicePromise: Promise<AnalysisService> | null = null;

/** Lazily-created shared game-analysis service for the browser (memoised). */
export function getBrowserAnalysisService(): Promise<AnalysisService> {
  browserAnalysisServicePromise ??= createBrowserAnalysisService();
  return browserAnalysisServicePromise;
}
