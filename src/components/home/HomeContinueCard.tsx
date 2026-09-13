import type * as React from 'react';
import { Link } from 'react-router-dom';
import { trainingCyclePath, trainingSetPath } from '@/app/routes';
import type { HomeContinueTarget } from '@/presentation/home';
import styles from './HomeContinueCard.module.css';

export interface HomeContinueCardProps {
  readonly target: HomeContinueTarget;
  /** Solved/total of the running cycle, when known (never fabricated). */
  readonly progress?: { readonly completed: number; readonly total: number } | null;
}

type ResolvedTarget = Exclude<HomeContinueTarget, { kind: 'none' }>;

function hrefFor(target: ResolvedTarget): string {
  return target.kind === 'cycle'
    ? trainingCyclePath(target.setId, target.cycleNumber)
    : trainingSetPath(target.setId);
}

function statusFor(target: HomeContinueTarget): string {
  switch (target.kind) {
    case 'cycle':
      return target.quickTrain
        ? 'Quick train — pick up at the next unanswered puzzle.'
        : `Cycle ${target.cycleNumber} in progress — pick up at the next unanswered puzzle.`;
    case 'block':
      return 'Open block — start the next cycle.';
    case 'set':
      return 'Continue this set.';
    case 'none':
      return '';
  }
}

/**
 * The "continue training" landmark: shown only when a target resolves. It names
 * the target, shows one line of status and links to the existing host page
 * (which owns the resume action). It never fabricates a progress number.
 */
export function HomeContinueCard({
  target,
  progress,
}: HomeContinueCardProps): React.JSX.Element | null {
  if (target.kind === 'none') {
    return null;
  }
  const percent =
    progress != null && progress.total > 0
      ? Math.round((progress.completed / progress.total) * 100)
      : 0;
  return (
    <section className={styles.card} aria-label="Continue training" data-testid="home-continue">
      <div className={styles.header}>
        <h2 className={styles.heading}>Continue training</h2>
        <span className={styles.pill}>In progress</span>
      </div>
      <p className={styles.label} data-testid="home-continue-label">
        {target.label}
      </p>
      <p className={styles.status} data-testid="home-continue-status">
        {statusFor(target)}
      </p>
      {progress != null && progress.total > 0 ? (
        <div className={styles.progress}>
          <div
            className={styles.progressBar}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.completed}
            aria-label={`${progress.completed} of ${progress.total} puzzles solved`}
            data-testid="home-continue-progress"
          >
            <div className={styles.progressFill} style={{ width: `${percent}%` }} />
          </div>
          <span className={styles.progressLabel} data-testid="home-continue-progress-label">
            {progress.completed} of {progress.total} solved
          </span>
        </div>
      ) : null}
      <Link className={styles.link} to={hrefFor(target)} data-testid="home-continue-link">
        Continue
      </Link>
    </section>
  );
}
