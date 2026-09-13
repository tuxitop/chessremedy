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
  className,
}: {
  readonly children: React.ReactNode;
  readonly dataTestId?: string;
  /** Extra class(es) merged onto the pane (responsive overrides). */
  readonly className?: string | undefined;
}): React.JSX.Element {
  return (
    <div
      className={className !== undefined ? `${styles.pane} ${className}` : styles.pane}
      role="region"
      aria-label="Moves"
      {...(dataTestId !== undefined ? { 'data-testid': dataTestId } : {})}
    >
      {children}
    </div>
  );
}
