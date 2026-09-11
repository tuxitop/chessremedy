import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/test-utils';
import { ChartCard } from './ChartCard';

interface Row {
  readonly period: string;
  readonly value: string;
}

const table = {
  caption: 'Accuracy data',
  columns: [
    { key: 'period', header: 'Period', render: (row: Row) => row.period },
    { key: 'value', header: 'Value', render: (row: Row) => row.value },
  ],
  rows: [{ period: '2026-W32', value: '85.0%' }],
  rowKey: (row: Row) => row.period,
};

describe('ChartCard', () => {
  it('exposes a heading, accessible name, text summary and disclosure table', () => {
    renderWithProviders(
      <ChartCard
        title="Accuracy trend"
        ariaLabel="Accuracy trend chart, week periods"
        summary="3 of 5 plotted points have enough data."
        state="ok"
        table={table}
        testId="card"
      >
        <p>chart body</p>
      </ChartCard>,
    );

    expect(screen.getByRole('heading', { name: 'Accuracy trend' })).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'Accuracy trend chart, week periods' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('card-summary')).toHaveTextContent(
      '3 of 5 plotted points have enough data.',
    );
    expect(screen.getByText('View data table')).toBeInTheDocument();
    expect(screen.getByTestId('card-table')).toBeInTheDocument();
    expect(screen.getByText('chart body')).toBeInTheDocument();
  });

  it('renders the honest-state placeholder instead of a chart when no point is ok', () => {
    renderWithProviders(
      <ChartCard
        title="Accuracy trend"
        ariaLabel="Accuracy trend chart"
        summary="No plottable points."
        state="insufficient"
        sampleN={4}
        table={table}
        testId="card"
      >
        <p>chart body</p>
      </ChartCard>,
    );

    expect(screen.getByTestId('card-placeholder')).toHaveTextContent('Insufficient data (n = 4)');
    expect(screen.queryByTestId('card-chart')).not.toBeInTheDocument();
    expect(screen.queryByText('chart body')).not.toBeInTheDocument();
    // The data table remains available as the text equivalent.
    expect(screen.getByTestId('card-table')).toBeInTheDocument();
  });

  it('shows "Tactics not scanned" for a notDetected card', () => {
    renderWithProviders(
      <ChartCard
        title="Missed tactics"
        ariaLabel="Missed tactics chart"
        summary="No detection pass."
        state="notDetected"
        table={table}
        testId="card"
      >
        <p>chart body</p>
      </ChartCard>,
    );

    expect(screen.getByTestId('card-placeholder')).toHaveTextContent('Tactics not scanned');
  });
});
