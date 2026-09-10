import { useEffect, useRef } from 'react';
import type * as React from 'react';
import { Button } from '@/components/ui/Button';
import styles from './ConfirmDialog.module.css';

export interface ConfirmDialogProps {
  /** Dialog heading; must name the object being acted on. */
  readonly title: string;
  /** Consequence sentence. */
  readonly message: string;
  /** Optional consequence facts (e.g. "3 cycles", "27 attempts"). */
  readonly details?: readonly string[];
  /** Label of the confirming (destructive) action. */
  readonly confirmLabel: string;
  readonly cancelLabel?: string;
  /** Stable test id prefix; the dialog and its controls derive their ids from it. */
  readonly testId: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/**
 * A destructive-action confirmation. A real modal `role="dialog"` that names the
 * object and spells out its consequences, with labelled Cancel/Confirm controls
 * (keyboard + touch). Escape cancels; focus moves into the dialog on open.
 */
export function ConfirmDialog({
  title,
  message,
  details,
  confirmLabel,
  cancelLabel = 'Cancel',
  testId,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onCancel();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${testId}-title`}
      aria-describedby={`${testId}-message`}
      data-testid={testId}
    >
      <div className={styles.dialog} ref={dialogRef} tabIndex={-1}>
        <h2 id={`${testId}-title`} className={styles.title}>
          {title}
        </h2>
        <p id={`${testId}-message`} className={styles.message}>
          {message}
        </p>
        {details && details.length > 0 ? (
          <ul className={styles.details} data-testid={`${testId}-details`}>
            {details.map((detail) => (
              <li key={detail}>{detail}</li>
            ))}
          </ul>
        ) : null}
        <div className={styles.actions}>
          <Button variant="secondary" data-testid={`${testId}-cancel`} onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button data-testid={`${testId}-confirm`} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
