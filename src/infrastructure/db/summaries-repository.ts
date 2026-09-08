/**
 * Per-analysis summary repository (Feature 010, Game Library milestone).
 *
 * Persists the game-scoped per-analysis summary — the canonical
 * Feature-009-function composition (`summarizeAnalysis` counts +
 * `gameAccuracy`, ADR-024) plus the detection-pass state — that the Game
 * Library row strip and the analysis-result filters read (ARCHITECTURE.md
 * §7). One row per analysis identity, keyed by `analysisId` and queryable
 * by game.
 *
 * A row is the domain `PerAnalysisSummary` plus the storage fields that
 * scope it: `analysisId` (primary key), `gameId` (game ownership) and
 * `updatedAt`. The `missedTacticCount`/`detectionVersion` absent-vs-zero
 * contract is preserved verbatim from `summaryDerivation.ts`.
 */

import type { Color } from 'chessops/types';
import type { ClassificationCounts } from '@/domain/analysis/summary';
import type {
  ScanProgress,
  SummaryDetectionState,
  SummaryPuzzleState,
} from '@/domain/analysis/summaryDerivation';
import type { GameId } from '@/domain/chess/game';
import { db, type ChessRemedyDatabase } from './database';

export type { ScanProgress } from '@/domain/analysis/summaryDerivation';

/** Persisted per-analysis summary row (schema v7 `analysisSummaries`). */
export interface AnalysisSummaryRow {
  /** Analysis identity the summary describes (job id; primary key). */
  readonly analysisId: string;
  /** Owning game (game-scoped derived data, ARCHITECTURE.md §7). */
  readonly gameId: GameId;
  /** The importing user's color the counts/accuracy were derived for. */
  readonly userColor: Color;
  /** User-side ADR-023 classification counts. */
  readonly classificationCounts: ClassificationCounts;
  /** Number of the user's moves that carry a persisted analysis. */
  readonly userMoves: number;
  /** Total analyzed plies (user and opponent). */
  readonly totalMoves: number;
  /** ADR-024 per-game accuracy over the user's usable moves; `null` when absent. */
  readonly accuracy: number | null;
  /** Number of user moves included in the accuracy mean. */
  readonly accuracyMoves: number;
  /** Detection-pass state for the analysis; `'absent'` until a pass is scheduled. */
  readonly detectionState: SummaryDetectionState;
  /** Missed-tactic count; `null` until a detection pass completed (absent ≠ zero). */
  readonly missedTacticCount: number | null;
  /** Detection version of the completed pass; `null` until one completes. */
  readonly detectionVersion: number | null;
  /**
   * Live Stage-2 progress of the pass (plan 013 W3); absent on older rows (the
   * field is additive — no schema bump) or before Stage 2 starts. Readers must
   * treat `undefined` as "no progress recorded".
   */
  readonly scanProgress?: ScanProgress | null;
  /**
   * Puzzle-generation state for the analysis (Feature 011, Stage B); absent on
   * older rows (the field is additive — no schema bump). `undefined` means "no
   * generation pass exists" — absent ≠ zero (the `puzzles` table row count of
   * the game is the only real-zero source). Readers must treat `undefined` as
   * `'absent'`.
   */
  readonly puzzleState?: SummaryPuzzleState;
  /**
   * Puzzle-generator version of a completed generation pass; absent/`null`
   * until one completes (only a `'completed'` pass may carry a version).
   * Readers must treat `undefined` as `null`.
   */
  readonly puzzleGeneratorVersion?: number | null;
  /**
   * Live generation progress (puzzles settled over total); absent on older
   * rows or before the pass writes progress. Readers must treat `undefined` as
   * "no progress recorded".
   */
  readonly puzzleProgress?: ScanProgress | null;
  /** Unix epoch millis of the last write. */
  readonly updatedAt: number;
}

export interface AnalysisSummariesRepository {
  /** Insert or overwrite the summary of one analysis identity. */
  putForAnalysis(summary: AnalysisSummaryRow): Promise<void>;
  /**
   * Merge `patch` into the summary of one analysis identity without rebuilding
   * the row, so one state machine (detection or Feature-011 generation) can
   * update **only its own fields** on the shared row and never clobbers the
   * other machine's fields. A silent no-op when no row exists; the row's
   * `updatedAt` is bumped and its `analysisId` is preserved.
   */
  patchForAnalysis(analysisId: string, patch: Partial<AnalysisSummaryRow>): Promise<void>;
  /** The summary of one analysis identity; `undefined` when absent. */
  getForAnalysis(analysisId: string): Promise<AnalysisSummaryRow | undefined>;
  /** Summaries of the given analysis identities (Library pushdown). */
  listForAnalysisIds(analysisIds: readonly string[]): Promise<readonly AnalysisSummaryRow[]>;
  /** Every summary owned by the given games (game-scoped reads/deletion). */
  listForGames(gameIds: readonly GameId[]): Promise<readonly AnalysisSummaryRow[]>;
  /** Every persisted summary row (session orphan reconciliation; bounded use). */
  listAll(): Promise<readonly AnalysisSummaryRow[]>;
  /** Remove one analysis identity's summary (forced re-analysis cleanup). */
  deleteForAnalysis(analysisId: string): Promise<void>;
  /** Remove every summary of the given games (game deletion cascade). */
  deleteForGames(gameIds: readonly GameId[]): Promise<void>;
}

export class DexieAnalysisSummariesRepository implements AnalysisSummariesRepository {
  private readonly database: ChessRemedyDatabase;

  constructor(database: ChessRemedyDatabase = db) {
    this.database = database;
  }

  async putForAnalysis(summary: AnalysisSummaryRow): Promise<void> {
    await this.database.analysisSummaries.put(summary);
  }

  async patchForAnalysis(analysisId: string, patch: Partial<AnalysisSummaryRow>): Promise<void> {
    const existing = await this.database.analysisSummaries.get(analysisId);
    if (!existing) {
      return;
    }
    await this.database.analysisSummaries.put({
      ...existing,
      ...patch,
      analysisId,
      updatedAt: Date.now(),
    });
  }

  async getForAnalysis(analysisId: string): Promise<AnalysisSummaryRow | undefined> {
    return this.database.analysisSummaries.get(analysisId);
  }

  async listForAnalysisIds(analysisIds: readonly string[]): Promise<readonly AnalysisSummaryRow[]> {
    if (analysisIds.length === 0) {
      return [];
    }
    return this.database.analysisSummaries
      .where('analysisId')
      .anyOf([...analysisIds])
      .toArray();
  }

  async listForGames(gameIds: readonly GameId[]): Promise<readonly AnalysisSummaryRow[]> {
    if (gameIds.length === 0) {
      return [];
    }
    return this.database.analysisSummaries
      .where('gameId')
      .anyOf([...gameIds])
      .toArray();
  }

  async listAll(): Promise<readonly AnalysisSummaryRow[]> {
    return this.database.analysisSummaries.toArray();
  }

  async deleteForAnalysis(analysisId: string): Promise<void> {
    await this.database.analysisSummaries.delete(analysisId);
  }

  async deleteForGames(gameIds: readonly GameId[]): Promise<void> {
    if (gameIds.length === 0) {
      return;
    }
    await this.database.analysisSummaries
      .where('gameId')
      .anyOf([...gameIds])
      .delete();
  }
}

export const summariesRepository: AnalysisSummariesRepository =
  new DexieAnalysisSummariesRepository();
