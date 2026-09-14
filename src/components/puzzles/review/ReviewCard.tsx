import type * as React from 'react';
import { formatPercent } from '@/components/puzzles/cycles';
import { InfoCard, type InfoCardAction, type InfoCardRow } from '@/components/ui/InfoCard';
import { formatRelativeDue } from '@/presentation/review/relativeTime';
import type { ReviewOverview } from '@/domain/review';
import styles from './ReviewCard.module.css';

export interface ReviewCardProps {
  /** The derived review overview, or `null` while loading. */
  readonly overview: ReviewOverview | null;
  /** True once the overview has loaded (loading copy otherwise). */
  readonly isReady?: boolean;
  /** A load failure to surface in place of the counts. */
  readonly error?: string | null;
  /** Current instant, Unix epoch millis (for the relative next-due text). */
  readonly now: number;
  /** The review session route; defaults to `/training/review`. */
  readonly to?: string;
}

/**
 * The Training-home review entry card (Feature 020 §1): due/new counts,
 * retention and next due with explicit empty/insufficient-data states, and a
 * real `Start review` control that is disabled with an explanation when the
 * queue is empty. Counts are text, never colour-only. It shares the `InfoCard`
 * structure with the resume-cycle and continue-training cards.
 */
export function ReviewCard({
  overview,
  isReady = true,
  error = null,
  now,
  to = '/training/review',
}: ReviewCardProps): React.JSX.Element {
  const titleId = 'review-card-title';

  if (error !== null) {
    return (
      <InfoCard title="Review" titleId={titleId} testId="review-card">
        <p className={styles.error} role="alert" data-testid="review-error">
          {error}
        </p>
      </InfoCard>
    );
  }

  if (overview === null || !isReady) {
    return (
      <InfoCard title="Review" titleId={titleId} testId="review-card">
        <p className={styles.muted} data-testid="review-loading">
          Loading your review queue…
        </p>
      </InfoCard>
    );
  }

  const dueShown = overview.queue.filter((entry) => entry.kind === 'review').length;
  const newShown = overview.queue.filter((entry) => entry.kind === 'new').length;
  const empty = overview.queue.length === 0;
  const retentionLabel =
    overview.retention === null
      ? 'Not enough data yet'
      : (formatPercent(overview.retention) ?? '—');
  const nextDueLabel =
    overview.nextDueAt !== null
      ? `Next review ${formatRelativeDue(overview.nextDueAt, now)}`
      : newShown > 0
        ? 'New puzzles available'
        : 'Nothing scheduled';

  const rows: readonly InfoCardRow[] = [
    {
      label: 'Due now',
      value:
        overview.dueNow > dueShown
          ? `${dueShown} (${overview.dueNow} due in total)`
          : String(dueShown),
      testId: 'review-due',
    },
    { label: 'New', value: String(newShown), testId: 'review-new' },
    { label: 'Retention', value: retentionLabel, testId: 'review-retention' },
    { label: 'Next due', value: nextDueLabel, testId: 'review-next-due' },
  ];

  const action: InfoCardAction = {
    label: 'Start review',
    to,
    testId: 'review-start',
    disabled: empty,
    ...(empty
      ? {
          note: 'Start review is unavailable until something is due or new puzzles are available.',
          noteTestId: 'review-start-note',
        }
      : {}),
  };

  return (
    <InfoCard
      title="Review"
      titleId={titleId}
      testId="review-card"
      pill={{ label: empty ? 'All caught up' : 'Due now', muted: empty, testId: 'review-pill' }}
      description="Resurface puzzles right before you would forget them, scheduled per puzzle."
      rows={rows}
      action={action}
    >
      {empty ? (
        <p className={styles.empty} data-testid="review-empty">
          All caught up — nothing is due and no new puzzles are waiting today.
        </p>
      ) : null}
    </InfoCard>
  );
}
