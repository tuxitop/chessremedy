import type * as React from 'react';
import { Link } from 'react-router-dom';
import { ROUTES } from '@/app/routes';
import styles from './HomeStatsGrid.module.css';

/**
 * First-run replacement for the stat grid: no games stored yet, with a direct
 * route into the Game Library. Never renders zeros.
 */
export function HomeEmptyState(): React.JSX.Element {
  return (
    <div className={styles.empty} data-testid="home-empty-state">
      <p className={styles.emptyTitle}>No games yet</p>
      <p className={styles.emptyText}>
        Import your games, analyze them locally with Stockfish, then train the puzzles generated
        from your mistakes.
      </p>
      <Link className={styles.emptyLink} to={ROUTES.games} data-testid="home-empty-link">
        Open the Game Library
      </Link>
    </div>
  );
}
