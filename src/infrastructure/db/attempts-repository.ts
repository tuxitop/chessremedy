/**
 * Puzzle-attempt repository (Feature 012).
 *
 * Persists one immutable `PuzzleAttemptRow` per puzzle presentation in a
 * training cycle (ARCHITECTURE.md §7). A row is the domain `PuzzleAttemptRow`
 * stored verbatim — the storage adds no fields — with natural key
 * `[cycleId + puzzleId + presentationIndex]` (schema v9): the spec's
 * one-row-per-presentation key, so a re-presentation in the same cycle
 * carries an incremented `presentationIndex` and is a **new** row, never an
 * overwrite.
 *
 * Rows are immutable once written; this repository therefore has **no update
 * path** — `addAttempt` is the only write path and it is first-write-wins
 * (idempotent retries never double-write or mutate), and there is no
 * `put`/`update`/`bulkPut` exposure. A corrected outcome is a new
 * presentation with an incremented `presentationIndex`, never a row edit.
 *
 * Game ownership is transitive through the puzzle: an attempt stores no game
 * column — its `puzzleId` (`puzzleIdOf(sourceGameId, sourcePly)`) is the
 * game-scoping reference, so the game-deletion cascade (`deleteGames` in
 * `games-repository.ts`) collects a deleted game's puzzle ids from the
 * `puzzles` table and removes this table's rows by `puzzleId`
 * (`deleteForPuzzleIds`). Feature-013 set-owned removals ride the same hook
 * and the `cycleId`/`trainingSetId` indexes.
 */

import type { PuzzleAttemptRow } from '@/domain/training';
import { db, type ChessRemedyDatabase } from './database';

/**
 * Persisted attempt row: the immutable domain `PuzzleAttemptRow`, stored as-is
 * with no storage-scope additions (a plain alias; kept so `database.ts` and
 * readers depend on a storage-named type like the other tables).
 */
export type PuzzleAttemptsRow = PuzzleAttemptRow;

export interface PuzzleAttemptsRepository {
  /**
   * Insert one attempt row — **first write wins** on the natural key
   * `[cycleId, puzzleId, presentationIndex]`: a row already present under the
   * key is left byte-identical and reported as `'already-present'` (never an
   * overwrite — rows are immutable once written). The `'already-present'`
   * result doubles as the write-retry idempotency signal for the recorder:
   * an ambiguous prior write landing is detected, not duplicated.
   *
   * @returns `'added'` when the row was written, `'already-present'` when the
   *   natural key already exists (the stored row is untouched).
   */
  addAttempt(row: PuzzleAttemptRow): Promise<'added' | 'already-present'>;
  /** One attempt by its natural key `[cycleId, puzzleId, presentationIndex]`; `undefined` when absent. */
  getAttempt(
    cycleId: string,
    puzzleId: string,
    presentationIndex: number,
  ): Promise<PuzzleAttemptRow | undefined>;
  /** Every attempt of one cycle, ordered by `puzzleId` then `presentationIndex` (Feature-013 lifecycle reads). */
  listForCycle(cycleId: string): Promise<PuzzleAttemptRow[]>;
  /** Every attempt of one puzzle, ordered by `cycleId` then `presentationIndex`. */
  listForPuzzle(puzzleId: string): Promise<PuzzleAttemptRow[]>;
  /**
   * Every persisted attempt, ordered by `cycleId` then `puzzleId` then
   * `presentationIndex` (the mastery read — one bounded batched pass over the
   * table, grouped by the caller; Feature 013 §"Repositories"). No index or
   * schema change.
   */
  listAll(): Promise<PuzzleAttemptRow[]>;
  /**
   * Every attempt of one puzzle within one cycle, ordered by
   * `presentationIndex` ascending — Feature-013's retry-pass/metrics read (the
   * first presentation is `presentationIndex === 1`).
   */
  listForCycleAndPuzzle(cycleId: string, puzzleId: string): Promise<PuzzleAttemptRow[]>;
  /**
   * Remove every attempt whose `puzzleId` is in the given set (game-deletion
   * cascade hook — `deleteGames` calls it inside its transaction — and
   * Feature-013 set-owned removals). An empty input is a no-op.
   */
  deleteForPuzzleIds(puzzleIds: readonly string[]): Promise<void>;
  /**
   * Remove every attempt whose `trainingSetId` is in the given set
   * (Feature-013 set-deletion cascade — the set's cycles/attempts go with it,
   * the puzzles do not). One indexed read over the `trainingSetId` index; an
   * empty input is a no-op.
   */
  deleteForTrainingSetIds(trainingSetIds: readonly string[]): Promise<void>;
}

export class DexiePuzzleAttemptsRepository implements PuzzleAttemptsRepository {
  private readonly database: ChessRemedyDatabase;

  constructor(database: ChessRemedyDatabase = db) {
    this.database = database;
  }

  async addAttempt(row: PuzzleAttemptRow): Promise<'added' | 'already-present'> {
    const key: [string, string, number] = [row.cycleId, row.puzzleId, row.presentationIndex];
    const existing = await this.database.puzzleAttempts.bulkGet([key]);
    if (existing[0] !== undefined) {
      return 'already-present';
    }
    await this.database.puzzleAttempts.bulkAdd([row]);
    return 'added';
  }

  async getAttempt(
    cycleId: string,
    puzzleId: string,
    presentationIndex: number,
  ): Promise<PuzzleAttemptRow | undefined> {
    return this.database.puzzleAttempts.get([cycleId, puzzleId, presentationIndex]);
  }

  async listForCycle(cycleId: string): Promise<PuzzleAttemptRow[]> {
    const rows = await this.database.puzzleAttempts.where('cycleId').equals(cycleId).toArray();
    return rows.sort(compareAttemptRows);
  }

  async listForPuzzle(puzzleId: string): Promise<PuzzleAttemptRow[]> {
    const rows = await this.database.puzzleAttempts.where('puzzleId').equals(puzzleId).toArray();
    return rows.sort(compareAttemptRows);
  }

  async listAll(): Promise<PuzzleAttemptRow[]> {
    const rows = await this.database.puzzleAttempts.toArray();
    return rows.sort(compareAttemptRows);
  }

  async listForCycleAndPuzzle(cycleId: string, puzzleId: string): Promise<PuzzleAttemptRow[]> {
    const rows = await this.database.puzzleAttempts
      .where('[cycleId+puzzleId]')
      .equals([cycleId, puzzleId])
      .toArray();
    return rows.sort(compareAttemptRows);
  }

  async deleteForPuzzleIds(puzzleIds: readonly string[]): Promise<void> {
    if (puzzleIds.length === 0) {
      return;
    }
    await this.database.puzzleAttempts
      .where('puzzleId')
      .anyOf([...puzzleIds])
      .delete();
  }

  async deleteForTrainingSetIds(trainingSetIds: readonly string[]): Promise<void> {
    if (trainingSetIds.length === 0) {
      return;
    }
    await this.database.puzzleAttempts
      .where('trainingSetId')
      .anyOf([...trainingSetIds])
      .delete();
  }
}

/** Natural-key order: `cycleId`, then `puzzleId`, then `presentationIndex`. */
function compareAttemptRows(a: PuzzleAttemptRow, b: PuzzleAttemptRow): number {
  return (
    a.cycleId.localeCompare(b.cycleId) ||
    a.puzzleId.localeCompare(b.puzzleId) ||
    a.presentationIndex - b.presentationIndex
  );
}

export const attemptsRepository: PuzzleAttemptsRepository = new DexiePuzzleAttemptsRepository();
