import type * as React from 'react';
import type {
  CycleComparison as CycleComparisonData,
  CycleMetricKey,
  CycleMetricDeltas,
  CycleMetrics,
} from '@/domain/training';
import { formatDurationMs, formatPercent } from './labels';
import styles from './CycleComparison.module.css';

export interface CycleComparisonProps {
  /** The same-set cross-cycle comparison (measured deltas only). */
  readonly comparison: CycleComparisonData;
  readonly currentCycleNumber: number;
  readonly previousCycleNumber: number;
  readonly testId?: string;
}

type MetricKind = 'count' | 'percent' | 'duration';

interface ComparisonRow {
  readonly key: CycleMetricKey;
  readonly label: string;
  readonly kind: MetricKind;
}

/**
 * The comparison rows shown for two cycles of the same set. Each reports the
 * two measured values and their difference. No improvement or causation claim
 * is made.
 */
const ROWS: readonly ComparisonRow[] = [
  { key: 'firstTryAccuracy', label: 'First-try accuracy', kind: 'percent' },
  { key: 'solveRate', label: 'Solve rate', kind: 'percent' },
  { key: 'puzzlesCompleted', label: 'Puzzles completed', kind: 'count' },
  { key: 'puzzlesSkipped', label: 'Puzzles skipped', kind: 'count' },
  { key: 'totalWrongMoves', label: 'Wrong moves', kind: 'count' },
  { key: 'hintsUsed', label: 'Hints used', kind: 'count' },
  { key: 'retries', label: 'Retries', kind: 'count' },
  { key: 'solvingTimeAverageMs', label: 'Average solving time', kind: 'duration' },
  { key: 'solvingTimeMedianMs', label: 'Median solving time', kind: 'duration' },
];

/**
 * Same-set cross-cycle comparison: the measured value in each cycle and their
 * difference. It never claims the training method caused the change.
 */
export function CycleComparison({
  comparison,
  currentCycleNumber,
  previousCycleNumber,
  testId = 'cycle-comparison',
}: CycleComparisonProps): React.JSX.Element {
  return (
    <div className={styles.wrap} data-testid={testId}>
      <p className={styles.note} data-testid={`${testId}-note`}>
        Measured differences between these two cycles of the same set only — they do not show that
        training caused any change.
      </p>
      <table className={styles.table}>
        <caption className={styles.caption}>
          Cycle {currentCycleNumber} compared with cycle {previousCycleNumber}
        </caption>
        <thead>
          <tr>
            <th scope="col">Metric</th>
            <th scope="col">Cycle {currentCycleNumber}</th>
            <th scope="col">Cycle {previousCycleNumber}</th>
            <th scope="col">Change</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <tr key={row.key} data-testid={`${testId}-row-${row.key}`}>
              <th scope="row" className={styles.metric}>
                {row.label}
              </th>
              <td data-testid={`${testId}-current-${row.key}`}>
                {valueText(metricValue(comparison.current, row.key), row.kind)}
              </td>
              <td data-testid={`${testId}-previous-${row.key}`}>
                {valueText(metricValue(comparison.previous, row.key), row.kind)}
              </td>
              <td data-testid={`${testId}-delta-${row.key}`}>
                {deltaText(comparison.absoluteDelta, row.key, row.kind)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Read one comparable value out of a `CycleMetrics`. */
function metricValue(metrics: CycleMetrics, key: CycleMetricKey): number | null {
  switch (key) {
    case 'puzzlesAttempted':
      return metrics.puzzlesAttempted;
    case 'puzzlesCompleted':
      return metrics.puzzlesCompleted;
    case 'puzzlesSkipped':
      return metrics.puzzlesSkipped;
    case 'firstTryAccuracy':
      return metrics.firstTryAccuracy;
    case 'solveRate':
      return metrics.solveRate;
    case 'totalPresentations':
      return metrics.totalPresentations;
    case 'totalWrongMoves':
      return metrics.totalWrongMoves;
    case 'hintsUsed':
      return metrics.hintsUsed;
    case 'puzzlesRequiringHint':
      return metrics.puzzlesRequiringHint;
    case 'retries':
      return metrics.retries;
    case 'puzzlesRequiringRetry':
      return metrics.puzzlesRequiringRetry;
    case 'solvingTimeTotalMs':
      return metrics.solvingTime.totalMs;
    case 'solvingTimeAverageMs':
      return metrics.solvingTime.averageMs;
    case 'solvingTimeMedianMs':
      return metrics.solvingTime.medianMs;
    default:
      return null;
  }
}

/** Format a measured value; `null` is an empty sample. */
function valueText(value: number | null, kind: MetricKind): string {
  if (value === null) {
    return 'empty';
  }
  if (kind === 'duration') {
    return formatDurationMs(value);
  }
  if (kind === 'percent') {
    return formatPercent(value) ?? 'empty';
  }
  return String(value);
}

/** Format an absolute delta for display; `null` is an undefined difference. */
function deltaText(deltas: CycleMetricDeltas, key: CycleMetricKey, kind: MetricKind): string {
  const delta = deltas[key];
  if (delta === null) {
    return '—';
  }
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
  if (kind === 'duration') {
    return `${sign}${formatDurationMs(Math.abs(delta))}`;
  }
  if (kind === 'percent') {
    return `${sign}${Math.round(Math.abs(delta) * 100)}%`;
  }
  return `${sign}${Math.abs(delta)}`;
}
