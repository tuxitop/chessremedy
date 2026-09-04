/**
 * Deterministic fake game-analysis service for component tests (Feature 008).
 *
 * Wraps the real `AnalysisService` with the scriptable fake engine (no Worker,
 * no network) and the shared repositories, so Game Library / Review UI tests
 * drive real persistence while the engine stays deterministic.
 */

import { gamesRepository } from '@/infrastructure/db/games-repository';
import { analysesRepository } from '@/infrastructure/db/analysis-repository';
import { analysisJobsRepository } from '@/infrastructure/db/analysis-jobs-repository';
import { DexieEngineAnalysisCache } from '@/infrastructure/db/engine-cache-repository';
import { AnalysisService } from '@/infrastructure/analysis/analysisService';
import type { AnalysisServiceLike } from '@/hooks/useGameAnalysis';
import type { AnalysisProfile, EngineMetadata } from '@/domain/chess';
import {
  createFakeEngine,
  FAKE_ENGINE_META,
  type FakeEngineRig,
} from '@/infrastructure/analysis/test-support/fakeAnalysisEngine';

export interface FakeAnalysisService {
  readonly service: AnalysisServiceLike;
  /** Reconfigure FENs to fail / recover (drives failed-analysis UI states). */
  readonly engine: FakeEngineRig;
}

export function createFakeAnalysisService(
  failures?: ReadonlyMap<string, string>,
): FakeAnalysisService {
  const rig = createFakeEngine(failures ? { failures } : {});
  const service: AnalysisServiceLike = new AnalysisService({
    games: gamesRepository,
    analyses: analysesRepository,
    jobs: analysisJobsRepository,
    engine: rig.service,
    engineCache: new DexieEngineAnalysisCache(),
    engineMetadata: (profile: AnalysisProfile): EngineMetadata => ({
      ...FAKE_ENGINE_META,
      profile,
    }),
  });
  return { service, engine: rig };
}
