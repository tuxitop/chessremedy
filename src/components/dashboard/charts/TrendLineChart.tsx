import { useMemo } from 'react';
import type * as React from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TrendGranularity } from '@/domain/statistics';
import {
  partitionLabel,
  type MergedTrendRow,
  type MergedTrendSeries,
  type TrendChartPoint,
} from '@/presentation/dashboard';
import { chartStateLabel } from './chartState';
import { useChartTheme, type ChartTheme } from './useChartTheme';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';
import styles from './charts.module.css';

export interface TrendLineChartProps {
  /** Merged Stage-1 series metadata (dataKey + per-period points with state/n). */
  readonly series: readonly MergedTrendSeries[];
  /** Merged Stage-1 rows (one row per period, one nullable value per series). */
  readonly rows: readonly MergedTrendRow[];
  /** Metric name used in the tooltip title (e.g. `Accuracy`). */
  readonly metricLabel: string;
  readonly granularity: TrendGranularity;
  readonly valueFormatter?: (value: number) => string;
  /** Fixed size override for tests (production uses `ResponsiveContainer`). */
  readonly width?: number;
  readonly height?: number;
  readonly testId?: string;
}

interface TooltipEntry {
  readonly dataKey?: string | number;
  readonly name?: string;
  readonly color?: string;
}

interface TrendTooltipProps {
  readonly active?: boolean;
  readonly label?: string | number | undefined;
  readonly payload?: readonly TooltipEntry[];
  readonly lookup: ReadonlyMap<string, ReadonlyMap<string, TrendChartPoint>>;
  readonly metricLabel: string;
  readonly valueFormatter: (value: number) => string;
  readonly theme: ChartTheme;
}

function TrendTooltip({
  active,
  label,
  payload,
  lookup,
  metricLabel,
  valueFormatter,
  theme,
}: TrendTooltipProps): React.JSX.Element | null {
  if (active !== true || payload === undefined || payload.length === 0) {
    return null;
  }
  const periodKey = typeof label === 'string' ? label : String(label ?? '');
  return (
    <div
      className={styles.tooltip}
      style={{ background: theme.tooltipBg, borderColor: theme.tooltipBorder, color: theme.text }}
    >
      <p className={styles.tooltipTitle}>
        {metricLabel} · {periodKey}
      </p>
      <ul className={styles.tooltipList}>
        {payload.map((entry, index) => {
          const key = String(entry.dataKey ?? index);
          const point = lookup.get(key)?.get(periodKey);
          const stateText = point ? chartStateLabel(point.state, point.n) : 'No data';
          const valueText =
            point !== undefined && point.value !== null
              ? valueFormatter(point.value)
              : (stateText ?? 'No data');
          return (
            <li key={key} className={styles.tooltipItem}>
              <span
                className={styles.tooltipSwatch}
                style={{ background: entry.color ?? theme.axis }}
                aria-hidden="true"
              />
              <span>{entry.name ?? key}</span>
              <span className={styles.tooltipValue}>{valueText}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Multi-series line chart for accuracy/error trends. One line per concrete
 * partition; non-`ok` points are gaps (`connectNulls={false}`), so a missing
 * period is never drawn as a zero. Values come from Stage-1 chart points only.
 */
export function TrendLineChart({
  series,
  rows,
  metricLabel,
  granularity,
  valueFormatter = (value) => String(value),
  width,
  height,
  testId = 'trend-line-chart',
}: TrendLineChartProps): React.JSX.Element {
  const theme = useChartTheme();
  const prefersReducedMotion = usePrefersReducedMotion();
  const lookup = useMemo(
    () =>
      new Map(
        series.map((entry) => [
          entry.key,
          new Map(entry.points.map((point) => [point.periodKey, point])),
        ]),
      ),
    [series],
  );
  const data = useMemo(() => [...rows], [rows]);
  const chartHeight = height ?? 260;

  const chart = (
    <LineChart
      {...(width !== undefined ? { width } : {})}
      {...(width !== undefined ? { height: chartHeight } : {})}
      data={data}
      accessibilityLayer
      margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
    >
      <CartesianGrid stroke={theme.grid} strokeDasharray="3 3" />
      <XAxis dataKey="periodKey" stroke={theme.axis} tick={{ fill: theme.axis, fontSize: 12 }} />
      <YAxis stroke={theme.axis} tick={{ fill: theme.axis, fontSize: 12 }} width={48} />
      <Tooltip
        content={(props) => (
          <TrendTooltip
            active={props.active}
            label={props.label}
            payload={props.payload as unknown as readonly TooltipEntry[]}
            lookup={lookup}
            metricLabel={metricLabel}
            valueFormatter={valueFormatter}
            theme={theme}
          />
        )}
      />
      <Legend />
      {series.map((entry, index) => (
        <Line
          key={entry.key}
          type="monotone"
          dataKey={entry.key}
          name={partitionLabel(entry.platform, entry.timeControl)}
          stroke={theme.series[index % theme.series.length] ?? theme.axis}
          connectNulls={false}
          isAnimationActive={!prefersReducedMotion}
          dot={false}
        />
      ))}
    </LineChart>
  );

  return (
    <div
      className={styles.frame}
      data-testid={testId}
      data-reduced-motion={prefersReducedMotion ? 'true' : 'false'}
      data-granularity={granularity}
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
