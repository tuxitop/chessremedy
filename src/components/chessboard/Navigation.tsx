import type * as React from 'react';
import styles from './Navigation.module.css';

export type NavigationTarget = 'first' | 'prev' | 'next' | 'last';

export interface NavigationProps {
  /** Current ply (0-based). 0 means "before the first move". */
  currentPly: number;
  /** Total number of plies in the mainline (after which the position is the final position). */
  totalPlies: number;
  /** Fired with the target the user requested. The caller resolves it to a ply. */
  onNavigate?: (target: NavigationTarget) => void;
}

function ChevronIcon({ double = false, flip = false }: { double?: boolean; flip?: boolean }) {
  const dir = flip ? -1 : 1;
  const path = double ? (
    <>
      <path
        d={`M${dir * 7} 5 L1 12 L${dir * 7} 19`}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={`M${dir * 15} 5 L${dir * 9} 12 L${dir * 15} 19`}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ) : (
    <path
      d={`M${dir * 5} 5 L${dir * 11} 12 L${dir * 5} 19`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      {path}
    </svg>
  );
}

/**
 * Four-button navigation bar (start / previous / next / last) rendered as
 * inline SVG chevrons so no symbol glyphs are needed. Lives below the
 * move list in the analysis layout.
 */
export function Navigation(props: NavigationProps): React.JSX.Element {
  const { currentPly, totalPlies, onNavigate } = props;
  const atStart = currentPly <= 0;
  const atEnd = currentPly >= totalPlies;

  return (
    <div
      className={styles.bar}
      role="toolbar"
      aria-label="Move navigation"
      data-testid="move-navigation"
    >
      <button
        type="button"
        className={styles.button}
        onClick={() => onNavigate?.('first')}
        aria-label="Go to first move"
        disabled={atStart}
        data-testid="nav-first"
      >
        <ChevronIcon double flip />
      </button>
      <button
        type="button"
        className={styles.button}
        onClick={() => onNavigate?.('prev')}
        aria-label="Previous move"
        disabled={atStart}
        data-testid="nav-prev"
      >
        <ChevronIcon flip />
      </button>
      <button
        type="button"
        className={styles.button}
        onClick={() => onNavigate?.('next')}
        aria-label="Next move"
        disabled={atEnd}
        data-testid="nav-next"
      >
        <ChevronIcon />
      </button>
      <button
        type="button"
        className={styles.button}
        onClick={() => onNavigate?.('last')}
        aria-label="Go to last move"
        disabled={atEnd}
        data-testid="nav-last"
      >
        <ChevronIcon double />
      </button>
    </div>
  );
}
