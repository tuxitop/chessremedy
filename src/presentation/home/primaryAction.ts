/**
 * Feature 018 — Home primary-action selector (pure, no React).
 *
 * Maps the loaded Home state (game count, analysis presence, continue target)
 * to the hero's context-aware action. It reads only existing values and
 * computes nothing; `hasEligibleAnalysis` is a presence check the caller
 * performs over Feature-014 partitions.
 */

import type { HomeContinueTarget } from './continue';

/** Inputs to `selectHomePrimaryAction`. */
export interface HomePrimaryActionState {
  /** Total stored games, or `null` while the game slice is loading/errored. */
  readonly totalGames: number | null;
  /** True when any Feature-014 partition has `metrics.games.analyzed > 0`. */
  readonly hasEligibleAnalysis: boolean;
  readonly continueTarget: HomeContinueTarget;
}

/** Where a Home action navigates. */
export type HomeActionTarget =
  | { readonly to: 'cycle'; readonly setId: string; readonly cycleNumber: number }
  | { readonly to: 'set'; readonly setId: string }
  | { readonly to: 'games' }
  | { readonly to: 'statistics' };

/** One resolved hero action. */
export interface HomePrimaryAction {
  readonly kind: 'import' | 'analyze' | 'continue' | 'statistics';
  readonly label: string;
  readonly target: HomeActionTarget;
}

/**
 * Select the hero's primary action:
 * - a resumable continue target wins even while the game count is unknown;
 * - no games stored → import;
 * - games but no eligible analysis → analyze;
 * - otherwise → statistics;
 * - unknown game count (loading/error) with no target → `null` (skeleton).
 */
export function selectHomePrimaryAction(state: HomePrimaryActionState): HomePrimaryAction | null {
  const target = state.continueTarget;
  if (target.kind === 'cycle') {
    return {
      kind: 'continue',
      label: 'Continue training',
      target: { to: 'cycle', setId: target.setId, cycleNumber: target.cycleNumber },
    };
  }
  if (target.kind === 'block' || target.kind === 'set') {
    return {
      kind: 'continue',
      label: 'Continue training',
      target: { to: 'set', setId: target.setId },
    };
  }

  if (state.totalGames === null) {
    return null;
  }
  if (state.totalGames === 0) {
    return { kind: 'import', label: 'Import your games', target: { to: 'games' } };
  }
  if (!state.hasEligibleAnalysis) {
    return { kind: 'analyze', label: 'Analyze a game', target: { to: 'games' } };
  }
  return { kind: 'statistics', label: 'View your statistics', target: { to: 'statistics' } };
}
