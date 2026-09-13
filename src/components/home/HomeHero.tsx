import type * as React from 'react';
import { Link } from 'react-router-dom';
import { ROUTES, trainingCyclePath, trainingSetPath } from '@/app/routes';
import type { HomePrimaryAction } from '@/presentation/home';
import styles from './HomeHero.module.css';

export interface HomeHeroPill {
  readonly label: string;
  readonly tone: 'brand' | 'neutral';
}

export interface HomeHeroProps {
  readonly primaryAction: HomePrimaryAction | null;
  readonly pills?: readonly HomeHeroPill[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly onRetry: () => void;
}

function hrefFor(action: HomePrimaryAction): string {
  const target = action.target;
  switch (target.to) {
    case 'cycle':
      return trainingCyclePath(target.setId, target.cycleNumber);
    case 'set':
      return trainingSetPath(target.setId);
    case 'games':
      return ROUTES.games;
    case 'statistics':
      return ROUTES.statistics;
  }
}

/**
 * The Home hero: one `<h1>`, a one-sentence value statement and a context-aware
 * primary action with an always-present Game Library link. While the game slice
 * loads the primary is a skeleton; on a game-slice error it is omitted and the
 * secondary stays usable.
 */
export function HomeHero({
  primaryAction,
  pills = [],
  loading,
  error,
  onRetry,
}: HomeHeroProps): React.JSX.Element {
  return (
    <section className={styles.hero} data-testid="home-hero">
      {pills.length > 0 ? (
        <div className={styles.pillRow} data-testid="home-hero-pills">
          {pills.map((pill) => (
            <span
              key={pill.label}
              className={`${styles.pill} ${pill.tone === 'brand' ? styles.pillBrand : styles.pillNeutral}`}
            >
              {pill.label}
            </span>
          ))}
        </div>
      ) : null}
      <h1 className={styles.title}>ChessRemedy</h1>
      <p className={styles.tagline}>
        Analyze your own games locally, turn mistakes and missed tactics into puzzles, and train
        them in cycles.
      </p>
      <div className={styles.actions}>
        {loading ? (
          <span
            className={styles.skeleton}
            aria-busy="true"
            data-testid="home-hero-primary-loading"
          >
            Loading…
          </span>
        ) : error !== null ? null : primaryAction !== null ? (
          <Link
            className={styles.primary}
            to={hrefFor(primaryAction)}
            data-testid="home-hero-primary"
          >
            {primaryAction.label}
          </Link>
        ) : null}
        <Link className={styles.secondary} to={ROUTES.games} data-testid="home-hero-secondary">
          Open the Game Library
        </Link>
      </div>
      {error !== null ? (
        <p className={styles.error} role="alert" data-testid="home-hero-error">
          {error}{' '}
          <button type="button" className={styles.retry} onClick={onRetry}>
            Retry
          </button>
        </p>
      ) : null}
    </section>
  );
}
