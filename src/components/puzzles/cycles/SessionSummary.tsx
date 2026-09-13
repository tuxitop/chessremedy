import type * as React from 'react';
import { Button } from '@/components/ui/Button';
import { formatSolveTime } from '@/components/puzzles/solve/solveText';
import type { SessionSummary as SessionSummaryData } from '@/domain/training';
import { formatPercent } from './labels';
import styles from './SessionSummary.module.css';

export interface SessionSummaryProps {
  /** The ephemeral session projection derived from the session's attempt rows. */
  readonly summary: SessionSummaryData;
  /** Cycle puzzles still queued under the canonical completion predicate. */
  readonly remainingPuzzles: number;
  /** True when the cycle completed before the timer. */
  readonly cycleCompleted: boolean;
  readonly onResume: () => void;
  readonly onBack: () => void;
  readonly onViewResults?: () => void;
  readonly testId?: string;
}

/**
 * The ephemeral end-of-session summary (Feature 019 §5): result counts, first-try
 * accuracy, time used, average time per puzzle and remaining cycle puzzles, with
 * Resume cycle / Back to training actions and a View cycle results action when
 * the cycle completed before the timer. Rates with no definite row show `—`.
 */
export function SessionSummary({
  summary,
  remainingPuzzles,
  cycleCompleted,
  onResume,
  onBack,
  onViewResults,
  testId = 'session-summary',
}: SessionSummaryProps): React.JSX.Element {
  const solved = summary.solvedFirstTry + summary.solvedWithHelp;

  return (
    <section className={styles.panel} data-testid={testId} aria-labelledby={`${testId}-title`}>
      <h2 className={styles.title} id={`${testId}-title`}>
        Session summary
      </h2>
      <p className={styles.text}>
        This training session has ended. The cycle stays resumable — nothing was lost.
      </p>
      <dl className={styles.grid}>
        <Row label="Solved" value={String(solved)} testId={`${testId}-solved`} />
        <Row
          label="Solved first-try"
          value={String(summary.solvedFirstTry)}
          testId={`${testId}-first-try`}
        />
        <Row
          label="Solved with help"
          value={String(summary.solvedWithHelp)}
          testId={`${testId}-solved-with-help`}
        />
        <Row label="Failed" value={String(summary.failed)} testId={`${testId}-failed`} />
        <Row label="Skipped" value={String(summary.skipped)} testId={`${testId}-skipped`} />
        <Row
          label="First-try accuracy"
          value={formatPercent(summary.firstTryAccuracy) ?? '—'}
          testId={`${testId}-accuracy`}
        />
        <Row
          label="Time used"
          value={formatSolveTime(summary.totalTimeMs)}
          testId={`${testId}-time`}
        />
        <Row
          label="Average time per puzzle"
          value={summary.averageTimeMs === null ? '—' : formatSolveTime(summary.averageTimeMs)}
          testId={`${testId}-average`}
        />
        <Row
          label="Cycle puzzles remaining"
          value={String(remainingPuzzles)}
          testId={`${testId}-remaining`}
        />
      </dl>
      <div className={styles.actions}>
        <Button data-testid={`${testId}-resume`} onClick={onResume}>
          Resume cycle
        </Button>
        <Button variant="secondary" data-testid={`${testId}-back`} onClick={onBack}>
          Back to training
        </Button>
        {cycleCompleted ? (
          <Button data-testid={`${testId}-view-results`} onClick={onViewResults}>
            View cycle results
          </Button>
        ) : null}
      </div>
    </section>
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
