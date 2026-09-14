/**
 * Review-schedules repository (Feature 020).
 *
 * Persists the derived `puzzleSchedules` projection (schema v13, ADR-035): one
 * row per puzzle keyed by `puzzleId` and indexed by `dueAt`. The row is the
 * pure `PuzzleScheduleRow` (a `ScheduleState` plus `puzzleId`/`lastGrade`/
 * version stamps/`updatedAt`), stored verbatim.
 *
 * The table is a **cache**: it is never authoritative, never synced and may be
 * dropped and rebuilt from the immutable `puzzleAttempts` log. Rows are
 * last-write-wins (the schema-v12 `updatedAt` convention) and cascade-deleted
 * with their puzzle via `games-repository.deleteGames`.
 */

import type { PuzzleScheduleRow } from '@/domain/review';
import { db, type ChessRemedyDatabase } from './database';

export type { PuzzleScheduleRow } from '@/domain/review';

export interface ReviewSchedulesRepository {
  /** One schedule row by its `puzzleId`; `undefined` when absent. */
  get(puzzleId: string): Promise<PuzzleScheduleRow | undefined>;
  /** Insert or replace one schedule row (last-write-wins). */
  put(row: PuzzleScheduleRow): Promise<void>;
  /** Insert or replace many schedule rows in one batch. */
  bulkPut(rows: readonly PuzzleScheduleRow[]): Promise<void>;
  /**
   * The due rows (`dueAt <= now`) in `dueAt` ascending order, bounded by
   * `limit` — one indexed read over the `dueAt` index, never a table scan.
   */
  listDue(now: number, limit: number): Promise<PuzzleScheduleRow[]>;
  /** Count of due rows (`dueAt <= now`) — the true backlog. */
  countDue(now: number): Promise<number>;
  /** Every schedule row, ordered by `puzzleId` (reconcile/rebuild pass). */
  listAll(): Promise<PuzzleScheduleRow[]>;
  /** The rows for the given puzzle ids (bulk hydration); absent ids omitted. */
  listByPuzzleIds(puzzleIds: readonly string[]): Promise<PuzzleScheduleRow[]>;
  /** Remove every row whose `puzzleId` is in the set (game-deletion cascade). */
  deleteForPuzzleIds(puzzleIds: readonly string[]): Promise<void>;
  /** Remove rows written under an older projection/parameter version. */
  deleteStale(scheduleVersion: number, schedulerParamsVersion: number): Promise<void>;
  /** Remove rows whose puzzle no longer exists (reconcile orphan drop). */
  deleteNotInPuzzleIds(puzzleIds: readonly string[]): Promise<void>;
}

export class DexieReviewSchedulesRepository implements ReviewSchedulesRepository {
  private readonly database: ChessRemedyDatabase;

  constructor(database: ChessRemedyDatabase = db) {
    this.database = database;
  }

  async get(puzzleId: string): Promise<PuzzleScheduleRow | undefined> {
    return this.database.puzzleSchedules.get(puzzleId);
  }

  async put(row: PuzzleScheduleRow): Promise<void> {
    await this.database.puzzleSchedules.put(row);
  }

  async bulkPut(rows: readonly PuzzleScheduleRow[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    await this.database.puzzleSchedules.bulkPut([...rows]);
  }

  async listDue(now: number, limit: number): Promise<PuzzleScheduleRow[]> {
    if (limit <= 0) {
      return [];
    }
    const rows = await this.database.puzzleSchedules
      .where('dueAt')
      .belowOrEqual(now)
      .limit(limit)
      .toArray();
    return [...rows].sort((a, b) => a.dueAt - b.dueAt || a.puzzleId.localeCompare(b.puzzleId));
  }

  async countDue(now: number): Promise<number> {
    return this.database.puzzleSchedules.where('dueAt').belowOrEqual(now).count();
  }

  async listAll(): Promise<PuzzleScheduleRow[]> {
    const rows = await this.database.puzzleSchedules.toArray();
    return rows.sort((a, b) => a.puzzleId.localeCompare(b.puzzleId));
  }

  async listByPuzzleIds(puzzleIds: readonly string[]): Promise<PuzzleScheduleRow[]> {
    if (puzzleIds.length === 0) {
      return [];
    }
    const rows = await this.database.puzzleSchedules.bulkGet([...puzzleIds]);
    return rows
      .filter((row): row is PuzzleScheduleRow => row !== undefined)
      .sort((a, b) => a.puzzleId.localeCompare(b.puzzleId));
  }

  async deleteForPuzzleIds(puzzleIds: readonly string[]): Promise<void> {
    if (puzzleIds.length === 0) {
      return;
    }
    await this.database.puzzleSchedules
      .where('puzzleId')
      .anyOf([...puzzleIds])
      .delete();
  }

  async deleteStale(scheduleVersion: number, schedulerParamsVersion: number): Promise<void> {
    const rows = await this.database.puzzleSchedules.toArray();
    const stale = rows
      .filter(
        (row) =>
          row.scheduleVersion !== scheduleVersion ||
          row.schedulerParamsVersion !== schedulerParamsVersion,
      )
      .map((row) => row.puzzleId);
    if (stale.length > 0) {
      await this.database.puzzleSchedules.bulkDelete(stale);
    }
  }

  async deleteNotInPuzzleIds(puzzleIds: readonly string[]): Promise<void> {
    const keep = new Set(puzzleIds);
    const rows = await this.database.puzzleSchedules.toArray();
    const orphans = rows.filter((row) => !keep.has(row.puzzleId)).map((row) => row.puzzleId);
    if (orphans.length > 0) {
      await this.database.puzzleSchedules.bulkDelete(orphans);
    }
  }
}

export const reviewSchedulesRepository: ReviewSchedulesRepository =
  new DexieReviewSchedulesRepository();
