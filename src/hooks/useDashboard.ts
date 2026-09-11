/**
 * Feature 015 — dashboard application hook.
 *
 * Maps the URL filter state to a canonical Feature-014 `StatisticsQuery`,
 * calls the statistics service read-only and exposes per-slice loading/error
 * state for the game-analysis and set-scoped training sections. It never
 * computes a statistic, never starts the engine and never opts into backfill;
 * every value comes from the injected `DashboardStatisticsSource`.
 *
 * The source is injectable for deterministic tests (default: the browser
 * statistics service); the training-set list is read through a separate
 * injectable `DashboardTrainingSetsSource` (default: the training-sets
 * repository) because the statistics service owns no set-listing method.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  filtersFromParams,
  paramsFromFilters,
  type GameLibraryFilters,
} from '@/domain/gameLibrary';
import type {
  CategoryStats,
  RepeatedlyFailedPuzzle,
  StatisticsComputeResult,
  StatisticsQuery,
  TrainingSetStats,
  TrendGranularity,
  TrendMetric,
} from '@/domain/statistics';
import type { TacticalTrainingSetRow, TrainingSetStatus } from '@/domain/training';
import { trainingSetsRepository } from '@/infrastructure/db/training-sets-repository';
import { getBrowserStatisticsService } from '@/infrastructure/statistics';
import type {
  GameMetricsReport,
  PhaseMetricsReport,
  StatisticsFailureReason,
  StatisticsReadOptions,
  StatisticsResult,
  StatisticsServiceQuery,
  StatisticsTrendOptions,
} from '@/infrastructure/statistics';
import {
  dashboardFilterHint,
  dashboardQueryFromFilters,
  mixedDimensions,
  type MixedDimensions,
} from '@/presentation/dashboard/query';
import { selectDefaultTrainingSet } from '@/presentation/dashboard/selection';

/** Result type of one trend read (the Feature-014 `trendSeries` computation). */
export type DashboardTrendComputation = Extract<
  StatisticsComputeResult,
  { operation: 'trendSeries' }
>;

/** Result type of the rating read (the Feature-014 `ratingHistories` computation). */
export type DashboardRatingComputation = Extract<
  StatisticsComputeResult,
  { operation: 'ratingHistories' }
>;

/**
 * The narrow statistics seam the hook consumes. The concrete Feature-014
 * `StatisticsService` structurally satisfies it; tests inject a deterministic
 * fake. Every method is called read-only with a `dataVersionKey` and never with
 * `backfill`.
 */
export interface DashboardStatisticsSource {
  gameMetrics(
    query: StatisticsServiceQuery,
    options?: StatisticsReadOptions,
  ): Promise<StatisticsResult<GameMetricsReport>>;
  trendSeries(
    metric: TrendMetric,
    query: StatisticsServiceQuery,
    options?: StatisticsTrendOptions,
  ): Promise<StatisticsResult<DashboardTrendComputation>>;
  ratingHistories(
    query: StatisticsServiceQuery,
    options?: StatisticsReadOptions,
  ): Promise<StatisticsResult<DashboardRatingComputation>>;
  phaseMetrics(
    query: StatisticsServiceQuery,
    options?: StatisticsReadOptions,
  ): Promise<StatisticsResult<PhaseMetricsReport>>;
  trainingSetStats(
    setId: string,
    options?: StatisticsReadOptions,
  ): Promise<StatisticsResult<TrainingSetStats>>;
  weakestCategories(
    setId: string,
    options?: StatisticsReadOptions,
  ): Promise<StatisticsResult<readonly CategoryStats[]>>;
  repeatedlyFailed(
    setId: string,
    options?: StatisticsReadOptions,
  ): Promise<StatisticsResult<readonly RepeatedlyFailedPuzzle[]>>;
}

/** The training-set listing seam (structurally satisfied by the repository). */
export interface DashboardTrainingSetsSource {
  list(options?: {
    readonly status?: TrainingSetStatus;
  }): Promise<readonly TacticalTrainingSetRow[]>;
  getOpenBlock(): Promise<TacticalTrainingSetRow | undefined>;
}

/** One independently-loading data slice. */
export interface DashboardSlice<T> {
  readonly data: T | null;
  readonly loading: boolean;
  readonly error: string | null;
}

/** The default trend metrics the game-analysis section plots. */
export const DASHBOARD_TREND_METRICS = [
  'accuracy',
  'inaccuraciesPerGame',
  'mistakesPerGame',
  'blundersPerGame',
  'missedTacticsPerGame',
] as const satisfies readonly TrendMetric[];

export type DashboardTrendMetric = (typeof DASHBOARD_TREND_METRICS)[number];

/** Inline error copy for a failed statistics read (never a fabricated value). */
export const DASHBOARD_LOAD_ERROR = 'Could not load statistics.';

/** The game-analysis section's inputs. */
export interface DashboardGameAnalysis {
  readonly metrics: DashboardSlice<GameMetricsReport>;
  readonly ratings: DashboardSlice<DashboardRatingComputation>;
  readonly phases: DashboardSlice<PhaseMetricsReport>;
  readonly trends: Readonly<
    Record<DashboardTrendMetric, DashboardSlice<DashboardTrendComputation>>
  >;
}

/** The set-scoped training section's inputs. */
export interface DashboardTrainingAnalysis {
  readonly sets: readonly TacticalTrainingSetRow[];
  readonly archivedSets: readonly TacticalTrainingSetRow[];
  readonly openBlock: TacticalTrainingSetRow | null;
  readonly selectedSetId: string | null;
  readonly selectedSet: TacticalTrainingSetRow | null;
  readonly stats: DashboardSlice<TrainingSetStats>;
  readonly categories: DashboardSlice<readonly CategoryStats[]>;
  readonly failed: DashboardSlice<readonly RepeatedlyFailedPuzzle[]>;
}

/** The public surface of `useDashboard`. */
export interface UseDashboard {
  readonly filters: GameLibraryFilters;
  /** Canonical query, or `null` while the custom range is invalid. */
  readonly query: StatisticsQuery | null;
  readonly hint: string | null;
  readonly mixed: MixedDimensions;
  readonly game: DashboardGameAnalysis;
  readonly training: DashboardTrainingAnalysis;
  /** True while any game-analysis slice is loading. */
  readonly loading: boolean;
  readonly error: string | null;
  readonly dataVersionKey: string;
  updateFilters(next: GameLibraryFilters, replace?: boolean): void;
  selectSet(setId: string | null): void;
  reload(): void;
}

/** Injectable dependencies (all defaulted for production). */
export interface UseDashboardOptions {
  readonly source?: DashboardStatisticsSource;
  readonly sets?: DashboardTrainingSetsSource;
  readonly now?: () => number;
  readonly trendMetrics?: readonly DashboardTrendMetric[];
  readonly granularity?: TrendGranularity;
}

type TrendState = Readonly<Record<DashboardTrendMetric, DashboardSlice<DashboardTrendComputation>>>;

interface SliceOutcome<T> {
  readonly slice: DashboardSlice<T>;
  readonly reason: StatisticsFailureReason | null;
}

function initialSlice<T>(): DashboardSlice<T> {
  return { data: null, loading: true, error: null };
}

function idleSlice<T>(): DashboardSlice<T> {
  return { data: null, loading: false, error: null };
}

function initialTrendState(metrics: readonly DashboardTrendMetric[]): TrendState {
  const requested = new Set(metrics);
  const state = {} as Record<DashboardTrendMetric, DashboardSlice<DashboardTrendComputation>>;
  for (const metric of DASHBOARD_TREND_METRICS) {
    state[metric] = requested.has(metric) ? initialSlice() : idleSlice();
  }
  return state;
}

/** Run one read, converting a typed failure or rejection into an honest slice. */
async function runSlice<T>(call: () => Promise<StatisticsResult<T>>): Promise<SliceOutcome<T>> {
  try {
    const result = await call();
    if (result.ok) {
      return { slice: { data: result.result, loading: false, error: null }, reason: null };
    }
    return {
      slice: { data: null, loading: false, error: result.message ?? DASHBOARD_LOAD_ERROR },
      reason: result.reason,
    };
  } catch {
    return {
      slice: { data: null, loading: false, error: DASHBOARD_LOAD_ERROR },
      reason: 'compute-error',
    };
  }
}

export function useDashboard(options: UseDashboardOptions = {}): UseDashboard {
  const source = options.source ?? getBrowserStatisticsService();
  const setsSource = options.sets ?? trainingSetsRepository;
  const trendMetrics = options.trendMetrics ?? DASHBOARD_TREND_METRICS;
  const granularity = options.granularity ?? 'week';
  const trendMetricsKey = trendMetrics.join('|');

  const [searchParams, setSearchParams] = useSearchParams();
  const filters = filtersFromParams(searchParams);
  const filtersKey = paramsFromFilters(filters).toString();
  const hint = dashboardFilterHint(filters);
  const mixed = mixedDimensions(filters);
  const setParam = searchParams.get('set');

  const reactId = useId();
  const [retryToken, setRetryToken] = useState(0);
  const dataVersionKey = `${reactId}:${retryToken}`;
  const [now, setNow] = useState<number>(() => (options.now ?? Date.now)());

  const [metrics, setMetrics] = useState<DashboardSlice<GameMetricsReport>>(() => initialSlice());
  const [ratings, setRatings] = useState<DashboardSlice<DashboardRatingComputation>>(() =>
    initialSlice(),
  );
  const [phases, setPhases] = useState<DashboardSlice<PhaseMetricsReport>>(() => initialSlice());
  const [trends, setTrends] = useState<TrendState>(() => initialTrendState(trendMetrics));
  const [activeSets, setActiveSets] = useState<readonly TacticalTrainingSetRow[]>([]);
  const [archivedSets, setArchivedSets] = useState<readonly TacticalTrainingSetRow[]>([]);
  const [openBlock, setOpenBlock] = useState<TacticalTrainingSetRow | null>(null);
  const [selectedSetId, setSelectedSetId] = useState<string | null>(null);
  const [stats, setStats] = useState<DashboardSlice<TrainingSetStats>>(() => initialSlice());
  const [categories, setCategories] = useState<DashboardSlice<readonly CategoryStats[]>>(() =>
    initialSlice(),
  );
  const [failed, setFailed] = useState<DashboardSlice<readonly RepeatedlyFailedPuzzle[]>>(() =>
    initialSlice(),
  );
  const [setsRefresh, setSetsRefresh] = useState(0);

  const gameRequestId = useRef(0);
  const trainingRequestId = useRef(0);

  const query = useMemo(
    () => (hint === null ? dashboardQueryFromFilters(filters, now) : null),
    // `filters` is fully identified by `filtersKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtersKey, hint, now],
  );

  function writeSetParam(setId: string | null): void {
    const params = paramsFromFilters(filters);
    if (setId !== null) {
      params.set('set', setId);
    }
    setSearchParams(params, { replace: true });
  }

  function updateFilters(next: GameLibraryFilters, replace?: boolean): void {
    const params = paramsFromFilters(next);
    if (setParam !== null) {
      params.set('set', setParam);
    }
    setSearchParams(params, replace ? { replace: true } : undefined);
  }

  function selectSet(setId: string | null): void {
    setSelectedSetId(setId);
    const params = paramsFromFilters(filters);
    if (setId !== null) {
      params.set('set', setId);
    }
    setSearchParams(params, { replace: true });
  }

  function reload(): void {
    setNow((options.now ?? Date.now)());
    setRetryToken((value) => value + 1);
    setSetsRefresh((value) => value + 1);
  }

  // Game-analysis reads: independent per slice so one failed read never blanks
  // the section. An invalid custom range issues no query (last valid view kept).
  useEffect(() => {
    const requestId = ++gameRequestId.current;
    const requestQuery =
      dashboardFilterHint(filters) === null ? dashboardQueryFromFilters(filters, now) : null;
    const requestedMetrics = trendMetrics;
    const readOptions: StatisticsReadOptions = { dataVersionKey };

    void (async () => {
      if (requestQuery === null) {
        setMetrics((current) => ({ ...current, loading: false }));
        setRatings((current) => ({ ...current, loading: false }));
        setPhases((current) => ({ ...current, loading: false }));
        setTrends((current) => {
          const next = { ...current };
          for (const metric of requestedMetrics) {
            next[metric] = { ...current[metric], loading: false };
          }
          return next;
        });
        return;
      }

      setMetrics((current) => ({ ...current, loading: true, error: null }));
      setRatings((current) => ({ ...current, loading: true, error: null }));
      setPhases((current) => ({ ...current, loading: true, error: null }));
      setTrends((current) => {
        const next = { ...current };
        for (const metric of requestedMetrics) {
          next[metric] = { ...current[metric], loading: true, error: null };
        }
        return next;
      });

      const [metricsOutcome, ratingsOutcome, phasesOutcome, trendOutcomes] = await Promise.all([
        runSlice(() => source.gameMetrics(requestQuery, readOptions)),
        runSlice(() => source.ratingHistories(requestQuery, readOptions)),
        runSlice(() => source.phaseMetrics(requestQuery, readOptions)),
        Promise.all(
          requestedMetrics.map(
            async (metric) =>
              [
                metric,
                await runSlice(() =>
                  source.trendSeries(metric, requestQuery, { ...readOptions, granularity }),
                ),
              ] as const,
          ),
        ),
      ]);
      if (requestId !== gameRequestId.current) {
        return;
      }
      setMetrics(metricsOutcome.slice);
      setRatings(ratingsOutcome.slice);
      setPhases(phasesOutcome.slice);
      setTrends((current) => {
        const next = { ...current };
        for (const metric of DASHBOARD_TREND_METRICS) {
          const found = trendOutcomes.find(([entry]) => entry === metric);
          next[metric] = found ? found[1].slice : idleSlice();
        }
        return next;
      });
    })();
    // `filters` is fully identified by `filtersKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey, dataVersionKey, source, granularity, trendMetricsKey, now]);

  // Training-set listing + default selection (A5/A7). Reading the URL `set`
  // param keeps the selection bookmarkable/restorable.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [active, archived, block] = await Promise.all([
          setsSource.list({ status: 'active' }),
          setsSource.list({ status: 'archived' }),
          setsSource.getOpenBlock(),
        ]);
        if (cancelled) {
          return;
        }
        const activeList = [...active];
        const archivedList = [...archived];
        setActiveSets(activeList);
        setArchivedSets(archivedList);
        setOpenBlock(block ?? null);
        const requested =
          setParam === null
            ? undefined
            : [...activeList, ...archivedList].find((set) => set.id === setParam);
        const next = requested ?? selectDefaultTrainingSet(activeList, archivedList, block);
        setSelectedSetId(next?.id ?? null);
        if (next != null && setParam !== next.id) {
          writeSetParam(next.id);
        }
      } catch {
        if (!cancelled) {
          setActiveSets([]);
          setArchivedSets([]);
          setOpenBlock(null);
          setSelectedSetId(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // `writeSetParam` is stable enough for the set-param write; the effect
    // intentionally re-runs only on the set param / retry / source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryToken, setsRefresh, setsSource, setParam]);

  // Set-scoped training reads: they never depend on the game-analysis filters.
  useEffect(() => {
    const requestId = ++trainingRequestId.current;
    const readOptions: StatisticsReadOptions = { dataVersionKey };
    const setId = selectedSetId;

    void (async () => {
      if (setId === null) {
        setStats(idleSlice());
        setCategories(idleSlice());
        setFailed(idleSlice());
        return;
      }
      setStats((current) => ({ ...current, loading: true, error: null }));
      setCategories((current) => ({ ...current, loading: true, error: null }));
      setFailed((current) => ({ ...current, loading: true, error: null }));

      const [statsOutcome, categoriesOutcome, failedOutcome] = await Promise.all([
        runSlice(() => source.trainingSetStats(setId, readOptions)),
        runSlice(() => source.weakestCategories(setId, readOptions)),
        runSlice(() => source.repeatedlyFailed(setId, readOptions)),
      ]);
      if (requestId !== trainingRequestId.current) {
        return;
      }
      setStats(statsOutcome.slice);
      setCategories(categoriesOutcome.slice);
      setFailed(failedOutcome.slice);
      // A set deleted between reads refreshes the selector (next read selects
      // the next available set or the empty state).
      if (statsOutcome.reason === 'not-found') {
        setSetsRefresh((value) => value + 1);
      }
    })();
  }, [selectedSetId, dataVersionKey, source]);

  const selectedSet = useMemo(
    () =>
      selectedSetId === null
        ? null
        : ([...activeSets, ...archivedSets].find((set) => set.id === selectedSetId) ?? null),
    [selectedSetId, activeSets, archivedSets],
  );

  const loading =
    metrics.loading ||
    ratings.loading ||
    phases.loading ||
    Object.values(trends).some((slice) => slice.loading);

  const error =
    metrics.error ??
    ratings.error ??
    phases.error ??
    stats.error ??
    categories.error ??
    failed.error;

  return {
    filters,
    query,
    hint,
    mixed,
    game: { metrics, ratings, phases, trends },
    training: {
      sets: activeSets,
      archivedSets,
      openBlock,
      selectedSetId,
      selectedSet,
      stats,
      categories,
      failed,
    },
    loading,
    error,
    dataVersionKey,
    updateFilters,
    selectSet,
    reload,
  };
}
