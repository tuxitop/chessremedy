import type * as React from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { MetricState } from '@/domain/statistics';
import type { WeaknessCategory } from '@/domain/statistics';
import { chartStateLabel } from './chartState';
import { useChartTheme } from './useChartTheme';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';
import styles from './charts.module.css';

/** One weakest-category bar: solve rate plus its honest state/sample. */
export interface WeakestCategoryPoint {
  readonly category: WeaknessCategory;
  readonly label: string;
  readonly value: number | null;
  readonly state: MetricState;
  readonly n: number;
}

export interface WeakestCategoriesChartProps {
  readonly points: readonly WeakestCategoryPoint[];
  readonly valueFormatter?: (value: number) => string;
  readonly width?: number;
  readonly height?: number;
  readonly testId?: string;
}

interface CategoryTooltipProps {
  readonly active?: boolean;
  readonly label?: string | number | undefined;
  readonly payload?: readonly { readonly value?: number }[];
  readonly points: readonly WeakestCategoryPoint[];
  readonly valueFormatter: (value: number) => string;
}

function CategoryTooltip({
  active,
  label,
  payload,
  points,
  valueFormatter,
}: CategoryTooltipProps): React.JSX.Element | null {
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
 * Horizontal bars of solve rate for the ranked weakest categories. Labels are
 * the canonical tactical-objective/blunder text, so category identity is never
 * colour-only.
 */
export function WeakestCategoriesChart({
  points,
  valueFormatter = (value) => String(value),
  width,
  height,
  testId = 'weakest-categories-chart',
}: WeakestCategoriesChartProps): React.JSX.Element {
  const theme = useChartTheme();
  const prefersReducedMotion = usePrefersReducedMotion();
  const data = points.map((point) => ({ label: point.label, value: point.value }));
  const chartHeight = height ?? Math.max(160, points.length * 44 + 48);

  const chart = (
    <BarChart
      {...(width !== undefined ? { width } : {})}
      {...(width !== undefined ? { height: chartHeight } : {})}
      data={data}
      layout="vertical"
      accessibilityLayer
      margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
    >
      <CartesianGrid stroke={theme.grid} strokeDasharray="3 3" />
      <XAxis
        type="number"
        stroke={theme.axis}
        tick={{ fill: theme.axis, fontSize: 12 }}
        tickFormatter={(value: number) => valueFormatter(value)}
      />
      <YAxis
        type="category"
        dataKey="label"
        stroke={theme.axis}
        tick={{ fill: theme.axis, fontSize: 12 }}
        width={140}
      />
      <Tooltip
        content={(props) => (
          <CategoryTooltip
            active={props.active}
            label={props.label}
            payload={props.payload as unknown as readonly { readonly value?: number }[]}
            points={points}
            valueFormatter={valueFormatter}
          />
        )}
      />
      <Bar
        dataKey="value"
        fill={theme.series[0] ?? theme.axis}
        isAnimationActive={!prefersReducedMotion}
      />
    </BarChart>
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
