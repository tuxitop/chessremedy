/**
 * Feature 018 — Home application hook.
 *
 * Loads the read-only data the Home page composes from the narrow
 * `HomeDataSource` seam. It holds four independent `{ data, loading, error }`
 * slices — `game`, `training`, `mastery`, `block` — so one failed read never
 * blanks another region. It computes no statistic, starts no engine and opts
 * into no backfill.
 *
 * The browser data source is reached through a dynamic import so the
 * statistics service/worker/engine stay out of the initial route chunk; tests
 * inject a fake and skip the import entirely.
 */

import { useEffect, useId, useState } from 'react';
import type { PuzzleRow } from '@/domain/puzzle';
import type { GameMetricsPartition, TrainingSetStats } from '@/domain/statistics';
import type { TacticalTrainingSetRow, TrainingCycleRow } from '@/domain/training/cycleTypes';
import type { HomeDataSource, HomeMasteryData } from '@/infrastructure/home/home-data-source';
import type { StatisticsServiceQuery } from '@/infrastructure/statistics';
import { HOME_STATS_WINDOW, homePreviousWindow } from '@/presentation/home';

export type { HomeDataSource, HomeMasteryData } from '@/infrastructure/home/home-data-source';

/** Inline error copy for a failed Home read (never a fabricated value). */
export const HOME_LOAD_ERROR = 'Could not load statistics.';

/** The game-analysis slice payload (Feature 007 count + Feature 014 partitions). */
export interface HomeGameData {
  readonly totalGames: number;
  readonly partitions: readonly GameMetricsPartition[];
  /** The same partitions over the immediately preceding window (week-over-week). */
  readonly previousPartitions: readonly GameMetricsPartition[];
}

/** The training slice payload (Feature 013 sets/block/cycles). */
export interface HomeTrainingData {
  readonly sets: readonly TacticalTrainingSetRow[];
  readonly openBlock: TacticalTrainingSetRow | null;
  readonly cycles: readonly TrainingCycleRow[];
}

/** The block slice payload (Feature 014 set statistics for the open block). */
export interface HomeBlockData {
  readonly stats: TrainingSetStats;
}

/** One independently-loading data slice. */
export interface HomeSlice<T> {
  readonly data: T | null;
  readonly loading: boolean;
  readonly error: string | null;
}

/** The public surface of `useHome`. */
export interface UseHome {
  readonly game: HomeSlice<HomeGameData>;
  readonly training: HomeSlice<HomeTrainingData>;
  readonly mastery: HomeSlice<HomeMasteryData>;
  readonly block: HomeSlice<HomeBlockData>;
  /** The most recent puzzle for the Home preview (idle when none exist). */
  readonly preview: HomeSlice<PuzzleRow>;
  readonly dataVersionKey: string;
  reload(): void;
}

/** Injectable dependencies (defaults are production). */
export interface UseHomeOptions {
  readonly source?: HomeDataSource;
  readonly now?: () => number;
}

function initialSlice<T>(): HomeSlice<T> {
  return { data: null, loading: true, error: null };
}

function idleSlice<T>(): HomeSlice<T> {
  return { data: null, loading: false, error: null };
}

function errorSlice<T>(): HomeSlice<T> {
  return { data: null, loading: false, error: HOME_LOAD_ERROR };
}

async function loadGame(
  source: HomeDataSource,
  query: StatisticsServiceQuery,
  previousQuery: StatisticsServiceQuery,
  dataVersionKey: string,
): Promise<HomeSlice<HomeGameData>> {
  try {
    const [totalGames, result, previous] = await Promise.all([
      source.countGames(),
      source.gameMetrics(query, { dataVersionKey }),
      source.gameMetrics(previousQuery, { dataVersionKey }),
    ]);
    if (!result.ok) {
      return { data: null, loading: false, error: result.message ?? HOME_LOAD_ERROR };
    }
    return {
      data: {
        totalGames,
        partitions: result.result.partitions,
        previousPartitions: previous.ok ? previous.result.partitions : [],
      },
      loading: false,
      error: null,
    };
  } catch {
    return errorSlice();
  }
}

async function loadTraining(source: HomeDataSource): Promise<HomeSlice<HomeTrainingData>> {
  try {
    const [active, archived, openBlock, cycles] = await Promise.all([
      source.listSets({ status: 'active' }),
      source.listSets({ status: 'archived' }),
      source.getOpenBlock(),
      source.listCycles(),
    ]);
    return {
      data: { sets: [...active, ...archived], openBlock: openBlock ?? null, cycles },
      loading: false,
      error: null,
    };
  } catch {
    return errorSlice();
  }
}

async function loadMastery(source: HomeDataSource): Promise<HomeSlice<HomeMasteryData>> {
  try {
    return { data: await source.masterySummary(), loading: false, error: null };
  } catch {
    return errorSlice();
  }
}

/** The preview is a nicety: a missing/failed read stays idle, never an error. */
async function loadPreview(source: HomeDataSource): Promise<HomeSlice<PuzzleRow>> {
  try {
    const puzzle = await source.latestPuzzle();
    return puzzle === undefined ? idleSlice() : { data: puzzle, loading: false, error: null };
  } catch {
    return idleSlice();
  }
}

async function loadBlock(
  source: HomeDataSource,
  setId: string,
  dataVersionKey: string,
): Promise<HomeSlice<HomeBlockData>> {
  try {
    const result = await source.trainingSetStats(setId, { dataVersionKey });
    if (!result.ok) {
      return { data: null, loading: false, error: result.message ?? HOME_LOAD_ERROR };
    }
    return { data: { stats: result.result }, loading: false, error: null };
  } catch {
    return errorSlice();
  }
}

export function useHome(options: UseHomeOptions = {}): UseHome {
  const injected = options.source;
  const reactId = useId();
  const [retryToken, setRetryToken] = useState(0);
  const dataVersionKey = `${reactId}:${retryToken}`;
  const [now, setNow] = useState<number>(() => (options.now ?? Date.now)());

  const [browserSource, setBrowserSource] = useState<HomeDataSource | null>(null);
  const source = injected ?? browserSource;
  const [game, setGame] = useState<HomeSlice<HomeGameData>>(() => initialSlice());
  const [training, setTraining] = useState<HomeSlice<HomeTrainingData>>(() => initialSlice());
  const [mastery, setMastery] = useState<HomeSlice<HomeMasteryData>>(() => initialSlice());
  const [block, setBlock] = useState<HomeSlice<HomeBlockData>>(() => initialSlice());
  const [preview, setPreview] = useState<HomeSlice<PuzzleRow>>(() => initialSlice());

  // Resolve the data source: injected for tests, else a lazily-imported browser
  // adapter (the statistics service never enters the initial chunk).
  useEffect(() => {
    if (injected !== undefined) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const module = await import('@/infrastructure/home/home-data-source');
        if (!cancelled) {
          setBrowserSource(module.createBrowserHomeDataSource());
        }
      } catch {
        if (!cancelled) {
          setGame(errorSlice());
          setTraining(errorSlice());
          setMastery(errorSlice());
          setBlock(errorSlice());
          setPreview(idleSlice());
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [injected, retryToken]);

  // Game slice: stored-game count + one bounded Feature-014 gameMetrics read.
  useEffect(() => {
    if (source === null) {
      return;
    }
    let cancelled = false;
    void (async () => {
      setGame((current) => ({ ...current, loading: true, error: null }));
      const query: StatisticsServiceQuery = {
        platform: 'all',
        timeControl: 'all',
        side: 'all',
        result: 'all',
        dateRange: HOME_STATS_WINDOW,
        now,
      };
      const previousQuery: StatisticsServiceQuery = {
        ...query,
        dateRange: homePreviousWindow(now),
      };
      const slice = await loadGame(source, query, previousQuery, dataVersionKey);
      if (!cancelled) {
        setGame(slice);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source, dataVersionKey, now]);

  // Training slice: active/archived sets + the open block + every cycle.
  useEffect(() => {
    if (source === null) {
      return;
    }
    let cancelled = false;
    void (async () => {
      setTraining((current) => ({ ...current, loading: true, error: null }));
      const slice = await loadTraining(source);
      if (!cancelled) {
        setTraining(slice);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source, dataVersionKey]);

  // Mastery slice: the canonical Feature-013 mastered/total puzzle counts.
  useEffect(() => {
    if (source === null) {
      return;
    }
    let cancelled = false;
    void (async () => {
      setMastery((current) => ({ ...current, loading: true, error: null }));
      const slice = await loadMastery(source);
      if (!cancelled) {
        setMastery(slice);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source, dataVersionKey]);

  const openBlockId = training.data?.openBlock?.id ?? null;

  // Block slice: Feature-014 set statistics for the open block only.
  useEffect(() => {
    if (source === null) {
      return;
    }
    let cancelled = false;
    void (async () => {
      if (training.loading) {
        setBlock((current) => ({ ...current, loading: true, error: null }));
        return;
      }
      if (openBlockId === null) {
        setBlock(idleSlice());
        return;
      }
      setBlock((current) => ({ ...current, loading: true, error: null }));
      const slice = await loadBlock(source, openBlockId, dataVersionKey);
      if (!cancelled) {
        setBlock(slice);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source, openBlockId, training.loading, dataVersionKey]);

  // Preview slice: the most recently created puzzle (Home showcase).
  useEffect(() => {
    if (source === null) {
      return;
    }
    let cancelled = false;
    void (async () => {
      setPreview((current) => ({ ...current, loading: true, error: null }));
      const slice = await loadPreview(source);
      if (!cancelled) {
        setPreview(slice);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source, dataVersionKey]);

  function reload(): void {
    setNow((options.now ?? Date.now)());
    setRetryToken((value) => value + 1);
  }

  return { game, training, mastery, block, preview, dataVersionKey, reload };
}
