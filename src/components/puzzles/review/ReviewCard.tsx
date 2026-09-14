import type * as React from 'react';
import { Link } from 'react-router-dom';
import { formatPercent } from '@/components/puzzles/cycles';
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
 * queue is empty. Counts are text, never colour-only.
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
      <section className={styles.card} data-testid="review-card" aria-labelledby={titleId}>
        <h2 className={styles.title} id={titleId}>
          Review
        </h2>
        <p className={styles.error} role="alert" data-testid="review-error">
          {error}
        </p>
      </section>
    );
  }

  if (overview === null || !isReady) {
    return (
      <section className={styles.card} data-testid="review-card" aria-labelledby={titleId}>
        <h2 className={styles.title} id={titleId}>
          Review
        </h2>
        <p className={styles.text} data-testid="review-loading">
          Loading your review queue…
        </p>
      </section>
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

  return (
    <section className={styles.card} data-testid="review-card" aria-labelledby={titleId}>
      <div className={styles.header}>
        <h2 className={styles.title} id={titleId}>
          Review
        </h2>
        <p className={styles.text}>
          Resurface puzzles right before you would forget them, scheduled per puzzle.
        </p>
      </div>

      {empty ? (
        <p className={styles.empty} data-testid="review-empty">
          All caught up — nothing is due and no new puzzles are waiting today.
        </p>
      ) : null}

      <dl className={styles.grid}>
        <Row
          label="Due now"
          value={
            overview.dueNow > dueShown
              ? `${dueShown} (${overview.dueNow} due in total)`
              : String(dueShown)
          }
          testId="review-due"
        />
        <Row label="New" value={String(newShown)} testId="review-new" />
        <Row label="Retention" value={retentionLabel} testId="review-retention" />
        <Row label="Next due" value={nextDueLabel} testId="review-next-due" />
      </dl>

      <div className={styles.actions}>
        <Link
          className={[styles.start, empty ? styles.startDisabled : ''].filter(Boolean).join(' ')}
          to={to}
          data-testid="review-start"
          aria-disabled={empty}
          tabIndex={empty ? -1 : undefined}
          onClick={(event) => {
            if (empty) {
              event.preventDefault();
            }
          }}
        >
          Start review
        </Link>
        {empty ? (
          <span className={styles.note} data-testid="review-start-note">
            Start review is unavailable until something is due or new puzzles are available.
          </span>
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
