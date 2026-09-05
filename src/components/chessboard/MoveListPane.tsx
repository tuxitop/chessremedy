import type * as React from 'react';
import styles from './MoveListPane.module.css';

/**
 * Shared "Moves" pane used by Live Analysis and Game Review so the move list
 * behaves identically in both: a bordered region that owns the vertical space
 * of its parent (the side panel) and scrolls its contents internally.
 */
export function MoveListPane({
  children,
  dataTestId,
}: {
  readonly children: React.ReactNode;
  readonly dataTestId?: string;
}): React.JSX.Element {
  return (
    <div
      className={styles.pane}
      role="region"
      aria-label="Moves"
      {...(dataTestId !== undefined ? { 'data-testid': dataTestId } : {})}
    >
      {children}
    </div>
  );
}
