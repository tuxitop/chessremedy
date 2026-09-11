/**
 * Feature 014 — browser statistics service assembly.
 *
 * Memoised singleton over the Dexie repositories, the lazy-summary backfill
 * (resolved lazily from the shared Feature-008 analysis service) and the
 * Worker-backed compute client. The engine service is only constructed when a
 * caller opts into backfill, so ordinary Dashboard reads never start
 * Stockfish.
 */

import { getBrowserAnalysisService } from '@/infrastructure/analysis/browser';
import { analysesRepository } from '@/infrastructure/db/analysis-repository';
import { analysisJobsRepository } from '@/infrastructure/db/analysis-jobs-repository';
import { attemptsRepository } from '@/infrastructure/db/attempts-repository';
import { gamesRepository } from '@/infrastructure/db/games-repository';
import { puzzlesRepository } from '@/infrastructure/db/puzzles-repository';
import { summariesRepository } from '@/infrastructure/db/summaries-repository';
import { trainingCyclesRepository } from '@/infrastructure/db/training-cycles-repository';
import { trainingSetsRepository } from '@/infrastructure/db/training-sets-repository';
import { StatisticsService } from './statistics-service';
import { createStatisticsCompute } from './worker-client';

let browserStatisticsService: StatisticsService | null = null;

/** Lazily-created shared statistics service for the browser (memoised). */
export function getBrowserStatisticsService(): StatisticsService {
  browserStatisticsService ??= new StatisticsService({
    games: gamesRepository,
    jobs: analysisJobsRepository,
    summaries: summariesRepository,
    analyses: analysesRepository,
    puzzles: puzzlesRepository,
    attempts: attemptsRepository,
    sets: trainingSetsRepository,
    cycles: trainingCyclesRepository,
    ensureSummariesForRows: async (gameIds) => {
      const analysisService = await getBrowserAnalysisService();
      return analysisService.ensureSummariesForRows(gameIds);
    },
    worker: createStatisticsCompute(),
  });
  return browserStatisticsService;
}
