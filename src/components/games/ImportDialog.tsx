import type * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { GAME_SOURCE_LABELS } from '@/domain/chess/gameSource';
import type { ImportProvider } from '@/domain/import';
import type { ImportServiceLike } from '@/hooks/useGameImport';
import { Button } from '@/components/ui/Button';
import { ImportPanel } from './ImportPanel';
import styles from './ImportDialog.module.css';

export interface ImportDialogProps {
  readonly service: ImportServiceLike;
  /** Called when the user dismisses the dialog (Escape, ✕, or backdrop). */
  readonly onClose: () => void;
  /** Called after an import run finishes so the page can refresh its list. */
  readonly onImported: () => void;
}

const PROVIDERS: readonly ImportProvider[] = ['chesscom', 'lichess'];

/**
 * Modal that hosts the single import form. The platform is chosen inside the
 * form (the rest of the fields are shared), so there is one dialog rather than
 * a separate panel per provider. Escape, the ✕ control and a backdrop click
 * all close it; focus moves into the dialog on open.
 */
export function ImportDialog({
  service,
  onClose,
  onImported,
}: ImportDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [provider, setProvider] = useState<ImportProvider>('chesscom');

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className={styles.overlay}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-dialog-title"
        data-testid="import-dialog"
        ref={dialogRef}
        tabIndex={-1}
      >
        <div className={styles.header}>
          <h2 className={styles.title} id="import-dialog-title">
            Import games
          </h2>
          <Button variant="ghost" data-testid="import-dialog-close" onClick={onClose}>
            Close
          </Button>
        </div>

        <label className={styles.providerField}>
          <span className={styles.providerLabel}>Platform</span>
          <select
            data-testid="import-provider"
            value={provider}
            onChange={(event) => setProvider(event.target.value as ImportProvider)}
          >
            {PROVIDERS.map((value) => (
              <option key={value} value={value}>
                {GAME_SOURCE_LABELS[value]}
              </option>
            ))}
          </select>
        </label>

        <ImportPanel
          provider={provider}
          service={service}
          onImported={onImported}
          showHeading={false}
        />
      </div>
    </div>
  );
}
