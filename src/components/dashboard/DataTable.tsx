import type * as React from 'react';
import styles from './DataTable.module.css';

/** One column of a disclosure data table (header + cell renderer). */
export interface DataTableColumn<Row> {
  readonly key: string;
  readonly header: string;
  readonly render: (row: Row) => React.ReactNode;
}

export interface DataTableProps<Row> {
  /** Accessible caption; names the table for screen readers. */
  readonly caption: string;
  readonly columns: readonly DataTableColumn<Row>[];
  readonly rows: readonly Row[];
  readonly rowKey: (row: Row, index: number) => string;
  readonly testId?: string;
}

/**
 * Generic accessible table used as a chart's text/data equivalent. Cells carry
 * their column header via `data-label` so the table renders as stacked cards on
 * narrow viewports without losing the header association.
 */
export function DataTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
  testId = 'dashboard-data-table',
}: DataTableProps<Row>): React.JSX.Element {
  return (
    <div className={styles.wrap}>
      <table className={styles.table} data-testid={testId}>
        <caption className={styles.caption}>{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col">
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={rowKey(row, index)}>
              {columns.map((column) => (
                <td key={column.key} data-label={column.header}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
