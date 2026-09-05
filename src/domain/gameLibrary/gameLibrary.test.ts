import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  DEFAULT_LIBRARY_FILTERS,
  clearDimension,
  filtersFromParams,
  libraryFiltersActive,
  libraryFiltersEqual,
  paramsFromFilters,
  type AnalysisFilter,
  type GameLibraryFilters,
  type HasCountFilter,
} from './filters';
import {
  MS_PER_DAY,
  isValidIsoDate,
  resolveTimeFrame,
  toExclusiveQueryInstants,
} from './timeframe';
import type { TimeFrame } from './timeframe';
import { normalizeSearch, matchesSearch } from './search';
import { matchesAnalysisResultFilters, matchesLibraryFilters } from './predicates';
import { withRowInsights, libraryRowOf, type GameRowInsights, type LibraryGameRow } from './index';
import { createSelection } from './selection';
import { compareNewestFirst, sortLibraryRows } from './sort';

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

function counts(blunder: number): NonNullable<GameRowInsights['classificationCounts']> {
  return { best: 4, good: 6, inaccuracy: 2, mistake: 1, blunder };
}

/** A base row overlaid with a read-only insights group (like the hook does). */
function withInsights(insights: GameRowInsights): LibraryGameRow {
  return withRowInsights(row({}), insights);
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
      analysis: 'analyzed',
      hasBlunders: 'no',
      hasMissedTactics: 'yes',
    };
    const params = paramsFromFilters(filters);
    expect(filtersFromParams(new URLSearchParams(params))).toEqual(filters);
  });

  it('omits all analysis-result dimensions from the URL and defaults to all', () => {
    const params = paramsFromFilters(all);
    expect(params.has('an')).toBe(false);
    expect(params.has('hb')).toBe(false);
    expect(params.has('hm')).toBe(false);
    expect(filtersFromParams(new URLSearchParams(params))).toEqual(DEFAULT_LIBRARY_FILTERS);
    expect(filtersFromParams(new URLSearchParams())).toEqual(DEFAULT_LIBRARY_FILTERS);
    expect(DEFAULT_LIBRARY_FILTERS).toMatchObject({
      analysis: 'all',
      hasBlunders: 'all',
      hasMissedTactics: 'all',
    });
  });

  it('encodes each analysis-result dimension under its URL key', () => {
    const filters: GameLibraryFilters = {
      ...all,
      analysis: 'notAnalyzed',
      hasBlunders: 'yes',
      hasMissedTactics: 'no',
    };
    const params = paramsFromFilters(filters);
    expect(params.get('an')).toBe('notAnalyzed');
    expect(params.get('hb')).toBe('yes');
    expect(params.get('hm')).toBe('no');
    expect(filtersFromParams(new URLSearchParams(params))).toEqual(filters);
  });

  it('ignores invalid query values and falls back to all', () => {
    const params = new URLSearchParams(
      '?tc=bogus&side=green&pl=chess&tf=forever&an=green&hb=maybe&hm=0',
    );
    const filters = filtersFromParams(params);
    expect(filters).toEqual(DEFAULT_LIBRARY_FILTERS);
  });

  it('clears individual dimensions and detects activity', () => {
    const active: GameLibraryFilters = { ...all, platform: 'lichess' };
    expect(libraryFiltersActive(active)).toBe(true);
    expect(libraryFiltersActive(all)).toBe(false);
    expect(clearDimension(active, 'platform')).toEqual(all);
  });

  it('treats analysis-result selections as active and clears them individually', () => {
    const analyzed: GameLibraryFilters = { ...all, analysis: 'analyzed' };
    const blunders: GameLibraryFilters = { ...all, hasBlunders: 'no' };
    const missed: GameLibraryFilters = { ...all, hasMissedTactics: 'yes' };
    expect(libraryFiltersActive(analyzed)).toBe(true);
    expect(libraryFiltersActive(blunders)).toBe(true);
    expect(libraryFiltersActive(missed)).toBe(true);
    expect(clearDimension(analyzed, 'analysis')).toEqual(all);
    expect(clearDimension(blunders, 'hasBlunders')).toEqual(all);
    expect(clearDimension(missed, 'hasMissedTactics')).toEqual(all);
    expect(libraryFiltersEqual(analyzed, { ...analyzed, analysis: 'all' })).toBe(false);
    expect(libraryFiltersEqual(blunders, { ...blunders, hasBlunders: 'yes' })).toBe(false);
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

const WINDOW = resolveTimeFrame({ preset: 'all' }, NOW);

describe('analysis-result filter predicates', () => {
  it('analysis: analyzed matches only completed/outdated runs', () => {
    const analyzed = { ...all, analysis: 'analyzed' as AnalysisFilter };
    const notAnalyzed = { ...all, analysis: 'notAnalyzed' as AnalysisFilter };
    for (const status of ['unanalyzed', 'queued', 'inProgress', 'cancelled', 'failed'] as const) {
      expect(matchesAnalysisResultFilters({ analysisStatus: status }, analyzed)).toBe(false);
      expect(matchesAnalysisResultFilters({ analysisStatus: status }, notAnalyzed)).toBe(true);
    }
    expect(matchesAnalysisResultFilters({ analysisStatus: 'completed' }, analyzed)).toBe(true);
    expect(matchesAnalysisResultFilters({ analysisStatus: 'outdated' }, analyzed)).toBe(true);
    expect(matchesAnalysisResultFilters({ analysisStatus: 'completed' }, notAnalyzed)).toBe(false);
    expect(matchesAnalysisResultFilters({ analysisStatus: 'outdated' }, notAnalyzed)).toBe(false);
  });

  it('analysis: a row without insights counts as not analyzed', () => {
    expect(matchesAnalysisResultFilters({}, { ...all, analysis: 'analyzed' })).toBe(false);
    expect(matchesAnalysisResultFilters({}, { ...all, analysis: 'notAnalyzed' })).toBe(true);
  });

  it('hasBlunders: yes/no require a completed analysis with stored counts', () => {
    const yes = { ...all, hasBlunders: 'yes' as HasCountFilter };
    const no = { ...all, hasBlunders: 'no' as HasCountFilter };
    // No completed analysis (bare row or any non-completed status) → neither.
    expect(matchesAnalysisResultFilters({}, yes)).toBe(false);
    expect(matchesAnalysisResultFilters({}, no)).toBe(false);
    expect(matchesAnalysisResultFilters({ analysisStatus: 'unanalyzed' }, no)).toBe(false);
    expect(
      matchesAnalysisResultFilters(
        { analysisStatus: 'inProgress', classificationCounts: counts(0) },
        no,
      ),
    ).toBe(false);

    const withBlunder = {
      analysisStatus: 'completed',
      classificationCounts: counts(2),
    } as const;
    expect(matchesAnalysisResultFilters(withBlunder, yes)).toBe(true);
    expect(matchesAnalysisResultFilters(withBlunder, no)).toBe(false);

    const clean = { analysisStatus: 'completed', classificationCounts: counts(0) } as const;
    expect(matchesAnalysisResultFilters(clean, yes)).toBe(false);
    expect(matchesAnalysisResultFilters(clean, no)).toBe(true);

    // Outdated runs still carry their last completed run's counts.
    const outdatedBlunder = {
      analysisStatus: 'outdated',
      classificationCounts: counts(1),
    } as const;
    expect(matchesAnalysisResultFilters(outdatedBlunder, yes)).toBe(true);

    // A completed status without a persisted summary matches neither.
    expect(matchesAnalysisResultFilters({ analysisStatus: 'completed' }, yes)).toBe(false);
    expect(matchesAnalysisResultFilters({ analysisStatus: 'completed' }, no)).toBe(false);
  });

  it('hasMissedTactics: zero is a real zero and absent is never matched', () => {
    const yes = { ...all, hasMissedTactics: 'yes' as HasCountFilter };
    const no = { ...all, hasMissedTactics: 'no' as HasCountFilter };
    // Undetected / no analysis matches neither outcome.
    expect(matchesAnalysisResultFilters({}, yes)).toBe(false);
    expect(matchesAnalysisResultFilters({}, no)).toBe(false);
    expect(
      matchesAnalysisResultFilters(
        { analysisStatus: 'unanalyzed', hasCompletedDetection: false, missedTactics: null },
        no,
      ),
    ).toBe(false);
    expect(
      matchesAnalysisResultFilters(
        { analysisStatus: 'completed', hasCompletedDetection: false, missedTactics: null },
        yes,
      ),
    ).toBe(false);
    expect(
      matchesAnalysisResultFilters(
        { analysisStatus: 'completed', hasCompletedDetection: false, missedTactics: null },
        no,
      ),
    ).toBe(false);

    const foundNothing = {
      analysisStatus: 'completed',
      hasCompletedDetection: true,
      missedTactics: 0,
    } as const;
    expect(matchesAnalysisResultFilters(foundNothing, yes)).toBe(false);
    expect(matchesAnalysisResultFilters(foundNothing, no)).toBe(true);

    const foundOne = {
      analysisStatus: 'completed',
      hasCompletedDetection: true,
      missedTactics: 3,
    } as const;
    expect(matchesAnalysisResultFilters(foundOne, yes)).toBe(true);
    expect(matchesAnalysisResultFilters(foundOne, no)).toBe(false);
  });

  it('ANDs the three dimensions with each other and with base filters', () => {
    const filters: GameLibraryFilters = {
      ...all,
      analysis: 'analyzed',
      hasBlunders: 'yes',
      hasMissedTactics: 'no',
    };
    const rowWithInsightsData = withInsights({
      analysisStatus: 'completed',
      classificationCounts: counts(1),
      hasCompletedDetection: true,
      missedTactics: 0,
    });
    expect(matchesLibraryFilters(rowWithInsightsData, filters, WINDOW)).toBe(true);

    // A blunder-free analyzed game fails the hasBlunders: yes leg.
    const noBlunders = withInsights({
      analysisStatus: 'completed',
      classificationCounts: counts(0),
      hasCompletedDetection: true,
      missedTactics: 0,
    });
    expect(matchesLibraryFilters(noBlunders, filters, WINDOW)).toBe(false);

    // The dimensions AND with platform too.
    expect(
      matchesLibraryFilters(
        withInsights({ analysisStatus: 'completed', classificationCounts: counts(1) }),
        { ...filters, platform: 'chesscom' },
        WINDOW,
      ),
    ).toBe(false);
  });

  it('full row predicate leaves unanalyzed games out of analyzed-only filters', () => {
    const filters: GameLibraryFilters = { ...all, analysis: 'analyzed' };
    expect(matchesLibraryFilters(row({}), filters, WINDOW)).toBe(false);
    expect(matchesLibraryFilters(withInsights({ analysisStatus: 'queued' }), filters, WINDOW)).toBe(
      false,
    );
    expect(
      matchesLibraryFilters(withInsights({ analysisStatus: 'outdated' }), filters, WINDOW),
    ).toBe(true);
  });
});

describe('row insights composition', () => {
  it('libraryRowOf produces a base row without insight fields', () => {
    const summary = {
      id: 'lichess:game1',
      source: 'lichess',
      externalId: 'game1',
      playedAt: '2026-09-10T12:00:00.000Z',
      whitePlayer: { name: 'magnus', rating: 2850 },
      blackPlayer: { name: 'chessremedy', rating: null },
      result: '1-0',
      moveCount: 34,
      termination: 'checkmate',
      timeControl: '300+2',
      normalizedTimeControl: 'blitz',
      userColor: 'black',
    } as const;
    const base = libraryRowOf(summary);
    expect(base).toEqual(row({}));
    expect(base.analysisStatus).toBeUndefined();
    expect(base.accuracy).toBeUndefined();
    expect(base.classificationCounts).toBeUndefined();
    expect(base.missedTactics).toBeUndefined();
    expect(base.hasCompletedDetection).toBeUndefined();
  });

  it('withRowInsights overlays analysis insights without losing base fields', () => {
    const base = row({ id: 'lichess:g', playedAt: '2026-09-10T12:00:00.000Z' });
    const insights: GameRowInsights = {
      analysisStatus: 'completed',
      accuracy: 78,
      classificationCounts: counts(2),
      hasCompletedDetection: false,
      missedTactics: null,
    };
    const enriched = withRowInsights(base, insights);
    expect(enriched.analysisStatus).toBe('completed');
    expect(enriched.accuracy).toBe(78);
    expect(enriched.classificationCounts).toEqual(counts(2));
    expect(enriched.hasCompletedDetection).toBe(false);
    expect(enriched.missedTactics).toBeNull();
    // Base fields are untouched.
    expect(enriched.id).toBe('lichess:g');
    expect(enriched.source).toBe('lichess');
    expect(enriched.userColor).toBe('black');
    expect(enriched.playedAt).toBe('2026-09-10T12:00:00.000Z');
  });

  it('keeps missed tactics absent (null) distinct from a detected zero', () => {
    const absent = withInsights({
      analysisStatus: 'completed',
      classificationCounts: counts(0),
      hasCompletedDetection: false,
      missedTactics: null,
    });
    const zero = withInsights({
      analysisStatus: 'completed',
      classificationCounts: counts(0),
      hasCompletedDetection: true,
      missedTactics: 0,
    });
    expect(absent.missedTactics).toBeNull();
    expect(zero.missedTactics).toBe(0);
    expect(matchesAnalysisResultFilters(absent, { ...all, hasMissedTactics: 'no' })).toBe(false);
    expect(matchesAnalysisResultFilters(zero, { ...all, hasMissedTactics: 'no' })).toBe(true);
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
