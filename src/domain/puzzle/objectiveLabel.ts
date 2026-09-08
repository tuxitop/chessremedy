/**
 * Feature 011 — tactical-objective presentation labels (domain, pure).
 *
 * Single source of truth for the four Feature-010 tactical objectives in the
 * per-game puzzle view and its screen-reader text (mirrors the
 * `classificationMeta` presentation-metadata precedent in the domain).
 */

import type { TacticalObjective } from '@/domain/tactics';

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
