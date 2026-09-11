import { useId } from 'react';
import type * as React from 'react';
import type { DataTableColumn } from './DataTable';
import { DataTable } from './DataTable';
import { ChartErrorBoundary } from './ChartErrorBoundary';
import { chartStateLabel, type ChartCardState } from './charts/chartState';
import styles from './ChartCard.module.css';

/** The disclosure-table payload for a chart card. */
export interface ChartCardTable<Row> {
  readonly caption: string;
  readonly columns: readonly DataTableColumn<Row>[];
  readonly rows: readonly Row[];
  readonly rowKey: (row: Row, index: number) => string;
}

export interface ChartCardProps<Row> {
  readonly title: string;
  /** Accessible name of the chart (`role="img"` + `aria-label`). */
  readonly ariaLabel: string;
  /** Visible text summary of the chart's values/states (non-hover equivalent). */
  readonly summary: string;
  /** Card-level honest state; non-`ok` renders the placeholder, not the chart. */
  readonly state: ChartCardState;
  /** Sample size shown in the `insufficient` placeholder. */
  readonly sampleN?: number;
  readonly table: ChartCardTable<Row>;
  /** The chart itself; only rendered when `state === 'ok'`. */
  readonly children: React.ReactNode;
  readonly testId?: string;
}

/**
 * Accessible frame around one chart: heading, text summary, `role="img"`
 * accessible name, an isolated error boundary and a disclosure data table with
 * the same values/states. When there is no `ok` point it renders the explicit
 * honest-state placeholder instead of an empty axis.
 */
export function ChartCard<Row>({
  title,
  ariaLabel,
  summary,
  state,
  sampleN,
  table,
  children,
  testId = 'chart-card',
}: ChartCardProps<Row>): React.JSX.Element {
  const titleId = useId();
  const placeholder = chartStateLabel(state, sampleN ?? 0);
  return (
    <section className={styles.card} aria-labelledby={titleId} data-testid={testId}>
      <h3 className={styles.title} id={titleId}>
        {title}
      </h3>
      <p className={styles.summary} data-testid={`${testId}-summary`}>
        {summary}
      </p>
      {placeholder !== null ? (
        <p className={styles.placeholder} role="note" data-testid={`${testId}-placeholder`}>
          {placeholder}
        </p>
      ) : (
        <div
          className={styles.chart}
          role="img"
          aria-label={ariaLabel}
          data-testid={`${testId}-chart`}
        >
          <ChartErrorBoundary>{children}</ChartErrorBoundary>
        </div>
      )}
      <details className={styles.details} data-testid={`${testId}-details`}>
        <summary className={styles.disclosure}>View data table</summary>
        <DataTable
          caption={table.caption}
          columns={table.columns}
          rows={table.rows}
          rowKey={table.rowKey}
          testId={`${testId}-table`}
        />
      </details>
    </section>
  );
}
