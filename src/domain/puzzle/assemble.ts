/**
 * Feature 011 — candidate → puzzle assembly (domain, pure).
 *
 * Two origins are assembled here, both **engine-free and deterministic**:
 *
 * - `assemblePuzzle` maps one Feature-010 `VerifiedTacticalCandidate` into an
 *   immutable tactical `PuzzleRow`, copying the candidate's fields verbatim and
 *   running **no engine, no difficulty recompute, no candidate generation, and
 *   no re-walk** (spec "Pipeline boundary").
 * - `assembleBlunderPuzzle` maps one qualifying user-side blunder ply (a
 *   Feature-009/ADR-023 `blunder` on the user's turn that Feature-010 did
 *   **not** verify) into a one-move "find the move you should have played"
 *   `PuzzleRow`. There is no candidate, no engine run and no Stage-2
 *   verification; the solution is the ply's stored analysis `bestMove`. The
 *   row's `difficulty` is a deterministic, provisional estimate (Feature-013
 *   may re-rate it).
 */

import { cpValueOf, winPercentFromCp, type EvalCpMate } from '@/domain/chess';
import type { VerifiedTacticalCandidate } from '@/domain/tactics';
import { parsePositionFen } from '@/domain/chess/position';
import { PUZZLE_GENERATOR_VERSION, type PuzzleRow } from './types';

/** Difficulty clamp floor/ceiling (`[0, 100]`, the ADR-025 score range). */
function clampDifficulty(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

/**
 * Deterministic, provisional difficulty of a one-move correct-move puzzle.
 *
 * The engine's evaluation **of the best move is not stored per ply** — a
 * `MoveAnalysis` row stores `evalBefore` (the best-line evaluation of the
 * pre-move position from the mover's perspective — i.e. the value the best
 * move achieves) and `evalAfter` (the value the user's actual move achieved,
 * same perspective). The swing the user missed is therefore
 * `|wp(evalBefore) − wp(evalAfter)|`, the same ADR-023 win-percentage-loss
 * signal that classified the ply as a blunder.
 *
 * Difficulty is that swing inverted: the bigger the win-probability swing the
 * user handed away, the more obvious the correct move and the **easier** the
 * puzzle (larger swing → lower score). Scores live in `[0, 100]` and bucket
 * through the standard ADR-025 buckets. This estimate is deterministic and
 * provisional — Feature 013 may re-rate blunder puzzles from solver data.
 *
 * @param evalBefore best-line evaluation of the position before the blunder
 *   (mover's perspective)
 * @param evalAfter  evaluation of the position after the user's blunder
 *   (mover's perspective)
 */
export function blunderDifficultyOf(evalBefore: EvalCpMate, evalAfter: EvalCpMate): number {
  const swingWp = Math.abs(
    winPercentFromCp(cpValueOf(evalBefore)) - winPercentFromCp(cpValueOf(evalAfter)),
  );
  return clampDifficulty(100 - swingWp);
}

/** The per-ply inputs a blunder puzzle is assembled from (Feature 008 row data). */
export interface BlunderPuzzleInput {
  readonly sourceGameId: string;
  /** 0-based ply of the position before the user's blunder. */
  readonly sourcePly: number;
  /** The generating analysis identity (job id). */
  readonly analysisId: string;
  /** FEN of the position before the user's blunder. */
  readonly startingFen: string;
  /** The blunder the user actually played, as UCI. */
  readonly userMovePlayed: string;
  /** The engine's best move at that ply (the correct move), as UCI. */
  readonly bestMove: string;
  /** Best-line evaluation of `startingFen` (mover's perspective). */
  readonly evalBefore: EvalCpMate;
  /** Evaluation after `userMovePlayed` (mover's perspective). */
  readonly evalAfter: EvalCpMate;
  /**
   * The `DETECTION_VERSION` whose completed detection pass gated generation
   * (the same freshness gate the whole pass runs under). Stored as provenance;
   * a blunder row is only ever produced from a fresh verdict.
   */
  readonly detectionVersion: number;
}

/**
 * Assemble an immutable one-move blunder puzzle row.
 *
 * Total over the Feature-011 blunder input contract: a starting FEN that is
 * unparseable cannot form a puzzle — such a row is a pipeline defect and
 * assembly throws rather than persist wrong data. The caller (the generation
 * service) filters out plies whose record has no engine `bestMove` before
 * calling, so `bestMove` is trusted to be present.
 *
 * @param input the qualifying user-blunder ply's analysis data
 * @param now   creation timestamp (Unix epoch millis)
 */
export function assembleBlunderPuzzle(input: BlunderPuzzleInput, now: number): PuzzleRow {
  const fen = parsePositionFen(input.startingFen);
  if (!fen.ok) {
    throw new Error(
      `assembleBlunderPuzzle: ply ${input.sourcePly} of game ${input.sourceGameId} has an ` +
        `unparseable starting FEN "${input.startingFen}": ${fen.message}`,
    );
  }

  return {
    sourceGameId: input.sourceGameId,
    sourcePly: input.sourcePly,
    analysisId: input.analysisId,
    startingFen: input.startingFen,
    userMovePlayed: input.userMovePlayed,
    // The position before the user's move — the user is always the mover.
    sideToMove: fen.position.turn,
    bestMove: input.bestMove,
    // A one-move correct-move puzzle: the whole solution is the single move.
    bestPv: [input.bestMove],
    origin: 'blunder',
    difficulty: blunderDifficultyOf(input.evalBefore, input.evalAfter),
    puzzleGeneratorVersion: PUZZLE_GENERATOR_VERSION,
    detectionVersion: input.detectionVersion,
    candidateGenerationVersion: null,
    createdAt: now,
  };
}

/**
 * Assemble an immutable puzzle row from a verified candidate.
 *
 * Total over the Feature-011 input contract: a verified candidate whose FEN is
 * unparseable, or that lacks the ADR-025 difficulty estimate that current
 * detection versions always persist, cannot form a puzzle — such a row is a
 * pipeline defect and assembly throws rather than persist wrong data.
 *
 * @param candidate the verified candidate (Feature-010 Stage-2 output)
 * @param now       creation timestamp (Unix epoch millis)
 */
export function assemblePuzzle(candidate: VerifiedTacticalCandidate, now: number): PuzzleRow {
  const fen = parsePositionFen(candidate.startingFen);
  if (!fen.ok) {
    throw new Error(
      `assemblePuzzle: candidate ${candidate.id} has an unparseable starting FEN ` +
        `"${candidate.startingFen}": ${fen.message}`,
    );
  }
  if (candidate.difficulty === undefined) {
    throw new Error(
      `assemblePuzzle: candidate ${candidate.id} carries no ADR-025 difficulty estimate`,
    );
  }

  const { wdlAfterBestLine } = candidate.verificationMetadata;

  return {
    sourceGameId: candidate.sourceGameId,
    sourcePly: candidate.sourcePly,
    analysisId: candidate.analysisId,
    startingFen: candidate.startingFen,
    userMovePlayed: candidate.userMovePlayed,
    // The position before the user's move — the user is always the mover.
    sideToMove: fen.position.turn,
    bestMove: candidate.bestMove,
    bestPv: [...candidate.bestPv],
    // The mate fast path persists only the best move; the contract default is
    // the singleton `[bestMove]` (spec "Puzzle assembly").
    acceptedFirstMoves: candidate.acceptedFirstMoves
      ? [...candidate.acceptedFirstMoves]
      : [candidate.bestMove],
    tacticalObjective: candidate.tacticalObjective,
    origin: 'tactical',
    difficulty: candidate.difficulty,
    verificationMetadata: {
      engineName: candidate.verificationMetadata.engineName,
      engineVersion: candidate.verificationMetadata.engineVersion,
      engineBuild: candidate.verificationMetadata.engineBuild,
      analysisVersion: candidate.verificationMetadata.analysisVersion,
      verificationDepth: candidate.verificationMetadata.verificationDepth,
      verificationTimestamp: candidate.verificationMetadata.verificationTimestamp,
      wdlAfterBestLine: wdlAfterBestLine
        ? { w: wdlAfterBestLine.w, d: wdlAfterBestLine.d, l: wdlAfterBestLine.l }
        : null,
    },
    candidateSolutionLength: candidate.candidateSolutionLength,
    puzzleGeneratorVersion: PUZZLE_GENERATOR_VERSION,
    detectionVersion: candidate.detectionVersion,
    candidateGenerationVersion: candidate.candidateGenerationVersion,
    createdAt: now,
  };
}
