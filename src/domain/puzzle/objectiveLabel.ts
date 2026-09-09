/**
 * Feature 011 — tactical-objective presentation labels (domain, pure).
 *
 * Single source of truth for the four Feature-010 tactical objectives in the
 * per-game puzzle view and its screen-reader text (mirrors the
 * `classificationMeta` presentation-metadata precedent in the domain). A
 * one-move blunder "correct-move" puzzle (origin `'blunder'`) carries no
 * tactical objective; it is labelled with the fixed text below.
 */

import type { TacticalObjective } from '@/domain/tactics';
import type { PuzzleRow } from './types';

export const OBJECTIVE_LABELS: Readonly<Record<TacticalObjective, string>> = {
  winning_material: 'Winning material',
  forcing_mate: 'Forced mate',
  decisive_advantage: 'Decisive advantage',
  neutralizing_threat: 'Neutralizing threat',
};

/** Human label for a tactical objective. */
export function objectiveLabel(objective: TacticalObjective): string {
  return OBJECTIVE_LABELS[objective];
}

/**
 * Objective label of a blunder "correct-move" puzzle: no Feature-010 objective
 * was verified, the puzzle is simply "find the move you should have played".
 */
export const BLUNDER_OBJECTIVE_LABEL = 'Find the best move';

/**
 * The objective chip text of any puzzle row: the fixed correct-move label for a
 * blunder row, else the row's tactical-objective label. Absent `origin` (a row
 * committed before the version-2 generator) is tactical.
 */
export function puzzleObjectiveLabel(row: Pick<PuzzleRow, 'origin' | 'tacticalObjective'>): string {
  if (row.origin === 'blunder') {
    return BLUNDER_OBJECTIVE_LABEL;
  }
  return objectiveLabel(row.tacticalObjective ?? 'winning_material');
}
