import type * as React from 'react';
import { Link } from 'react-router-dom';
import { trainingCyclePath, trainingSetPath } from '@/app/routes';
import type { HomeContinueTarget } from '@/presentation/home';
import styles from './HomeContinueCard.module.css';

export interface HomeContinueCardProps {
  readonly target: HomeContinueTarget;
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
export function HomeContinueCard({ target }: HomeContinueCardProps): React.JSX.Element | null {
  if (target.kind === 'none') {
    return null;
  }
  return (
    <section className={styles.card} aria-label="Continue training" data-testid="home-continue">
      <h2 className={styles.heading}>Continue training</h2>
      <p className={styles.label} data-testid="home-continue-label">
        {target.label}
      </p>
      <p className={styles.status} data-testid="home-continue-status">
        {statusFor(target)}
      </p>
      <Link className={styles.link} to={hrefFor(target)} data-testid="home-continue-link">
        Continue
      </Link>
    </section>
  );
}
