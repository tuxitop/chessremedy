import Dexie, { type Table } from 'dexie';
import { applyV1Schema, applyV2Schema } from './schema';
import type { GameRow } from './games-repository';
import { PERSISTENCE_SCHEMA_VERSION } from '@/config/app-config';

export interface SettingRow<T = unknown> {
  key: string;
  value: T;
  updatedAt: number;
}

export class ChessRemedyDatabase extends Dexie {
  settings!: Table<SettingRow, string>;
  games!: Table<GameRow, string>;

  constructor(name = 'chessremedy') {
    super(name);
    // Future versions chain here in order.
    applyV1Schema(this);
    applyV2Schema(this);
  }
}

export const db = new ChessRemedyDatabase();

if (PERSISTENCE_SCHEMA_VERSION !== 2) {
  throw new Error(
    `PERSISTENCE_SCHEMA_VERSION mismatch: ${PERSISTENCE_SCHEMA_VERSION} vs Dexie v2. ` +
      `Bump PERSISTENCE_SCHEMA_VERSION in app-config.ts and add a new schema module ` +
      `when extending the database.`,
  );
}
