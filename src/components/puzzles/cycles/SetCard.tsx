import type * as React from 'react';
import { Link } from 'react-router-dom';
import type { TacticalTrainingSetRow, TrainingCycleRow } from '@/domain/training';
import { cycleStatusLabel, formatTimestamp } from './labels';
import styles from './SetCard.module.css';

export interface SetCardProps {
  readonly set: TacticalTrainingSetRow;
  /** Stored membership count; `0` renders an explicit empty state, not a fake count. */
  readonly puzzleCount: number;
  /** The latest cycle of the set (highest cycle number), if any. */
  readonly cycle: TrainingCycleRow | null;
  /** Latest activity timestamp (cycle or set update); `null` when there is none. */
  readonly lastActivityAt: number | null;
  /** Route to the set detail page. */
  readonly to: string;
  /** Optional textual badge (e.g. `Auto`) shown next to the set name. */
  readonly badge?: string;
  /** Optional short note under the title (e.g. the auto-set refresh note). */
  readonly note?: string;
  /**
   * Text shown in place of the count when `puzzleCount` is `0`. Defaults to
   * `No puzzles yet`; an auto set whose pool is fully mastered passes
   * `All puzzles mastered` so the absence is never a bare `0`.
   */
  readonly emptyCountLabel?: string;
}

/**
 * One training-set card for the training home. Deliberate card layout (not a
 * shrunk table); absent data is stated in words — a set with no puzzles, no
 * cycles or no activity never renders a bare `0`.
 */
export function SetCard({
  set,
  puzzleCount,
  cycle,
  lastActivityAt,
  to,
  badge,
  note,
  emptyCountLabel,
}: SetCardProps): React.JSX.Element {
  const activity = formatTimestamp(lastActivityAt);
  return (
    <article className={styles.card} data-testid={`set-card-${set.id}`}>
      <h2 className={styles.title}>
        {badge !== undefined ? (
          <span className={styles.badge} data-testid={`set-card-badge-${set.id}`}>
            {badge}
          </span>
        ) : null}
        <Link className={styles.link} to={to} data-testid={`set-card-open-${set.id}`}>
          {set.name}
        </Link>
      </h2>
      {note !== undefined ? (
        <p className={styles.note} data-testid={`set-card-note-${set.id}`}>
          {note}
        </p>
      ) : null}
      <dl className={styles.facts}>
        <div className={styles.row}>
          <dt>Puzzles</dt>
          <dd data-testid={`set-card-count-${set.id}`}>
            {puzzleCount === 0
              ? (emptyCountLabel ?? 'No puzzles yet')
              : `${puzzleCount} ${puzzleCount === 1 ? 'puzzle' : 'puzzles'}`}
          </dd>
        </div>
        <div className={styles.row}>
          <dt>Current cycle</dt>
          <dd data-testid={`set-card-cycle-${set.id}`}>
            {cycle === null
              ? 'No cycles yet'
              : `Cycle ${cycle.cycleNumber} · ${cycleStatusLabel(cycle.status)}`}
          </dd>
        </div>
        <div className={styles.row}>
          <dt>Last activity</dt>
          <dd data-testid={`set-card-activity-${set.id}`}>
            {activity === null ? 'No activity yet' : activity}
          </dd>
        </div>
      </dl>
    </article>
  );
}
