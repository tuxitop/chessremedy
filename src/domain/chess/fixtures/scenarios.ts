/**
 * Fixture scenario arrays (Feature 003).
 *
 * Deterministic collections of fixture games for statistics/dashboard tests
 * (Feature 014): no games, a single game, several games, mixed platforms,
 * mixed time controls, and games spread over multiple ISO weeks.
 */

import { fixtureGame } from './games';
import type { Game } from '../game';

function pick(...ids: string[]): readonly Game[] {
  return ids.map(fixtureGame);
}

export const fixtureScenarios = {
  noGames: [] as const,
  singleGame: pick('cc-blitz-clean'),
  multipleGames: pick(
    'cc-bullet-blunder',
    'cc-blitz-clean',
    'cc-rapid-missed-tactic',
    'li-bullet-missed-mate',
  ),
  mixedPlatforms: pick('cc-blitz-clean', 'li-rapid-clean', 'local-missing-rating'),
  mixedTimeControls: pick(
    'cc-bullet-blunder',
    'cc-blitz-clean',
    'cc-rapid-missed-tactic',
    'cc-classical-endgame',
    'li-correspondence',
  ),
  multipleWeeks: pick(
    'cc-bullet-blunder',
    'cc-rapid-missed-tactic',
    'li-bullet-missed-mate',
    'li-rapid-clean',
    'li-correspondence',
  ),
} as const;
