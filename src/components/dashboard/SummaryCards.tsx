import type * as React from 'react';
import type { Aggregate, GameMetrics } from '@/domain/statistics';
import {
  aggregateDisplay,
  formatAccuracyDisplay,
  formatCount,
  formatSample,
  type AggregateValueFormatter,
} from '@/presentation/dashboard';
import styles from './SummaryCards.module.css';

export interface SummaryCardsProps {
  /** The canonical Feature-014 metrics for one concrete partition. */
  readonly metrics: GameMetrics;
  /** Human label of the partition these cards belong to. */
  readonly partitionLabel: string;
  readonly testId?: string;
}

/** Per-game error rates are shown with one decimal (presentation rounding). */
function formatPerGame(value: number): string {
  return value.toFixed(1);
}

/**
 * The headline game-analysis aggregates for one partition. Every aggregate card
 * uses the honest-state mapping (`aggregateDisplay`) and shows its `n`; an
 * `insufficient`/`empty`/`notDetected` aggregate hides the value and shows the
 * explicit placeholder instead of a fabricated zero.
 */
export function SummaryCards({
  metrics,
  partitionLabel,
  testId = 'summary-cards',
}: SummaryCardsProps): React.JSX.Element {
  return (
    <div className={styles.wrap} data-testid={testId}>
      <h3 className={styles.partition} data-testid={`${testId}-partition`}>
        {partitionLabel}
      </h3>
      <dl className={styles.grid}>
        <CountCard label="Games" value={metrics.games.total} testId={`${testId}-games-total`} />
        <CountCard
          label="Analyzed"
          value={metrics.games.analyzed}
          testId={`${testId}-games-analyzed`}
        />
        <CountCard
          label="Detected"
          value={metrics.games.detected}
          testId={`${testId}-games-detected`}
        />
        <AggregateCard
          label="Accuracy"
          aggregate={metrics.accuracy}
          format={formatAccuracyDisplay}
          testId={`${testId}-accuracy`}
        />
        <AggregateCard
          label="Inaccuracies per game"
          aggregate={metrics.classification.inaccuraciesPerGame}
          format={formatPerGame}
          testId={`${testId}-inaccuracies-per-game`}
        />
        <AggregateCard
          label="Mistakes per game"
          aggregate={metrics.classification.mistakesPerGame}
          format={formatPerGame}
          testId={`${testId}-mistakes-per-game`}
        />
        <AggregateCard
          label="Blunders per game"
          aggregate={metrics.classification.blundersPerGame}
          format={formatPerGame}
          testId={`${testId}-blunders-per-game`}
        />
        <AggregateCard
          label="Missed tactics per game"
          aggregate={metrics.missedTactics.missedTacticsPerGame}
          format={formatPerGame}
          testId={`${testId}-missed-tactics-per-game`}
        />
        <AggregateCard
          label="Median blunders per game"
          aggregate={metrics.classification.medianBlundersPerGame}
          format={formatPerGame}
          testId={`${testId}-median-blunders-per-game`}
        />
      </dl>
    </div>
  );
}

function CountCard({
  label,
  value,
  testId,
}: {
  readonly label: string;
  readonly value: number;
  readonly testId: string;
}): React.JSX.Element {
  return (
    <div className={styles.card} data-testid={testId} data-state="count">
      <dt className={styles.cardLabel}>{label}</dt>
      <dd className={styles.cardValue}>
        <span className={styles.value}>{formatCount(value)}</span>
        <span className={styles.sample}>{formatSample(value, 'games')}</span>
      </dd>
    </div>
  );
}

function AggregateCard({
  label,
  aggregate,
  format,
  testId,
}: {
  readonly label: string;
  readonly aggregate: Aggregate;
  readonly format: AggregateValueFormatter;
  readonly testId: string;
}): React.JSX.Element {
  const display = aggregateDisplay(aggregate, format);
  return (
    <div className={styles.card} data-testid={testId} data-state={display.state}>
      <dt className={styles.cardLabel}>{label}</dt>
      <dd className={styles.cardValue}>
        {display.hidden ? (
          <span className={styles.placeholder} data-testid={`${testId}-placeholder`}>
            {display.stateLabel}
          </span>
        ) : (
          <>
            <span className={styles.value} data-testid={`${testId}-value`}>
              {display.text}
            </span>
            <span className={styles.sample} data-testid={`${testId}-sample`}>
              {display.sampleLabel}
            </span>
          </>
        )}
      </dd>
    </div>
  );
}
