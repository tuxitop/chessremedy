/**
 * Browser game-analysis service assembly (Feature 008).
 *
 * Builds the shared Feature-005 browser engine service, the persistent
 * ADR-018 position-keyed cache and the analysis repositories into an
 * `AnalysisService`. The engine identity (name/version/build) comes from the
 * constructed engine service (it resolves from the shipped manifest at build
 * time), so no Stockfish version is hard-coded here.
 *
 * ADR-034: the analysis engine is the **shared memoised** browser engine
 * (`getBrowserEngineService`), so Live Analysis (Feature 006) and full-game
 * analysis (Feature 008) run on one worker/queue. The Feature-010
 * `TacticalDetectionService` is given the dedicated lazy **verification**
 * engine instead, so detection never blocks the analysis FIFO and both read
 * and write the same ADR-018 position cache. This is a small behaviour change
 * for the live board (it now shares the analysis worker with game analysis);
 * see ADR-034.
 */

import {
  getBrowserEngineService,
  getBrowserVerificationEngineService,
} from '@/infrastructure/engine/browser';
import type { EngineServiceImpl } from '@/infrastructure/engine/engineService';
import { gamesRepository } from '@/infrastructure/db/games-repository';
import { analysesRepository } from '@/infrastructure/db/analysis-repository';
import { analysisJobsRepository } from '@/infrastructure/db/analysis-jobs-repository';
import { engineAnalysisCacheRepository } from '@/infrastructure/db/engine-cache-repository';
import { summariesRepository } from '@/infrastructure/db/summaries-repository';
import { puzzleCandidatesRepository } from '@/infrastructure/db/candidates-repository';
import { TacticalDetectionService } from '@/infrastructure/tactics/tacticalDetectionService';
import { resolveStoredVerificationDepth } from '@/infrastructure/tactics/browser';
import { getBrowserPuzzleGenerationService } from '@/infrastructure/puzzles';
import type { EngineMetadata, AnalysisProfile } from '@/domain/chess';
import { AnalysisService } from './analysisService';

function engineMetadataResolver(
  service: EngineServiceImpl,
): (profile: AnalysisProfile) => EngineMetadata {
  const identity = service.engineIdentity;
  return (profile) => ({ ...identity, profile });
}

export async function createBrowserAnalysisService(): Promise<AnalysisService> {
  const [engine, verificationEngine] = await Promise.all([
    getBrowserEngineService(),
    getBrowserVerificationEngineService(),
  ]);
  const detection = new TacticalDetectionService({
    engine: verificationEngine,
    resolveVerificationDepth: resolveStoredVerificationDepth,
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
    // Feature-011 Stage C: engine-free puzzle generation, auto-triggered when a
    // detection pass settles `completed` at the current DETECTION_VERSION.
    generation: getBrowserPuzzleGenerationService(),
  });
}

let browserAnalysisServicePromise: Promise<AnalysisService> | null = null;

/** Lazily-created shared game-analysis service for the browser (memoised). */
export function getBrowserAnalysisService(): Promise<AnalysisService> {
  browserAnalysisServicePromise ??= createBrowserAnalysisService();
  return browserAnalysisServicePromise;
}
