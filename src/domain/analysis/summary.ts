/**
 * Review summary derivation (Feature 008 §15).
 *
 * Pure counts over persisted `MoveAnalysis` records with the user's moves
 * separated from the opponent's. The UI never applies its own classification
 * rules — everything is read from the persisted records.
 */

import type { Color } from 'chessops/types';
import type { MoveAnalysis, MoveClassification } from '@/domain/chess';

export const CLASSIFICATION_LABELS: readonly MoveClassification[] = [
  'best',
  'good',
  'inaccuracy',
  'mistake',
  'blunder',
];

export interface ClassificationCounts {
  readonly best: number;
  readonly good: number;
  readonly inaccuracy: number;
  readonly mistake: number;
  readonly blunder: number;
}

export interface AnalysisSummary {
  /** Counts for the importing user's moves only. */
  readonly user: ClassificationCounts;
  /** Counts for the opponent's moves (shown for game context only). */
  readonly opponent: ClassificationCounts;
  /** Missed-tactic count for the user (0/absent until Feature 010). */
  readonly userMissedTactics: number;
  /** Total number of user moves that carry a persisted analysis. */
  readonly userMoves: number;
  readonly totalMoves: number;
}

export function emptyClassificationCounts(): ClassificationCounts {
  return { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
}

function addCount(
  counts: ClassificationCounts,
  classification: MoveClassification,
): ClassificationCounts {
  return { ...counts, [classification]: counts[classification] + 1 };
}

/**
 * Summarize one game's persisted `MoveAnalysis` records. The user's color
 * comes from the stored `Game.userColor`.
 */
export function summarizeAnalysis(
  records: readonly MoveAnalysis[],
  userColor: Color,
): AnalysisSummary {
  let user = emptyClassificationCounts();
  let opponent = emptyClassificationCounts();
  let userMissedTactics = 0;
  let userMoves = 0;

  for (const record of records) {
    const isUser = record.side === userColor;
    if (isUser) {
      user = addCount(user, record.classification);
      userMoves += 1;
      if (record.missedTactic) {
        userMissedTactics += 1;
      }
    } else {
      opponent = addCount(opponent, record.classification);
    }
  }

  return {
    user,
    opponent,
    userMissedTactics,
    userMoves,
    totalMoves: records.length,
  };
}
