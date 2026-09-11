import { useState } from 'react';
import type * as React from 'react';
import type {
  PhaseMetrics,
  PlatformDimension,
  TimeControlDimension,
  TrendGranularity,
} from '@/domain/statistics';
import type {
  DashboardGameAnalysis,
  DashboardSlice,
  DashboardTrendComputation,
} from '@/hooks/useDashboard';
import type {
  MergedTrendRow,
  MergedTrendSeries,
  RatingChartPoint,
  TrendChartPoint,
} from '@/presentation/dashboard';
import {
  ERROR_METRIC_LABELS,
  defaultPartitionValue,
  formatAccuracyDisplay,
  formatCount,
  formatDashboardDate,
  formatRating,
  formatSample,
  mergeTrendSeries,
  partitionKey,
  partitionLabel,
  partitionOptions,
  phaseLabel,
  ratingToChartPoints,
} from '@/presentation/dashboard';
import type { DataTableColumn } from './DataTable';
import { ChartCard } from './ChartCard';
import { DashboardEmpty, DashboardLoadError, DashboardLoading } from './DashboardStates';
import { PartitionSelector } from './PartitionSelector';
import { SummaryCards } from './SummaryCards';
import {
  PhaseErrorsChart,
  type PhaseErrorCell,
  type PhaseErrorRow,
} from './charts/PhaseErrorsChart';
import { RatingProgressChart } from './charts/RatingProgressChart';
import { TrendLineChart } from './charts/TrendLineChart';
import { chartStateFromPoints, chartStateLabel } from './charts/chartState';
import type { ChartErrorClass } from './charts/useChartTheme';
import styles from './DashboardGameSection.module.css';

const PHASE_ERROR_CLASSES: readonly ChartErrorClass[] = [
  'inaccuracies',
  'mistakes',
  'blunders',
  'missedTactics',
];

type PhaseMetricField = 'errorsPer100Moves' | 'counts';

type PartitionFilter = (platform: PlatformDimension, timeControl: TimeControlDimension) => boolean;

export interface DashboardGameSectionProps {
  /** The game-analysis slices from `useDashboard`. */
  readonly game: DashboardGameAnalysis;
  readonly granularity?: TrendGranularity;
  readonly onRetry?: () => void;
  /** Fixed chart size override for tests. */
  readonly chartWidth?: number;
  readonly chartHeight?: number;
  readonly testId?: string;
}

function formatPerGame(value: number): string {
  return value.toFixed(1);
}

function buildTrendLookup(
  series: readonly MergedTrendSeries[],
): ReadonlyMap<string, ReadonlyMap<string, TrendChartPoint>> {
  return new Map(
    series.map((entry) => [
      entry.key,
      new Map(entry.points.map((point) => [point.periodKey, point])),
    ]),
  );
}

function trendCellText(
  point: TrendChartPoint | undefined,
  format: (value: number) => string,
): string {
  if (point === undefined) {
    return 'No data';
  }
  if (point.value !== null) {
    return `${format(point.value)} (${formatSample(point.n, point.unit)})`;
  }
  return chartStateLabel(point.state, point.n) ?? 'No data';
}

function trendColumns(
  series: readonly MergedTrendSeries[],
  lookup: ReadonlyMap<string, ReadonlyMap<string, TrendChartPoint>>,
  format: (value: number) => string,
): readonly DataTableColumn<MergedTrendRow>[] {
  return [
    { key: 'period', header: 'Period', render: (row) => String(row.periodKey ?? '') },
    ...series.map((entry) => ({
      key: entry.key,
      header: partitionLabel(entry.platform, entry.timeControl),
      render: (row: MergedTrendRow) => {
        const periodKey = String(row.periodKey ?? '');
        return trendCellText(lookup.get(entry.key)?.get(periodKey), format);
      },
    })),
  ];
}

function phaseRows(
  phases: readonly PhaseMetrics[],
  field: PhaseMetricField,
): readonly PhaseErrorRow[] {
  return phases.map((phase) => {
    const metrics = phase[field];
    const cells = {} as Record<ChartErrorClass, PhaseErrorCell>;
    for (const key of PHASE_ERROR_CLASSES) {
      const aggregate = metrics[key];
      cells[key] = { value: aggregate.value, state: aggregate.state, n: aggregate.sample.n };
    }
    return { phase: phase.phase, label: phaseLabel(phase.phase), cells };
  });
}

function phaseCellText(cell: PhaseErrorCell, field: PhaseMetricField): string {
  if (cell.value !== null) {
    const value = field === 'errorsPer100Moves' ? cell.value.toFixed(1) : formatCount(cell.value);
    return `${value} (${formatSample(cell.n, 'moves')})`;
  }
  return chartStateLabel(cell.state, cell.n) ?? 'No data';
}

interface TrendCardProps {
  readonly title: string;
  readonly metricLabel: string;
  readonly slice: DashboardSlice<DashboardTrendComputation>;
  readonly isVisible: PartitionFilter;
  readonly valueFormatter: (value: number) => string;
  readonly granularity: TrendGranularity;
  readonly onRetry?: () => void;
  readonly chartWidth?: number;
  readonly chartHeight?: number;
  readonly testId: string;
}

/** One trend chart with its own independent loading/error/empty state. */
function TrendCard({
  title,
  metricLabel,
  slice,
  isVisible,
  valueFormatter,
  granularity,
  onRetry,
  chartWidth,
  chartHeight,
  testId,
}: TrendCardProps): React.JSX.Element {
  if (slice.loading && slice.data === null) {
    return <DashboardLoading label={`Loading ${metricLabel}…`} />;
  }
  if (slice.error !== null && slice.data === null) {
    return (
      <DashboardLoadError message={slice.error} {...(onRetry !== undefined ? { onRetry } : {})} />
    );
  }
  const report = slice.data;
  if (report === null) {
    return <DashboardLoading label={`Loading ${metricLabel}…`} />;
  }
  const visible = report.series.filter((entry) => isVisible(entry.platform, entry.timeControl));
  const merged = mergeTrendSeries(visible);
  const lookup = buildTrendLookup(merged.series);
  const columns = trendColumns(merged.series, lookup, valueFormatter);
  const states = merged.series.flatMap((entry) => entry.points.map((point) => point.state));
  const state = chartStateFromPoints(states);
  const insufficientN = merged.series
    .flatMap((entry) => entry.points)
    .reduce((max, point) => (point.state === 'insufficient' ? Math.max(max, point.n) : max), 0);
  const plottable = merged.series.reduce(
    (total, entry) => total + entry.points.filter((point) => point.state === 'ok').length,
    0,
  );
  const totalPoints = merged.series.reduce((total, entry) => total + entry.points.length, 0);
  const summary = `${metricLabel} by ${granularity}. ${plottable} of ${totalPoints} plotted points have enough data; other periods are gaps.`;

  return (
    <ChartCard
      title={title}
      ariaLabel={`${title} chart, ${granularity} periods, ${visible.length} partition(s)`}
      summary={summary}
      state={state}
      sampleN={insufficientN}
      table={{
        caption: `${title} data`,
        columns,
        rows: merged.rows,
        rowKey: (row) => String(row.periodKey ?? ''),
      }}
      testId={testId}
    >
      <TrendLineChart
        series={merged.series}
        rows={merged.rows}
        metricLabel={metricLabel}
        granularity={granularity}
        valueFormatter={valueFormatter}
        {...(chartWidth !== undefined ? { width: chartWidth } : {})}
        {...(chartHeight !== undefined ? { height: chartHeight } : {})}
        testId={`${testId}-chart`}
      />
    </ChartCard>
  );
}

/**
 * The game-analysis section: summary cards, rating progress (one chart per
 * concrete partition), accuracy/error trends and game-phase errors. All values
 * come from the `useDashboard` slices (Feature-014 results); the section only
 * maps them to display. Non-`ok` trend points are gaps; no value is computed.
 */
export function DashboardGameSection({
  game,
  granularity = 'week',
  onRetry,
  chartWidth,
  chartHeight,
  testId = 'dashboard-game-section',
}: DashboardGameSectionProps): React.JSX.Element {
  const partitions = game.metrics.data?.partitions ?? [];
  const options = partitionOptions(partitions);
  const [requestedPartition, setRequestedPartition] = useState<string | null>(null);
  const [phaseField, setPhaseField] = useState<PhaseMetricField>('errorsPer100Moves');

  // The default rendering is the first concrete partition (plan A1). `null`
  // means "not chosen yet"; an explicit `all` is preserved, and a concrete
  // choice that disappears falls back to the first concrete partition.
  const partition =
    requestedPartition === null
      ? defaultPartitionValue(options)
      : requestedPartition === 'all' ||
          options.some((option) => option.value === requestedPartition)
        ? requestedPartition
        : defaultPartitionValue(options);

  const isVisible: PartitionFilter =
    partition === 'all'
      ? () => true
      : (platform, timeControl) => partitionKey(platform, timeControl) === partition;

  if (game.metrics.loading && game.metrics.data === null) {
    return <DashboardLoading />;
  }
  if (game.metrics.error !== null && game.metrics.data === null) {
    return (
      <DashboardLoadError
        message={game.metrics.error}
        {...(onRetry !== undefined ? { onRetry } : {})}
      />
    );
  }
  const report = game.metrics.data;
  if (report === null) {
    return <DashboardLoading />;
  }
  if (report.partitions.length === 0) {
    return <DashboardEmpty />;
  }

  const visiblePartitions = report.partitions.filter((entry) =>
    isVisible(entry.platform, entry.timeControl),
  );
  const histories = (game.ratings.data?.histories ?? []).filter((entry) =>
    isVisible(entry.platform, entry.timeControl),
  );
  const phasePartitions = (game.phases.data?.partitions ?? []).filter((entry) =>
    isVisible(entry.platform, entry.timeControl),
  );

  return (
    <section className={styles.section} aria-label="Game analysis" data-testid={testId}>
      <div className={styles.header}>
        <h2 className={styles.heading}>Game analysis</h2>
        <PartitionSelector
          options={options}
          value={partition}
          onChange={setRequestedPartition}
          testId="dashboard-partition"
        />
      </div>

      <div className={styles.summaries}>
        {visiblePartitions.map((entry) => {
          const key = `${entry.platform}-${entry.timeControl}`;
          return (
            <SummaryCards
              key={key}
              metrics={entry.metrics}
              partitionLabel={partitionLabel(entry.platform, entry.timeControl)}
              testId={`summary-${key}`}
            />
          );
        })}
      </div>

      <div className={styles.charts}>
        {game.ratings.loading && game.ratings.data === null ? (
          <DashboardLoading label="Loading rating histories…" />
        ) : null}
        {game.ratings.error !== null && game.ratings.data === null ? (
          <DashboardLoadError
            message={game.ratings.error}
            {...(onRetry !== undefined ? { onRetry } : {})}
          />
        ) : null}
        {histories.map((history) => {
          const key = `${history.platform}-${history.timeControl}`;
          const points = ratingToChartPoints(history);
          const state = points.length > 0 ? 'ok' : 'empty';
          const summary =
            points.length > 0
              ? `${points.length} rated games plotted over time.`
              : 'No rated, dated games for this partition.';
          return (
            <ChartCard
              key={key}
              title={`Rating progress — ${partitionLabel(history.platform, history.timeControl)}`}
              ariaLabel={`Rating progress chart for ${partitionLabel(history.platform, history.timeControl)}`}
              summary={summary}
              state={state}
              table={{
                caption: `Rating progress for ${partitionLabel(history.platform, history.timeControl)}`,
                columns: [
                  {
                    key: 'date',
                    header: 'Date',
                    render: (point: RatingChartPoint) => formatDashboardDate(point.x),
                  },
                  {
                    key: 'rating',
                    header: 'Rating',
                    render: (point: RatingChartPoint) => formatRating(point.y),
                  },
                ],
                rows: points,
                rowKey: (point) => point.gameId,
              }}
              testId={`rating-${key}`}
            >
              <RatingProgressChart
                points={points}
                {...(chartWidth !== undefined ? { width: chartWidth } : {})}
                {...(chartHeight !== undefined ? { height: chartHeight } : {})}
                testId={`rating-${key}-chart`}
              />
            </ChartCard>
          );
        })}

        <TrendCard
          title="Accuracy trend"
          metricLabel="Accuracy"
          slice={game.trends.accuracy}
          isVisible={isVisible}
          valueFormatter={(value) => formatAccuracyDisplay(value)}
          granularity={granularity}
          {...(onRetry !== undefined ? { onRetry } : {})}
          {...(chartWidth !== undefined ? { chartWidth } : {})}
          {...(chartHeight !== undefined ? { chartHeight } : {})}
          testId="trend-accuracy"
        />
        <TrendCard
          title="Inaccuracies per game"
          metricLabel="Inaccuracies per game"
          slice={game.trends.inaccuraciesPerGame}
          isVisible={isVisible}
          valueFormatter={formatPerGame}
          granularity={granularity}
          {...(onRetry !== undefined ? { onRetry } : {})}
          {...(chartWidth !== undefined ? { chartWidth } : {})}
          {...(chartHeight !== undefined ? { chartHeight } : {})}
          testId="trend-inaccuracies"
        />
        <TrendCard
          title="Mistakes per game"
          metricLabel="Mistakes per game"
          slice={game.trends.mistakesPerGame}
          isVisible={isVisible}
          valueFormatter={formatPerGame}
          granularity={granularity}
          {...(onRetry !== undefined ? { onRetry } : {})}
          {...(chartWidth !== undefined ? { chartWidth } : {})}
          {...(chartHeight !== undefined ? { chartHeight } : {})}
          testId="trend-mistakes"
        />
        <TrendCard
          title="Blunders per game"
          metricLabel="Blunders per game"
          slice={game.trends.blundersPerGame}
          isVisible={isVisible}
          valueFormatter={formatPerGame}
          granularity={granularity}
          {...(onRetry !== undefined ? { onRetry } : {})}
          {...(chartWidth !== undefined ? { chartWidth } : {})}
          {...(chartHeight !== undefined ? { chartHeight } : {})}
          testId="trend-blunders"
        />
        <TrendCard
          title="Missed tactics per game"
          metricLabel="Missed tactics per game"
          slice={game.trends.missedTacticsPerGame}
          isVisible={isVisible}
          valueFormatter={formatPerGame}
          granularity={granularity}
          {...(onRetry !== undefined ? { onRetry } : {})}
          {...(chartWidth !== undefined ? { chartWidth } : {})}
          {...(chartHeight !== undefined ? { chartHeight } : {})}
          testId="trend-missed-tactics"
        />

        {phasePartitions.length > 0 ? (
          <div className={styles.phaseControls} role="group" aria-label="Game-phase error metric">
            <button
              type="button"
              className={phaseField === 'errorsPer100Moves' ? styles.active : styles.toggle}
              aria-pressed={phaseField === 'errorsPer100Moves'}
              data-testid="phase-field-normalized"
              onClick={() => setPhaseField('errorsPer100Moves')}
            >
              Errors per 100 moves
            </button>
            <button
              type="button"
              className={phaseField === 'counts' ? styles.active : styles.toggle}
              aria-pressed={phaseField === 'counts'}
              data-testid="phase-field-counts"
              onClick={() => setPhaseField('counts')}
            >
              Counts
            </button>
          </div>
        ) : null}

        {game.phases.loading && game.phases.data === null ? (
          <DashboardLoading label="Loading game-phase metrics…" />
        ) : null}
        {game.phases.error !== null && game.phases.data === null ? (
          <DashboardLoadError
            message={game.phases.error}
            {...(onRetry !== undefined ? { onRetry } : {})}
          />
        ) : null}
        {phasePartitions.map((phasePartition) => {
          const key = `${phasePartition.platform}-${phasePartition.timeControl}`;
          const rows = phaseRows(phasePartition.phases, phaseField);
          const states = rows.flatMap((row) =>
            PHASE_ERROR_CLASSES.map((errorClass) => row.cells[errorClass].state),
          );
          const state = chartStateFromPoints(states);
          const insufficientN = rows
            .flatMap((row) => PHASE_ERROR_CLASSES.map((errorClass) => row.cells[errorClass]))
            .reduce(
              (max, cell) => (cell.state === 'insufficient' ? Math.max(max, cell.n) : max),
              0,
            );
          const valueLabel =
            phaseField === 'errorsPer100Moves' ? 'Errors per 100 moves' : 'Error counts';
          return (
            <ChartCard
              key={key}
              title={`Game-phase errors — ${partitionLabel(phasePartition.platform, phasePartition.timeControl)}`}
              ariaLabel={`Game-phase error chart for ${partitionLabel(phasePartition.platform, phasePartition.timeControl)}, ${valueLabel}`}
              summary={`${valueLabel} by opening, middlegame and endgame.`}
              state={state}
              sampleN={insufficientN}
              table={{
                caption: `Game-phase errors for ${partitionLabel(phasePartition.platform, phasePartition.timeControl)}`,
                columns: [
                  { key: 'phase', header: 'Phase', render: (row: PhaseErrorRow) => row.label },
                  ...PHASE_ERROR_CLASSES.map((errorClass) => ({
                    key: errorClass,
                    header: ERROR_METRIC_LABELS[errorClass],
                    render: (row: PhaseErrorRow) =>
                      phaseCellText(row.cells[errorClass], phaseField),
                  })),
                ],
                rows,
                rowKey: (row) => row.phase,
              }}
              testId={`phase-${key}`}
            >
              <PhaseErrorsChart
                rows={rows}
                valueLabel={valueLabel}
                valueFormatter={
                  phaseField === 'errorsPer100Moves' ? (value) => value.toFixed(1) : formatCount
                }
                {...(chartWidth !== undefined ? { width: chartWidth } : {})}
                {...(chartHeight !== undefined ? { height: chartHeight } : {})}
                testId={`phase-${key}-chart`}
              />
            </ChartCard>
          );
        })}
      </div>
    </section>
  );
}
