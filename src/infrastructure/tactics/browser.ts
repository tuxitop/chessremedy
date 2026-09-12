/**
 * Browser tactical-detection service assembly (Feature 010).
 *
 * Wires the Feature-010 repositories (per-analysis summaries, puzzle
 * candidates, MoveAnalysis), the analysis jobs + games repositories (for the
 * Milestone-B lazy backfill), the dedicated Feature-005 browser **verification**
 * engine (ADR-034) and the persistent ADR-018 engine-analysis cache into a
 * `TacticalDetectionService`. Reused by the analysis-service assembly once the
 * Feature-008 integration lands.
 */

import { getBrowserVerificationEngineService } from '@/infrastructure/engine/browser';
import { analysesRepository } from '@/infrastructure/db/analysis-repository';
import { analysisJobsRepository } from '@/infrastructure/db/analysis-jobs-repository';
import { puzzleCandidatesRepository } from '@/infrastructure/db/candidates-repository';
import { gamesRepository } from '@/infrastructure/db/games-repository';
import { summariesRepository } from '@/infrastructure/db/summaries-repository';
import { engineAnalysisCacheRepository } from '@/infrastructure/db/engine-cache-repository';
import { settingsRepository } from '@/infrastructure/db/settings-repository';
import { SETTINGS_KEYS } from '@/config/app-config';
import { TacticalDetectionService } from './tacticalDetectionService';
import {
  clampTacticalDetectionSettings,
  type TacticalDetectionSettings,
} from './verificationDepth';

/**
 * Read the persisted Stage-2 verification depth from Settings
 * (`analysis.tacticalDetection`), clamped to `[10, 40]` with a `22` fallback
 * (ADR-026/ADR-034). The detection service resolves this **once per pass**, so
 * every Stage-2 search of one pass shares the effective depth. Shared by the
 * standalone tactics assembly and the analysis-service assembly.
 */
export async function resolveStoredVerificationDepth(): Promise<number> {
  const stored = await settingsRepository.get<TacticalDetectionSettings>(
    SETTINGS_KEYS.analysisTacticalDetection,
  );
  return clampTacticalDetectionSettings(stored).verificationDepth;
}

export async function createBrowserTacticalDetectionService(): Promise<TacticalDetectionService> {
  const engine = await getBrowserVerificationEngineService();
  return new TacticalDetectionService({
    engine,
    resolveVerificationDepth: resolveStoredVerificationDepth,
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
