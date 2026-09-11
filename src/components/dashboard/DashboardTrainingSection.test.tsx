import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/test-utils';
import type { DashboardTrainingAnalysis } from '@/hooks/useDashboard';
import { emptyDashboardScenario, richDashboardScenario } from '@/test/fixtures/dashboard/scenarios';
import { trainingAnalysisFromScenario } from '@/test/fixtures/dashboard/trainingAnalysis';
import { DashboardTrainingSection } from './DashboardTrainingSection';

const rich = trainingAnalysisFromScenario(richDashboardScenario());

describe('DashboardTrainingSection', () => {
  it('renders the current cycle, per-cycle charts, categories and failures', () => {
    renderWithProviders(
      <DashboardTrainingSection
        training={rich}
        onSelectSet={vi.fn()}
        chartWidth={320}
        chartHeight={180}
      />,
    );

    expect(screen.getByTestId('training-current-cycle-number')).toHaveTextContent('Cycle 5');
    expect(screen.getByTestId('training-current-cycle-status')).toHaveTextContent('In progress');
    expect(screen.getByTestId('training-current-cycle-partial')).toHaveTextContent('Partial cycle');
    expect(screen.getByTestId('training-current-cycle-progress')).toHaveTextContent(
      '3 of 9 puzzles completed',
    );
    expect(screen.getByTestId('training-abandoned')).toHaveTextContent('3');

    expect(screen.getByTestId('training-accuracy')).toBeInTheDocument();
    expect(screen.getByTestId('training-time')).toBeInTheDocument();
    expect(screen.getByTestId('training-hints')).toBeInTheDocument();
    expect(screen.getByTestId('training-retries')).toBeInTheDocument();
    expect(screen.getByTestId('training-completion')).toBeInTheDocument();
    expect(screen.getByTestId('training-weakest-categories')).toBeInTheDocument();
    expect(screen.getByTestId('training-repeatedly-failed-list')).toBeInTheDocument();
  }, 10_000);

  it('switches the accuracy, time and completion metrics', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <DashboardTrainingSection
        training={rich}
        onSelectSet={vi.fn()}
        chartWidth={320}
        chartHeight={180}
      />,
    );

    await user.click(screen.getByTestId('training-accuracy-solveRate'));
    expect(screen.getByTestId('training-accuracy-solveRate')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.click(screen.getByTestId('training-time-median'));
    expect(screen.getByTestId('training-time-median')).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByTestId('training-completion-skipped'));
    expect(screen.getByTestId('training-completion-skipped')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  }, 15_000);

  it('renders measured cross-cycle deltas without a causation claim', () => {
    renderWithProviders(
      <DashboardTrainingSection training={rich} onSelectSet={vi.fn()} chartWidth={320} />,
    );

    expect(screen.getByTestId('training-cycle-comparison')).toBeInTheDocument();
    expect(screen.getByTestId('training-cycle-comparison-note')).toHaveTextContent(
      'do not show that training caused any change',
    );
    expect(screen.getByTestId('training-relative-deltas')).toBeInTheDocument();
  }, 10_000);

  it('shows unranked categories separately from the ranked bars', () => {
    renderWithProviders(
      <DashboardTrainingSection training={rich} onSelectSet={vi.fn()} chartWidth={320} />,
    );

    expect(screen.getByTestId('training-unranked-categories')).toHaveTextContent('Not enough data');
  }, 10_000);

  it('contains no scheduling language', () => {
    renderWithProviders(
      <DashboardTrainingSection training={rich} onSelectSet={vi.fn()} chartWidth={320} />,
    );

    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/\bdue\b/i);
    expect(text).not.toMatch(/next review/i);
    expect(text).not.toMatch(/\bretention\b/i);
    expect(text).not.toMatch(/\bFSRS\b/);
  }, 10_000);

  it('selects a set through the set selector', async () => {
    const onSelectSet = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <DashboardTrainingSection
        training={rich}
        onSelectSet={onSelectSet}
        chartWidth={320}
        chartHeight={180}
      />,
    );

    await user.selectOptions(
      screen.getByTestId('training-set-selector'),
      'fixture:dashboard-archived',
    );
    expect(onSelectSet).toHaveBeenCalledWith('fixture:dashboard-archived');
  }, 10_000);

  it('renders the no-training empty state when no set exists', () => {
    const training = trainingAnalysisFromScenario(emptyDashboardScenario());
    renderWithProviders(<DashboardTrainingSection training={training} onSelectSet={vi.fn()} />);
    expect(screen.getByTestId('dashboard-no-training')).toBeInTheDocument();
  });

  it('renders a loading state', () => {
    const loading: DashboardTrainingAnalysis = {
      ...rich,
      stats: { data: null, loading: true, error: null },
    };
    renderWithProviders(<DashboardTrainingSection training={loading} onSelectSet={vi.fn()} />);
    expect(screen.getByTestId('dashboard-loading')).toHaveTextContent(
      'Loading training statistics',
    );
  });

  it('renders an inline error with a retry', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    const failing: DashboardTrainingAnalysis = {
      ...rich,
      stats: { data: null, loading: false, error: 'Could not load statistics.' },
    };
    renderWithProviders(
      <DashboardTrainingSection training={failing} onSelectSet={vi.fn()} onRetry={onRetry} />,
    );

    const error = screen.getByTestId('dashboard-load-error');
    expect(within(error).getByText('Could not load statistics.')).toBeInTheDocument();
    await user.click(within(error).getByTestId('dashboard-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
