/**
 * Feature 011 — candidate → puzzle assembly (domain, pure).
 *
 * Maps one Feature-010 `VerifiedTacticalCandidate` into one immutable
 * `PuzzleRow`. This is the Feature-011 boundary for verified data: assembly
 * copies the candidate's fields verbatim and runs **no engine, no difficulty
 * recompute, no candidate generation, and no re-walk** (spec "Pipeline
 * boundary").
 */

import type { VerifiedTacticalCandidate } from '@/domain/tactics';
import { parsePositionFen } from '@/domain/chess/position';
import { PUZZLE_GENERATOR_VERSION, type PuzzleRow } from './types';

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
