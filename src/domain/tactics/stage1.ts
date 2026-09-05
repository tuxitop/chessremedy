/**
 * Tactical detection Stage 1 — candidate generation (Feature 010).
 *
 * Pure, deterministic filter over persisted `MoveAnalysis` records. It emits
 * a `RawCandidate` for the user's plies where the played move crossed the
 * mistake-or-worse win-probability band (ADR-023/026) and was not the
 * engine's best choice. No engine work happens here; Stage 2 (verification)
 * consumes the result.
 */

import type { Color } from 'chessops/types';
import { cpValueOf, winPercentFromCp, WPLOSS_INACCURACY } from '@/domain/chess';
import type { EvalCpMate, MoveAnalysis } from '@/domain/chess';
import { CANDIDATE_GENERATION_VERSION } from './types';
import type { RawCandidate } from './types';

function hasEval(evaluation: EvalCpMate): boolean {
  return evaluation.cp !== null || evaluation.mate !== null;
}

function winPercentOf(evaluation: EvalCpMate): number {
  return winPercentFromCp(cpValueOf(evaluation));
}

function clampTo100(value: number): number {
  return Math.min(100, Math.max(0, value));
}

export function generateCandidates(
  records: readonly MoveAnalysis[],
  userColor: Color,
  now: number,
): RawCandidate[] {
  const candidates: RawCandidate[] = [];
  for (const record of records) {
    if (record.side !== userColor) {
      continue;
    }
    if (record.inBook) {
      continue;
    }
    if (record.bestMove === null || record.playedMove.uci === record.bestMove.uci) {
      continue;
    }
    if (!hasEval(record.evalBefore) || !hasEval(record.evalAfter)) {
      continue;
    }
    const wpLoss = clampTo100(winPercentOf(record.evalBefore) - winPercentOf(record.evalAfter));
    if (wpLoss < WPLOSS_INACCURACY) {
      continue;
    }
    candidates.push({
      id: `${record.analysisId}:${record.ply}`,
      analysisId: record.analysisId,
      sourceGameId: record.gameId,
      sourcePly: record.ply,
      startingFen: record.positionFen,
      userMovePlayed: record.playedMove.uci,
      bestMove: record.bestMove.uci,
      bestPv: record.bestPv,
      wpLoss,
      evalCpBefore: record.evalBefore.cp,
      evalCpAfterUserMove: record.evalAfter.cp,
      candidateGenerationVersion: CANDIDATE_GENERATION_VERSION,
      createdAt: now,
    });
  }
  return candidates;
}
