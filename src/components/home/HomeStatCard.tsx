import type * as React from 'react';
import { Button } from '@/components/ui/Button';
import styles from './HomeStatsGrid.module.css';

export interface HomeStatCardProps {
  readonly label: string;
  readonly testId: string;
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly onRetry?: () => void;
  readonly children?: React.ReactNode;
}

/**
 * One honest stat card: a labelled `<dt>`/`<dd>` pair with explicit loading and
 * inline error/retry states. It never renders a fabricated value — the caller
 * supplies the resolved content only when the slice is ready.
 */
export function HomeStatCard({
  label,
  testId,
  loading = false,
  error = null,
  onRetry,
  children,
}: HomeStatCardProps): React.JSX.Element {
  const state = loading ? 'loading' : error !== null ? 'error' : 'value';
  return (
    <div className={styles.card} data-testid={testId} data-state={state} aria-busy={loading}>
      <dt className={styles.cardLabel}>{label}</dt>
      <dd className={styles.cardValue}>
        {loading ? (
          <span className={styles.placeholder} data-testid={`${testId}-loading`}>
            Loading…
          </span>
        ) : error !== null ? (
          <span className={styles.error} data-testid={`${testId}-error`}>
            <span role="alert">{error}</span>
            {onRetry !== undefined ? (
              <Button
                variant="secondary"
                onClick={onRetry}
                data-testid={`${testId}-retry`}
                className={styles.retry ?? ''}
              >
                Retry
              </Button>
            ) : null}
          </span>
        ) : (
          children
        )}
      </dd>
    </div>
  );
}
