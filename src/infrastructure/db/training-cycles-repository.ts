/**
 * Training-cycles repository (Feature 013).
 *
 * Persists one row per pass through a training set (`TrainingCycleRow`, schema
 * v10). A row is the domain row stored verbatim — the storage adds no fields.
 * The pair `[trainingSetId, cycleNumber]` is unique (the schema's compound
 * `&[trainingSetId+cycleNumber]` key); `cycleNumber` is 1-based per set.
 *
 * A cycle's identity/snapshot fields (membership `puzzleIds` + `config`) are
 * immutable once created; only the lifecycle status/timestamps change, via
 * `updateStatus`. Every aggregate metric is derived from the immutable
 * `puzzleAttempts` rows and is never stored here.
 */

import type { TrainingCycleRow, TrainingCycleStatus } from '@/domain/training';
import { QUICK_TRAIN_SET_ID } from '@/domain/training';
import { db, type ChessRemedyDatabase } from './database';

/**
 * Persisted training-cycle row: the domain `TrainingCycleRow`, stored as-is
 * with no storage-scope additions (a plain alias; kept so `database.ts` and
 * readers depend on a storage-named type like the other tables).
 */
export type TrainingCyclesRow = TrainingCycleRow;

/** The lifecycle fields `updateStatus` may change on an existing cycle. */
export interface TrainingCycleStatusPatch {
  readonly status: TrainingCycleStatus;
  readonly completedAt?: number | null;
  readonly abandonedAt?: number | null;
}

export interface TrainingCyclesRepository {
  /** One cycle by id; `undefined` when absent. */
  get(id: string): Promise<TrainingCyclesRow | undefined>;
  /** Every cycle of one set, ordered by `cycleNumber` ascending. */
  listForSet(setId: string): Promise<TrainingCyclesRow[]>;
  /**
   * Every persisted cycle across all sets, ordered deterministically by
   * `trainingSetId`, then `cycleNumber`, then `id`. Used by the global mastery
   * read so an orphaned attempt row (a `cycleId` with no cycle row) never
   * credits.
   */
  listAll(): Promise<TrainingCyclesRow[]>;
  /** One set's cycle by its 1-based number (the compound unique key read). */
  getByNumber(setId: string, cycleNumber: number): Promise<TrainingCyclesRow | undefined>;
  /** Insert or replace one cycle row. */
  create(row: TrainingCyclesRow): Promise<void>;
  /**
   * Insert one **Quick-train** cycle: a real `trainingCycles` row under the
   * reserved `QUICK_TRAIN_SET_ID` sentinel with **no** owning `trainingSets`
   * row (spec §3c). The sentinel row is excluded from set-scoped reads and is
   * removed only by the game-deletion/puzzle cascade. Rejects a row whose
   * `trainingSetId` is not the sentinel so the ad-hoc identity cannot be
   * misused for an ordinary set cycle.
   */
  createQuickTrain(row: TrainingCyclesRow): Promise<void>;
  /**
   * Apply a lifecycle status/timestamp patch to one cycle. Returns the stored
   * row, or `undefined` when the id is absent (no row is created).
   */
  updateStatus(id: string, patch: TrainingCycleStatusPatch): Promise<TrainingCyclesRow | undefined>;
  /** Remove every cycle of one set (the set-deletion cascade's cycle half). */
  deleteForSet(setId: string): Promise<void>;
}

export class DexieTrainingCyclesRepository implements TrainingCyclesRepository {
  private readonly database: ChessRemedyDatabase;

  constructor(database: ChessRemedyDatabase = db) {
    this.database = database;
  }

  async get(id: string): Promise<TrainingCyclesRow | undefined> {
    return this.database.trainingCycles.get(id);
  }

  async listForSet(setId: string): Promise<TrainingCyclesRow[]> {
    const rows = await this.database.trainingCycles.where('trainingSetId').equals(setId).toArray();
    return rows.sort((a, b) => a.cycleNumber - b.cycleNumber || a.id.localeCompare(b.id));
  }

  async listAll(): Promise<TrainingCyclesRow[]> {
    const rows = await this.database.trainingCycles.toArray();
    return rows.sort(
      (a, b) =>
        a.trainingSetId.localeCompare(b.trainingSetId) ||
        a.cycleNumber - b.cycleNumber ||
        a.id.localeCompare(b.id),
    );
  }

  async getByNumber(setId: string, cycleNumber: number): Promise<TrainingCyclesRow | undefined> {
    return this.database.trainingCycles
      .where('[trainingSetId+cycleNumber]')
      .equals([setId, cycleNumber])
      .first();
  }

  async create(row: TrainingCyclesRow): Promise<void> {
    await this.database.trainingCycles.put(row);
  }

  async createQuickTrain(row: TrainingCyclesRow): Promise<void> {
    if (row.trainingSetId !== QUICK_TRAIN_SET_ID) {
      throw new Error(
        `createQuickTrain requires the ${QUICK_TRAIN_SET_ID} sentinel trainingSetId.`,
      );
    }
    await this.database.trainingCycles.put(row);
  }

  async updateStatus(
    id: string,
    patch: TrainingCycleStatusPatch,
  ): Promise<TrainingCyclesRow | undefined> {
    const existing = await this.database.trainingCycles.get(id);
    if (!existing) {
      return undefined;
    }
    const updated: TrainingCyclesRow = {
      ...existing,
      status: patch.status,
      completedAt: patch.completedAt === undefined ? existing.completedAt : patch.completedAt,
      abandonedAt: patch.abandonedAt === undefined ? existing.abandonedAt : patch.abandonedAt,
    };
    await this.database.trainingCycles.put(updated);
    return updated;
  }

  async deleteForSet(setId: string): Promise<void> {
    await this.database.trainingCycles.where('trainingSetId').equals(setId).delete();
  }
}

export const trainingCyclesRepository: TrainingCyclesRepository =
  new DexieTrainingCyclesRepository();
