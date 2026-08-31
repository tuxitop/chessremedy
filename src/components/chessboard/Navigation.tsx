import type * as React from 'react';
import type { PgnViewerApi, PgnViewerGoTo } from './PgnViewer';
import styles from './Navigation.module.css';

export interface NavigationProps {
  api: PgnViewerApi | null;
  onGoTo?: (to: PgnViewerGoTo) => void;
}

/**
 * Four-button navigation bar that drives the PgnViewer API.
 * Used in the Playground and any future Chessboard surface that
 * needs explicit start / prev / next / end controls (in addition
 * to the PgnViewer's own keyboard shortcuts).
 */
export function Navigation({ api, onGoTo }: NavigationProps): React.JSX.Element {
  const handle = (to: PgnViewerGoTo): void => {
    if (!api) {
      return;
    }
    api.goTo(to);
    onGoTo?.(to);
  };

  const disabled = !api;

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
        onClick={() => handle('first')}
        disabled={disabled}
        aria-label="Go to first move"
        data-testid="nav-first"
      >
        |◀
      </button>
      <button
        type="button"
        className={styles.button}
        onClick={() => handle('prev')}
        disabled={disabled}
        aria-label="Previous move"
        data-testid="nav-prev"
      >
        ◀
      </button>
      <button
        type="button"
        className={styles.button}
        onClick={() => handle('next')}
        disabled={disabled}
        aria-label="Next move"
        data-testid="nav-next"
      >
        ▶
      </button>
      <button
        type="button"
        className={styles.button}
        onClick={() => handle('last')}
        disabled={disabled}
        aria-label="Go to last move"
        data-testid="nav-last"
      >
        ▶|
      </button>
    </div>
  );
}
