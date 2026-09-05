import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { gamesRepository } from '@/infrastructure/db/games-repository';
import { gameLibraryQueryFor } from '@/infrastructure/db/game-library-query';
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
  type GameLibraryFilters,
  type LibraryGameRow,
} from '@/domain/gameLibrary';
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
  deleteSelected(): Promise<void>;
  clearAllFilters(): void;
}

function serialize(filters: GameLibraryFilters): string {
  return paramsFromFilters(filters).toString();
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
      const query = gameLibraryQueryFor(filters, window);
      const [summaries, storedCount] = await Promise.all([
        gamesRepository.listGameSummaries(query),
        gamesRepository.countGames(),
      ]);
      if (cancelled || requestId.current !== id) {
        return;
      }
      const matched = summaries
        .filter((summary) => matchesLibraryFilters(libraryRowOf(summary), filters, window))
        .map((summary) => libraryRowOf(summary));
      setRows(sortLibraryRows(matched));
      setTotalStored(storedCount);
      if (selectionFilterKey.current !== serialized) {
        selectionFilterKey.current = serialized;
        setSelected(createSelection());
      }
      setError(null);
      setLoading(false);
    })().catch(() => {
      if (!cancelled && requestId.current === id) {
        setError('Could not load your games from local storage.');
        setLoading(false);
      }
    });
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
    setLoading(true);
    setError(null);
    try {
      await gamesRepository.deleteGames(ids);
      setSelected(createSelection());
      const window = resolveTimeFrame(filters.timeFrame, Date.now());
      const query = gameLibraryQueryFor(filters, window);
      const [summaries, storedCount] = await Promise.all([
        gamesRepository.listGameSummaries(query),
        gamesRepository.countGames(),
      ]);
      const matched = summaries
        .filter((summary) => matchesLibraryFilters(libraryRowOf(summary), filters, window))
        .map((summary) => libraryRowOf(summary));
      setRows(sortLibraryRows(matched));
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
    filters.platform !== 'all';

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
    clearAllFilters,
  };
}
