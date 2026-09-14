/**
 * Feature 018 — `HomePage` deterministic tests.
 *
 * Injects a fake `HomeDataSource` and a pinned `now`; no engine, network or
 * IndexedDB. Covers first-run/no-analysis/returning states, quick links, the
 * labeled primary partition, independent slice errors and accessibility.
 */

import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/test-utils';
import { FakeHomeDataSource } from '@/test/fixtures/home/fakeHomeDataSource';
import type { FakeHomeResults } from '@/test/fixtures/home/fakeHomeDataSource';
import {
  HOME_FIXTURE_NOW,
  firstRunHomeScenario,
  noAnalysisHomeScenario,
  noTargetHomeScenario,
  returningHomeScenario,
} from '@/test/fixtures/home/scenarios';
import { HomePage } from './HomePage';

function renderHome(results: FakeHomeResults) {
  const source = new FakeHomeDataSource(results);
  const view = renderWithProviders(<HomePage source={source} now={() => HOME_FIXTURE_NOW} />);
  return { source, ...view };
}

describe('HomePage', () => {
  it('shows the first-run hero, no continue card and the full how-it-works', async () => {
    renderHome(firstRunHomeScenario());

    expect(await screen.findByTestId('home-hero-primary')).toHaveTextContent('Import your games');
    expect(screen.getByTestId('home-hero-primary')).toHaveAttribute('href', '/games');
    expect(screen.queryByTestId('home-continue')).not.toBeInTheDocument();
    expect(screen.queryByTestId('review-card')).not.toBeInTheDocument();
    expect(await screen.findByTestId('home-empty-state')).toHaveTextContent('No games yet');
    expect(screen.getByTestId('home-how-it-works').tagName).toBe('SECTION');
  });

  it('shows "Analyze a game" and "No analyses yet" when games are unanalyzed', async () => {
    renderHome(noAnalysisHomeScenario());

    expect(await screen.findByTestId('home-hero-primary')).toHaveTextContent('Analyze a game');
    expect(await screen.findByTestId('home-stat-games-none')).toHaveTextContent('No analyses yet');
  });

  it('shows "Continue training" and the continue card for a returning user', async () => {
    renderHome(returningHomeScenario());

    expect(await screen.findByTestId('home-hero-primary')).toHaveTextContent('Continue training');
    expect(await screen.findByTestId('home-continue-label')).toHaveTextContent('Rapid review');
    expect(screen.getByTestId('home-continue-link')).toHaveAttribute(
      'href',
      '/training/sets/home-set/cycles/2',
    );
    expect(screen.getByTestId('home-how-it-works').tagName).toBe('SECTION');
  });

  it('shows the review card beside continue training once puzzles exist', async () => {
    renderHome(returningHomeScenario());

    expect(await screen.findByTestId('review-card')).toBeInTheDocument();
    expect(screen.getByTestId('home-continue')).toBeInTheDocument();
    expect(await screen.findByTestId('review-start')).toHaveAttribute('href', '/training/review');
  });

  it('shows "View your insights" when analyzed with no continue target', async () => {
    renderHome(noTargetHomeScenario());

    expect(await screen.findByTestId('home-hero-primary')).toHaveTextContent('View your insights');
    expect(screen.getByTestId('home-hero-primary')).toHaveAttribute('href', '/statistics');
    expect(screen.queryByTestId('home-continue')).not.toBeInTheDocument();
  });

  it('resolves the four quick links to the canonical routes', async () => {
    renderHome(returningHomeScenario());
    const nav = await screen.findByTestId('home-quick-nav');

    expect(within(nav).getByRole('link', { name: /Games/ })).toHaveAttribute('href', '/games');
    expect(within(nav).getByRole('link', { name: /Training/ })).toHaveAttribute(
      'href',
      '/training',
    );
    expect(within(nav).getByRole('link', { name: /Insights/ })).toHaveAttribute(
      'href',
      '/statistics',
    );
    expect(within(nav).getByRole('link', { name: /Analysis/ })).toHaveAttribute(
      'href',
      '/analysis/live',
    );
  });

  it('renders one labeled primary partition and the window label', async () => {
    renderHome(returningHomeScenario());

    const partition = await screen.findByTestId('home-stat-games-partition');
    expect(partition).toHaveTextContent('Lichess · Rapid');
    expect(partition).toHaveTextContent('Last 7 days');
    expect(partition).not.toHaveTextContent('All platforms');
  });

  it('keeps slices independent when the game and training reads fail', async () => {
    const source = new FakeHomeDataSource(returningHomeScenario());
    source.failGame = true;
    source.failTraining = true;
    renderWithProviders(<HomePage source={source} now={() => HOME_FIXTURE_NOW} />);

    expect(await screen.findByTestId('home-stat-games-error')).toHaveTextContent(
      'Could not load statistics.',
    );
    expect(await screen.findByTestId('home-stat-block-error')).toBeInTheDocument();
    expect(screen.getByTestId('home-stat-mastery-value')).toHaveTextContent(
      '3 of 8 puzzles mastered',
    );

    screen.getByTestId('home-stat-games-retry').click();
    await waitFor(() => expect(source.countCalls('gameMetrics')).toBeGreaterThan(1));
  });

  it('has a single h1, named regions and a polite live region', async () => {
    renderHome(returningHomeScenario());
    await screen.findByTestId('home-stat-games-value');

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('region', { name: 'Continue training' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Training vitals' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Quick links' })).toBeInTheDocument();
    expect(screen.getByTestId('home-live')).toHaveAttribute('aria-live', 'polite');
  });

  it('marks a pending data region busy and announces loading', () => {
    const source = new FakeHomeDataSource(returningHomeScenario());
    source.gameMetrics = () => new Promise<never>(() => {});
    renderWithProviders(<HomePage source={source} now={() => HOME_FIXTURE_NOW} />);

    expect(screen.getByTestId('home-stat-games')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('home-live')).toHaveTextContent('Loading home data…');
  });
});
