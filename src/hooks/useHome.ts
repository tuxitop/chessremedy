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
import type { GameMetricsPartition, TrainingSetStats } from '@/domain/statistics';
import type { TacticalTrainingSetRow, TrainingCycleRow } from '@/domain/training/cycleTypes';
import type { HomeDataSource, HomeMasteryData } from '@/infrastructure/home/home-data-source';
import type { StatisticsServiceQuery } from '@/infrastructure/statistics';
import { HOME_STATS_WINDOW } from '@/presentation/home';

export type { HomeDataSource, HomeMasteryData } from '@/infrastructure/home/home-data-source';

/** Inline error copy for a failed Home read (never a fabricated value). */
export const HOME_LOAD_ERROR = 'Could not load statistics.';

/** The game-analysis slice payload (Feature 007 count + Feature 014 partitions). */
export interface HomeGameData {
  readonly totalGames: number;
  readonly partitions: readonly GameMetricsPartition[];
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
  dataVersionKey: string,
): Promise<HomeSlice<HomeGameData>> {
  try {
    const [totalGames, result] = await Promise.all([
      source.countGames(),
      source.gameMetrics(query, { dataVersionKey }),
    ]);
    if (!result.ok) {
      return { data: null, loading: false, error: result.message ?? HOME_LOAD_ERROR };
    }
    return {
      data: { totalGames, partitions: result.result.partitions },
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
      const slice = await loadGame(source, query, dataVersionKey);
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

  function reload(): void {
    setNow((options.now ?? Date.now)());
    setRetryToken((value) => value + 1);
  }

  return { game, training, mastery, block, dataVersionKey, reload };
}
