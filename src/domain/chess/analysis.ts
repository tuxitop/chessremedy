/**
 * Analysis domain model — canonical (Feature 003 + Feature 008).
 *
 * Shapes follow `specs/domain/analysis-model.md` (canonical schema), ADR-018
 * (engine/cache fields), ADR-019 (`evalBefore`/`evalAfter` + nullable `wdl`),
 * ADR-023 (classification), ARCHITECTURE.md §9 (versioning) and the ADR-012
 * profile table. Feature 008 produces and persists `MoveAnalysis` records;
 * Features 009/010/011/014 consume them — there is a single shared model.
 *
 * Nothing in this module imports React, the database or Worker globals.
 */

import type { Color } from 'chessops/types';

export const GAME_PHASES = ['opening', 'middlegame', 'endgame'] as const;
export type GamePhase = (typeof GAME_PHASES)[number];

/** Persistent per-game analysis job states (Feature 008 queue). */
export const ANALYSIS_JOB_STATES = [
  'queued',
  'inProgress',
  'completed',
  'cancelled',
  'failed',
] as const;
export type AnalysisJobState = (typeof ANALYSIS_JOB_STATES)[number];

export const ANALYSIS_PROFILES = ['fast', 'normal', 'tactical', 'deep'] as const;
export type AnalysisProfile = (typeof ANALYSIS_PROFILES)[number];

/** Stockfish WDL triplet in per-mille (w + d + l = 1000), ADR-019. */
export interface Wdl {
  readonly w: number;
  readonly d: number;
  readonly l: number;
}

export interface EngineMetadata {
  readonly engineName: string;
  /** Engine release, e.g. `18.0.8` (ADR-020). */
  readonly engineVersion: string;
  /** Engine build, e.g. `stockfish-18-lite-single`. */
  readonly engineBuild: string;
  readonly profile: AnalysisProfile;
}

/**
 * Version of the Feature-008 game-analysis pipeline. Bump when the pipeline's
 * engine-submission semantics change (not for classification or phase rule
 * changes, which carry their own versions). ARCHITECTURE.md §9.
 */
export const ANALYSIS_VERSION = 1;

export const MOVE_CLASSIFICATIONS = ['best', 'good', 'inaccuracy', 'mistake', 'blunder'] as const;
export type MoveClassification = (typeof MOVE_CLASSIFICATIONS)[number];

export interface PlayedMove {
  readonly san: string;
  readonly uci: string;
}

/**
 * Centipawn and/or mate evaluation. Both fields are nullable; exactly the
 * fields the engine produced are populated (ADR-019). Mate distance sign is
 * from the side to move: positive = the side to move mates.
 */
export interface EvalCpMate {
  readonly cp: number | null;
  readonly mate: number | null;
}

/** One retained engine line (MultiPV), in engine order (rank 1..N). */
export interface MultiPvLine {
  readonly multipv: number;
  /** Principal variation as UCI tokens from the position before the move. */
  readonly uci: readonly string[];
  readonly evaluation: EvalCpMate;
  /** `null` for the `fast` profile (ADR-019). */
  readonly wdl: Wdl | null;
}

/**
 * One persisted record per analyzed ply of a game (specs/domain/analysis-model.md).
 * `evalBefore` is the engine's best evaluation of `positionFen` from the
 * mover's perspective; `evalAfter` is the evaluation of the position after
 * `playedMove`, re-expressed from the mover's perspective.
 */
export interface MoveAnalysis {
  /** Identity of the analysis run that produced the record (job id). */
  readonly analysisId: string;
  readonly gameId: string;
  /** 0-based index of the position before the move (plies already played). */
  readonly ply: number;
  /** Full move number (1-based) of the move. */
  readonly moveNumber: number;
  /** The mover. */
  readonly side: Color;
  readonly playedMove: PlayedMove;
  /** Canonical FEN of the position before the move. */
  readonly positionFen: string;
  readonly evalBefore: EvalCpMate;
  readonly evalAfter: EvalCpMate;
  readonly wdlBefore: Wdl | null;
  readonly wdlAfter: Wdl | null;
  /** Engine's top choice from `positionFen`; `null` when the engine returned none. */
  readonly bestMove: PlayedMove | null;
  /** Engine's principal variation (UCI) from `positionFen`. */
  readonly bestPv: readonly string[];
  /** MultiPV lines when the profile requested them, else just the top line. */
  readonly multipvLines: readonly MultiPvLine[];
  readonly legalMovesCount: number;
  /** Book/opening tagging; reserved (V1 leaves every move `false`). */
  readonly inBook: boolean;
  readonly classification: MoveClassification;
  readonly classificationVersion: number;
  readonly gamePhase: GamePhase;
  readonly gamePhaseVersion: number;
  /** Reserved for Feature 010 (tactical detection); never computed here. */
  readonly missedTactic: boolean;
  /** Reserved for Feature 010; `null` until detection runs. */
  readonly detectionVersion: number | null;
  readonly engine: EngineMetadata;
  /** Pipeline version that produced this record (ARCHITECTURE.md §9). */
  readonly analysisVersion: number;
  /** Unix epoch millis when the record was produced. */
  readonly analyzedAt: number;
}
