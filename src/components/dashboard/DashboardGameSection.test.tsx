import { describe, expect, it, vi } from 'vitest';
import { useState, type ReactNode } from 'react';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/test-utils';
import { gameAnalysisFromScenario } from '@/test/fixtures/dashboard/gameAnalysis';
import { DashboardGameSection } from './DashboardGameSection';

// This section test exercises composition, partition selection and the
// accessible table/summary chrome — not Recharts' SVG output (the chart
// components have their own tests). Stubbing Recharts keeps the test fast and
// deterministic under full-suite parallel load.
vi.mock('recharts', () => {
  const Stub = (): null => null;
  return {
    ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    LineChart: Stub,
    Line: Stub,
    BarChart: Stub,
    Bar: Stub,
    CartesianGrid: Stub,
    Legend: Stub,
    Tooltip: Stub,
    XAxis: Stub,
    YAxis: Stub,
    Cell: Stub,
    LabelList: Stub,
    ReferenceLine: Stub,
    ReferenceArea: Stub,
  };
});

describe('DashboardGameSection', () => {
  /** Controlled harness: the hook owns the URL; the section is presentational. */
  function Harness({
    initialPartition = 'lichess:rapid',
  }: {
    initialPartition?: string;
  }): React.JSX.Element {
    const [partition, setPartition] = useState(initialPartition);
    return (
      <DashboardGameSection
        game={gameAnalysisFromScenario()}
        partition={partition}
        onPartition={setPartition}
        chartWidth={320}
        chartHeight={180}
      />
    );
  }

  it('renders the most-games concrete partition by default and can show every labeled partition', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);

    // Feature 017 §8: the default is the concrete partition with the most games
    // (the rich fixture has 12+ Lichess rapid games, not the first bullet one).
    expect(screen.getByTestId('summary-lichess-rapid')).toBeInTheDocument();
    expect(screen.queryByTestId('summary-lichess-bullet')).toBeNull();

    await user.selectOptions(screen.getByTestId('dashboard-partition'), 'all');
    expect(screen.getByTestId('summary-lichess-rapid')).toBeInTheDocument();
    expect(screen.getByTestId('summary-chesscom-blitz')).toBeInTheDocument();
  });

  it('renders one rating chart per concrete partition without averaging', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    await user.selectOptions(screen.getByTestId('dashboard-partition'), 'all');

    expect(screen.getByTestId('rating-lichess-rapid')).toBeInTheDocument();
    expect(screen.getByTestId('rating-chesscom-blitz')).toBeInTheDocument();
  });

  it('keeps partitions as separate series and gaps non-ok accuracy points', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    await user.selectOptions(screen.getByTestId('dashboard-partition'), 'all');

    const table = screen.getByTestId('trend-accuracy-table');
    expect(
      within(table).getByRole('columnheader', { name: 'Lichess · Rapid' }),
    ).toBeInTheDocument();
    expect(
      within(table).getByRole('columnheader', { name: 'Chess.com · Blitz' }),
    ).toBeInTheDocument();
    expect(within(table).getAllByText('No data').length).toBeGreaterThan(0);
    expect(within(table).getAllByText(/Insufficient data/).length).toBeGreaterThan(0);
  });

  it('renders missed tactics as "Tactics not scanned" without a detection pass', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    await user.selectOptions(screen.getByTestId('dashboard-partition'), 'all');

    const table = screen.getByTestId('trend-missed-tactics-table');
    expect(within(table).getAllByText('Tactics not scanned').length).toBeGreaterThan(0);
  });

  it('defaults the phase chart to errorsPer100Moves and offers the counts alternate', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    await user.selectOptions(screen.getByTestId('dashboard-partition'), 'all');

    const card = screen.getByTestId('phase-lichess-rapid');
    expect(within(card).getByTestId('phase-lichess-rapid-summary')).toHaveTextContent(
      'Errors per 100 moves',
    );
    await user.click(screen.getByTestId('phase-field-counts'));
    expect(within(card).getByTestId('phase-lichess-rapid-summary')).toHaveTextContent(
      'Error counts',
    );
  });
});
