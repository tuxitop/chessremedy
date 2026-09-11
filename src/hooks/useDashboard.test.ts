/**
 * useDashboard tests (Feature 015, Stage 2).
 *
 * Deterministic hook tests over an injected fake `DashboardStatisticsSource`
 * and `DashboardTrainingSetsSource` — no engine, network or IndexedDB. Covers
 * the read-only Feature-014 call shape, independent slice states, retry,
 * invalid-range handling, set-scoped reads and filter/set independence.
 */

import { createElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DEFAULT_LIBRARY_FILTERS } from '@/domain/gameLibrary';
import { DASHBOARD_TREND_METRICS, useDashboard } from './useDashboard';
import {
  FakeStatisticsSource,
  FakeTrainingSetsSource,
} from '@/test/fixtures/dashboard/fakeStatistics';
import {
  emptyDashboardScenario,
  openBlockDashboardScenario,
  richDashboardScenario,
  type DashboardScenario,
} from '@/test/fixtures/dashboard/scenarios';

function setup(scenario: DashboardScenario, initialEntry = '/dashboard') {
  const source = new FakeStatisticsSource(scenario.data);
  const sets = new FakeTrainingSetsSource(
    scenario.activeSets,
    scenario.archivedSets,
    scenario.openBlock,
  );
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(MemoryRouter, { initialEntries: [initialEntry] }, children);
  const view = renderHook(() => useDashboard({ source, sets }), { wrapper });
  return { source, sets, ...view };
}

const DEFAULT_SET_ID = 'fixture:dashboard-set';
const ARCHIVED_SET_ID = 'fixture:dashboard-archived';

describe('useDashboard', () => {
  it('reads only the Feature-014 methods with side/result all and no combine/backfill', async () => {
    const { source, result } = setup(richDashboardScenario());

    await waitFor(() => expect(result.current.game.metrics.data).not.toBeNull());
    await waitFor(() => expect(result.current.training.stats.data).not.toBeNull());

    expect(source.countCalls('gameMetrics')).toBe(1);
    expect(source.countCalls('ratingHistories')).toBe(1);
    expect(source.countCalls('phaseMetrics')).toBe(1);
    for (const metric of DASHBOARD_TREND_METRICS) {
      expect(source.callsFor('trendSeries').some((call) => call.metric === metric)).toBe(true);
    }
    expect(source.countCalls('trainingSetStats')).toBe(1);
    expect(source.countCalls('weakestCategories')).toBe(1);
    expect(source.countCalls('repeatedlyFailed')).toBe(1);

    const gameCall = source.callsFor('gameMetrics')[0]!;
    expect(gameCall.query).toMatchObject({ side: 'all', result: 'all' });
    expect(gameCall.query?.combine).toBeUndefined();
    expect(gameCall.options).not.toHaveProperty('backfill');
    expect(gameCall.options?.dataVersionKey).toBe(result.current.dataVersionKey);

    const trendCall = source.callsFor('trendSeries')[0]!;
    expect(trendCall.query).toMatchObject({ side: 'all', result: 'all' });
    expect(trendCall.options).toMatchObject({ granularity: 'week' });
    expect(trendCall.options).not.toHaveProperty('backfill');

    expect(source.callsFor('trainingSetStats')[0]?.setId).toBe(DEFAULT_SET_ID);
  });

  it('keeps slices independent when one read fails', async () => {
    const scenario = richDashboardScenario();
    const failing: DashboardScenario = {
      ...scenario,
      data: { ...scenario.data, gameMetrics: { ok: false, reason: 'compute-error' } },
    };
    const { result } = setup(failing);

    await waitFor(() => expect(result.current.game.phases.data).not.toBeNull());
    await waitFor(() => expect(result.current.game.metrics.error).not.toBeNull());
    expect(result.current.game.metrics.data).toBeNull();
    expect(result.current.game.ratings.data).not.toBeNull();
    expect(result.current.game.phases.data).not.toBeNull();
  });

  it('retries a failed read and fills the slice', async () => {
    const scenario = richDashboardScenario();
    const failing: DashboardScenario = {
      ...scenario,
      data: { ...scenario.data, gameMetrics: { ok: false, reason: 'compute-error' } },
    };
    const { source, result } = setup(failing);

    await waitFor(() => expect(result.current.game.metrics.error).not.toBeNull());
    const before = source.countCalls('gameMetrics');

    source.data = { ...source.data, gameMetrics: scenario.data.gameMetrics };
    act(() => result.current.reload());

    await waitFor(() => expect(result.current.game.metrics.data).not.toBeNull());
    expect(result.current.game.metrics.error).toBeNull();
    expect(source.countCalls('gameMetrics')).toBeGreaterThan(before);
  });

  it('keeps the last valid view for an invalid custom range and issues no new query', async () => {
    const { source, result } = setup(richDashboardScenario());
    await waitFor(() => expect(result.current.game.metrics.data).not.toBeNull());
    const before = source.countCalls('gameMetrics');

    act(() =>
      result.current.updateFilters({
        ...DEFAULT_LIBRARY_FILTERS,
        timeFrame: { preset: 'custom', from: '', to: '' },
      }),
    );

    await waitFor(() => expect(result.current.hint).not.toBeNull());
    expect(result.current.query).toBeNull();
    expect(result.current.game.metrics.data).not.toBeNull();
    expect(source.countCalls('gameMetrics')).toBe(before);
  });

  it('re-reads only training when the selected set changes', async () => {
    const { source, result } = setup(richDashboardScenario());
    await waitFor(() => expect(result.current.training.stats.data).not.toBeNull());
    const gameCalls = source.countCalls('gameMetrics');
    const trainingCalls = source.countCalls('trainingSetStats');

    act(() => result.current.selectSet(ARCHIVED_SET_ID));

    await waitFor(() =>
      expect(source.countCalls('trainingSetStats')).toBeGreaterThan(trainingCalls),
    );
    await waitFor(() => expect(result.current.training.selectedSetId).toBe(ARCHIVED_SET_ID));
    expect(source.countCalls('gameMetrics')).toBe(gameCalls);
    const trainingCallsForSet = source.callsFor('trainingSetStats');
    expect(trainingCallsForSet[trainingCallsForSet.length - 1]?.setId).toBe(ARCHIVED_SET_ID);
  });

  it('does not re-read training when the game filters change', async () => {
    const { source, result } = setup(richDashboardScenario());
    await waitFor(() => expect(result.current.training.stats.data).not.toBeNull());
    const gameCalls = source.countCalls('gameMetrics');
    const trainingCalls = source.countCalls('trainingSetStats');

    act(() => result.current.updateFilters({ ...DEFAULT_LIBRARY_FILTERS, platform: 'lichess' }));

    await waitFor(() => expect(source.countCalls('gameMetrics')).toBeGreaterThan(gameCalls));
    expect(source.countCalls('trainingSetStats')).toBe(trainingCalls);
  });

  it('selects the open block by default', async () => {
    const { result } = setup(openBlockDashboardScenario());
    await waitFor(() => expect(result.current.training.selectedSetId).not.toBeNull());
    expect(result.current.training.selectedSetId).toBe('fixture:dashboard-block');
    expect(result.current.training.openBlock?.id).toBe('fixture:dashboard-block');
  });

  it('renders an empty dataset with no selected set and idle training slices', async () => {
    const { result } = setup(emptyDashboardScenario());
    await waitFor(() => expect(result.current.game.metrics.data).not.toBeNull());
    await waitFor(() => expect(result.current.training.stats.loading).toBe(false));
    expect(result.current.training.selectedSetId).toBeNull();
    expect(result.current.training.sets).toEqual([]);
    expect(result.current.training.stats.data).toBeNull();
  });
});
