import Dexie, { type Table } from 'dexie';
import {
  applyV1Schema,
  applyV2Schema,
  applyV3Schema,
  applyV4Schema,
  applyV5Schema,
  applyV6Schema,
  applyV7Schema,
  applyV8Schema,
  applyV9Schema,
  applyV10Schema,
  applyV11Schema,
} from './schema';
import type { GameRow } from './games-repository';
import type { AnalysisJob } from '@/domain/analysis';
import type { MoveAnalysis } from '@/domain/chess';
import type { EngineCacheRow } from './engine-cache-repository';
import type { AnalysisSummaryRow } from './summaries-repository';
import type { PuzzleCandidateRow } from './candidates-repository';
import type { PuzzlesRow } from './puzzles-repository';
import type { PuzzleAttemptsRow } from './attempts-repository';
import type { TrainingSetsRow } from './training-sets-repository';
import type { TrainingCyclesRow } from './training-cycles-repository';
import { PERSISTENCE_SCHEMA_VERSION } from '@/config/app-config';
import type { ImportJob } from '@/domain/import/job';

export interface SettingRow<T = unknown> {
  key: string;
  value: T;
  updatedAt: number;
}

export class ChessRemedyDatabase extends Dexie {
  settings!: Table<SettingRow, string>;
  games!: Table<GameRow, string>;
  importJobs!: Table<ImportJob, string>;
  /** Feature-008 per-ply MoveAnalysis records (primary key `[analysisId, ply]`). */
  analyses!: Table<MoveAnalysis, [string, number]>;
  /** Feature-008 persistent analysis queue/metadata. */
  analysisJobs!: Table<AnalysisJob, string>;
  /** ADR-018 FEN-keyed engine cache (independent of games). */
  positionAnalysisCache!: Table<EngineCacheRow, string>;
  /** Feature-010 per-analysis summaries (schema v7), keyed by analysis id. */
  analysisSummaries!: Table<AnalysisSummaryRow, string>;
  /** Feature-010 puzzle candidates (schema v7), keyed `[analysisId, sourcePly]`. */
  puzzleCandidates!: Table<PuzzleCandidateRow, [string, number]>;
  /** Feature-011 puzzles (schema v8), keyed `[sourceGameId, sourcePly]`. */
  puzzles!: Table<PuzzlesRow, [string, number]>;
  /** Feature-012 puzzle attempts (schema v9), keyed `[cycleId, puzzleId, presentationIndex]`. */
  puzzleAttempts!: Table<PuzzleAttemptsRow, [string, string, number]>;
  /** Feature-013 training sets (schema v10), keyed by id. */
  trainingSets!: Table<TrainingSetsRow, string>;
  /** Feature-013 training cycles (schema v10), keyed by id. */
  trainingCycles!: Table<TrainingCyclesRow, string>;

  constructor(name = 'chessremedy') {
    super(name);
    // Future versions chain here in order.
    applyV1Schema(this);
    applyV2Schema(this);
    applyV3Schema(this);
    applyV4Schema(this);
    applyV5Schema(this);
    applyV6Schema(this);
    applyV7Schema(this);
    applyV8Schema(this);
    applyV9Schema(this);
    applyV10Schema(this);
    applyV11Schema(this);
  }
}

export const db = new ChessRemedyDatabase();

if (PERSISTENCE_SCHEMA_VERSION !== 11) {
  throw new Error(
    `PERSISTENCE_SCHEMA_VERSION mismatch: ${PERSISTENCE_SCHEMA_VERSION} vs Dexie v11. ` +
      `Bump PERSISTENCE_SCHEMA_VERSION in app-config.ts and add a new schema module ` +
      `when extending the database.`,
  );
}
