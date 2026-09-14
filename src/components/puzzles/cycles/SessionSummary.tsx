import type * as React from 'react';
import { Button } from '@/components/ui/Button';
import { formatSolveTime } from '@/components/puzzles/solve/solveText';
import type { SessionSummary as SessionSummaryData } from '@/domain/training';
import { formatPercent } from './labels';
import styles from './SessionSummary.module.css';

/** One extra labelled summary row (Feature 020 review metrics). */
export interface SessionSummaryExtraRow {
  readonly label: string;
  readonly value: string;
  readonly testId: string;
}

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
  /** Panel heading; defaults to the Feature-019 "Session summary". */
  readonly title?: string;
  /** Intro copy; defaults to the Feature-019 text. */
  readonly description?: string;
  /** Label for the remaining-puzzles row; defaults to "Cycle puzzles remaining". */
  readonly remainingLabel?: string;
  /** Resume-button label; defaults to "Resume cycle". */
  readonly resumeLabel?: string;
  /** Back-button label; defaults to "Back to training". */
  readonly backLabel?: string;
  /** Extra labelled rows appended to the summary grid (Feature 020 review). */
  readonly extraRows?: readonly SessionSummaryExtraRow[];
}

/**
 * The ephemeral end-of-session summary (Feature 019 §5): result counts, first-try
 * accuracy, time used, average time per puzzle and remaining cycle puzzles, with
 * Resume cycle / Back to training actions and a View cycle results action when
 * the cycle completed before the timer. Rates with no definite row show `—`.
 *
 * Feature 020 reuses it for the review session via the optional `title`/
 * `description`/labels/`extraRows`; every new prop defaults to the Feature-019
 * behaviour.
 */
export function SessionSummary({
  summary,
  remainingPuzzles,
  cycleCompleted,
  onResume,
  onBack,
  onViewResults,
  testId = 'session-summary',
  title = 'Session summary',
  description = 'This training session has ended. The cycle stays resumable — nothing was lost.',
  remainingLabel = 'Cycle puzzles remaining',
  resumeLabel = 'Resume cycle',
  backLabel = 'Back to training',
  extraRows,
}: SessionSummaryProps): React.JSX.Element {
  const solved = summary.solvedFirstTry + summary.solvedWithHelp;

  return (
    <section className={styles.panel} data-testid={testId} aria-labelledby={`${testId}-title`}>
      <h2 className={styles.title} id={`${testId}-title`}>
        {title}
      </h2>
      <p className={styles.text}>{description}</p>
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
          label={remainingLabel}
          value={String(remainingPuzzles)}
          testId={`${testId}-remaining`}
        />
        {extraRows?.map((row) => (
          <Row key={row.testId} label={row.label} value={row.value} testId={row.testId} />
        ))}
      </dl>
      <div className={styles.actions}>
        <Button data-testid={`${testId}-resume`} onClick={onResume}>
          {resumeLabel}
        </Button>
        <Button variant="secondary" data-testid={`${testId}-back`} onClick={onBack}>
          {backLabel}
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
