import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { CycleHistory } from './CycleHistory';
import { cycleFixture } from '@/domain/training/test-support';
import { renderWithProviders } from '@/test/test-utils';

const CYCLES = [
  cycleFixture({ id: 'c1', cycleNumber: 1, status: 'completed' }),
  cycleFixture({ id: 'c2', cycleNumber: 2, status: 'abandoned' }),
  cycleFixture({ id: 'c3', cycleNumber: 3, status: 'inProgress' }),
];

describe('CycleHistory', () => {
  it('spells out every cycle status textually', () => {
    renderWithProviders(<CycleHistory cycles={CYCLES} emptyMessage="None" testId="ch" />);

    expect(screen.getByTestId('ch-status-1')).toHaveTextContent('Completed');
    expect(screen.getByTestId('ch-status-2')).toHaveTextContent('Abandoned');
    expect(screen.getByTestId('ch-status-3')).toHaveTextContent('In progress');
  });

  it('shows an empty message when there are no cycles', () => {
    renderWithProviders(<CycleHistory cycles={[]} emptyMessage="No cycles yet." testId="ch" />);
    expect(screen.getByTestId('ch-empty')).toHaveTextContent('No cycles yet.');
  });

  it('renders per-cycle progress when a progress resolver is supplied', () => {
    renderWithProviders(
      <CycleHistory
        cycles={CYCLES}
        emptyMessage="None"
        testId="ch3"
        progressFor={(cycle) =>
          cycle.cycleNumber === 1
            ? { solved: 2, total: 3, accuracy: 0.5 }
            : cycle.cycleNumber === 2
              ? { solved: 0, total: 3, accuracy: null }
              : null
        }
      />,
    );

    expect(screen.getByTestId('ch3-progress-1')).toHaveTextContent('2/3 · 50%');
    expect(screen.getByTestId('ch3-progress-2')).toHaveTextContent('0/3 · —');
    expect(screen.queryByTestId('ch3-progress-3')).toBeNull();
  });

  it('renders a results link only when a path builder is supplied', () => {
    renderWithProviders(<CycleHistory cycles={CYCLES} emptyMessage="None" testId="ch" />);
    expect(screen.queryByTestId('ch-results-1')).toBeNull();

    renderWithProviders(
      <CycleHistory
        cycles={CYCLES}
        emptyMessage="None"
        testId="ch2"
        resultsPathFor={(cycle) => `/results/${cycle.cycleNumber}`}
      />,
    );
    expect(screen.getByTestId('ch2-results-1')).toHaveAttribute('href', '/results/1');
  });
});
