import { gamesRepository } from '@/infrastructure/db/games-repository';
import { importJobsRepository } from '@/infrastructure/db/import-jobs-repository';
import { ChessComAdapter } from '@/infrastructure/providers/chessCom';
import { LichessAdapter } from '@/infrastructure/providers/lichess';
import { ImportService } from './importService';

export {
  ImportService,
  ImportServiceError,
  IMPORT_BATCH_SIZE,
  isUnfiltered,
} from './importService';
export type { ImportServiceOptions, ImportRunOptions, StartImportRequest } from './importService';

function browserFetch(): typeof fetch {
  if (typeof globalThis.fetch !== 'function') {
    throw new Error('This environment provides no fetch implementation.');
  }
  return globalThis.fetch.bind(globalThis);
}

let importServiceInstance: ImportService | undefined;

/** The application-wide import service (browser fetch + Dexie singletons). */
export function createDefaultImportService(): ImportService {
  importServiceInstance ??= new ImportService({
    games: gamesRepository,
    jobs: importJobsRepository,
    adapters: {
      chesscom: new ChessComAdapter({ fetchImpl: browserFetch() }),
      lichess: new LichessAdapter({ fetchImpl: browserFetch() }),
    },
  });
  return importServiceInstance;
}

export const importService: ImportService = createDefaultImportService();
