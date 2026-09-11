import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
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
  it('defaults to the first concrete partition and can show every labeled partition', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <DashboardGameSection game={gameAnalysisFromScenario()} chartWidth={320} chartHeight={180} />,
    );

    // Plan A1: the rendered default is a single concrete partition.
    expect(screen.getByTestId('summary-lichess-bullet')).toBeInTheDocument();
    expect(screen.queryByTestId('summary-lichess-rapid')).toBeNull();

    await user.selectOptions(screen.getByTestId('dashboard-partition'), 'all');
    expect(screen.getByTestId('summary-lichess-rapid')).toBeInTheDocument();
    expect(screen.getByTestId('summary-chesscom-blitz')).toBeInTheDocument();
  });

  it('renders one rating chart per concrete partition without averaging', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <DashboardGameSection game={gameAnalysisFromScenario()} chartWidth={320} chartHeight={180} />,
    );
    await user.selectOptions(screen.getByTestId('dashboard-partition'), 'all');

    expect(screen.getByTestId('rating-lichess-rapid')).toBeInTheDocument();
    expect(screen.getByTestId('rating-chesscom-blitz')).toBeInTheDocument();
  });

  it('keeps partitions as separate series and gaps non-ok accuracy points', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <DashboardGameSection game={gameAnalysisFromScenario()} chartWidth={320} chartHeight={180} />,
    );
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
    renderWithProviders(
      <DashboardGameSection game={gameAnalysisFromScenario()} chartWidth={320} chartHeight={180} />,
    );
    await user.selectOptions(screen.getByTestId('dashboard-partition'), 'all');

    const table = screen.getByTestId('trend-missed-tactics-table');
    expect(within(table).getAllByText('Tactics not scanned').length).toBeGreaterThan(0);
  });

  it('defaults the phase chart to errorsPer100Moves and offers the counts alternate', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <DashboardGameSection game={gameAnalysisFromScenario()} chartWidth={320} chartHeight={180} />,
    );
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
