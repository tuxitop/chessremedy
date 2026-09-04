import type * as React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { gamesRepository, type GameSummary } from '@/infrastructure/db/games-repository';
import { importService } from '@/infrastructure/import';
import {
  DEFAULT_GAME_LIST_FILTERS,
  matchesGameListFilters,
  type GameListFilters,
} from '@/components/games/gameListFilters';
import { GameListFiltersBar } from '@/components/games/GameListFiltersBar';
import { ImportedGamesList } from '@/components/games/ImportedGamesList';
import { ImportPanel } from '@/components/games/ImportPanel';
import styles from './GamesPage.module.css';

import type { ImportServiceLike } from '@/hooks/useGameImport';

interface GamesPageProps {
  /** Injectable for tests; defaults to the app-wide import service. */
  readonly service?: ImportServiceLike;
}

export function GamesPage({ service = importService }: GamesPageProps = {}): React.JSX.Element {
  const [summaries, setSummaries] = useState<readonly GameSummary[]>([]);
  const [filters, setFilters] = useState<GameListFilters>(DEFAULT_GAME_LIST_FILTERS);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  useEffect(() => {
    let cancelled = false;
    void gamesRepository.listGameSummaries().then((list) => {
      if (!cancelled) {
        setSummaries(list);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const totalCount = summaries.length;
  const filtered = useMemo(
    () => summaries.filter((s) => matchesGameListFilters(s, filters)),
    [summaries, filters],
  );

  return (
    <div className={styles.page} data-testid="games-page">
      <h1 className={styles.heading}>Your games</h1>

      <div className={styles.imports} data-testid="games-imports">
        <ImportPanel provider="chesscom" service={service} onImported={refresh} />
        <ImportPanel provider="lichess" service={service} onImported={refresh} />
      </div>

      <section className={styles.listSection}>
        {totalCount > 0 ? (
          <GameListFiltersBar
            filters={filters}
            onChange={setFilters}
            matched={filtered.length}
            total={totalCount}
          />
        ) : null}
        <ImportedGamesList games={filtered} totalCount={totalCount} />
      </section>
    </div>
  );
}
