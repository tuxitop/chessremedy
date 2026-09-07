/**
 * Puzzle-candidate repository (Feature 010).
 *
 * Persists the two-stage detection output as game-scoped derived data
 * (ARCHITECTURE.md §7). A row is a domain candidate under its own
 * `verificationStatus`, stored as-is, with natural key
 * `[analysisId + sourcePly]` (schema v7) so detection stays scoped to the
 * analysis identity that produced it; the game-scoping index is the row's
 * domain `sourceGameId` field.
 *
 * The row type is discriminated by `verificationStatus`: `verified` rows
 * carry the full verification-only fields (`tacticalObjective`,
 * `candidateSolutionLength`, `verificationMetadata`, `detectionVersion`),
 * while `raw`/`failed` rows carry none of them. `wpLoss` is present on every
 * row (it lives on `RawCandidate`). Feature 011 later consumes `verified`
 * rows only.
 */

import type {
  CandidateVerificationStatus,
  RawCandidate,
  VerificationRejectionReason,
  VerifiedTacticalCandidate,
} from '@/domain/tactics';
import type { GameId } from '@/domain/chess/game';
import { db, type ChessRemedyDatabase } from './database';

/** The engine's top evaluation line a rejected candidate was judged against. */
export interface CandidateVerificationLine {
  /** Top move as UCI. */
  readonly move: string;
  /** Top principal variation as UCI tokens. */
  readonly uci: readonly string[];
  readonly evalCp: number | null;
  readonly evalMate: number | null;
}

/** A candidate that has not (yet) passed Stage-2 verification. */
export interface UnverifiedPuzzleCandidateRow extends RawCandidate {
  /** `'raw'` while awaiting verification, `'failed'` after a failed run. */
  readonly verificationStatus: 'raw' | 'failed';
  /**
   * The Stage-2 guard reason that rejected a candidate (plan-13 recall
   * diagnostics, C). Present only when the row was rejected by a definitive
   * `verifyCandidate` verdict; engine-failed / deferred candidates carry no
   * reason (their row is still `'failed'` but unresolved). Additive — older
   * rows lack it.
   */
  readonly rejectionReason?: VerificationRejectionReason;
  /**
   * The engine's top line the Stage-2 run evaluated, persisted so a rejected
   * candidate can explain "no tactic found — the engine's best was …".
   * Additive; absent on older/verified rows.
   */
  readonly verificationTopLine?: CandidateVerificationLine;
}

/**
 * Persisted puzzle-candidate row: a raw/`failed` or a fully verified
 * candidate under its own `verificationStatus`. `verified` rows are the
 * discriminated subset that adds the verification-only fields.
 */
export type PuzzleCandidateRow = UnverifiedPuzzleCandidateRow | VerifiedTacticalCandidate;

export interface PuzzleCandidatesRepository {
  /** Insert or overwrite candidate rows of one (or more) analysis identities. */
  bulkPutForAnalysis(rows: readonly PuzzleCandidateRow[]): Promise<void>;
  /** Every candidate of one game + analysis identity, ordered by `sourcePly`. */
  listForGameAndAnalysis(
    gameId: GameId,
    analysisId: string,
  ): Promise<readonly PuzzleCandidateRow[]>;
  /** The verified candidates of a game (Feature 011 input), by `sourcePly`. */
  listVerifiedForGame(gameId: GameId): Promise<readonly VerifiedTacticalCandidate[]>;
  /** Flip one candidate's status by its natural key `[analysisId, sourcePly]`. */
  updateStatus(
    analysisId: string,
    sourcePly: number,
    status: CandidateVerificationStatus,
  ): Promise<void>;
  /**
   * Record a definitive Stage-2 guard rejection for one candidate (plan-13
   * recall diagnostics, C): flips the row to `failed` and stores the guard
   * `reason` so the scan report can say *why* each candidate was rejected.
   * `line` (optional) stores the engine's top evaluation line for that verdict.
   */
  updateRejected(
    analysisId: string,
    sourcePly: number,
    reason: VerificationRejectionReason,
    line?: CandidateVerificationLine,
  ): Promise<void>;
  /** Remove every candidate of one analysis run (forced re-analysis cleanup). */
  deleteForAnalysis(analysisId: string): Promise<void>;
  /** Remove every candidate of the given games (game deletion cascade). */
  deleteForGames(gameIds: readonly GameId[]): Promise<void>;
}

export class DexiePuzzleCandidatesRepository implements PuzzleCandidatesRepository {
  private readonly database: ChessRemedyDatabase;

  constructor(database: ChessRemedyDatabase = db) {
    this.database = database;
  }

  async bulkPutForAnalysis(rows: readonly PuzzleCandidateRow[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    await this.database.puzzleCandidates.bulkPut([...rows]);
  }

  async listForGameAndAnalysis(
    gameId: GameId,
    analysisId: string,
  ): Promise<readonly PuzzleCandidateRow[]> {
    const rows = await this.database.puzzleCandidates
      .where('sourceGameId')
      .equals(gameId)
      .and((row) => row.analysisId === analysisId)
      .toArray();
    return this.sortBySourcePly(rows);
  }

  async listVerifiedForGame(gameId: GameId): Promise<readonly VerifiedTacticalCandidate[]> {
    const rows = await this.database.puzzleCandidates
      .where('sourceGameId')
      .equals(gameId)
      .filter((row) => row.verificationStatus === 'verified')
      .toArray();
    return this.sortBySourcePly(rows);
  }

  async updateStatus(
    analysisId: string,
    sourcePly: number,
    status: CandidateVerificationStatus,
  ): Promise<void> {
    await this.database.puzzleCandidates.update([analysisId, sourcePly], {
      verificationStatus: status,
    });
  }

  async updateRejected(
    analysisId: string,
    sourcePly: number,
    reason: VerificationRejectionReason,
    line?: CandidateVerificationLine,
  ): Promise<void> {
    await this.database.puzzleCandidates.update([analysisId, sourcePly], {
      verificationStatus: 'failed',
      rejectionReason: reason,
      ...(line !== undefined ? { verificationTopLine: line } : {}),
    });
  }

  async deleteForAnalysis(analysisId: string): Promise<void> {
    await this.database.puzzleCandidates.where('analysisId').equals(analysisId).delete();
  }

  async deleteForGames(gameIds: readonly GameId[]): Promise<void> {
    if (gameIds.length === 0) {
      return;
    }
    await this.database.puzzleCandidates
      .where('sourceGameId')
      .anyOf([...gameIds])
      .delete();
  }

  private sortBySourcePly<T extends { readonly sourcePly: number }>(
    rows: readonly T[],
  ): readonly T[] {
    return [...rows].sort((a, b) => a.sourcePly - b.sourcePly);
  }
}

export const puzzleCandidatesRepository: PuzzleCandidatesRepository =
  new DexiePuzzleCandidatesRepository();
