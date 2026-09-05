/**
 * Tactical detection types (Feature 010).
 *
 * Shared shapes for the two-stage pipeline (ADR-026 / research §3 and §10):
 * the Stage-1 raw candidate, the verified candidate handed to Feature 011,
 * the verification metadata and the domain version constants. Pure types
 * with no value-level imports.
 */

/** Outcome a verified tactic must achieve (specs/PRODUCT.md §8). */
export type TacticalObjective =
  'winning_material' | 'forcing_mate' | 'decisive_advantage' | 'neutralizing_threat';

export type CandidateVerificationStatus = 'raw' | 'verified' | 'failed';

export type DetectionPassState = 'queued' | 'inProgress' | 'completed' | 'failed';

export const DETECTION_VERSION = 1;

export const CANDIDATE_GENERATION_VERSION = 1;

/** Stage-1 output for a single user ply that crossed the mistake band. */
export interface RawCandidate {
  readonly id: string;
  /** The analysis identity the candidate was detected in (job id). */
  readonly analysisId: string;
  readonly sourceGameId: string;
  readonly sourcePly: number;
  /** FEN of the position before the user's move. */
  readonly startingFen: string;
  /** The user's move as UCI. */
  readonly userMovePlayed: string;
  /** The engine's best move as UCI. */
  readonly bestMove: string;
  /** The engine's principal variation as UCI tokens from `startingFen`. */
  readonly bestPv: readonly string[];
  /** Win-probability loss of the played move, clamped to `[0, 100]`. */
  readonly wpLoss: number;
  /** Centipawn evaluation before the move; `null` for mate-only evals. */
  readonly evalCpBefore: number | null;
  /** Centipawn evaluation after the user's move; `null` for mate-only evals. */
  readonly evalCpAfterUserMove: number | null;
  readonly candidateGenerationVersion: number;
  /** Candidate creation, Unix epoch millis. */
  readonly createdAt: number;
}

/** Engine identity + conditions of a Stage-2 verification (research §10). */
export interface VerificationMetadata {
  readonly engineName: string;
  readonly engineVersion: string;
  readonly engineBuild: string;
  readonly analysisVersion: number;
  readonly verificationDepth: number;
  /** Unix epoch millis when the verification engine run completed. */
  readonly verificationTimestamp: number;
  readonly wdlAfterBestLine: {
    readonly w: number;
    readonly d: number;
    readonly l: number;
  } | null;
}

/** A raw candidate that survived every Stage-2 guard (Feature 011 input). */
export interface VerifiedTacticalCandidate extends RawCandidate {
  readonly tacticalObjective: TacticalObjective;
  /** Length in plies of the verified solution line. */
  readonly candidateSolutionLength: number;
  readonly verificationMetadata: VerificationMetadata;
  readonly detectionVersion: number;
  readonly verificationStatus: 'verified';
}
