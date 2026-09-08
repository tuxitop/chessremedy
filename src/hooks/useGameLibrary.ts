import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { gamesRepository } from '@/infrastructure/db/games-repository';
import { analysisJobsRepository } from '@/infrastructure/db/analysis-jobs-repository';
import { summariesRepository } from '@/infrastructure/db/summaries-repository';
import { puzzlesRepository } from '@/infrastructure/db/puzzles-repository';
import {
  analysisInsightsForGame,
  groupJobsByGame,
  groupSummariesByGame,
  resolveAnalysisResultFilter,
} from '@/infrastructure/db/analysis-result-query';
import { gameLibraryQueryFor } from '@/infrastructure/db/game-library-query';
import type { AnalysisJob } from '@/domain/analysis';
import type { AnalysisSummaryRow } from '@/infrastructure/db/summaries-repository';
import {
  DEFAULT_LIBRARY_FILTERS,
  filtersFromParams,
  isCustomTimeFrame,
  libraryRowOf,
  matchesLibraryFilters,
  paramsFromFilters,
  resolveTimeFrame,
  sortLibraryRows,
  validateTimeFrame,
  withRowInsights,
  type GameLibraryFilters,
  type LibraryGameRow,
} from '@/domain/gameLibrary';
import type { TimeWindow } from '@/domain/gameLibrary/timeframe';
import { createSelection, type GameSelection } from '@/domain/gameLibrary/selection';

export interface UseGameLibrary {
  readonly filters: GameLibraryFilters;
  readonly totalStored: number;
  readonly rows: readonly LibraryGameRow[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly selected: GameSelection;
  readonly isFiltering: boolean;
  update(next: GameLibraryFilters, replace?: boolean): void;
  reload(): void;
  toggleRow(id: string): void;
  selectAllVisible(): void;
  clearSelection(): void;
  /** Delete the currently selected games. */
  deleteSelected(): Promise<void>;
  /** Delete specific games (per-row delete) and reload. */
  deleteGames(ids: readonly string[]): Promise<void>;
  clearAllFilters(): void;
}

function serialize(filters: GameLibraryFilters): string {
  return paramsFromFilters(filters).toString();
}

function analysisDimensionsActive(filters: GameLibraryFilters): boolean {
  return (
    filters.analysis !== 'all' ||
    filters.hasBlunders !== 'all' ||
    filters.hasMissedTactics !== 'all'
  );
}

interface LibraryLoad {
  readonly rows: readonly LibraryGameRow[];
  readonly totalStored: number;
}

/**
 * Load the filtered Library rows. Metadata/time dimensions push down into the
 * games query; when an analysis-result dimension is active it is resolved
 * from persisted jobs + per-analysis summaries (never a `MoveAnalysis` scan)
 * into an id restriction pushed into the same query. Listed rows are then
 * enriched with their per-game analysis insights (Feature 010) and per-game
 * `puzzles`-row counts (Feature 011) before the in-memory filter/search pass.
 */
async function loadLibraryRows(
  filters: GameLibraryFilters,
  window: TimeWindow,
): Promise<LibraryLoad> {
  let jobs: readonly AnalysisJob[] = [];
  let summaries: readonly AnalysisSummaryRow[] = [];

  const query =
    analysisDimensionsActive(filters) === false
      ? gameLibraryQueryFor(filters, window)
      : await restrictedQuery(filters, window, (loadedJobs, loadedSummaries) => {
          jobs = loadedJobs;
          summaries = loadedSummaries;
        });

  const [gameRows, storedCount] = await Promise.all([
    gamesRepository.listGameSummaries(query),
    gamesRepository.countGames(),
  ]);

  if (jobs.length === 0) {
    // No restriction ran: fetch the jobs/summaries of the listed rows only.
    const ids = gameRows.map((summary) => summary.id);
    [jobs, summaries] = await Promise.all([
      analysisJobsRepository.listByGames(ids),
      summariesRepository.listForGames(ids),
    ]);
  }

  // Feature-011 Stage D: the game-scoped `puzzles` row count of every listed
  // row (one query over the `sourceGameId` index). The map is threaded into
  // the insight overlay, which exposes a count only for a `completed`
  // generation pass (absent ≠ zero — see analysis-result-query.ts).
  const ids = gameRows.map((summary) => summary.id);
  const puzzleCountsByGame = await puzzlesRepository.countForGames(ids);

  const jobsByGame = groupJobsByGame(jobs);
  const summariesByGame = groupSummariesByGame(summaries);
  const enriched = gameRows.map((summary) => {
    const row = libraryRowOf(summary);
    const insights = analysisInsightsForGame(
      jobsByGame.get(row.id) ?? [],
      summariesByGame.get(row.id) ?? [],
      puzzleCountsByGame,
    );
    return withRowInsights(row, insights);
  });
  const matched = enriched.filter((row) => matchesLibraryFilters(row, filters, window));
  return { rows: sortLibraryRows(matched), totalStored: storedCount };
}

async function restrictedQuery(
  filters: GameLibraryFilters,
  window: TimeWindow,
  onData: (jobs: readonly AnalysisJob[], summaries: readonly AnalysisSummaryRow[]) => void,
) {
  const metadataQuery = gameLibraryQueryFor(filters, window, null);
  const universe = await gamesRepository.listGameIds(metadataQuery);
  const [jobs, summaries] = await Promise.all([
    analysisJobsRepository.listByGames(universe),
    summariesRepository.listForGames(universe),
  ]);
  onData(jobs, summaries);
  const restriction = resolveAnalysisResultFilter(filters, universe, jobs, summaries);
  return gameLibraryQueryFor(filters, window, restriction);
}

export function useGameLibrary(refreshKey: number): UseGameLibrary {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = filtersFromParams(searchParams);
  const serialized = serialize(filters);

  const [totalStored, setTotalStored] = useState(0);
  const [rows, setRows] = useState<readonly LibraryGameRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<GameSelection>(() => createSelection());
  const [tick, setTick] = useState(0);

  // Tracks which filter snapshot the current selection belongs to. Whenever
  // it no longer matches the active filters, the selection is cleared (on
  // the next successful load or the next selection action).
  const selectionFilterKey = useRef(serialized);
  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current;
    let cancelled = false;
    void (async () => {
      // An incomplete or invalid custom range has no queryable bounds yet
      // (its dates are still being typed). Skip the query and keep the
      // current rows; the toolbar shows the inline validation hint instead of
      // a load error.
      if (isCustomTimeFrame(filters.timeFrame) && validateTimeFrame(filters.timeFrame) !== null) {
        if (!cancelled && requestId.current === id) {
          setError(null);
          setLoading(false);
        }
        return;
      }
      const window = resolveTimeFrame(filters.timeFrame, Date.now());
      try {
        const { rows: matched, totalStored: storedCount } = await loadLibraryRows(filters, window);
        if (cancelled || requestId.current !== id) {
          return;
        }
        setRows(matched);
        setTotalStored(storedCount);
        if (selectionFilterKey.current !== serialized) {
          selectionFilterKey.current = serialized;
          setSelected(createSelection());
        }
        setError(null);
        setLoading(false);
      } catch {
        if (!cancelled && requestId.current === id) {
          setError('Could not load your games from local storage.');
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Reload on filter change (URL), an external refresh signal, or reload().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialized, refreshKey, tick]);

  function update(next: GameLibraryFilters, replace?: boolean): void {
    const key = serialize(next);
    selectionFilterKey.current = key;
    setSelected(createSelection());
    setSearchParams(paramsFromFilters(next), replace ? { replace: true } : undefined);
  }

  function toggleRow(id: string): void {
    if (selectionFilterKey.current !== serialized) {
      selectionFilterKey.current = serialized;
      setSelected(createSelection());
    }
    setSelected((current) => current.toggle(id));
  }

  function selectAllVisible(): void {
    selectionFilterKey.current = serialized;
    setSelected((current) => current.selectAll(rows.map((row) => row.id)));
  }

  function clearSelection(): void {
    selectionFilterKey.current = serialized;
    setSelected(createSelection());
  }

  async function deleteSelected(): Promise<void> {
    const ids = [...selected.ids];
    if (ids.length === 0) {
      return;
    }
    await deleteGames(ids);
  }

  async function deleteGames(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await gamesRepository.deleteGames(ids);
      setSelected(createSelection());
      const window = resolveTimeFrame(filters.timeFrame, Date.now());
      const { rows: matched, totalStored: storedCount } = await loadLibraryRows(filters, window);
      setRows(matched);
      setTotalStored(storedCount);
      setLoading(false);
    } catch {
      setError('Could not delete the selected games from local storage.');
      setLoading(false);
    }
  }

  function reload(): void {
    setTick((value) => value + 1);
  }

  function clearAllFilters(): void {
    update(DEFAULT_LIBRARY_FILTERS, true);
  }

  const isFiltering =
    filters.search.trim() !== '' ||
    filters.timeFrame.preset !== 'all' ||
    filters.timeControl !== 'all' ||
    filters.side !== 'all' ||
    filters.platform !== 'all' ||
    analysisDimensionsActive(filters);

  return {
    filters,
    totalStored,
    rows,
    loading,
    error,
    selected,
    isFiltering,
    update,
    reload,
    toggleRow,
    selectAllVisible,
    clearSelection,
    deleteSelected,
    deleteGames,
    clearAllFilters,
  };
}
