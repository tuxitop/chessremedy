/**
 * Feature 011 — puzzle row model (domain, pure).
 *
 * A `PuzzleRow` is the immutable, persisted shape of a training puzzle derived
 * from the user's own game. A puzzle originates either from a single
 * Feature-010 verified tactical candidate (origin `'tactical'`) or from a
 * user-side blunder that Feature-010 did **not** capture as a verified tactic
 * (origin `'blunder'`, a one-move "find the move you should have played"
 * puzzle). The row deliberately carries **no scheduling or training state**
 * (ADR-031): that state arrives with Feature 012/013.
 */

import type { Color } from 'chessops/types';
import type { TacticalObjective, VerificationMetadata } from '@/domain/tactics';

/**
 * States of a puzzle-generation pass over one analysis identity.
 *
 * `'absent'` is *not* a member — it is the "no field yet" state of a summary
 * row that has never had a generation pass (see Stage B). The pass itself
 * moves `queued → inProgress → completed | failed`.
 */
export type PuzzleGenerationState = 'queued' | 'inProgress' | 'completed' | 'failed';

/**
 * Version of the puzzle generator (ARCHITECTURE §9).
 *
 * Bumped only when the generator/assembly semantics change. Version 2 adds the
 * one-move blunder "correct-move" origin (a second row kind with a
 * deterministic, provisional difficulty — Feature-013 may re-rate it) and the
 * `origin` discriminator on every new row. Stored on every row; a bump never
 * retroactively re-maps stored scores or rows (ADR-025 Consequences).
 * Independent of `DETECTION_VERSION` and `CANDIDATE_GENERATION_VERSION`, both
 * of which are copied onto the row for provenance (a blunder row has no
 * Feature-010 candidate, so its `candidateGenerationVersion` is `null`).
 */
export const PUZZLE_GENERATOR_VERSION = 2;

/**
 * Origin/kind of a puzzle row. Absent on rows committed before the version-2
 * generator (they are tactical by construction); every new row sets it
 * explicitly.
 *
 * - `'tactical'` — the original Feature-011 origin: a Feature-010 verified
 *   candidate (multi-move forcing solution, ADR-025 difficulty, verification
 *   metadata, accepted alternative first moves).
 * - `'blunder'` — a user-side blunder that was **not** a verified tactic: a
 *   one-move correct-move puzzle whose solution is the analysis `bestMove` at
 *   that ply. No tactical objective, no verification metadata, no candidate;
 *   `difficulty` is deterministic and provisional (Feature-013 may re-rate).
 */
export type PuzzleOrigin = 'tactical' | 'blunder';

/**
 * A training puzzle: the immutable output of the Feature-011 generator.
 *
 * Natural key `[sourceGameId, sourcePly]` — at most one puzzle per (game, ply);
 * re-analysis never replaces an existing row. All fields are `readonly` and a
 * row is never mutated once persisted.
 */
export interface PuzzleRow {
  /** Owning game id (provenance). */
  readonly sourceGameId: string;
  /** 0-based ply of the position before the user's move (provenance). */
  readonly sourcePly: number;
  /** Analysis identity that generated this puzzle (provenance). */
  readonly analysisId: string;
  /** FEN of the puzzle start position (the position before the missed move). */
  readonly startingFen: string;
  /** The user's played move as UCI — provenance only, never the solution. */
  readonly userMovePlayed: string;
  /** Colour to move: the user's colour (they are the mover at `startingFen`). */
  readonly sideToMove: Color;
  /**
   * The best move as UCI — the first move of the solution. Required on every
   * row: for a tactical puzzle it is the verified best move; for a blunder
   * puzzle it is the engine's `bestMove` at the blunder ply (the move the user
   * should have played) and the whole solution.
   */
  readonly bestMove: string;
  /**
   * The solution as UCI tokens from `startingFen`. A tactical row carries the
   * verified forcing line (possibly multiple moves); a blunder row carries the
   * singleton `[bestMove]` (a one-move correct-move puzzle).
   */
  readonly bestPv: readonly string[];
  /**
   * Origin/kind of the row. Absent on committed pre-version-2 rows = `'tactical'`;
   * every new row sets it explicitly. `'blunder'` rows carry none of the
   * tactical-only fields below.
   */
  readonly origin?: PuzzleOrigin;
  /** Distinct legal first moves that reach the objective. Tactical rows only. */
  readonly acceptedFirstMoves?: readonly string[];
  /**
   * The candidate's stored ADR-025 tactical objective. Tactical rows only; a
   * blunder row presents the fixed "find the best move" objective instead.
   */
  readonly tacticalObjective?: TacticalObjective;
  /** The candidate's stored ADR-025 difficulty estimate — copied, never recomputed. */
  readonly difficulty: number;
  /** Verification conditions copied unchanged from the candidate. Tactical rows only. */
  readonly verificationMetadata?: VerificationMetadata;
  /** Length in plies of the verified solution line. Tactical rows only. */
  readonly candidateSolutionLength?: number;
  /** Version of this puzzle's generator semantics. */
  readonly puzzleGeneratorVersion: number;
  /**
   * Detection version the source candidate was verified under — or, for a
   * blunder row, the `DETECTION_VERSION` whose completed detection pass gated
   * generation (a blunder row is only ever produced from a fresh verdict).
   */
  readonly detectionVersion: number;
  /**
   * Candidate-generation version of the source candidate. A blunder row has no
   * Feature-010 candidate, so its value is `null`.
   */
  readonly candidateGenerationVersion: number | null;
  /** Puzzle creation, Unix epoch millis. */
  readonly createdAt: number;
}
