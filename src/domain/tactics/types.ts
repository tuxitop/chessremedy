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

/**
 * Detection-pipeline version. Incremented when verification thresholds,
 * guards or verification sources change (ADR-026). Version 2 added the
 * stored-analysis fast path (WP-C): candidates verified from a decisive
 * stored mate line without a fresh tactical-profile engine run. Version 3
 * adds the Stage-2 unicity gate (plan 013, W2): for non-mate objectives the
 * best line must beat the best alternative by a large winning-chance margin,
 * so ambiguous near-tie solutions no longer verify. Version 4 time-bounds the
 * tactical verification (`VERIFY_MOVETIME_MS`) and defers engine-failing
 * candidates after a bounded retry (plan-013 fixes A/C): verification can now
 * return shallower results instead of failing, so old verified verdicts and
 * new ones are distinguishable. Version 5 drops the ADR-025 difficulty
 * rejection floor: difficulty is still computed and persisted, but a tactic
 * the user genuinely missed surfaces regardless of how easy a puzzle it would
 * make (the floor was in practice unreachable; Feature-011 may apply its own
 * quality threshold when building training puzzles). Version 6 lowers the
 * `winning_material` objective floor from 3 to 2 piece-value units (owner
 * decision): a won exchange / quiet fork that nets two points is a real miss.
 * Version 7 removes the unicity / `best-move-not-unique` rejection (owner
 * decision): a tactic the user missed is a miss even when a second move is
 * nearly as good.
 */
export const DETECTION_VERSION = 7;

/**
 * Candidate-generation version. Incremented when the Stage-1 candidate rules
 * change (plan 013, W1). Version 1 emitted a candidate only when the user's
 * played move crossed the >= 5 win-% mistake band; version 2 is the
 * position-centric lichess-puzzler model: it additionally emits candidates
 * when the opponent's last move conceded a big swing to the user, when the
 * user's position was already decisive (missed mate/forced win), and when a
 * small-loss quiet miss had a forcing best first move.
 */
export const CANDIDATE_GENERATION_VERSION = 2;

/** How a verified candidate's solution was established (ADR-026). */
export type VerificationSource = 'tactical-search' | 'stored-analysis';

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
  /**
   * How this candidate was verified. `'tactical-search'` (the default when
   * absent) is a fresh tactical-profile run through every guard (ADR-026);
   * `'stored-analysis'` is the deterministic mate fast path (WP-C), which
   * reuses the game's own decisive stored analysis and skips the MultiPV /
   * WDL guards that need a fresh search.
   */
  readonly verificationSource?: VerificationSource;
  /**
   * The persisted ADR-025 difficulty estimate of the verified solution
   * (Feature-011 follow-up). Computed by the verification that produced this
   * candidate: the tactical-profile run uses the tactical depth (22), the
   * stored-mate fast path uses the stored line's depth. The ADR-025
   * `depthBonus` never applies to engine-verified V1 puzzles (tactical depth
   * < 26). Optional for backward compatibility — rows verified before this
   * field existed carry no estimate.
   */
  readonly difficulty?: number;
  /**
   * Distinct first moves a solver may play and still reach a tactical
   * objective: the verified best move plus every accepted (distinct-first-move)
   * alternative whose own line reaches an objective. This is exactly the set
   * ADR-025's candidate-first-move count (C) is measured on, so Feature
   * 012/013 can accept any of them and the stored difficulty stays consistent.
   * `forcing_mate` fast-path candidates carry only the best move. Optional for
   * backward compatibility (absent on rows verified before this field).
   */
  readonly acceptedFirstMoves?: readonly string[];
}
