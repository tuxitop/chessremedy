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
});
