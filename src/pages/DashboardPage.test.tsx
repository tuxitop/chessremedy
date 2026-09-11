/**
 * DashboardPage tests (Feature 015, Stage 6).
 *
 * Deterministic page tests over an injected fake statistics/training source —
 * no engine, network or IndexedDB. Covers both sections, the honest states,
 * provenance, filter/partition and training-set selection and the responsive
 * structure.
 */

import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/test-utils';
import type { DashboardScenario } from '@/test/fixtures/dashboard/scenarios';
import {
  emptyDashboardScenario,
  mixedVersionDashboardScenario,
  richDashboardScenario,
} from '@/test/fixtures/dashboard/scenarios';
import {
  FakeStatisticsSource,
  FakeTrainingSetsSource,
} from '@/test/fixtures/dashboard/fakeStatistics';
import { DashboardPage } from './DashboardPage';

function setup(scenario: DashboardScenario, initialEntries: string[] = ['/dashboard']) {
  const source = new FakeStatisticsSource(scenario.data);
  const sets = new FakeTrainingSetsSource(
    scenario.activeSets,
    scenario.archivedSets,
    scenario.openBlock,
  );
  const view = renderWithProviders(<DashboardPage source={source} sets={sets} />, {
    initialEntries,
  });
  return { source, sets, ...view };
}

describe('DashboardPage', () => {
  it('renders the game-analysis section, the training section and the provenance footer', async () => {
    setup(richDashboardScenario());

    const game = await screen.findByTestId('dashboard-game-section');
    const training = await screen.findByTestId('dashboard-training-section');
    expect(game).toBeInTheDocument();
    expect(training).toBeInTheDocument();
    expect(await screen.findByTestId('provenance-footer')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-filter-bar')).toBeInTheDocument();
  });

  it('labels mixed and outdated provenance without silently mixing', async () => {
    setup(mixedVersionDashboardScenario());

    expect(await screen.findByTestId('provenance-footer-mixed')).toHaveTextContent('Mixed data');
    expect(await screen.findByTestId('provenance-footer-outdated')).toHaveTextContent(
      'Re-analyze from the Game Library',
    );
  });

  it('renders honest empty states for an empty dataset', async () => {
    setup(emptyDashboardScenario());

    expect(await screen.findByTestId('dashboard-empty')).toBeInTheDocument();
    expect(await screen.findByTestId('dashboard-no-training')).toBeInTheDocument();
    expect(await screen.findByTestId('provenance-footer')).toBeInTheDocument();
  });

  it('shows an inline load error with a retry and fabricates no value', async () => {
    const scenario = richDashboardScenario();
    const failing: DashboardScenario = {
      ...scenario,
      data: { ...scenario.data, gameMetrics: { ok: false, reason: 'compute-error' } },
    };
    const { source } = setup(failing);
    const user = userEvent.setup();

    const error = await screen.findByTestId('dashboard-load-error');
    expect(within(error).getByText('Could not load statistics.')).toBeInTheDocument();
    const before = source.countCalls('gameMetrics');

    source.data = scenario.data;
    await user.click(within(error).getByTestId('dashboard-retry'));
    await waitFor(() => expect(source.countCalls('gameMetrics')).toBeGreaterThan(before));
  });

  it('changes the game-analysis partition from the partition selector', async () => {
    setup(richDashboardScenario());
    const user = userEvent.setup();

    await screen.findByTestId('dashboard-game-section');
    await user.selectOptions(screen.getByTestId('dashboard-partition'), 'all');

    expect(screen.getByTestId('summary-lichess-rapid')).toBeInTheDocument();
    expect(screen.getByTestId('summary-chesscom-blitz')).toBeInTheDocument();
  });

  it('keeps the training section set-scoped when the game filters change', async () => {
    setup(richDashboardScenario());
    const user = userEvent.setup();

    const training = await screen.findByTestId('dashboard-training-section');
    await screen.findByTestId('training-current-cycle');
    const before = within(training).getByTestId('training-current-cycle-number').textContent;

    await user.selectOptions(screen.getByTestId('dashboard-filter-platform'), 'lichess');

    expect(within(training).getByTestId('training-current-cycle-number').textContent).toBe(before);
    expect(within(training).getByTestId('training-set-selector')).toBeInTheDocument();
  });

  it('selects a training set through the set selector', async () => {
    setup(richDashboardScenario());
    const user = userEvent.setup();

    const selector = await screen.findByTestId('training-set-selector');
    await user.selectOptions(selector, 'fixture:dashboard-archived');

    await waitFor(() =>
      expect(screen.getByTestId('training-set-selector')).toHaveValue('fixture:dashboard-archived'),
    );
  });

  it('exposes a responsive structure with accessible charts and a live region', async () => {
    const { container } = setup(richDashboardScenario());

    await screen.findByTestId('dashboard-game-section');
    const page = screen.getByTestId('dashboard-page');
    expect(within(page).getByTestId('dashboard-game-section')).toBeInTheDocument();
    expect(within(page).getByTestId('dashboard-training-section')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-live')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getAllByRole('img').length).toBeGreaterThan(0);
    expect(container.querySelector('h1')).toHaveTextContent('Dashboard');
  });
});
