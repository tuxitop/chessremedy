import type * as React from 'react';
import { useCallback, useState } from 'react';
import { importService } from '@/infrastructure/import';
import type { ImportServiceLike } from '@/hooks/useGameImport';
import { ImportPanel } from '@/components/games/ImportPanel';
import { GameLibrary } from '@/components/games/library/GameLibrary';
import styles from './GamesPage.module.css';

interface GamesPageProps {
  /** Injectable for tests; defaults to the app-wide import service. */
  readonly service?: ImportServiceLike;
}

export function GamesPage({ service = importService }: GamesPageProps = {}): React.JSX.Element {
  const [refreshKey, setRefreshKey] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  return (
    <div className={styles.page} data-testid="games-page">
      <h1 className={styles.heading}>Game Library</h1>

      <details
        className={styles.importSection}
        open={importOpen}
        onToggle={(event) => setImportOpen((event.target as HTMLDetailsElement).open)}
      >
        <summary data-testid="import-toggle">Import games…</summary>
        <div className={styles.imports} data-testid="games-imports">
          <ImportPanel provider="lichess" service={service} onImported={refresh} />
          <ImportPanel provider="chesscom" service={service} onImported={refresh} />
        </div>
      </details>

      <GameLibrary refreshKey={refreshKey} />
    </div>
  );
}
