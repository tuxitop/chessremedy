import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/test-utils';
import { DataTable, type DataTableColumn } from './DataTable';

interface Row {
  readonly id: string;
  readonly name: string;
  readonly score: number;
}

const columns: readonly DataTableColumn<Row>[] = [
  { key: 'name', header: 'Name', render: (row) => row.name },
  { key: 'score', header: 'Score', render: (row) => String(row.score) },
];

const rows: readonly Row[] = [
  { id: 'a', name: 'Alice', score: 3 },
  { id: 'b', name: 'Bob', score: 7 },
];

describe('DataTable', () => {
  it('renders an accessible table with a caption and header cells', () => {
    renderWithProviders(
      <DataTable caption="Scores" columns={columns} rows={rows} rowKey={(row) => row.id} />,
    );

    expect(screen.getByRole('table', { name: 'Scores' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Score' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Alice' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '7' })).toBeInTheDocument();
  });
});
