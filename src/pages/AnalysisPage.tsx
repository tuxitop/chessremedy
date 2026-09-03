import type * as React from 'react';
import { Link } from 'react-router-dom';
import styles from './AnalysisPage.module.css';

/**
 * Analysis hub landing. Feature 006 ships the live analysis board at
 * `/analysis/live`; game analysis surfaces arrive with Feature 008.
 */
export function AnalysisPage(): React.JSX.Element {
  return (
    <section className={styles.hub} data-testid="analysis-hub">
      <h1 className={styles.heading}>Analysis</h1>
      <p className={styles.blurb}>
        Analyse any position locally with Stockfish. Game review arrives with Feature 008.
      </p>
      <Link className={styles.card} to="/analysis/live" data-testid="live-analysis-link">
        <span className={styles.cardTitle}>Live analysis board</span>
        <span className={styles.cardBody}>
          Play a position and get live evaluation, multiple lines and best-move guidance.
        </span>
      </Link>
    </section>
  );
}
