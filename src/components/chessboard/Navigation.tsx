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

function ChevronIcon({ double = false, back = false }: { double?: boolean; back?: boolean }) {
  const chevrons = double ? (
    <>
      <path d="M4 6l6 6-6 6" />
      <path d="M13 6l6 6-6 6" />
    </>
  ) : (
    <path d="M8 6l6 6-6 6" />
  );
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={back ? { transform: 'rotate(180deg)' } : undefined}
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {chevrons}
      </g>
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
        <ChevronIcon double back />
      </button>
      <button
        type="button"
        className={styles.button}
        onClick={() => onNavigate?.('prev')}
        aria-label="Previous move"
        disabled={atStart}
        data-testid="nav-prev"
      >
        <ChevronIcon back />
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
