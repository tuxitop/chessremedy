import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  DEFAULT_LIBRARY_FILTERS,
  clearDimension,
  filtersFromParams,
  libraryFiltersActive,
  libraryFiltersEqual,
  paramsFromFilters,
} from './filters';
import {
  MS_PER_DAY,
  isValidIsoDate,
  resolveTimeFrame,
  toExclusiveQueryInstants,
} from './timeframe';
import type { TimeFrame } from './timeframe';
import { normalizeSearch, matchesSearch } from './search';
import { matchesLibraryFilters } from './predicates';
import type { LibraryGameRow } from './index';
import { createSelection } from './selection';
import { compareNewestFirst, sortLibraryRows } from './sort';
import type { GameLibraryFilters } from './filters';

const DEFAULT_TZ = process.env.TZ;
process.env.TZ = 'UTC';

afterEach(() => {
  process.env.TZ = DEFAULT_TZ ?? 'UTC';
});

// Fixed UTC instants used as `now`; under TZ=UTC local == UTC.
const NOW = Date.UTC(2026, 8, 15, 12, 0, 0); // 2026-09-15T12:00Z

function row(overrides: Partial<LibraryGameRow>): LibraryGameRow {
  return {
    id: 'lichess:game1',
    source: 'lichess',
    externalId: 'game1',
    playedAt: '2026-09-10T12:00:00.000Z',
    whiteName: 'magnus',
    blackName: 'chessremedy',
    whiteRating: 2850,
    blackRating: null,
    result: '1-0',
    moveCount: 34,
    termination: 'checkmate',
    timeControl: '300+2',
    normalizedTimeControl: 'blitz',
    userColor: 'black',
    ...overrides,
  };
}

const all: GameLibraryFilters = DEFAULT_LIBRARY_FILTERS;

beforeEach(() => {
  process.env.TZ = 'UTC';
});

describe('timeframe resolution (TZ=UTC)', () => {
  it('resolves all to an unbounded window', () => {
    expect(resolveTimeFrame({ preset: 'all' }, NOW)).toEqual({ fromMs: null, toMs: null });
  });

  it('today covers the local day of now through now', () => {
    const { fromMs, toMs } = resolveTimeFrame({ preset: 'today' }, NOW);
    expect(new Date(fromMs!).toISOString()).toBe('2026-09-15T00:00:00.000Z');
    expect(toMs).toBe(NOW);
  });

  it('last30d starts 29 calendar days before today', () => {
    const { fromMs } = resolveTimeFrame({ preset: 'last30d' }, NOW);
    expect(fromMs).toBe(Date.UTC(2026, 7, 17)); // 30th day inclusive
  });

  it('last7d starts 6 calendar days before today', () => {
    const { fromMs } = resolveTimeFrame({ preset: 'last7d' }, NOW);
    expect(fromMs).toBe(Date.UTC(2026, 8, 9));
  });

  it('monthly/year presets clamp to whole calendar days', () => {
    expect(resolveTimeFrame({ preset: 'last3m' }, NOW).fromMs).toBe(Date.UTC(2026, 5, 15));
    expect(resolveTimeFrame({ preset: 'last6m' }, NOW).fromMs).toBe(Date.UTC(2026, 2, 15));
    expect(resolveTimeFrame({ preset: 'lastYear' }, NOW).fromMs).toBe(Date.UTC(2025, 8, 15));
  });

  it('custom ranges are inclusive whole local days', () => {
    const frame: TimeFrame = { preset: 'custom', from: '2026-09-01', to: '2026-09-02' };
    const window = resolveTimeFrame(frame, NOW);
    expect(window).toEqual({
      fromMs: Date.UTC(2026, 8, 1),
      toMs: Date.UTC(2026, 8, 2) + MS_PER_DAY - 1,
    });
  });

  it('validates custom ranges', () => {
    expect(isValidIsoDate('2026-02-29')).toBe(false);
    expect(isValidIsoDate('2024-02-29')).toBe(true);
  });

  it('produces exclusive query instants from an inclusive window', () => {
    const window = resolveTimeFrame(
      { preset: 'custom', from: '2026-09-01', to: '2026-09-01' },
      NOW,
    );
    expect(toExclusiveQueryInstants(window)).toEqual({
      playedAfter: '2026-08-31T23:59:59.999Z',
      playedBefore: '2026-09-02T00:00:00.000Z',
    });
  });

  it('shifts day boundaries with the host time zone (explicit offset)', () => {
    process.env.TZ = 'Asia/Kolkata'; // UTC+05:30
    const window = resolveTimeFrame({ preset: 'today' }, Date.UTC(2026, 8, 15, 20, 0, 0));
    // 2026-09-15 20:00 UTC == 2026-09-16 01:30 local → local day starts 2026-09-15 18:30 UTC.
    expect(new Date(window.fromMs!).toISOString()).toBe('2026-09-15T18:30:00.000Z');
    process.env.TZ = 'UTC';
  });
});

describe('library filters state + URL codec', () => {
  it('round-trips filters through URL params', () => {
    const filters: GameLibraryFilters = {
      search: 'Carlsen',
      timeFrame: { preset: 'custom', from: '2026-01-01', to: '2026-02-01' },
      timeControl: 'rapid',
      side: 'white',
      platform: 'lichess',
    };
    const params = paramsFromFilters(filters);
    expect(filtersFromParams(new URLSearchParams(params))).toEqual(filters);
  });

  it('ignores invalid query values and falls back to all', () => {
    const params = new URLSearchParams('?tc=bogus&side=green&pl=chess&tf=forever');
    const filters = filtersFromParams(params);
    expect(filters).toEqual(DEFAULT_LIBRARY_FILTERS);
  });

  it('clears individual dimensions and detects activity', () => {
    const active: GameLibraryFilters = { ...all, platform: 'lichess' };
    expect(libraryFiltersActive(active)).toBe(true);
    expect(libraryFiltersActive(all)).toBe(false);
    expect(clearDimension(active, 'platform')).toEqual(all);
  });

  it('compares equality including custom ranges', () => {
    const a: GameLibraryFilters = {
      ...all,
      timeFrame: { preset: 'custom', from: '2026-01-01', to: '2026-01-31' },
    };
    const b: GameLibraryFilters = { ...a };
    expect(libraryFiltersEqual(a, b)).toBe(true);
    expect(libraryFiltersEqual(a, { ...a, timeFrame: { preset: 'all' } })).toBe(false);
  });
});

describe('search', () => {
  it('normalizes whitespace and case', () => {
    expect(normalizeSearch('  MagnUs   Carlsen ')).toBe('magnus carlsen');
  });

  it('matches players, opponent and external id (any field, substring)', () => {
    expect(matchesSearch(row({ whiteName: 'Magnus Carlsen' }), 'carlsen')).toBe(true);
    expect(matchesSearch(row({ blackName: 'chessremedy' }), 'REM')).toBe(true);
    expect(matchesSearch(row({ externalId: '7123456701' }), '4567')).toBe(true);
    expect(matchesSearch(row({}), 'nobody')).toBe(false);
  });

  it('empty search matches everything', () => {
    expect(matchesSearch(row({}), '   ')).toBe(true);
  });
});

describe('combined predicates', () => {
  it('ANDs platform, time control, side, date window and search', () => {
    const e = row({ source: 'lichess', normalizedTimeControl: 'blitz', userColor: 'black' });
    const window = resolveTimeFrame({ preset: 'all' }, NOW);
    const filters: GameLibraryFilters = {
      ...all,
      platform: 'lichess',
      timeControl: 'blitz',
      side: 'black',
    };
    expect(matchesLibraryFilters(e, filters, window)).toBe(true);
    expect(matchesLibraryFilters(row({ userColor: 'white' }), filters, window)).toBe(false);
    expect(matchesLibraryFilters(row({ source: 'chesscom' }), filters, window)).toBe(false);
    expect(matchesLibraryFilters(row({ normalizedTimeControl: 'rapid' }), filters, window)).toBe(
      false,
    );
  });

  it('excludes dateless games when a window is active', () => {
    const e = row({ playedAt: null });
    const window = resolveTimeFrame({ preset: 'today' }, NOW);
    expect(matchesLibraryFilters(e, all, window)).toBe(false);
    expect(matchesLibraryFilters(e, all, { fromMs: null, toMs: null })).toBe(true);
  });
});

describe('selection', () => {
  it('toggles, selects all (replacing) and clears', () => {
    let sel = createSelection();
    sel = sel.toggle('a');
    sel = sel.toggle('b');
    expect(sel.count).toBe(2);
    sel = sel.selectAll(['x', 'y']);
    expect(sel.ids).toEqual(new Set(['x', 'y']));
    sel = sel.toggle('x');
    expect(sel.isSelected('y')).toBe(true);
    expect(sel.isSelected('x')).toBe(false);
    sel = sel.clear();
    expect(sel.count).toBe(0);
  });
});

describe('sorting', () => {
  it('sorts newest first with nulls last', () => {
    const old = row({ id: 'a', playedAt: '2026-01-01T00:00:00.000Z' });
    const newer = row({ id: 'b', playedAt: '2026-09-01T00:00:00.000Z' });
    const none = row({ id: 'c', playedAt: null });
    expect(sortLibraryRows([old, none, newer]).map((r) => r.id)).toEqual(['b', 'a', 'c']);
    expect(compareNewestFirst(none, old)).toBeGreaterThan(0);
  });
});
