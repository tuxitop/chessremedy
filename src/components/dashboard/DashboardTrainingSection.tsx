import { useState } from 'react';
import type * as React from 'react';
import { CycleComparison, CycleMetricsPanel, cycleStatusLabel } from '@/components/puzzles/cycles';
import type {
  Aggregate,
  CategoryStats,
  CycleStats,
  RepeatedlyFailedPuzzle,
  TrainingSetStats,
} from '@/domain/statistics';
import { cycleTimeGoal, type CycleComparison as CycleComparisonData } from '@/domain/training';
import type { DashboardSlice, DashboardTrainingAnalysis } from '@/hooks/useDashboard';
import {
  formatAccuracyDisplay,
  formatCount,
  formatDashboardTime,
  formatPercentValue,
  formatSample,
  weakestCategoryLabel,
} from '@/presentation/dashboard';
import type { DataTableColumn } from './DataTable';
import { ChartCard } from './ChartCard';
import { DashboardLoadError, DashboardLoading, DashboardNoTraining } from './DashboardStates';
import { RepeatedlyFailedList } from './RepeatedlyFailedList';
import { TrainingSetSelector } from './TrainingSetSelector';
import { CycleTrendChart, type CycleChartPoint } from './charts/CycleTrendChart';
import { WeakestCategoriesChart, type WeakestCategoryPoint } from './charts/WeakestCategoriesChart';
import { chartStateFromPoints, chartStateLabel } from './charts/chartState';
import styles from './DashboardTrainingSection.module.css';

type AccuracyMetric = 'firstTryAccuracy' | 'solveRate';
type TimeMetric = 'total' | 'average' | 'median';
type HintMetric = 'hintsUsed' | 'puzzlesRequiringHint';
type RetryMetric = 'retries' | 'puzzlesRequiringRetry';
type CompletionMetric = 'completed' | 'skipped';

export interface DashboardTrainingSectionProps {
  /** The set-scoped training slices from `useDashboard`. */
  readonly training: DashboardTrainingAnalysis;
  onSelectSet(setId: string | null): void;
  readonly onRetry?: () => void;
  /** Fixed chart size override for tests. */
  readonly chartWidth?: number;
  readonly chartHeight?: number;
  readonly testId?: string;
}

/** One per-cycle point from a Feature-014 `Aggregate` (non-`ok` → gap). */
function aggregatePoint(stats: CycleStats, aggregate: Aggregate): CycleChartPoint {
  return {
    cycleNumber: stats.cycleNumber,
    label: `Cycle ${stats.cycleNumber}`,
    value: aggregate.state === 'ok' ? aggregate.value : null,
    state: aggregate.state,
    n: aggregate.sample.n,
  };
}

/**
 * One per-cycle count point. Counts are always exact (Feature 013), so a cycle
 * with no attempts shows a real `0`; the sample is the cycle's attempted
 * puzzles.
 */
function countPoint(stats: CycleStats, value: number): CycleChartPoint {
  return {
    cycleNumber: stats.cycleNumber,
    label: `Cycle ${stats.cycleNumber}`,
    value,
    state: 'ok',
    n: stats.metrics.puzzlesAttempted,
  };
}

/**
 * The current cycle's total solving time. `totalMs` is a real `0` when nothing
 * is definite, so the point's honest state is taken from the canonical
 * average/median aggregate (same sample) and a non-`ok` total is a gap.
 */
function totalTimePoint(stats: CycleStats): CycleChartPoint {
  const { average } = stats.solvingTime;
  return {
    cycleNumber: stats.cycleNumber,
    label: `Cycle ${stats.cycleNumber}`,
    value: average.state === 'ok' ? stats.solvingTime.totalMs : null,
    state: average.state,
    n: average.sample.n,
  };
}

function cycleCellText(
  point: CycleChartPoint | undefined,
  format: (value: number) => string,
): string {
  if (point === undefined) {
    return 'No data';
  }
  if (point.value !== null) {
    return `${format(point.value)} (${formatSample(point.n, 'puzzles')})`;
  }
  return chartStateLabel(point.state, point.n) ?? 'No data';
}

function cycleColumns(
  valueFormatter: (value: number) => string,
): readonly DataTableColumn<CycleChartPoint>[] {
  return [
    { key: 'cycle', header: 'Cycle', render: (point) => point.label },
    {
      key: 'value',
      header: 'Value',
      render: (point) => cycleCellText(point, valueFormatter),
    },
  ];
}

interface CycleChartCardProps {
  readonly title: string;
  readonly metricLabel: string;
  readonly points: readonly CycleChartPoint[];
  readonly kind: 'line' | 'bar';
  readonly valueFormatter: (value: number) => string;
  readonly chartWidth?: number;
  readonly chartHeight?: number;
  readonly testId: string;
}

/** One per-cycle chart with its own honest state, summary and data table. */
function CycleChartCard({
  title,
  metricLabel,
  points,
  kind,
  valueFormatter,
  chartWidth,
  chartHeight,
  testId,
}: CycleChartCardProps): React.JSX.Element {
  const state = chartStateFromPoints(points.map((point) => point.state));
  const plottable = points.filter((point) => point.state === 'ok').length;
  const insufficientN = points.reduce(
    (max, point) => (point.state === 'insufficient' ? Math.max(max, point.n) : max),
    0,
  );
  const summary = `${metricLabel} by cycle. ${plottable} of ${points.length} cycles plotted; cycles with too few puzzles are gaps.`;
  return (
    <ChartCard
      title={title}
      ariaLabel={`${title} chart, ${points.length} cycles`}
      summary={summary}
      state={state}
      sampleN={insufficientN}
      table={{
        caption: `${title} data`,
        columns: cycleColumns(valueFormatter),
        rows: points,
        rowKey: (point) => String(point.cycleNumber),
      }}
      testId={testId}
    >
      <CycleTrendChart
        points={points}
        kind={kind}
        valueFormatter={valueFormatter}
        {...(chartWidth !== undefined ? { width: chartWidth } : {})}
        {...(chartHeight !== undefined ? { height: chartHeight } : {})}
        testId={`${testId}-chart`}
      />
    </ChartCard>
  );
}

interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

interface SegmentedProps<T extends string> {
  readonly label: string;
  readonly options: readonly SegmentedOption<T>[];
  readonly value: T;
  onChange(value: T): void;
  readonly testIdPrefix: string;
}

/** Accessible single-select toggle group (state is text, never colour-only). */
function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  testIdPrefix,
}: SegmentedProps<T>): React.JSX.Element {
  return (
    <div className={styles.toggleGroup} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={value === option.value ? styles.active : styles.toggle}
          aria-pressed={value === option.value}
          data-testid={`${testIdPrefix}-${option.value}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function CurrentCycleCard({ stats }: { readonly stats: TrainingSetStats }): React.JSX.Element {
  const current = stats.currentCycle;
  if (current === null) {
    return (
      <section className={styles.card} data-testid="training-current-cycle">
        <h3 className={styles.cardTitle}>Current cycle</h3>
        <p className={styles.meta} data-testid="training-current-cycle-not-started">
          Not started — no cycle has been recorded for this set yet.
        </p>
      </section>
    );
  }
  return (
    <section className={styles.card} data-testid="training-current-cycle">
      <h3 className={styles.cardTitle}>Current cycle</h3>
      <p className={styles.statusRow}>
        <span data-testid="training-current-cycle-number">Cycle {current.cycleNumber}</span>
        {' · '}
        <span data-testid="training-current-cycle-status">{cycleStatusLabel(current.status)}</span>
      </p>
      {current.partial ? (
        <p className={styles.note} data-testid="training-current-cycle-partial">
          Partial cycle — still in progress, so these figures are incomplete.
        </p>
      ) : null}
      <p className={styles.progress} data-testid="training-current-cycle-progress">
        {current.metrics.puzzlesCompleted} of {stats.puzzleCount} puzzles completed ·{' '}
        {current.metrics.puzzlesSkipped} skipped
      </p>
      <CycleMetricsPanel metrics={current.metrics} testId="training-current-cycle-metrics" />
    </section>
  );
}

function RelativeDeltasCard({
  comparison,
}: {
  readonly comparison: CycleComparisonData;
}): React.JSX.Element {
  const rows = [
    { key: 'firstTryAccuracy', label: 'First-try accuracy' },
    { key: 'solveRate', label: 'Solve rate' },
    { key: 'solvingTimeTotalMs', label: 'Total solving time' },
    { key: 'solvingTimeAverageMs', label: 'Average solving time' },
  ] as const;
  return (
    <section className={styles.card} data-testid="training-relative-deltas">
      <h3 className={styles.cardTitle}>Relative change</h3>
      <p className={styles.note}>
        Measured change from the previous cycle of the same set. These are changes only — they do
        not show that training caused them.
      </p>
      <table className={styles.relativeTable}>
        <caption className={styles.srOnly}>
          Relative change compared with the previous cycle
        </caption>
        <thead>
          <tr>
            <th scope="col">Metric</th>
            <th scope="col">Relative change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const value = comparison.relativeDelta[row.key];
            return (
              <tr key={row.key}>
                <th scope="row">{row.label}</th>
                <td data-testid={`training-relative-${row.key}`}>
                  {value === null ? '—' : formatPercentValue(value, 1)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function WeakestCategoriesCard({
  categories,
  chartWidth,
  chartHeight,
}: {
  readonly categories: readonly CategoryStats[];
  readonly chartWidth?: number;
  readonly chartHeight?: number;
}): React.JSX.Element {
  const ranked = categories.filter((category) => category.ranked);
  const unranked = categories.filter((category) => !category.ranked);
  const points: readonly WeakestCategoryPoint[] = ranked.map((category) => ({
    category: category.category,
    label: weakestCategoryLabel(category.category),
    value: category.solveRate.state === 'ok' ? category.solveRate.value : null,
    state: category.solveRate.state,
    n: category.solveRate.sample.n,
  }));
  const state = chartStateFromPoints(points.map((point) => point.state));
  const summary =
    ranked.length > 0
      ? `${ranked.length} categories with at least 5 definite puzzles, lowest solve rate first.`
      : 'No category has at least 5 definite puzzles yet.';
  return (
    <>
      <ChartCard
        title="Weakest tactical categories"
        ariaLabel="Weakest tactical categories chart, horizontal bars of solve rate"
        summary={summary}
        state={state}
        table={{
          caption: 'Weakest tactical categories data',
          columns: [
            { key: 'category', header: 'Category', render: (point) => point.label },
            {
              key: 'solveRate',
              header: 'Solve rate',
              render: (point) =>
                point.value !== null
                  ? `${formatPercentValue(point.value)} (${formatSample(point.n, 'puzzles')})`
                  : (chartStateLabel(point.state, point.n) ?? 'No data'),
            },
          ],
          rows: points,
          rowKey: (point) => point.category,
        }}
        testId="training-weakest-categories"
      >
        <WeakestCategoriesChart
          points={points}
          valueFormatter={(value) => formatPercentValue(value)}
          {...(chartWidth !== undefined ? { width: chartWidth } : {})}
          {...(chartHeight !== undefined ? { height: chartHeight } : {})}
          testId="training-weakest-categories-chart"
        />
      </ChartCard>
      {unranked.length > 0 ? (
        <p className={styles.unranked} data-testid="training-unranked-categories">
          Not enough data (fewer than 5 definite puzzles):{' '}
          {unranked
            .map(
              (category) =>
                `${weakestCategoryLabel(category.category)} (n = ${category.definiteAttempts})`,
            )
            .join(', ')}
        </p>
      ) : null}
    </>
  );
}

function SectionShell({
  training,
  onSelectSet,
  testId,
  children,
}: {
  readonly training: DashboardTrainingAnalysis;
  onSelectSet(setId: string | null): void;
  readonly testId: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className={styles.section} aria-label="Training" data-testid={testId}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.heading}>Training</h2>
          <p className={styles.subtitle}>
            Set-scoped — game-analysis filters do not apply to these figures.
          </p>
        </div>
        {training.sets.length > 0 ||
        training.archivedSets.length > 0 ||
        training.openBlock !== null ? (
          <TrainingSetSelector
            sets={training.sets}
            archivedSets={training.archivedSets}
            openBlock={training.openBlock}
            value={training.selectedSetId}
            onSelect={onSelectSet}
            testId="training-set-selector"
          />
        ) : null}
      </div>
      {children}
    </section>
  );
}

/**
 * The set-scoped training section: current cycle, per-cycle accuracy, solving
 * time, hints/retries and completion, cross-cycle measured deltas, weakest
 * tactical categories and repeatedly failed puzzles. Every value comes from
 * the `useDashboard` training slices (Feature-014 results); the section only
 * maps them to display and never accepts a game filter.
 */
export function DashboardTrainingSection({
  training,
  onSelectSet,
  onRetry,
  chartWidth,
  chartHeight,
  testId = 'dashboard-training-section',
}: DashboardTrainingSectionProps): React.JSX.Element {
  const [accuracyMetric, setAccuracyMetric] = useState<AccuracyMetric>('firstTryAccuracy');
  const [timeMetric, setTimeMetric] = useState<TimeMetric>('total');
  const [hintMetric, setHintMetric] = useState<HintMetric>('hintsUsed');
  const [retryMetric, setRetryMetric] = useState<RetryMetric>('retries');
  const [completionMetric, setCompletionMetric] = useState<CompletionMetric>('completed');

  if (training.stats.loading && training.stats.data === null) {
    return (
      <SectionShell training={training} onSelectSet={onSelectSet} testId={testId}>
        <DashboardLoading label="Loading training statistics…" />
      </SectionShell>
    );
  }
  if (training.selectedSet === null && training.stats.data === null) {
    return (
      <SectionShell training={training} onSelectSet={onSelectSet} testId={testId}>
        <DashboardNoTraining />
      </SectionShell>
    );
  }
  if (training.stats.error !== null && training.stats.data === null) {
    return (
      <SectionShell training={training} onSelectSet={onSelectSet} testId={testId}>
        <DashboardLoadError
          message={training.stats.error}
          {...(onRetry !== undefined ? { onRetry } : {})}
        />
      </SectionShell>
    );
  }
  const stats = training.stats.data;
  if (stats === null) {
    return (
      <SectionShell training={training} onSelectSet={onSelectSet} testId={testId}>
        <DashboardLoading label="Loading training statistics…" />
      </SectionShell>
    );
  }

  const current = stats.currentCycle;
  const previous =
    stats.cycles.length >= 2 ? (stats.cycles[stats.cycles.length - 2] ?? null) : null;
  const goal = current !== null ? cycleTimeGoal(current.metrics, previous?.metrics ?? null) : null;
  const comparison = stats.crossCycleComparison;

  const accuracyPoints = stats.cycles.map((cycle) =>
    aggregatePoint(
      cycle,
      accuracyMetric === 'firstTryAccuracy' ? cycle.firstTryAccuracy : cycle.solveRate,
    ),
  );
  const timePoints = stats.cycles.map((cycle) => {
    if (timeMetric === 'total') {
      return totalTimePoint(cycle);
    }
    return aggregatePoint(
      cycle,
      timeMetric === 'average' ? cycle.solvingTime.average : cycle.solvingTime.median,
    );
  });
  const hintPoints = stats.cycles.map((cycle) =>
    countPoint(
      cycle,
      hintMetric === 'hintsUsed' ? cycle.metrics.hintsUsed : cycle.metrics.puzzlesRequiringHint,
    ),
  );
  const retryPoints = stats.cycles.map((cycle) =>
    countPoint(
      cycle,
      retryMetric === 'retries' ? cycle.metrics.retries : cycle.metrics.puzzlesRequiringRetry,
    ),
  );
  const completionPoints = stats.cycles.map((cycle) =>
    countPoint(
      cycle,
      completionMetric === 'completed'
        ? cycle.metrics.puzzlesCompleted
        : cycle.metrics.puzzlesSkipped,
    ),
  );

  const categoriesSlice: DashboardSlice<readonly CategoryStats[]> = training.categories;
  const failedSlice: DashboardSlice<readonly RepeatedlyFailedPuzzle[]> = training.failed;

  return (
    <SectionShell training={training} onSelectSet={onSelectSet} testId={testId}>
      <p className={styles.srOnly} role="status" aria-live="polite" data-testid={`${testId}-live`}>
        {training.selectedSet === null
          ? 'No training set selected.'
          : `Showing training set ${training.selectedSet.name}.`}
      </p>

      <div className={styles.cards}>
        <CurrentCycleCard stats={stats} />
        {comparison !== null && current !== null && previous !== null ? (
          <section className={styles.card} data-testid="training-improvement">
            <h3 className={styles.cardTitle}>Improvement over the previous cycle</h3>
            <CycleComparison
              comparison={comparison}
              currentCycleNumber={current.cycleNumber}
              previousCycleNumber={previous.cycleNumber}
              testId="training-cycle-comparison"
            />
          </section>
        ) : null}
        {comparison !== null ? <RelativeDeltasCard comparison={comparison} /> : null}
      </div>

      {goal !== null ? (
        <p className={styles.note} role="note" data-testid="training-time-goal">
          {timeGoalText(goal.targetMs, previous)}
        </p>
      ) : null}

      {stats.abandonedCycles.length > 0 ? (
        <p className={styles.note} data-testid="training-abandoned">
          Abandoned {stats.abandonedCycles.length === 1 ? 'cycle' : 'cycles'} (shown separately,
          never counted as completed):{' '}
          {stats.abandonedCycles.map((cycle) => cycle.cycleNumber).join(', ')}.
        </p>
      ) : null}

      <div className={styles.cards}>
        <div className={styles.chartBlock}>
          <Segmented<AccuracyMetric>
            label="Accuracy metric"
            options={[
              { value: 'firstTryAccuracy', label: 'First-try accuracy' },
              { value: 'solveRate', label: 'Solve rate' },
            ]}
            value={accuracyMetric}
            onChange={setAccuracyMetric}
            testIdPrefix="training-accuracy"
          />
          <CycleChartCard
            title="Accuracy by cycle"
            metricLabel={
              accuracyMetric === 'firstTryAccuracy' ? 'First-try accuracy' : 'Solve rate'
            }
            points={accuracyPoints}
            kind="line"
            valueFormatter={(value) => formatAccuracyDisplay(value)}
            {...(chartWidth !== undefined ? { chartWidth } : {})}
            {...(chartHeight !== undefined ? { chartHeight } : {})}
            testId="training-accuracy"
          />
        </div>

        <div className={styles.chartBlock}>
          <Segmented<TimeMetric>
            label="Solving-time metric"
            options={[
              { value: 'total', label: 'Total' },
              { value: 'average', label: 'Average' },
              { value: 'median', label: 'Median' },
            ]}
            value={timeMetric}
            onChange={setTimeMetric}
            testIdPrefix="training-time"
          />
          <CycleChartCard
            title="Solving time by cycle"
            metricLabel="Solving time"
            points={timePoints}
            kind="bar"
            valueFormatter={(value) => formatDashboardTime(value)}
            {...(chartWidth !== undefined ? { chartWidth } : {})}
            {...(chartHeight !== undefined ? { chartHeight } : {})}
            testId="training-time"
          />
        </div>

        <div className={styles.chartBlock}>
          <Segmented<HintMetric>
            label="Hints metric"
            options={[
              { value: 'hintsUsed', label: 'Hints used' },
              { value: 'puzzlesRequiringHint', label: 'Puzzles needing a hint' },
            ]}
            value={hintMetric}
            onChange={setHintMetric}
            testIdPrefix="training-hints"
          />
          <CycleChartCard
            title="Hints by cycle"
            metricLabel={hintMetric === 'hintsUsed' ? 'Hints used' : 'Puzzles needing a hint'}
            points={hintPoints}
            kind="bar"
            valueFormatter={formatCount}
            {...(chartWidth !== undefined ? { chartWidth } : {})}
            {...(chartHeight !== undefined ? { chartHeight } : {})}
            testId="training-hints"
          />
        </div>

        <div className={styles.chartBlock}>
          <Segmented<RetryMetric>
            label="Retries metric"
            options={[
              { value: 'retries', label: 'Retries' },
              { value: 'puzzlesRequiringRetry', label: 'Puzzles needing a retry' },
            ]}
            value={retryMetric}
            onChange={setRetryMetric}
            testIdPrefix="training-retries"
          />
          <CycleChartCard
            title="Retries by cycle"
            metricLabel={retryMetric === 'retries' ? 'Retries' : 'Puzzles needing a retry'}
            points={retryPoints}
            kind="bar"
            valueFormatter={formatCount}
            {...(chartWidth !== undefined ? { chartWidth } : {})}
            {...(chartHeight !== undefined ? { chartHeight } : {})}
            testId="training-retries"
          />
        </div>

        <div className={styles.chartBlock}>
          <Segmented<CompletionMetric>
            label="Completion metric"
            options={[
              { value: 'completed', label: 'Completed' },
              { value: 'skipped', label: 'Skipped' },
            ]}
            value={completionMetric}
            onChange={setCompletionMetric}
            testIdPrefix="training-completion"
          />
          <CycleChartCard
            title="Completion by cycle"
            metricLabel={completionMetric === 'completed' ? 'Puzzles completed' : 'Puzzles skipped'}
            points={completionPoints}
            kind="bar"
            valueFormatter={formatCount}
            {...(chartWidth !== undefined ? { chartWidth } : {})}
            {...(chartHeight !== undefined ? { chartHeight } : {})}
            testId="training-completion"
          />
        </div>
      </div>

      <div className={styles.cards}>
        {categoriesSlice.loading && categoriesSlice.data === null ? (
          <DashboardLoading label="Loading weakest categories…" />
        ) : categoriesSlice.error !== null && categoriesSlice.data === null ? (
          <DashboardLoadError
            message={categoriesSlice.error}
            {...(onRetry !== undefined ? { onRetry } : {})}
          />
        ) : (
          <WeakestCategoriesCard
            categories={categoriesSlice.data ?? []}
            {...(chartWidth !== undefined ? { chartWidth } : {})}
            {...(chartHeight !== undefined ? { chartHeight } : {})}
          />
        )}

        <section className={styles.card} data-testid="training-repeatedly-failed">
          <h3 className={styles.cardTitle}>Repeatedly failed puzzles</h3>
          <p className={styles.note}>
            Puzzles failed in two or more distinct cycles of this set. This is a progress signal
            only — it does not schedule anything.
          </p>
          {failedSlice.loading && failedSlice.data === null ? (
            <DashboardLoading label="Loading repeatedly failed puzzles…" />
          ) : failedSlice.error !== null && failedSlice.data === null ? (
            <DashboardLoadError
              message={failedSlice.error}
              {...(onRetry !== undefined ? { onRetry } : {})}
            />
          ) : (
            <RepeatedlyFailedList
              items={failedSlice.data ?? []}
              testId="training-repeatedly-failed-list"
            />
          )}
        </section>
      </div>
    </SectionShell>
  );
}

/** The time-halving guidance text; `targetMs` is `null` when undefined. */
function timeGoalText(targetMs: number | null, previous: CycleStats | null): string {
  if (targetMs !== null) {
    return `Time guidance: beat ${formatDashboardTime(targetMs)} — half the previous cycle's time. Guidance only, never a gate.`;
  }
  if (previous !== null) {
    return 'Time guidance: the previous cycle recorded no solving time, so there is no time target yet.';
  }
  return 'Time guidance: later cycles target beating half the previous cycle’s time. Guidance only, never a gate.';
}
