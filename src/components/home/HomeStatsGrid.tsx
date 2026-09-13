import type * as React from 'react';
import { Link } from 'react-router-dom';
import { ROUTES } from '@/app/routes';
import { cycleStatusLabel } from '@/components/puzzles/cycles/labels';
import type { Aggregate, GameMetricsPartition } from '@/domain/statistics';
import type {
  HomeBlockData,
  HomeGameData,
  HomeMasteryData,
  HomeSlice,
  HomeTrainingData,
} from '@/hooks/useHome';
import {
  aggregateDisplay,
  formatAccuracyDisplay,
  formatCount,
  partitionKey,
  partitionLabel,
  type AggregateValueFormatter,
} from '@/presentation/dashboard';
import {
  HOME_PREVIOUS_WINDOW_LABEL,
  HOME_STATS_WINDOW_LABEL,
  selectPrimaryPartition,
} from '@/presentation/home';
import { HomeEmptyState } from './HomeEmptyState';
import { HomeStatCard } from './HomeStatCard';
import styles from './HomeStatsGrid.module.css';

export interface HomeStatsGridProps {
  readonly game: HomeSlice<HomeGameData>;
  readonly training: HomeSlice<HomeTrainingData>;
  readonly mastery: HomeSlice<HomeMasteryData>;
  readonly block: HomeSlice<HomeBlockData>;
  readonly onRetry: () => void;
}

/** Per-game error rates are shown with one decimal (presentation rounding). */
const formatPerGame: AggregateValueFormatter = (value) => value.toFixed(1);

/**
 * The Home at-a-glance grid. Each card owns its honest loading/error state and
 * every value comes from Feature 014 (or the canonical Feature-013 mastery) via
 * the Feature-015 display helpers. First-run (no games) is replaced by a single
 * explicit empty state.
 */
export function HomeStatsGrid({
  game,
  training,
  mastery,
  block,
  onRetry,
}: HomeStatsGridProps): React.JSX.Element {
  const partition = game.data === null ? null : selectPrimaryPartition(game.data.partitions);
  const previousPartition =
    partition === null || game.data === null
      ? null
      : (game.data.previousPartitions.find(
          (candidate) =>
            partitionKey(candidate.platform, candidate.timeControl) ===
            partitionKey(partition.platform, partition.timeControl),
        ) ?? null);
  const firstRun = game.data !== null && game.data.totalGames === 0;

  return (
    <section className={styles.section} aria-label="Training vitals" data-testid="home-stats">
      <h2 className={styles.heading}>Training vitals</h2>
      {firstRun ? (
        <HomeEmptyState />
      ) : (
        <div className={styles.groups}>
          <dl className={styles.grid}>
            <GamesAnalyzedCard game={game} partition={partition} onRetry={onRetry} />
            <AccuracyCard
              game={game}
              partition={partition}
              previous={previousPartition}
              onRetry={onRetry}
            />
            <MasteryCard mastery={mastery} onRetry={onRetry} />
            <BlockCard training={training} block={block} onRetry={onRetry} />
          </dl>
          {partition !== null ? (
            <dl className={styles.rates}>
              <RateCard
                label="Blunders per game"
                aggregate={partition.metrics.classification.blundersPerGame}
                previous={previousPartition?.metrics.classification.blundersPerGame ?? null}
                higherIsBetter={false}
                testId="home-stat-blunders"
              />
              <RateCard
                label="Missed tactics per game"
                aggregate={partition.metrics.missedTactics.missedTacticsPerGame}
                previous={previousPartition?.metrics.missedTactics.missedTacticsPerGame ?? null}
                higherIsBetter={false}
                testId="home-stat-missed-tactics"
              />
            </dl>
          ) : null}
        </div>
      )}
    </section>
  );
}

function GamesAnalyzedCard({
  game,
  partition,
  onRetry,
}: {
  readonly game: HomeSlice<HomeGameData>;
  readonly partition: GameMetricsPartition | null;
  readonly onRetry: () => void;
}): React.JSX.Element {
  if (game.loading) {
    return <HomeStatCard label="Games analyzed" testId="home-stat-games" loading />;
  }
  if (game.error !== null) {
    return (
      <HomeStatCard
        label="Games analyzed"
        testId="home-stat-games"
        error={game.error}
        onRetry={onRetry}
      />
    );
  }
  if (partition === null) {
    return (
      <HomeStatCard label="Games analyzed" testId="home-stat-games">
        <span className={styles.placeholder} data-testid="home-stat-games-empty">
          No recent games
        </span>
        <Link className={styles.cardLink} to={ROUTES.statistics}>
          View statistics
        </Link>
      </HomeStatCard>
    );
  }
  const { analyzed, total } = partition.metrics.games;
  return (
    <HomeStatCard label="Games analyzed" testId="home-stat-games">
      {analyzed === 0 ? (
        <span className={styles.placeholder} data-testid="home-stat-games-none">
          No analyses yet
        </span>
      ) : (
        <span className={styles.value} data-testid="home-stat-games-value">
          {formatCount(analyzed)} of {formatCount(total)} analyzed
        </span>
      )}
      <span className={styles.meta} data-testid="home-stat-games-partition">
        {partitionLabel(partition.platform, partition.timeControl)} · {HOME_STATS_WINDOW_LABEL}
      </span>
    </HomeStatCard>
  );
}

function AccuracyCard({
  game,
  partition,
  previous,
  onRetry,
}: {
  readonly game: HomeSlice<HomeGameData>;
  readonly partition: GameMetricsPartition | null;
  readonly previous: GameMetricsPartition | null;
  readonly onRetry: () => void;
}): React.JSX.Element {
  if (game.loading) {
    return <HomeStatCard label="Accuracy" testId="home-stat-accuracy" loading />;
  }
  if (game.error !== null) {
    return (
      <HomeStatCard
        label="Accuracy"
        testId="home-stat-accuracy"
        error={game.error}
        onRetry={onRetry}
      />
    );
  }
  if (partition === null) {
    return (
      <HomeStatCard label="Accuracy" testId="home-stat-accuracy">
        <span className={styles.placeholder} data-testid="home-stat-accuracy-empty">
          No recent games
        </span>
      </HomeStatCard>
    );
  }
  const display = aggregateDisplay(partition.metrics.accuracy, formatAccuracyDisplay);
  return (
    <HomeStatCard label="Accuracy" testId="home-stat-accuracy">
      {display.hidden ? (
        <span className={styles.placeholder} data-testid="home-stat-accuracy-placeholder">
          {display.stateLabel}
        </span>
      ) : (
        <>
          <span className={styles.value} data-testid="home-stat-accuracy-value">
            {display.text}
          </span>
          <span className={styles.sample} data-testid="home-stat-accuracy-sample">
            {display.sampleLabel}
          </span>
          <Delta
            current={partition.metrics.accuracy}
            previous={previous?.metrics.accuracy ?? null}
            higherIsBetter
            testId="home-stat-accuracy-delta"
          />
        </>
      )}
    </HomeStatCard>
  );
}

function MasteryCard({
  mastery,
  onRetry,
}: {
  readonly mastery: HomeSlice<HomeMasteryData>;
  readonly onRetry: () => void;
}): React.JSX.Element {
  if (mastery.loading) {
    return <HomeStatCard label="Puzzles mastered" testId="home-stat-mastery" loading />;
  }
  if (mastery.error !== null) {
    return (
      <HomeStatCard
        label="Puzzles mastered"
        testId="home-stat-mastery"
        error={mastery.error}
        onRetry={onRetry}
      />
    );
  }
  const data = mastery.data;
  if (data === null || data.total === 0) {
    return (
      <HomeStatCard label="Puzzles mastered" testId="home-stat-mastery">
        <span className={styles.placeholder} data-testid="home-stat-mastery-empty">
          No puzzles yet
        </span>
      </HomeStatCard>
    );
  }
  return (
    <HomeStatCard label="Puzzles mastered" testId="home-stat-mastery">
      <span className={styles.value} data-testid="home-stat-mastery-value">
        {formatCount(data.mastered)} of {formatCount(data.total)} puzzles mastered
      </span>
    </HomeStatCard>
  );
}

function BlockCard({
  training,
  block,
  onRetry,
}: {
  readonly training: HomeSlice<HomeTrainingData>;
  readonly block: HomeSlice<HomeBlockData>;
  readonly onRetry: () => void;
}): React.JSX.Element {
  if (training.loading) {
    return <HomeStatCard label="Current block" testId="home-stat-block" loading />;
  }
  if (training.error !== null) {
    return (
      <HomeStatCard
        label="Current block"
        testId="home-stat-block"
        error={training.error}
        onRetry={onRetry}
      />
    );
  }
  if (training.data?.openBlock === null || training.data === null) {
    return (
      <HomeStatCard label="Current block" testId="home-stat-block">
        <span className={styles.placeholder} data-testid="home-stat-block-empty">
          No open block
        </span>
        <Link className={styles.cardLink} to={ROUTES.training}>
          Go to Training
        </Link>
      </HomeStatCard>
    );
  }
  if (block.error !== null) {
    return (
      <HomeStatCard
        label="Current block"
        testId="home-stat-block"
        error={block.error}
        onRetry={onRetry}
      />
    );
  }
  if (block.loading || block.data === null) {
    return <HomeStatCard label="Current block" testId="home-stat-block" loading />;
  }
  const stats = block.data.stats;
  const current = stats.currentCycle;
  if (current === null) {
    return (
      <HomeStatCard label="Current block" testId="home-stat-block">
        <span className={styles.placeholder} data-testid="home-stat-block-not-started">
          Not started
        </span>
      </HomeStatCard>
    );
  }
  return (
    <HomeStatCard label="Current block" testId="home-stat-block">
      <span className={styles.value} data-testid="home-stat-block-value">
        Cycle {current.cycleNumber} · {current.metrics.puzzlesCompleted} of {stats.puzzleCount}{' '}
        puzzles done
      </span>
      <span className={styles.meta} data-testid="home-stat-block-status">
        {cycleStatusLabel(current.status)}
        {current.partial ? ' · partial' : ''}
      </span>
    </HomeStatCard>
  );
}

function RateCard({
  label,
  aggregate,
  previous,
  higherIsBetter,
  testId,
}: {
  readonly label: string;
  readonly aggregate: Parameters<typeof aggregateDisplay>[0];
  readonly previous: Aggregate | null;
  readonly higherIsBetter: boolean;
  readonly testId: string;
}): React.JSX.Element {
  const display = aggregateDisplay(aggregate, formatPerGame);
  return (
    <HomeStatCard label={label} testId={testId}>
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
          <Delta
            current={aggregate}
            previous={previous}
            higherIsBetter={higherIsBetter}
            testId={`${testId}-delta`}
          />
        </>
      )}
    </HomeStatCard>
  );
}

/**
 * A week-over-week delta between two `ok` aggregates. Renders nothing unless
 * both sides have a usable `ok` value, so a short/missing previous sample never
 * shows a misleading change; a negligible difference reads as "no change".
 */
function Delta({
  current,
  previous,
  higherIsBetter,
  testId,
}: {
  readonly current: Aggregate;
  readonly previous: Aggregate | null;
  readonly higherIsBetter: boolean;
  readonly testId: string;
}): React.JSX.Element | null {
  if (current.state !== 'ok' || previous === null || previous.state !== 'ok') {
    return null;
  }
  const currentValue = current.value;
  const previousValue = previous.value;
  if (currentValue === null || previousValue === null) {
    return null;
  }
  const diff = currentValue - previousValue;
  if (Math.abs(diff) < 0.05) {
    return (
      <span className={styles.delta} data-testid={testId}>
        No change vs {HOME_PREVIOUS_WINDOW_LABEL}
      </span>
    );
  }
  const improved = higherIsBetter ? diff > 0 : diff < 0;
  return (
    <span
      className={`${styles.delta} ${improved ? styles.deltaGood : styles.deltaBad}`}
      data-testid={testId}
    >
      {diff > 0 ? '+' : '−'}
      {Math.abs(diff).toFixed(1)} vs {HOME_PREVIOUS_WINDOW_LABEL}
    </span>
  );
}
