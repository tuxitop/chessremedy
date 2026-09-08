/**
 * Feature 011 — puzzle row model (domain, pure).
 *
 * A `PuzzleRow` is the immutable, persisted shape of a training puzzle derived
 * from a single Feature-010 verified tactical candidate of the user's own game.
 * The row deliberately carries **no scheduling or training state** (ADR-031):
 * that state arrives with Feature 012/013.
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
 * Bumped only when the generator/assembly semantics change (a future ADR).
 * Stored on every row; a bump never retroactively re-maps stored scores or
 * rows (ADR-025 Consequences). Independent of `DETECTION_VERSION` and
 * `CANDIDATE_GENERATION_VERSION`, both of which are copied onto the row for
 * provenance.
 */
export const PUZZLE_GENERATOR_VERSION = 1;

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
  /** The user's missed move as UCI — provenance only, never the solution. */
  readonly userMovePlayed: string;
  /** Colour to move: the user's colour (they are the mover at `startingFen`). */
  readonly sideToMove: Color;
  /** The verified best move as UCI — first move of the solution. */
  readonly bestMove: string;
  /** The verified solution as UCI tokens from `startingFen`. */
  readonly bestPv: readonly string[];
  /** Distinct legal first moves that reach an objective (defaults to `[bestMove]`). */
  readonly acceptedFirstMoves: readonly string[];
  /** The candidate's stored ADR-025 tactical objective. */
  readonly tacticalObjective: TacticalObjective;
  /** The candidate's stored ADR-025 difficulty estimate — copied, never recomputed. */
  readonly difficulty: number;
  /** Verification conditions copied unchanged from the candidate. */
  readonly verificationMetadata: VerificationMetadata;
  /** Length in plies of the verified solution line. */
  readonly candidateSolutionLength: number;
  /** Version of this puzzle's generator semantics. */
  readonly puzzleGeneratorVersion: number;
  /** Detection version the source candidate was verified under. */
  readonly detectionVersion: number;
  /** Candidate-generation version of the source candidate. */
  readonly candidateGenerationVersion: number;
  /** Puzzle creation, Unix epoch millis. */
  readonly createdAt: number;
}
