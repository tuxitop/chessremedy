/**
 * Training-sets repository (Feature 013).
 *
 * Persists the fixed, user-owned training collections (`TacticalTrainingSetRow`,
 * schema v10). A row is the domain row stored verbatim — the storage adds no
 * fields — keyed by `id`; membership is stored state (`puzzleIds`), never a
 * live query, so a puzzle may belong to zero, one or many sets and membership
 * is never stored on the puzzle.
 *
 * Set-owned deletion is the ownership cascade (ARCHITECTURE.md §7,
 * `domain/tactical-training.md`): deleting a set removes its cycles and their
 * immutable attempt rows in one transaction, but never its puzzles (they remain
 * owned by their source games). Game deletion rides `removePuzzleIds` — a scan
 * of the small set table that strips the deleted puzzle ids from every
 * membership, bounded by the number of sets rather than puzzles.
 */

import type { TacticalTrainingSetRow, TrainingSetStatus } from '@/domain/training';
import { isWoodpeckerBlock } from '@/domain/training';
import { makeTombstone } from '@/domain/sync';
import { db, type ChessRemedyDatabase } from './database';
import { DexiePuzzleAttemptsRepository } from './attempts-repository';
import { DexieSyncStateRepository } from './sync-state-repository';

/**
 * Persisted training-set row: the domain `TacticalTrainingSetRow`, stored as-is
 * with no storage-scope additions (a plain alias; kept so `database.ts` and
 * readers depend on a storage-named type like the other tables).
 */
export type TrainingSetsRow = TacticalTrainingSetRow;

/** The mutable fields of a set (identity/createdAt are never patched). */
export type TrainingSetUpdate = Partial<
  Pick<TacticalTrainingSetRow, 'name' | 'status' | 'source' | 'puzzleIds' | 'targetSize' | 'config'>
>;

export interface TrainingSetsRepository {
  /** One set by id; `undefined` when absent. */
  get(id: string): Promise<TrainingSetsRow | undefined>;
  /**
   * Sets filtered by `status` (default `'active'`), ordered by `createdAt`
   * then id. An empty status filter reads the `status` index.
   */
  list(options?: { readonly status?: TrainingSetStatus }): Promise<TrainingSetsRow[]>;
  /** Insert or replace one set row. */
  create(row: TrainingSetsRow): Promise<void>;
  /**
   * Apply a partial patch to one set, bumping `updatedAt`. Returns the stored
   * row, or `undefined` when the id is absent (no row is created).
   */
  update(id: string, patch: TrainingSetUpdate): Promise<TrainingSetsRow | undefined>;
  /**
   * Delete one set or Woodpecker block (open or closed) and everything it owns
   * in one transaction: the set row, its cycles (via the `trainingSetId`
   * index) and its attempt rows (via `deleteForTrainingSetIds`). Puzzles are
   * deliberately untouched.
   */
  delete(id: string): Promise<void>;
  /**
   * The single open **Woodpecker block**: the `active` set with
   * `source.kind === 'auto'` **and** `source.recipe.kind === 'woodpeckerBlock'`,
   * or `undefined` when none is open (spec §1/§3a). A pre-block-model legacy
   * `auto` row without a recipe is ignored. At most one may be open; the
   * earliest `createdAt` wins defensively.
   */
  getOpenBlock(): Promise<TrainingSetsRow | undefined>;
  /**
   * Close an open block: set `status: 'archived'` with the caller-supplied
   * `updatedAt` (deterministic; no hidden clock). Returns the stored row, or
   * `undefined` when the id is absent. Closing returns the block's
   * still-unmastered members to the derived pool implicitly — the pool excludes
   * only the **open** block's members, so no membership is mutated here.
   */
  closeBlock(id: string, now: number): Promise<TrainingSetsRow | undefined>;
  /**
   * Game-deletion cleanup: remove the given puzzle ids from every set's stored
   * membership and persist each changed set with a fresh `updatedAt`. Bounded
   * by the number of sets (a scan of the small set table), never by puzzle
   * count. An empty input is a no-op.
   */
  removePuzzleIds(puzzleIds: readonly string[]): Promise<void>;
  /** Every set whose stored membership contains the given puzzle id, by `createdAt` then id. */
  listContainingPuzzle(puzzleId: string): Promise<TrainingSetsRow[]>;
}

export class DexieTrainingSetsRepository implements TrainingSetsRepository {
  private readonly database: ChessRemedyDatabase;

  constructor(database: ChessRemedyDatabase = db) {
    this.database = database;
  }

  async get(id: string): Promise<TrainingSetsRow | undefined> {
    return this.database.trainingSets.get(id);
  }

  async list(options: { readonly status?: TrainingSetStatus } = {}): Promise<TrainingSetsRow[]> {
    const status = options.status ?? 'active';
    const rows = await this.database.trainingSets.where('status').equals(status).toArray();
    return rows.sort(compareSetRows);
  }

  async create(row: TrainingSetsRow): Promise<void> {
    await this.database.trainingSets.put(row);
  }

  async getOpenBlock(): Promise<TrainingSetsRow | undefined> {
    const active = await this.database.trainingSets.where('status').equals('active').toArray();
    return active.filter(isWoodpeckerBlock).sort(compareSetRows)[0];
  }

  async closeBlock(id: string, now: number): Promise<TrainingSetsRow | undefined> {
    const existing = await this.database.trainingSets.get(id);
    if (!existing) {
      return undefined;
    }
    const closed: TrainingSetsRow = { ...existing, status: 'archived', updatedAt: now };
    await this.database.trainingSets.put(closed);
    return closed;
  }

  async update(id: string, patch: TrainingSetUpdate): Promise<TrainingSetsRow | undefined> {
    const existing = await this.database.trainingSets.get(id);
    if (!existing) {
      return undefined;
    }
    const updated: TrainingSetsRow = { ...existing, ...patch, updatedAt: Date.now() };
    await this.database.trainingSets.put(updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    await this.database.transaction(
      'rw',
      [
        this.database.trainingSets,
        this.database.trainingCycles,
        this.database.puzzleAttempts,
        this.database.syncState,
        this.database.syncTombstones,
      ],
      async () => {
        // Deletion propagation (Feature 016): one `trainingSet` tombstone with
        // the cascade, so the deletion reaches every device. Works even when
        // sync is unconfigured (the device id is lazily minted).
        const deviceId = await new DexieSyncStateRepository(this.database).getOrCreateDeviceId();
        await this.database.syncTombstones.put(
          makeTombstone('trainingSet', id, Date.now(), deviceId),
        );
        await this.database.trainingSets.delete(id);
        await this.database.trainingCycles.where('trainingSetId').equals(id).delete();
        await new DexiePuzzleAttemptsRepository(this.database).deleteForTrainingSetIds([id]);
      },
    );
  }

  async removePuzzleIds(puzzleIds: readonly string[]): Promise<void> {
    if (puzzleIds.length === 0) {
      return;
    }
    const remove = new Set(puzzleIds);
    const sets = await this.database.trainingSets.toArray();
    const now = Date.now();
    const changed: TrainingSetsRow[] = [];
    for (const set of sets) {
      const remaining = set.puzzleIds.filter((id) => !remove.has(id));
      if (remaining.length !== set.puzzleIds.length) {
        changed.push({ ...set, puzzleIds: remaining, updatedAt: now });
      }
    }
    if (changed.length > 0) {
      await this.database.trainingSets.bulkPut(changed);
    }
  }

  async listContainingPuzzle(puzzleId: string): Promise<TrainingSetsRow[]> {
    const sets = await this.database.trainingSets.toArray();
    return sets.filter((set) => set.puzzleIds.includes(puzzleId)).sort(compareSetRows);
  }
}

/** Deterministic listing order: `createdAt` ascending, ties by id. */
function compareSetRows(a: TrainingSetsRow, b: TrainingSetsRow): number {
  return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}

export const trainingSetsRepository: TrainingSetsRepository = new DexieTrainingSetsRepository();
