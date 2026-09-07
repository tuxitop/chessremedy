import type * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { importService } from '@/infrastructure/import';
import type { ImportServiceLike } from '@/hooks/useGameImport';
import { getBrowserAnalysisService } from '@/infrastructure/analysis';
import type { AnalysisServiceLike } from '@/hooks/useGameAnalysis';
import { ImportPanel } from '@/components/games/ImportPanel';
import { GameLibrary } from '@/components/games/library/GameLibrary';
import styles from './GamesPage.module.css';

interface GamesPageProps {
  /** Injectable for tests; defaults to the app-wide import service. */
  readonly service?: ImportServiceLike;
  /**
   * Injectable for tests; when omitted the page lazily builds the browser
   * game-analysis service (Feature 008).
   */
  readonly analysisService?: AnalysisServiceLike | null;
}

export function GamesPage({
  service = importService,
  analysisService,
}: GamesPageProps = {}): React.JSX.Element {
  const [refreshKey, setRefreshKey] = useState(0);
  const [defaultAnalysisService, setDefaultAnalysisService] = useState<AnalysisServiceLike | null>(
    null,
  );
  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  useEffect(() => {
    if (analysisService !== undefined) {
      return;
    }
    let active = true;
    getBrowserAnalysisService()
      .then((built) => {
        if (active) {
          setDefaultAnalysisService(built);
          if (import.meta.env.DEV) {
            (globalThis as { __chessremedy?: unknown }).__chessremedy = built;
          }
        }
      })
      .catch(() => {
        // Analysis stays unavailable; the Library disables the Analyze action.
      });
    return () => {
      active = false;
    };
  }, [analysisService]);

  const resolvedAnalysis = analysisService !== undefined ? analysisService : defaultAnalysisService;

  return (
    <div className={styles.page} data-testid="games-page">
      <h1 className={styles.heading}>Game Library</h1>

      <GameLibrary
        refreshKey={refreshKey}
        analysisService={resolvedAnalysis}
        importPanels={
          <>
            <ImportPanel provider="lichess" service={service} onImported={refresh} />
            <ImportPanel provider="chesscom" service={service} onImported={refresh} />
          </>
        }
      />
    </div>
  );
}
