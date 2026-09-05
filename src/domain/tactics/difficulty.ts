/**
 * ADR-025 puzzle difficulty estimate (Feature 010 / Feature 011).
 *
 * Canonical implementation of the ADR-025 difficulty formula; the ADR is the
 * single source of truth for the weights, the per-term caps and the depth
 * bonus. Feature 010 uses the estimate as the Stage-2 quality gate — ADR-026
 * rejects a candidate whose estimate is below 15 (the "Easy" bucket minimum).
 * Feature 011 persists the full formula output as the puzzle's `difficulty`.
 *
 * Deterministic and pure: the score is a function of the six documented
 * inputs only. Inputs follow the ADR-025 table verbatim:
 *
 * - `lineLength` (L) — solution length in plies;
 * - `candidateFirstMoves` (C) — accepted candidate first moves (MultiPV);
 * - `forcingness` (F) — tactical forcingness as a percentage in `[0, 100]`,
 *   i.e. `(checks + captures) / (2 * L) * 100`. `line.ts` computes the metric
 *   as a fraction, so pass `forcingness(walk) * 100`;
 * - `evalSwing` (E) — absolute evaluation swing in centipawns;
 * - `material` (M) — material won by the solver in piece-value units
 *   (queen = 9);
 * - `depth` — engine verification depth.
 *
 * The score is `round`ed then clamped to `[DIFFICULTY_MIN, DIFFICULTY_MAX]`.
 * Weight/cap changes require a new ADR (ADR-025 Consequences) and are recorded
 * under the puzzle generator version, never retroactively.
 */

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Score floor (ADR-025: `clamp(0, 100, ...)`). */
export const DIFFICULTY_MIN = 0;

/** Score ceiling (ADR-025: `clamp(0, 100, ...)`). */
export const DIFFICULTY_MAX = 100;

/** Weight of the solution-length term `10 * min(L, 6)` (ADR-025). */
export const LENGTH_WEIGHT = 10;

/** Cap of the solution-length term, in plies (ADR-025 `min(L, 6)`). */
export const LENGTH_TERM_CAP = 6;

/** Weight of the candidate-first-moves term `8 * min(C, 6)` (ADR-025). */
export const CANDIDATES_WEIGHT = 8;

/** Cap of the candidate-first-moves term (ADR-025 `min(C, 6)`). */
export const CANDIDATES_TERM_CAP = 6;

/** Weight of the forcingness term `35 * (F / 100)` (ADR-025). */
export const FORCINGNESS_WEIGHT = 35;

/** Weight of the evaluation-swing term `12 * min(E, 400) / 400` (ADR-025). */
export const EVAL_SWING_WEIGHT = 12;

/** Cap of the evaluation-swing term, in centipawns (ADR-025 `min(E, 400)`). */
export const EVAL_SWING_TERM_CAP = 400;

/** Weight of the material term `10 * min(M, 12) / 12` (ADR-025). */
export const MATERIAL_WEIGHT = 10;

/** Cap of the material term, in piece-value units (ADR-025 `min(M, 12)`). */
export const MATERIAL_TERM_CAP = 12;

/** Difficulty bonus added when the engine depth is deep enough (ADR-025). */
export const DEPTH_BONUS = 5;

/** Depth at or above which the depth bonus applies (ADR-025 `depth >= 26`). */
export const DEPTH_BONUS_MIN_DEPTH = 26;

/** Inputs to `estimateDifficulty` (ADR-025 table). */
export interface DifficultyInputs {
  /** Solution length in plies (L). */
  readonly lineLength: number;
  /** Number of accepted candidate first moves (C, MultiPV). */
  readonly candidateFirstMoves: number;
  /** Tactical forcingness as a percentage in `[0, 100]` (F). */
  readonly forcingness: number;
  /** Absolute evaluation swing in centipawns (E). */
  readonly evalSwing: number;
  /** Material won by the solver in piece-value units, queen = 9 (M). */
  readonly material: number;
  /** Engine verification depth (depth). */
  readonly depth: number;
}

/** Estimate a puzzle's `[0, 100]` difficulty from its verification output
 * (ADR-025 formula), rounded and clamped. */
export function estimateDifficulty(inputs: DifficultyInputs): number {
  const { lineLength, candidateFirstMoves, forcingness, evalSwing, material, depth } = inputs;
  const depthBonus = depth >= DEPTH_BONUS_MIN_DEPTH ? DEPTH_BONUS : 0;
  const raw =
    LENGTH_WEIGHT * Math.min(lineLength, LENGTH_TERM_CAP) +
    CANDIDATES_WEIGHT * Math.min(candidateFirstMoves, CANDIDATES_TERM_CAP) +
    FORCINGNESS_WEIGHT * (forcingness / 100) +
    EVAL_SWING_WEIGHT * (Math.min(evalSwing, EVAL_SWING_TERM_CAP) / EVAL_SWING_TERM_CAP) +
    MATERIAL_WEIGHT * (Math.min(material, MATERIAL_TERM_CAP) / MATERIAL_TERM_CAP) +
    depthBonus;
  return clamp(Math.round(raw), DIFFICULTY_MIN, DIFFICULTY_MAX);
}
