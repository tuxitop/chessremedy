import type * as React from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { GamePhase } from '@/domain/chess/analysis';
import type { MetricState } from '@/domain/statistics';
import { ERROR_METRIC_LABELS } from '@/presentation/dashboard';
import { chartStateLabel } from './chartState';
import { useChartTheme } from './useChartTheme';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';
import type { ChartErrorClass } from './useChartTheme';
import styles from './charts.module.css';

/** One phase/error-class cell: the aggregate value plus its honest state. */
export interface PhaseErrorCell {
  readonly value: number | null;
  readonly state: MetricState;
  readonly n: number;
}

/** One phase row with a cell per error class (all four by default). */
export interface PhaseErrorRow {
  readonly phase: GamePhase;
  readonly label: string;
  readonly cells: Readonly<Record<ChartErrorClass, PhaseErrorCell>>;
}

export interface PhaseErrorsChartProps {
  readonly rows: readonly PhaseErrorRow[];
  readonly errorClasses?: readonly ChartErrorClass[];
  readonly valueLabel: string;
  readonly valueFormatter?: (value: number) => string;
  readonly width?: number;
  readonly height?: number;
  readonly testId?: string;
}

const DEFAULT_ERROR_CLASSES: readonly ChartErrorClass[] = [
  'inaccuracies',
  'mistakes',
  'blunders',
  'missedTactics',
];

interface PhaseTooltipProps {
  readonly active?: boolean;
  readonly label?: string | number | undefined;
  readonly payload?: readonly { readonly dataKey?: string | number; readonly color?: string }[];
  readonly rows: readonly PhaseErrorRow[];
  readonly valueFormatter: (value: number) => string;
}

function PhaseTooltip({
  active,
  label,
  payload,
  rows,
  valueFormatter,
}: PhaseTooltipProps): React.JSX.Element | null {
  if (active !== true || payload === undefined || payload.length === 0) {
    return null;
  }
  const row = rows.find((candidate) => candidate.label === label);
  return (
    <div className={styles.tooltip}>
      <p className={styles.tooltipTitle}>{String(label ?? '')}</p>
      <ul className={styles.tooltipList}>
        {payload.map((entry, index) => {
          const errorClass = entry.dataKey as ChartErrorClass;
          const cell = row?.cells[errorClass];
          const stateText = cell ? chartStateLabel(cell.state, cell.n) : 'No data';
          const valueText =
            cell !== undefined && cell.value !== null
              ? valueFormatter(cell.value)
              : (stateText ?? 'No data');
          return (
            <li key={String(entry.dataKey ?? index)} className={styles.tooltipItem}>
              <span
                className={styles.tooltipSwatch}
                style={{ background: entry.color }}
                aria-hidden="true"
              />
              <span>{ERROR_METRIC_LABELS[errorClass] ?? errorClass}</span>
              <span className={styles.tooltipValue}>{valueText}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Grouped bar chart of the user's errors by game phase. Rows come from the
 * caller (one per phase, one cell per error class); a non-`ok` cell is a gap,
 * never a zero bar. The default caller view is normalized `errorsPer100Moves`.
 */
export function PhaseErrorsChart({
  rows,
  errorClasses = DEFAULT_ERROR_CLASSES,
  valueLabel,
  valueFormatter = (value) => String(value),
  width,
  height,
  testId = 'phase-errors-chart',
}: PhaseErrorsChartProps): React.JSX.Element {
  const theme = useChartTheme();
  const prefersReducedMotion = usePrefersReducedMotion();
  const data = rows.map((row) => ({
    label: row.label,
    ...Object.fromEntries(errorClasses.map((key) => [key, row.cells[key].value])),
  }));
  const chartHeight = height ?? 280;

  const chart = (
    <BarChart
      {...(width !== undefined ? { width } : {})}
      {...(width !== undefined ? { height: chartHeight } : {})}
      data={data}
      accessibilityLayer
      margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
    >
      <CartesianGrid stroke={theme.grid} strokeDasharray="3 3" />
      <XAxis dataKey="label" stroke={theme.axis} tick={{ fill: theme.axis, fontSize: 12 }} />
      <YAxis
        stroke={theme.axis}
        tick={{ fill: theme.axis, fontSize: 12 }}
        width={48}
        label={{ value: valueLabel, angle: -90, position: 'insideLeft', fill: theme.axis }}
      />
      <Tooltip
        content={(props) => (
          <PhaseTooltip
            active={props.active}
            label={props.label}
            payload={
              props.payload as unknown as readonly {
                readonly dataKey?: string | number;
                readonly color?: string;
              }[]
            }
            rows={rows}
            valueFormatter={valueFormatter}
          />
        )}
      />
      <Legend />
      {errorClasses.map((errorClass) => (
        <Bar
          key={errorClass}
          dataKey={errorClass}
          name={ERROR_METRIC_LABELS[errorClass]}
          fill={theme.error[errorClass]}
          isAnimationActive={!prefersReducedMotion}
        />
      ))}
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
