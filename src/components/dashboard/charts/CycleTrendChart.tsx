import type * as React from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { MetricState } from '@/domain/statistics';
import { chartStateLabel } from './chartState';
import { useChartTheme } from './useChartTheme';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';
import styles from './charts.module.css';

/** One per-cycle point: the metric value plus its honest state/sample. */
export interface CycleChartPoint {
  readonly cycleNumber: number;
  readonly label: string;
  readonly value: number | null;
  readonly state: MetricState;
  readonly n: number;
}

export interface CycleTrendChartProps {
  readonly points: readonly CycleChartPoint[];
  readonly kind: 'line' | 'bar';
  readonly valueFormatter?: (value: number) => string;
  readonly width?: number;
  readonly height?: number;
  readonly testId?: string;
}

interface CycleTooltipProps {
  readonly active?: boolean;
  readonly label?: string | number | undefined;
  readonly payload?: readonly { readonly value?: number }[];
  readonly points: readonly CycleChartPoint[];
  readonly valueFormatter: (value: number) => string;
}

function CycleTooltip({
  active,
  label,
  payload,
  points,
  valueFormatter,
}: CycleTooltipProps): React.JSX.Element | null {
  if (active !== true || payload === undefined || payload.length === 0) {
    return null;
  }
  const point = points.find((candidate) => candidate.label === label);
  const stateText = point ? chartStateLabel(point.state, point.n) : 'No data';
  const valueText =
    point !== undefined && point.value !== null
      ? valueFormatter(point.value)
      : (stateText ?? 'No data');
  return (
    <div className={styles.tooltip}>
      <p className={styles.tooltipTitle}>{String(label ?? '')}</p>
      <p className={styles.tooltipValue}>{valueText}</p>
    </div>
  );
}

/**
 * Generic per-cycle trend (line or bar) over caller-supplied points. Cycles
 * whose aggregate is not `ok` are gaps, never zero points; the points are built
 * by the caller from Feature-014 cycle aggregates.
 */
export function CycleTrendChart({
  points,
  kind,
  valueFormatter = (value) => String(value),
  width,
  height,
  testId = 'cycle-trend-chart',
}: CycleTrendChartProps): React.JSX.Element {
  const theme = useChartTheme();
  const prefersReducedMotion = usePrefersReducedMotion();
  const data = points.map((point) => ({
    label: point.label,
    value: point.value,
    cycleNumber: point.cycleNumber,
  }));
  const chartHeight = height ?? 240;

  const tooltip = (
    <Tooltip
      content={(props) => (
        <CycleTooltip
          active={props.active}
          label={props.label}
          payload={props.payload as unknown as readonly { readonly value?: number }[]}
          points={points}
          valueFormatter={valueFormatter}
        />
      )}
    />
  );

  const commonAxes = (
    <>
      <CartesianGrid stroke={theme.grid} strokeDasharray="3 3" />
      <XAxis dataKey="label" stroke={theme.axis} tick={{ fill: theme.axis, fontSize: 12 }} />
      <YAxis
        stroke={theme.axis}
        tick={{ fill: theme.axis, fontSize: 12 }}
        width={48}
        tickFormatter={(value: number) => valueFormatter(value)}
      />
    </>
  );

  const sizeProps = {
    ...(width !== undefined ? { width } : {}),
    ...(width !== undefined ? { height: chartHeight } : {}),
  };

  const chart =
    kind === 'bar' ? (
      <BarChart
        {...sizeProps}
        data={data}
        accessibilityLayer
        margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
      >
        {commonAxes}
        {tooltip}
        <Bar
          dataKey="value"
          fill={theme.series[0] ?? theme.axis}
          isAnimationActive={!prefersReducedMotion}
        />
      </BarChart>
    ) : (
      <LineChart
        {...sizeProps}
        data={data}
        accessibilityLayer
        margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
      >
        {commonAxes}
        {tooltip}
        <Line
          type="monotone"
          dataKey="value"
          stroke={theme.series[0] ?? theme.axis}
          connectNulls={false}
          isAnimationActive={!prefersReducedMotion}
          dot={false}
        />
      </LineChart>
    );

  return (
    <div
      className={styles.frame}
      data-testid={testId}
      data-reduced-motion={prefersReducedMotion ? 'true' : 'false'}
    >
      {width !== undefined ? (
        chart
      ) : (
        <ResponsiveContainer width="100%" height={chartHeight}>
          {chart}
        </ResponsiveContainer>
      )}
    </div>
  );
}
