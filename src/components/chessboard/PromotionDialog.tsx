import { useEffect, useRef } from 'react';
import type * as React from 'react';
import { PIECE_SETS, type PieceSet } from './themes';
import styles from './PromotionDialog.module.css';

export type PromotionRole = 'queen' | 'rook' | 'bishop' | 'knight';

export interface PromotionDialogProps {
  open: boolean;
  /** Active piece set so the dialog renders the right SVGs. */
  pieceSet: PieceSet;
  onSelect: (role: PromotionRole) => void;
  onCancel: () => void;
}

const ROLE_TO_FILENAME: Record<PromotionRole, string> = {
  queen: 'queen-w.svg',
  rook: 'rook-w.svg',
  bishop: 'bishop-w.svg',
  knight: 'knight-w.svg',
};

const ROLE_ORDER: readonly PromotionRole[] = ['queen', 'rook', 'bishop', 'knight'];

/**
 * Centered modal over the board when a pawn-to-back-rank move is
 * attempted. Renders four piece-image buttons (Q / R / B / N) using
 * the active piece theme's white pieces. Q has default focus.
 * `Escape` calls `onCancel`.
 */
export function PromotionDialog({
  open,
  pieceSet,
  onSelect,
  onCancel,
}: PromotionDialogProps): React.JSX.Element | null {
  const firstButtonRef = useRef<HTMLButtonElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    firstButtonRef.current?.focus();

    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
    };
  }, [open, onCancel]);

  if (!open) {
    return null;
  }

  const pieceUrl = (role: PromotionRole): string =>
    `/vendor/pieces/${pieceSet}/${ROLE_TO_FILENAME[role]}`;

  return (
    <div
      className={styles.scrim}
      role="presentation"
      onClick={(event) => {
        if (event.target === containerRef.current) {
          onCancel();
        }
      }}
    >
      <div
        ref={containerRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label="Choose promotion piece"
        data-testid="promotion-dialog"
      >
        {ROLE_ORDER.map((role, index) => (
          <button
            key={role}
            type="button"
            className={styles.pieceButton}
            ref={index === 0 ? firstButtonRef : undefined}
            onClick={() => onSelect(role)}
            data-testid={`promotion-${role}`}
            aria-label={`Promote to ${role}`}
          >
            <img src={pieceUrl(role)} alt="" className={styles.pieceImage} width={64} height={64} />
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Resolves the active piece set. Always returns one of the 5 supported
 * sets. Public so callers can map a `PieceSet` to a fetcher URL.
 */
export function pieceUrlForRole(pieceSet: PieceSet, role: PromotionRole): string {
  return `/vendor/pieces/${pieceSet}/${ROLE_TO_FILENAME[role]}`;
}

export const PROMOTION_ROLES: readonly PromotionRole[] = ROLE_ORDER;
export const ALL_PIECE_SETS: readonly PieceSet[] = PIECE_SETS;
