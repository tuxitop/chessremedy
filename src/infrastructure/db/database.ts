import Dexie, { type Table } from 'dexie';
import {
  applyV1Schema,
  applyV2Schema,
  applyV3Schema,
  applyV4Schema,
  applyV5Schema,
  applyV6Schema,
} from './schema';
import type { GameRow } from './games-repository';
import type { AnalysisJob } from '@/domain/analysis';
import type { MoveAnalysis } from '@/domain/chess';
import type { EngineCacheRow } from './engine-cache-repository';
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

  constructor(name = 'chessremedy') {
    super(name);
    // Future versions chain here in order.
    applyV1Schema(this);
    applyV2Schema(this);
    applyV3Schema(this);
    applyV4Schema(this);
    applyV5Schema(this);
    applyV6Schema(this);
  }
}

export const db = new ChessRemedyDatabase();

if (PERSISTENCE_SCHEMA_VERSION !== 6) {
  throw new Error(
    `PERSISTENCE_SCHEMA_VERSION mismatch: ${PERSISTENCE_SCHEMA_VERSION} vs Dexie v6. ` +
      `Bump PERSISTENCE_SCHEMA_VERSION in app-config.ts and add a new schema module ` +
      `when extending the database.`,
  );
}
