import type * as React from 'react';
import type { CycleMetrics } from '@/domain/training';
import { formatDurationMs, formatPercent } from './labels';
import styles from './CycleMetricsPanel.module.css';

export interface CycleMetricsPanelProps {
  /** The canonical cycle aggregates (shared with Feature 014). */
  readonly metrics: CycleMetrics;
  readonly testId?: string;
}

/**
 * The canonical cycle aggregates with their sample sizes. Rate/time aggregates
 * are `empty` (never `0`) when no puzzle is definite; counts are always exact.
 */
export function CycleMetricsPanel({
  metrics,
  testId = 'cycle-metrics',
}: CycleMetricsPanelProps): React.JSX.Element {
  const completed = metrics.puzzlesCompleted;
  return (
    <dl className={styles.grid} data-testid={testId}>
      <Row
        label="Puzzles attempted"
        value={String(metrics.puzzlesAttempted)}
        testId={`${testId}-attempted`}
      />
      <Row
        label="Puzzles completed"
        value={String(metrics.puzzlesCompleted)}
        testId={`${testId}-completed`}
      />
      <Row
        label="Puzzles skipped"
        value={String(metrics.puzzlesSkipped)}
        testId={`${testId}-skipped`}
      />
      <Row
        label="First-try accuracy"
        value={rateText(metrics.firstTryAccuracy, completed)}
        testId={`${testId}-first-try`}
      />
      <Row
        label="Solve rate"
        value={rateText(metrics.solveRate, completed)}
        testId={`${testId}-solve-rate`}
      />
      <Row
        label="Presentations"
        value={String(metrics.totalPresentations)}
        testId={`${testId}-presentations`}
      />
      <Row
        label="Wrong moves"
        value={String(metrics.totalWrongMoves)}
        testId={`${testId}-wrong-moves`}
      />
      <Row
        label="Hints used"
        value={`${metrics.hintsUsed} on ${metrics.puzzlesRequiringHint} ${
          metrics.puzzlesRequiringHint === 1 ? 'puzzle' : 'puzzles'
        }`}
        testId={`${testId}-hints`}
      />
      <Row
        label="Retries"
        value={`${metrics.retries} on ${metrics.puzzlesRequiringRetry} ${
          metrics.puzzlesRequiringRetry === 1 ? 'puzzle' : 'puzzles'
        }`}
        testId={`${testId}-retries`}
      />
      <Row
        label="Total solving time"
        value={
          metrics.solvingTime.totalMs === 0 && completed === 0
            ? 'empty'
            : formatDurationMs(metrics.solvingTime.totalMs)
        }
        testId={`${testId}-total-time`}
      />
      <Row
        label="Average solving time"
        value={timeText(metrics.solvingTime.averageMs, completed)}
        testId={`${testId}-average-time`}
      />
      <Row
        label="Median solving time"
        value={timeText(metrics.solvingTime.medianMs, completed)}
        testId={`${testId}-median-time`}
      />
    </dl>
  );
}

function Row({
  label,
  value,
  testId,
}: {
  readonly label: string;
  readonly value: string;
  readonly testId: string;
}): React.JSX.Element {
  return (
    <div className={styles.row}>
      <dt className={styles.label}>{label}</dt>
      <dd className={styles.value} data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

/** A rate with its sample size, or `empty` when no puzzle is definite. */
function rateText(value: number | null, sample: number): string {
  const formatted = formatPercent(value);
  return formatted === null ? 'empty' : `${formatted} (n = ${sample} completed)`;
}

/** A time with its sample size, or `empty` when no puzzle is definite. */
function timeText(value: number | null, sample: number): string {
  return value === null ? 'empty' : `${formatDurationMs(value)} (n = ${sample} completed)`;
}
