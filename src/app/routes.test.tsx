/**
 * Feature 017 (W1) — routes, nav order and legacy redirects.
 *
 * Structural guards over `ROUTES`/`NAV_ITEMS` plus functional redirect checks
 * built from the exported `appRoutes` with `createMemoryRouter`.
 */

import { describe, expect, it } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import {
  NAV_ITEMS,
  ROUTES,
  trainingCyclePath,
  trainingCycleResultsPath,
  trainingSetPath,
} from './routes';
import { legacyRedirectRoutes } from './redirects';
import { appRoutes } from './router';

function renderAt(entry: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [entry] });
  render(<RouterProvider router={router} />);
  return router;
}

describe('NAV_ITEMS', () => {
  it('lists the canonical order and labels', () => {
    expect(NAV_ITEMS.map((item) => item.label)).toEqual([
      'Home',
      'Games',
      'Training',
      'Insights',
      'Analysis',
      'Settings',
    ]);
  });

  it('points Training and Insights at the renamed routes', () => {
    expect(NAV_ITEMS.find((item) => item.label === 'Training')?.path).toBe(ROUTES.training);
    expect(NAV_ITEMS.find((item) => item.label === 'Insights')?.path).toBe(ROUTES.statistics);
  });
});

describe('ROUTES', () => {
  it('renames the puzzles/dashboard keys to training/statistics', () => {
    expect(ROUTES.training).toBe('/training');
    expect(ROUTES.trainingNew).toBe('/training/new');
    expect(ROUTES.trainingMastered).toBe('/training/mastered');
    expect(ROUTES.trainingSet).toBe('/training/sets/:setId');
    expect(ROUTES.trainingCycle).toBe('/training/sets/:setId/cycles/:cycleNumber');
    expect(ROUTES.trainingCycleResults).toBe('/training/sets/:setId/cycles/:cycleNumber/results');
    expect(ROUTES.statistics).toBe('/statistics');
    expect(ROUTES).not.toHaveProperty('puzzles');
    expect(ROUTES).not.toHaveProperty('dashboard');
  });

  it('builds concrete training paths', () => {
    expect(trainingSetPath('set-a')).toBe('/training/sets/set-a');
    expect(trainingCyclePath('set-a', 3)).toBe('/training/sets/set-a/cycles/3');
    expect(trainingCycleResultsPath('set-a', 3)).toBe('/training/sets/set-a/cycles/3/results');
  });
});

describe('legacy section redirects', () => {
  it('redirects /puzzles to /training', async () => {
    const router = renderAt('/puzzles');
    await waitFor(() => expect(router.state.location.pathname).toBe('/training'));
  });

  it('maps a nested puzzles path preserving query and hash', async () => {
    const router = renderAt('/puzzles/sets/set-1?foo=1&bar=2#section');
    await waitFor(() => expect(router.state.location.pathname).toBe('/training/sets/set-1'));
    expect(router.state.location.search).toBe('?foo=1&bar=2');
    expect(router.state.location.hash).toBe('#section');
  });

  it('redirects a cycle-results path preserving query and hash', async () => {
    const router = renderAt('/puzzles/sets/set-1/cycles/2/results?x=1#y');
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/training/sets/set-1/cycles/2/results'),
    );
    expect(router.state.location.search).toBe('?x=1');
    expect(router.state.location.hash).toBe('#y');
  });

  it('redirects /dashboard to /statistics preserving query and hash', async () => {
    const router = renderAt('/dashboard?partition=all#charts');
    await waitFor(() => expect(router.state.location.pathname).toBe('/statistics'));
    expect(router.state.location.search).toBe('?partition=all');
    expect(router.state.location.hash).toBe('#charts');
  });

  it('sends an unknown /puzzles suffix to /training rather than 404', async () => {
    const router = renderAt('/puzzles/does/not/exist');
    await waitFor(() => expect(router.state.location.pathname).toBe('/training'));
  });

  it('never redirects /games/:id/puzzles', async () => {
    const router = renderAt('/games/game-1/puzzles');
    expect(router.state.location.pathname).toBe('/games/game-1/puzzles');
  });

  it('does not self-redirect /training or /statistics', async () => {
    expect(legacyRedirectRoutes.some((route) => route.path === 'training')).toBe(false);
    expect(legacyRedirectRoutes.some((route) => route.path === 'statistics')).toBe(false);
    const router = renderAt('/training');
    expect(router.state.location.pathname).toBe('/training');
  });
});
