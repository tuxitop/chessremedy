import type * as React from 'react';
import { GAME_SOURCE_LABELS } from '@/domain/chess/gameSource';
import type { GameSummary } from '@/infrastructure/db/games-repository';
import styles from './ImportedGamesList.module.css';

interface ImportedGamesListProps {
  readonly games: readonly GameSummary[];
  /** Total rows stored (before the display filters). */
  readonly totalCount: number;
}

function dateLabel(playedAt: string | null): string {
  if (playedAt === null) {
    return '—';
  }
  const date = playedAt.slice(0, 10);
  return `${date.slice(0, 4)}-${date.slice(5, 7)}-${date.slice(8, 10)}`;
}

function playerCell(player: { name: string; rating: number | null }): string {
  return player.rating === null ? player.name : `${player.name} (${player.rating})`;
}

export function ImportedGamesList({
  games,
  totalCount,
}: ImportedGamesListProps): React.JSX.Element {
  if (totalCount === 0) {
    return (
      <p className={styles.empty} data-testid="imported-games-empty">
        No games yet. Use one of the import panels above to bring in your Chess.com or Lichess
        games.
      </p>
    );
  }
  if (games.length === 0) {
    return (
      <p className={styles.empty} data-testid="imported-games-no-match">
        No games match the filters.
      </p>
    );
  }
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Played</th>
            <th scope="col">White</th>
            <th scope="col">Black</th>
            <th scope="col">Result</th>
            <th scope="col">Time control</th>
            <th scope="col">Platform</th>
            <th scope="col">Your side</th>
          </tr>
        </thead>
        <tbody>
          {games.map((game) => (
            <tr key={game.id} data-testid="game-row">
              <td data-testid="game-date">{dateLabel(game.playedAt)}</td>
              <td data-testid="game-white">{playerCell(game.whitePlayer)}</td>
              <td data-testid="game-black">{playerCell(game.blackPlayer)}</td>
              <td data-testid="game-result">{game.result}</td>
              <td data-testid="game-timecontrol">{`${game.normalizedTimeControl}${game.timeControl === '' ? '' : ` (${game.timeControl})`}`}</td>
              <td data-testid="game-source">{GAME_SOURCE_LABELS[game.source]}</td>
              <td data-testid="game-side">{game.userColor}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
