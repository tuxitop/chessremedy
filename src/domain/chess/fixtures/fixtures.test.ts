import { describe, expect, it } from 'vitest';
import { outcomeOf } from '../game';
import { mainlineMoves } from '../move';
import { validateReplay } from '../moveList';
import {
  FIXTURE_TAGS,
  GAME_FIXTURE_DEFS,
  fixtureGame,
  fixtureGamesByTag,
  FIXTURE_GAMES,
  fixtureScenarios,
} from '.';
import type { Game } from '../game';
import type { FixtureTag } from './defs';

const USER_COLOR_OUTCOME: Record<string, 'win' | 'loss' | 'draw'> = {
  whiteWins_white: 'win',
  whiteWins_black: 'loss',
  blackWins_black: 'win',
  blackWins_white: 'loss',
  draw_white: 'draw',
  draw_black: 'draw',
};

function userOutcome(game: Game): 'win' | 'loss' | 'draw' {
  const outcome = outcomeOf(game.result);
  if (outcome === 'unknown') {
    throw new Error(`Unexpected unknown result for fixture: ${game.id}`);
  }
  const key = `${outcome}_${game.userColor}`;
  const value = USER_COLOR_OUTCOME[key];
  if (!value) {
    throw new Error(`Unhandled outcome/color: ${key}`);
  }
  return value;
}

function isoWeekOf(playedAt: string): number {
  const date = new Date(playedAt);
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3);
  return 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
}

describe('fixture integrity', () => {
  it('builds every defined fixture into a legal Game', () => {
    expect(FIXTURE_GAMES).toHaveLength(GAME_FIXTURE_DEFS.length);
    for (const def of GAME_FIXTURE_DEFS) {
      const game = fixtureGame(def.id);
      expect(game.source).toBe(def.source);
      expect(game.externalId).toBe(def.externalId);
      expect(game.userColor).toBe(def.userColor);
      expect(validateReplay(game.moves)).toEqual([]);
      expect(game.result).not.toBe('*');
    }
  });

  it('keeps ids unique and stable across repeated module loads', () => {
    const ids = FIXTURE_GAMES.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const def of GAME_FIXTURE_DEFS) {
      expect(fixtureGame(def.id).id).toBe(fixtureGame(def.id).id);
    }
  });

  it('produces derived mainline moves and replay positions', () => {
    for (const game of FIXTURE_GAMES) {
      const moves = mainlineMoves(game.moves);
      expect(moves.length).toBeGreaterThan(0);
      expect(moves[0]!.ply).toBe(0);
      expect(moves[0]!.fenBefore).toBe(game.moves.startFen);
      for (const move of moves) {
        expect(move.color).toBe(move.ply % 2 === 0 ? 'white' : 'black');
      }
    }
  });

  it('covers every source (both providers, local, fixture)', () => {
    const sources = new Set(FIXTURE_GAMES.map((g) => g.source));
    for (const source of ['chesscom', 'lichess', 'local', 'fixture'] as const) {
      expect(sources.has(source)).toBe(true);
    }
    const chesscom = FIXTURE_GAMES.filter((g) => g.source === 'chesscom');
    const lichess = FIXTURE_GAMES.filter((g) => g.source === 'lichess');
    expect(chesscom.length).toBeGreaterThanOrEqual(2);
    expect(lichess.length).toBeGreaterThanOrEqual(2);
  });

  it('covers every normalized time-control category', () => {
    const categories = new Set(FIXTURE_GAMES.map((g) => g.normalizedTimeControl));
    for (const category of [
      'bullet',
      'blitz',
      'rapid',
      'classical',
      'correspondence',
      'unknown',
    ] as const) {
      expect(categories.has(category)).toBe(true);
    }
  });

  it('classifies the 5|5 boundary fixtures with the platform profile', () => {
    expect(fixtureGame('cc-blitz-five-five').normalizedTimeControl).toBe('blitz');
    expect(fixtureGame('li-rapid-five-five').normalizedTimeControl).toBe('rapid');
    // Chess.com 30|0 has no classical group: it is rapid.
    expect(fixtureGame('cc-classical-endgame').normalizedTimeControl).toBe('rapid');
  });

  it('covers user wins, losses and draws', () => {
    const outcomes = new Set(FIXTURE_GAMES.map(userOutcome));
    for (const outcome of ['win', 'loss', 'draw'] as const) {
      expect(outcomes.has(outcome)).toBe(true);
    }
  });

  it('covers both user colors', () => {
    const colors = new Set(FIXTURE_GAMES.map((g) => g.userColor));
    expect(colors.has('white')).toBe(true);
    expect(colors.has('black')).toBe(true);
  });

  it('covers every declared fixture tag', () => {
    const used = new Set<FixtureTag>();
    for (const def of GAME_FIXTURE_DEFS) {
      for (const tag of def.tags) {
        used.add(tag);
      }
    }
    for (const tag of FIXTURE_TAGS) {
      expect(used.has(tag)).toBe(true);
    }
  });

  it('spans at least four distinct ISO weeks', () => {
    const weeks = new Set(FIXTURE_GAMES.map((g) => isoWeekOf(g.playedAt ?? '')));
    expect(weeks.size).toBeGreaterThanOrEqual(4);
  });

  it('marks user-blunder games on user-colored plies and keeps clean games clean', () => {
    const hasNag = (game: Game, color: Game['userColor']): boolean =>
      mainlineMoves(game.moves).some((m) => m.color === color && m.nags.includes(4));

    for (const game of fixtureGamesByTag('userBlunder')) {
      expect(hasNag(game, game.userColor)).toBe(true);
    }
    for (const game of fixtureGamesByTag('clean')) {
      expect(mainlineMoves(game.moves).some((m) => m.nags.includes(4))).toBe(false);
    }
  });

  it('matches def-level metadata against the parsed result', () => {
    for (const def of GAME_FIXTURE_DEFS) {
      const game = fixtureGame(def.id);
      if (def.id !== 'local-short-unknown-tc') {
        expect(game.normalizedTimeControl).not.toBe('unknown');
      }
    }
    const unknownTc = fixtureGame('local-short-unknown-tc');
    expect(unknownTc.timeControl).toBe('');
    expect(unknownTc.normalizedTimeControl).toBe('unknown');
  });

  it('preserves the raw PGN text verbatim on each game', () => {
    for (const def of GAME_FIXTURE_DEFS) {
      expect(fixtureGame(def.id).pgn).toBe(def.pgn);
    }
  });
});

describe('fixture scenarios', () => {
  it('provides the required scenario shapes', () => {
    expect(fixtureScenarios.noGames).toEqual([]);
    expect(fixtureScenarios.singleGame).toHaveLength(1);
    expect(fixtureScenarios.multipleGames.length).toBeGreaterThan(1);
    expect(fixtureScenarios.mixedTimeControls.length).toBeGreaterThan(1);
    expect(fixtureScenarios.multipleWeeks.length).toBeGreaterThanOrEqual(4);
  });

  it('references only fixture games', () => {
    const known = new Set(FIXTURE_GAMES);
    for (const scenario of Object.values(fixtureScenarios)) {
      for (const game of scenario) {
        expect(known.has(game)).toBe(true);
      }
    }
  });

  it('mixes platforms and time controls', () => {
    const sources = new Set(fixtureScenarios.mixedPlatforms.map((g) => g.source));
    expect(sources.has('chesscom')).toBe(true);
    expect(sources.has('lichess')).toBe(true);
    expect(sources.has('local')).toBe(true);

    const categories = new Set(
      fixtureScenarios.mixedTimeControls.map((g) => g.normalizedTimeControl),
    );
    expect(categories.size).toBeGreaterThanOrEqual(5);
  });

  it('spans at least four distinct ISO weeks in the multipleWeeks scenario', () => {
    const weeks = new Set(fixtureScenarios.multipleWeeks.map((g) => isoWeekOf(g.playedAt ?? '')));
    expect(weeks.size).toBeGreaterThanOrEqual(4);
  });
});
