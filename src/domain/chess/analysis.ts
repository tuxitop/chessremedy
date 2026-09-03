/**
 * Analysis model definitions (Feature 003).
 *
 * Model-only declarations — nothing in this feature produces engine data.
 * Shapes follow `specs/domain/analysis-model.md` (concept list), ADR-018
 * (engine/cache fields), ADR-019 (`evalCp`/`evalMate`/`wdl`) and
 * ARCHITECTURE.md §9 (versioning). Profile tokens come from the ADR-012
 * table. Features 008–010 extend these shapes at the marked extension
 * points (they add eval-before/after/delta inputs required by ADR-023/024).
 */

export const GAME_PHASES = ['opening', 'middlegame', 'endgame'] as const;
export type GamePhase = (typeof GAME_PHASES)[number];

export const ANALYSIS_STATES = ['pending', 'running', 'completed', 'failed', 'cancelled'] as const;
export type AnalysisState = (typeof ANALYSIS_STATES)[number];

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

export interface MoveAnalysis {
  readonly id: string;
  readonly gameId: string;
  /** Ply of the analyzed position (0 = start). */
  readonly ply: number;
  readonly fen: string;
  /** Move played from this position; `null` at a terminal position. */
  readonly playedMove: { san: string; uci: string } | null;
  readonly bestMove: { san: string; uci: string } | null;
  /** Centipawns from the side-to-move perspective (ADR-019). */
  readonly evalCp: number | null;
  readonly evalMate: number | null;
  /** WDL from the side-to-move perspective; `null` for the fast profile. */
  readonly wdl: Wdl | null;
  /** Principal variation as UCI moves. */
  readonly principalVariation: readonly string[];
  readonly legalMovesCount: number | null;
  readonly phase: GamePhase;
  readonly engine: EngineMetadata | null;
  readonly analysisVersion: number;
  /** Unix epoch millis; `null` until analysis finishes. */
  readonly analyzedAt: number | null;
  // Feature 009/010 add classificationVersion/classification/missedTactic/puzzleId later.
}

export interface Analysis {
  readonly id: string;
  readonly gameId: string;
  readonly state: AnalysisState;
  readonly moves: readonly MoveAnalysis[];
  readonly analysisVersion: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}
