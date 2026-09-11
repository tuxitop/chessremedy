import type * as React from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatDashboardDate, formatRating, type RatingChartPoint } from '@/presentation/dashboard';
import { useChartTheme } from './useChartTheme';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';
import styles from './charts.module.css';

export interface RatingProgressChartProps {
  /** Stage-1 stored rating points (no interpolation/carry-forward). */
  readonly points: readonly RatingChartPoint[];
  readonly width?: number;
  readonly height?: number;
  readonly testId?: string;
}

interface RatingTooltipProps {
  readonly active?: boolean;
  readonly label?: string | number | undefined;
  readonly payload?: readonly { readonly value?: number }[];
}

function RatingTooltip({ active, label, payload }: RatingTooltipProps): React.JSX.Element | null {
  if (active !== true || payload === undefined || payload.length === 0) {
    return null;
  }
  const x = typeof label === 'number' ? label : Number(label);
  const value = payload[0]?.value;
  return (
    <div className={styles.tooltip}>
      <p className={styles.tooltipTitle}>{formatDashboardDate(Number.isFinite(x) ? x : null)}</p>
      <p className={styles.tooltipValue}>{value === undefined ? '—' : formatRating(value)}</p>
    </div>
  );
}

/**
 * One partition's rating history as a time-series line. Only the stored rating
 * points are plotted; a missing rating or undated game produces no point, so
 * the line has honest gaps rather than carry-forward values.
 */
export function RatingProgressChart({
  points,
  width,
  height,
  testId = 'rating-progress-chart',
}: RatingProgressChartProps): React.JSX.Element {
  const theme = useChartTheme();
  const prefersReducedMotion = usePrefersReducedMotion();
  const data = points.map((point) => ({ x: point.x, y: point.y }));
  const chartHeight = height ?? 240;

  const chart = (
    <LineChart
      {...(width !== undefined ? { width } : {})}
      {...(width !== undefined ? { height: chartHeight } : {})}
      data={data}
      accessibilityLayer
      margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
    >
      <CartesianGrid stroke={theme.grid} strokeDasharray="3 3" />
      <XAxis
        dataKey="x"
        type="number"
        scale="time"
        domain={['dataMin', 'dataMax']}
        stroke={theme.axis}
        tick={{ fill: theme.axis, fontSize: 12 }}
        tickFormatter={(value: number) => formatDashboardDate(value)}
      />
      <YAxis
        dataKey="y"
        domain={['auto', 'auto']}
        stroke={theme.axis}
        tick={{ fill: theme.axis, fontSize: 12 }}
        width={48}
        tickFormatter={(value: number) => formatRating(value)}
      />
      <Tooltip
        content={(props) => (
          <RatingTooltip
            active={props.active}
            label={props.label}
            payload={props.payload as unknown as readonly { readonly value?: number }[]}
          />
        )}
      />
      <Line
        type="monotone"
        dataKey="y"
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
