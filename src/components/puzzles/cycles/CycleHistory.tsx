import type * as React from 'react';
import { Link } from 'react-router-dom';
import type { TrainingCycleRow } from '@/domain/training';
import { cycleStatusLabel, formatPercent, formatTimestamp } from './labels';
import styles from './CycleHistory.module.css';

/** A cycle's progress summary rendered in its history row. */
export interface CycleHistoryProgress {
  readonly solved: number;
  readonly total: number;
  /** `firstTryAccuracy`, or `null` when the sample is empty. */
  readonly accuracy: number | null;
}

export interface CycleHistoryProps {
  readonly cycles: readonly TrainingCycleRow[];
  readonly emptyMessage: string;
  /**
   * Optional route builder for a cycle's results view. Omitted until the results
   * route exists, so no dead link is rendered.
   */
  readonly resultsPathFor?: (cycle: TrainingCycleRow) => string;
  /** Optional per-cycle progress; a cycle with no summary renders none. */
  readonly progressFor?: (cycle: TrainingCycleRow) => CycleHistoryProgress | null;
  readonly testId?: string;
}

/**
 * The set's cycle history: one textual row per cycle (number, status, timing).
 * Status is spelled out, never colour-only; completed, in-progress and
 * abandoned cycles are distinguishable without colour.
 */
export function CycleHistory({
  cycles,
  emptyMessage,
  resultsPathFor,
  progressFor,
  testId = 'cycle-history',
}: CycleHistoryProps): React.JSX.Element {
  if (cycles.length === 0) {
    return (
      <p className={styles.empty} data-testid={`${testId}-empty`}>
        {emptyMessage}
      </p>
    );
  }

  return (
    <ol className={styles.list} data-testid={testId}>
      {cycles.map((cycle) => {
        const resultsPath = resultsPathFor?.(cycle);
        const progress = progressFor?.(cycle) ?? null;
        return (
          <li
            key={cycle.id}
            className={styles.item}
            data-testid={`${testId}-cycle-${cycle.cycleNumber}`}
          >
            <div className={styles.head}>
              <span className={styles.number}>Cycle {cycle.cycleNumber}</span>
              <span className={styles.status} data-testid={`${testId}-status-${cycle.cycleNumber}`}>
                {cycleStatusLabel(cycle.status)}
              </span>
            </div>
            {progress !== null ? (
              <p
                className={styles.progress}
                data-testid={`${testId}-progress-${cycle.cycleNumber}`}
              >
                {progress.solved}/{progress.total} · {formatPercent(progress.accuracy) ?? '—'}
              </p>
            ) : null}
            <dl className={styles.times}>
              <div className={styles.timeRow}>
                <dt>Started</dt>
                <dd>{formatTimestamp(cycle.startedAt) ?? '—'}</dd>
              </div>
              {cycle.completedAt !== null ? (
                <div className={styles.timeRow}>
                  <dt>Completed</dt>
                  <dd>{formatTimestamp(cycle.completedAt) ?? '—'}</dd>
                </div>
              ) : null}
              {cycle.abandonedAt !== null ? (
                <div className={styles.timeRow}>
                  <dt>Abandoned</dt>
                  <dd>{formatTimestamp(cycle.abandonedAt) ?? '—'}</dd>
                </div>
              ) : null}
            </dl>
            {resultsPath !== undefined ? (
              <Link
                className={styles.resultsLink}
                to={resultsPath}
                data-testid={`${testId}-results-${cycle.cycleNumber}`}
              >
                View results
              </Link>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
