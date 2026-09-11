import type * as React from 'react';
import { Link } from 'react-router-dom';
import type { RepeatedlyFailedPuzzle } from '@/domain/statistics';
import { formatDashboardDate } from '@/presentation/dashboard';
import type { DataTableColumn } from './DataTable';
import { DataTable } from './DataTable';
import styles from './RepeatedlyFailedList.module.css';

export interface RepeatedlyFailedListProps {
  /** Puzzles failed in at least two distinct cycles of the selected set. */
  readonly items: readonly RepeatedlyFailedPuzzle[];
  readonly testId?: string;
}

/**
 * Compact list of puzzles failed in `>= 2` distinct cycles. Each row links to
 * the puzzle's source-game view (the existing `/games/:id/puzzles` route). This
 * is a progress signal only — it carries no scheduling language and schedules
 * nothing (ADR-031).
 */
export function RepeatedlyFailedList({
  items,
  testId = 'repeatedly-failed',
}: RepeatedlyFailedListProps): React.JSX.Element {
  if (items.length === 0) {
    return (
      <p className={styles.empty} data-testid={`${testId}-empty`}>
        No puzzle has been failed in two or more cycles of this set.
      </p>
    );
  }

  const columns: readonly DataTableColumn<RepeatedlyFailedPuzzle>[] = [
    {
      key: 'puzzle',
      header: 'Puzzle',
      render: (item) => (
        <Link className={styles.link} to={`/games/${item.sourceGameId}/puzzles`}>
          {item.puzzleId}
        </Link>
      ),
    },
    { key: 'failures', header: 'Failures', render: (item) => String(item.failureCount) },
    { key: 'cycles', header: 'Cycles', render: (item) => String(item.cycleCount) },
    {
      key: 'lastFailed',
      header: 'Last failed',
      render: (item) => formatDashboardDate(item.lastFailedAt),
    },
  ];

  return (
    <DataTable
      caption="Puzzles failed in two or more cycles"
      columns={columns}
      rows={items}
      rowKey={(item) => item.puzzleId}
      testId={testId}
    />
  );
}
