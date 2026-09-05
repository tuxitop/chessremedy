import { describe, expect, it } from 'vitest';
import { DEFAULT_LIBRARY_FILTERS, type GameLibraryFilters } from '@/domain/gameLibrary/filters';
import { resolveTimeFrame } from '@/domain/gameLibrary/timeframe';
import { gameLibraryQueryFor } from './game-library-query';

process.env.TZ = 'UTC';

const NOW = Date.UTC(2026, 8, 15, 12, 0, 0);

describe('gameLibraryQueryFor', () => {
  it('returns undefined when nothing is pushed down', () => {
    const window = resolveTimeFrame({ preset: 'all' }, NOW);
    expect(gameLibraryQueryFor(DEFAULT_LIBRARY_FILTERS, window)).toBeUndefined();
  });

  it('maps single-equality filters and the date window to a GameQuery', () => {
    const filters: GameLibraryFilters = {
      ...DEFAULT_LIBRARY_FILTERS,
      platform: 'lichess',
      timeControl: 'blitz',
      side: 'black',
    };
    const window = resolveTimeFrame(
      { preset: 'custom', from: '2026-09-01', to: '2026-09-15' },
      NOW,
    );
    expect(gameLibraryQueryFor(filters, window)).toEqual({
      source: 'lichess',
      normalizedTimeControl: 'blitz',
      userColor: 'black',
      playedAfter: '2026-08-31T23:59:59.999Z',
      playedBefore: '2026-09-16T00:00:00.000Z',
    });
  });

  it('omits equality for all/default dimensions but keeps a date bound', () => {
    const window = resolveTimeFrame({ preset: 'today' }, NOW);
    expect(gameLibraryQueryFor(DEFAULT_LIBRARY_FILTERS, window)).toEqual({
      playedAfter: '2026-09-14T23:59:59.999Z',
      playedBefore: '2026-09-15T12:00:00.001Z',
    });
  });

  it('pushes a resolved analysis-result id set into the query', () => {
    const window = resolveTimeFrame({ preset: 'all' }, NOW);
    const filters: GameLibraryFilters = {
      ...DEFAULT_LIBRARY_FILTERS,
      analysis: 'analyzed',
      hasBlunders: 'yes',
    };
    const ids = new Set(['lichess:g1', 'lichess:g2']);
    expect(gameLibraryQueryFor(filters, window, ids)).toEqual({
      ids: ['lichess:g1', 'lichess:g2'],
    });
  });

  it('keeps an empty id set (no matches) instead of collapsing to undefined', () => {
    const window = resolveTimeFrame({ preset: 'all' }, NOW);
    const filters: GameLibraryFilters = { ...DEFAULT_LIBRARY_FILTERS, analysis: 'analyzed' };
    expect(gameLibraryQueryFor(filters, window, new Set())).toEqual({ ids: [] });
    expect(gameLibraryQueryFor(filters, window, new Set())).not.toBeUndefined();
  });

  it('combines the id restriction with metadata and date bounds', () => {
    const window = resolveTimeFrame(
      { preset: 'custom', from: '2026-09-01', to: '2026-09-15' },
      NOW,
    );
    const filters: GameLibraryFilters = {
      ...DEFAULT_LIBRARY_FILTERS,
      platform: 'lichess',
      timeControl: 'blitz',
      hasMissedTactics: 'no',
    };
    expect(gameLibraryQueryFor(filters, window, new Set(['lichess:g1']))).toEqual({
      source: 'lichess',
      normalizedTimeControl: 'blitz',
      ids: ['lichess:g1'],
      playedAfter: '2026-08-31T23:59:59.999Z',
      playedBefore: '2026-09-16T00:00:00.000Z',
    });
  });
});
