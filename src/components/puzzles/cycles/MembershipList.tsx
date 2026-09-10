import { useState } from 'react';
import type * as React from 'react';
import type { DifficultyBucketName } from '@/domain/puzzle/buckets';
import type { PuzzleOrigin } from '@/domain/puzzle';
import { Button } from '@/components/ui/Button';
import styles from './MembershipList.module.css';

/** One row of a set's membership/pool preview, pre-resolved for display. */
export interface MembershipListItem {
  /** Canonical `puzzleIdOf` id. */
  readonly id: string;
  readonly sourceGameId: string;
  readonly sourcePly: number;
  /** Absent origin is tactical (pre-version-2 rows). */
  readonly origin: PuzzleOrigin;
  /** Human objective label (already resolved; blunder rows use the fixed label). */
  readonly objective: string;
  readonly difficulty: number;
  readonly difficultyBucket: DifficultyBucketName;
}

export interface MembershipListProps {
  readonly items: readonly MembershipListItem[];
  /** Rows rendered before the "Show more" control (mobile pagination). */
  readonly pageSize?: number;
  /** Message shown when there are no rows (never a bare count). */
  readonly emptyMessage: string;
  /** When provided, each row becomes a touch-friendly checkbox selection. */
  readonly selectedIds?: ReadonlySet<string>;
  readonly onToggle?: (id: string) => void;
  readonly testId: string;
  readonly ariaLabel: string;
}

/**
 * A paginated membership/pool list. On mobile only `pageSize` rows render at a
 * time with an explicit "Show more" control, so a set with hundreds of puzzles
 * never paints thousands of rows. When `selectedIds`/`onToggle` are supplied the
 * rows are labelled checkboxes (touch multi-select); otherwise they are
 * read-only facts.
 */
export function MembershipList({
  items,
  pageSize = 25,
  emptyMessage,
  selectedIds,
  onToggle,
  testId,
  ariaLabel,
}: MembershipListProps): React.JSX.Element {
  const [visible, setVisible] = useState(pageSize);
  const selectable = selectedIds !== undefined && onToggle !== undefined;

  if (items.length === 0) {
    return (
      <p className={styles.empty} data-testid={`${testId}-empty`}>
        {emptyMessage}
      </p>
    );
  }

  const shown = items.slice(0, visible);
  const remaining = items.length - shown.length;

  return (
    <div className={styles.wrap}>
      <ul className={styles.list} data-testid={testId} aria-label={ariaLabel}>
        {shown.map((item) => {
          const selected = selectedIds?.has(item.id) ?? false;
          const facts = (
            <>
              <span className={styles.provenance} data-testid={`${testId}-provenance-${item.id}`}>
                {item.sourceGameId} · ply {item.sourcePly}
              </span>
              <span className={styles.objective}>{item.objective}</span>
              <span className={styles.difficulty}>
                {item.difficultyBucket} · {item.difficulty}
              </span>
            </>
          );
          return (
            <li key={item.id} className={styles.item} data-testid={`${testId}-item-${item.id}`}>
              {selectable ? (
                <label className={styles.selectLabel}>
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => onToggle?.(item.id)}
                    data-testid={`${testId}-select-${item.id}`}
                  />
                  <span className={styles.facts}>{facts}</span>
                </label>
              ) : (
                <span className={styles.facts}>{facts}</span>
              )}
            </li>
          );
        })}
      </ul>
      {remaining > 0 ? (
        <Button
          variant="secondary"
          data-testid={`${testId}-more`}
          onClick={() => setVisible((current) => current + pageSize)}
        >
          Show {Math.min(remaining, pageSize)} more ({shown.length} of {items.length} shown)
        </Button>
      ) : null}
    </div>
  );
}
