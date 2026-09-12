import type * as React from 'react';
import { Link } from 'react-router-dom';
import { ROUTES } from '@/app/routes';
import styles from './HomeHowItWorks.module.css';

export interface HomeHowItWorksProps {
  /** Returning users get a `<details>` disclosure; first-run shows the copy. */
  readonly collapsible: boolean;
}

function Content(): React.JSX.Element {
  return (
    <>
      <ol className={styles.list}>
        <li>
          <strong>Import</strong> your own games from Lichess or Chess.com.
        </li>
        <li>
          <strong>Analyze</strong> them locally with Stockfish to find mistakes and missed tactics.
        </li>
        <li>
          <strong>Train</strong> the puzzles generated from those games in fixed cycles.
        </li>
        <li>Everything is stored on this device; synchronization is optional.</li>
      </ol>
      <p className={styles.links}>
        <Link to={ROUTES.games}>Open the Game Library</Link>
        {' · '}
        <Link to={ROUTES.training}>Start Training</Link>
      </p>
    </>
  );
}

/**
 * Static "how it works / where to start" copy. Always visible for first-run;
 * collapsed behind a native `<details>` disclosure for returning users.
 */
export function HomeHowItWorks({ collapsible }: HomeHowItWorksProps): React.JSX.Element {
  if (collapsible) {
    return (
      <details className={styles.section} data-testid="home-how-it-works">
        <summary className={styles.summary}>How it works</summary>
        <Content />
      </details>
    );
  }
  return (
    <section className={styles.section} aria-label="How it works" data-testid="home-how-it-works">
      <h2 className={styles.heading}>How it works</h2>
      <Content />
    </section>
  );
}
