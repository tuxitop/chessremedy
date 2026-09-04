import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GAME_LIST_FILTERS,
  gameListFiltersActive,
  matchesGameListFilters,
  opponentName,
  type GameListEntry,
  type GameListFilters,
} from './gameListFilters';
import { fixtureGame } from '@/domain/chess/fixtures';

function entry(overrides: Partial<GameListEntry>): GameListEntry {
  const base = fixtureGame('cc-blitz-clean');
  return {
    source: base.source,
    normalizedTimeControl: base.normalizedTimeControl,
    result: base.result,
    userColor: base.userColor,
    playedAt: base.playedAt,
    whitePlayer: base.whitePlayer,
    blackPlayer: base.blackPlayer,
    ...overrides,
  };
}

const all = DEFAULT_GAME_LIST_FILTERS;

describe('opponentName', () => {
  it('returns the player opposite userColor', () => {
    const userBlack = entry({ userColor: 'black' }); // white: eagereddie, black: chessremedy
    expect(opponentName(userBlack)).toBe('eagereddie');

    const userWhite = entry({ userColor: 'white', whitePlayer: { name: 'chessremedy' } });
    expect(opponentName(userWhite)).toBe('chessremedy'); // base black player
  });
});

describe('matchesGameListFilters', () => {
  it('matches everything by default', () => {
    expect(matchesGameListFilters(entry({}), all)).toBe(true);
  });

  it('filters by platform and time control', () => {
    const e = entry({ source: 'chesscom', normalizedTimeControl: 'blitz' });
    const combined: GameListFilters = {
      ...all,
      sources: ['lichess'],
      timeControls: ['blitz'],
    };
    expect(matchesGameListFilters(e, combined)).toBe(false);
    expect(matchesGameListFilters(entry({ source: 'lichess' }), combined)).toBe(true);

    const platformOnly: GameListFilters = { ...all, sources: ['lichess'] };
    expect(matchesGameListFilters(entry({ source: 'chesscom' }), platformOnly)).toBe(false);
    expect(matchesGameListFilters(entry({ source: 'lichess' }), platformOnly)).toBe(true);
  });

  it('filters by side, result and opponent (case-insensitive substring)', () => {
    const e = entry({ userColor: 'black', result: '0-1' });
    const opponent: GameListFilters = { ...all, opponent: 'EAGEReddie' };
    expect(matchesGameListFilters(e, opponent)).toBe(true);

    const results: GameListFilters = { ...all, results: ['1/2-1/2'] };
    expect(matchesGameListFilters(e, results)).toBe(false);

    const side: GameListFilters = { ...all, colors: ['white'] };
    expect(matchesGameListFilters(e, side)).toBe(false);
  });

  it('matches by inclusive UTC date portion', () => {
    const e = entry({ playedAt: '2026-05-28T12:34:00.000Z' });
    const range: GameListFilters = { ...all, dateFrom: '2026-05-28', dateTo: '2026-05-28' };
    expect(matchesGameListFilters(e, range)).toBe(true);

    const before: GameListFilters = { ...all, dateFrom: '2026-05-29' };
    expect(matchesGameListFilters(e, before)).toBe(false);

    const after: GameListFilters = { ...all, dateTo: '2026-05-27' };
    expect(matchesGameListFilters(e, after)).toBe(false);
  });

  it('excludes dateless games while a date range is active', () => {
    const dateless = entry({ playedAt: null });
    expect(matchesGameListFilters(dateless, { ...all, dateFrom: '2020-01-01' })).toBe(false);
    expect(matchesGameListFilters(dateless, all)).toBe(true);
  });
});

describe('gameListFiltersActive', () => {
  it('is false for defaults and true once any dimension narrows', () => {
    expect(gameListFiltersActive(all)).toBe(false);
    expect(gameListFiltersActive({ ...all, opponent: '  ' })).toBe(false);
    expect(gameListFiltersActive({ ...all, sources: ['chesscom'] })).toBe(true);
    expect(gameListFiltersActive({ ...all, dateFrom: '2026-01-01' })).toBe(true);
  });
});
