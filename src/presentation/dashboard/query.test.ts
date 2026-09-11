import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIBRARY_FILTERS,
  filtersFromParams,
  libraryFiltersEqual,
  paramsFromFilters,
  type GameLibraryFilters,
} from '@/domain/gameLibrary';
import { dashboardFilterHint, dashboardQueryFromFilters, mixedDimensions } from './query';

const NOW = 1_700_000_000_000;

function filters(overrides: Partial<GameLibraryFilters> = {}): GameLibraryFilters {
  return { ...DEFAULT_LIBRARY_FILTERS, ...overrides };
}

describe('dashboardQueryFromFilters', () => {
  it('pins side/result to all and never sets combine', () => {
    const query = dashboardQueryFromFilters(filters(), NOW);
    expect(query).toEqual({
      platform: 'all',
      timeControl: 'all',
      side: 'all',
      result: 'all',
      dateRange: { preset: 'all' },
      now: NOW,
    });
    expect(query.combine).toBeUndefined();
  });

  it('carries the canonical platform/time-control/date-range dimensions', () => {
    const query = dashboardQueryFromFilters(
      filters({ platform: 'lichess', timeControl: 'rapid', timeFrame: { preset: 'last30d' } }),
      NOW,
    );
    expect(query.platform).toBe('lichess');
    expect(query.timeControl).toBe('rapid');
    expect(query.dateRange).toEqual({ preset: 'last30d' });
  });
});

describe('dashboard filter codec round-trip', () => {
  it('serializes and restores the canonical filters', () => {
    const original = filters({
      platform: 'chesscom',
      timeControl: 'blitz',
      timeFrame: { preset: 'custom', from: '2026-01-01', to: '2026-03-01' },
    });
    const restored = filtersFromParams(paramsFromFilters(original));
    expect(libraryFiltersEqual(restored, original)).toBe(true);
  });

  it('ignores the dashboard-owned set param', () => {
    const params = paramsFromFilters(filters({ platform: 'lichess' }));
    params.set('set', 'fixture:set');
    expect(filtersFromParams(params).platform).toBe('lichess');
  });
});

describe('dashboardFilterHint', () => {
  it('is null for presets', () => {
    expect(dashboardFilterHint(filters())).toBeNull();
  });

  it('returns the inline hint for an incomplete custom range', () => {
    expect(
      dashboardFilterHint(filters({ timeFrame: { preset: 'custom', from: '', to: '' } })),
    ).toBe('Choose both a start and an end date.');
  });

  it('returns the inline hint when from is after to', () => {
    expect(
      dashboardFilterHint(
        filters({ timeFrame: { preset: 'custom', from: '2026-03-01', to: '2026-01-01' } }),
      ),
    ).toBe('The start date must not be after the end date.');
  });
});

describe('mixedDimensions', () => {
  it('reports both dimensions when All/All is selected', () => {
    const mixed = mixedDimensions(filters());
    expect(mixed.mixed).toBe(true);
    expect(mixed.platform).toBe(true);
    expect(mixed.timeControl).toBe(true);
    expect(mixed.labels).toEqual(['platforms', 'time controls']);
  });

  it('reports no mixed dimensions for one concrete partition', () => {
    const mixed = mixedDimensions(filters({ platform: 'lichess', timeControl: 'rapid' }));
    expect(mixed.mixed).toBe(false);
    expect(mixed.labels).toEqual([]);
  });

  it('names only the mixed time-control dimension', () => {
    const mixed = mixedDimensions(filters({ platform: 'lichess' }));
    expect(mixed.labels).toEqual(['time controls']);
  });
});
