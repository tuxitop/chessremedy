import type * as React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import styles from './DashboardStates.module.css';

export interface DashboardLoadingProps {
  readonly label?: string;
}

/** Polite loading placeholder; never blocks the rest of the page. */
export function DashboardLoading({
  label = 'Loading statistics…',
}: DashboardLoadingProps): React.JSX.Element {
  return (
    <p className={styles.loading} role="status" aria-live="polite" data-testid="dashboard-loading">
      {label}
    </p>
  );
}

export interface DashboardLoadErrorProps {
  readonly message?: string;
  readonly onRetry?: () => void;
}

/** Inline read failure with a retry; never a fabricated value. */
export function DashboardLoadError({
  message = 'Could not load statistics.',
  onRetry,
}: DashboardLoadErrorProps): React.JSX.Element {
  return (
    <div className={styles.panel} role="alert" data-testid="dashboard-load-error">
      <p className={styles.text}>{message}</p>
      {onRetry !== undefined ? (
        <Button variant="secondary" onClick={onRetry} data-testid="dashboard-retry">
          Retry
        </Button>
      ) : null}
    </div>
  );
}

/** First-run empty state: no games to analyse yet. */
export function DashboardEmpty(): React.JSX.Element {
  return (
    <div className={styles.panel} data-testid="dashboard-empty">
      <h2 className={styles.title}>No games yet</h2>
      <p className={styles.text}>
        Import your games, then analyze them to see rating, accuracy and mistake trends here.
      </p>
      <p className={styles.links}>
        <Link to="/games">Go to Games</Link>
        {' · '}
        <Link to="/analysis">Open Analysis</Link>
      </p>
    </div>
  );
}

/** Training-section empty state: no set selected or available. */
export function DashboardNoTraining(): React.JSX.Element {
  return (
    <div className={styles.panel} data-testid="dashboard-no-training">
      <h2 className={styles.title}>No training set yet</h2>
      <p className={styles.text}>
        Create a tactical training set to track cycle accuracy, solving time and your weakest
        categories.
      </p>
      <p className={styles.links}>
        <Link to="/training">Go to Training</Link>
      </p>
    </div>
  );
}
