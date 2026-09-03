/**
 * Deterministic fixture games (Feature 003).
 *
 * Builds fully-typed `Game` objects from the fixture defs by calling
 * `gameFromPgn` at module load; a bad fixture throws immediately so a
 * fixture error fails fast at import/test time. Fixture `Game`s are never
 * written to IndexedDB.
 */

import { gameFromPgn } from '../parseGame';
import { GAME_FIXTURE_DEFS, type GameFixtureDef } from './defs';
import type { Game } from '../game';
import type { FixtureTag } from './defs';

function buildGame(def: GameFixtureDef): Game {
  const parsed = gameFromPgn(def.pgn, {
    source: def.source,
    ...(def.externalId ? { externalId: def.externalId } : {}),
    userColor: def.userColor,
  });
  if (!parsed.ok) {
    throw new Error(`Fixture ${def.id} failed to parse: ${parsed.error.message}`);
  }
  return parsed.game;
}

export const FIXTURE_GAMES: readonly Game[] = GAME_FIXTURE_DEFS.map(buildGame);

export function fixtureGame(id: string): Game {
  const index = GAME_FIXTURE_DEFS.findIndex((def) => def.id === id);
  if (index < 0) {
    throw new Error(`Unknown fixture: ${id}`);
  }
  return FIXTURE_GAMES[index]!;
}

export function fixtureGamesByTag(tag: FixtureTag): readonly Game[] {
  return GAME_FIXTURE_DEFS.filter((def) => def.tags.includes(tag)).map((def) =>
    fixtureGame(def.id),
  );
}
