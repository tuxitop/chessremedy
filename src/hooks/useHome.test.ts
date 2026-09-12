/**
 * Feature 018 — `useHome` hook tests (deterministic, no engine/network/IndexedDB).
 *
 * Uses an injected `FakeHomeDataSource` to assert the read-only Feature-014/013
 * call shape, slice independence, retry and the idle block slice.
 */

import { describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useHome } from './useHome';
import { FakeHomeDataSource } from '@/test/fixtures/home/fakeHomeDataSource';
import type { FakeHomeResults } from '@/test/fixtures/home/fakeHomeDataSource';
import {
  HOME_FIXTURE_NOW,
  openBlockHomeScenario,
  returningHomeScenario,
} from '@/test/fixtures/home/scenarios';

function setup(results: FakeHomeResults) {
  const source = new FakeHomeDataSource(results);
  const view = renderHook(() => useHome({ source, now: () => HOME_FIXTURE_NOW }));
  return { source, ...view };
}

describe('useHome', () => {
  it('reads one bounded gameMetrics call with all dimensions and no combine', async () => {
    const { source, result } = setup(returningHomeScenario());

    await waitFor(() => expect(result.current.game.data).not.toBeNull());

    expect(source.countCalls('gameMetrics')).toBe(1);
    const call = source.callsFor('gameMetrics')[0]!;
    expect(call.query).toMatchObject({
      platform: 'all',
      timeControl: 'all',
      side: 'all',
      result: 'all',
      dateRange: { preset: 'last3m' },
    });
    expect(call.query?.combine).toBeUndefined();
    expect(call.query?.now).toBe(HOME_FIXTURE_NOW);
    expect(call.options?.dataVersionKey).toBe(result.current.dataVersionKey);
    expect(call.options).not.toHaveProperty('backfill');
  });

  it('reads trainingSetStats once, for the open block only', async () => {
    const { source, result } = setup(openBlockHomeScenario());

    await waitFor(() => expect(result.current.block.data).not.toBeNull());

    expect(source.countCalls('trainingSetStats')).toBe(1);
    expect(source.callsFor('trainingSetStats')[0]?.setId).toBe('home-block');
    expect(source.callsFor('trainingSetStats')[0]?.options).not.toHaveProperty('backfill');
  });

  it('surfaces the canonical mastery summary', async () => {
    const { result } = setup(returningHomeScenario());

    await waitFor(() => expect(result.current.mastery.data).not.toBeNull());
    expect(result.current.mastery.data).toEqual({ mastered: 3, total: 8 });
  });

  it('leaves the block slice idle when there is no open block', async () => {
    const { source, result } = setup(returningHomeScenario());

    await waitFor(() => expect(result.current.training.data).not.toBeNull());
    expect(result.current.block.loading).toBe(false);
    expect(result.current.block.data).toBeNull();
    expect(result.current.block.error).toBeNull();
    expect(source.countCalls('trainingSetStats')).toBe(0);
  });

  it('keeps training and mastery when the game slice fails', async () => {
    const source = new FakeHomeDataSource(returningHomeScenario());
    source.failGame = true;
    const { result } = renderHook(() => useHome({ source, now: () => HOME_FIXTURE_NOW }));

    await waitFor(() => expect(result.current.game.error).not.toBeNull());
    await waitFor(() => expect(result.current.training.data).not.toBeNull());
    await waitFor(() => expect(result.current.mastery.data).not.toBeNull());
    expect(result.current.game.data).toBeNull();
  });

  it('keeps the game and mastery slices when the training slice fails', async () => {
    const source = new FakeHomeDataSource(returningHomeScenario());
    source.failTraining = true;
    const { result } = renderHook(() => useHome({ source, now: () => HOME_FIXTURE_NOW }));

    await waitFor(() => expect(result.current.training.error).not.toBeNull());
    await waitFor(() => expect(result.current.game.data).not.toBeNull());
    await waitFor(() => expect(result.current.mastery.data).not.toBeNull());
    expect(result.current.training.data).toBeNull();
  });

  it('surfaces a block-slice error independently of the game slice', async () => {
    const source = new FakeHomeDataSource(openBlockHomeScenario());
    source.failBlock = true;
    const { result } = renderHook(() => useHome({ source, now: () => HOME_FIXTURE_NOW }));

    await waitFor(() => expect(result.current.block.error).not.toBeNull());
    expect(result.current.game.data).not.toBeNull();
    expect(result.current.training.data).not.toBeNull();
  });

  it('retries a failed slice after reload', async () => {
    const source = new FakeHomeDataSource(returningHomeScenario());
    source.failGame = true;
    const { result } = renderHook(() => useHome({ source, now: () => HOME_FIXTURE_NOW }));

    await waitFor(() => expect(result.current.game.error).not.toBeNull());
    const before = source.countCalls('gameMetrics');

    source.failGame = false;
    act(() => result.current.reload());

    await waitFor(() => expect(result.current.game.data).not.toBeNull());
    expect(source.countCalls('gameMetrics')).toBeGreaterThan(before);
  });
});
