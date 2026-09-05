import type * as React from 'react';
import styles from './IconButton.module.css';

export interface IconButtonProps {
  /** Accessible label; also used as the tooltip title. */
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly ariaExpanded?: boolean;
  readonly dataTestId?: string;
  readonly className?: string;
  readonly children: React.ReactNode;
}

/** Square icon-only button (primary icon actions in the Library toolbar). */
export function IconButton({
  label,
  onClick,
  disabled = false,
  ariaExpanded,
  dataTestId,
  className,
  children,
}: IconButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      className={`${styles.iconButton}${className ? ` ${className}` : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-expanded={ariaExpanded}
      title={label}
      {...(dataTestId !== undefined ? { 'data-testid': dataTestId } : {})}
    >
      {children}
    </button>
  );
}
