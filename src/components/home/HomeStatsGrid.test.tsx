/**
 * Feature 018 — `HomeStatsGrid` honest-state tests.
 *
 * Every value is fed through injected slices built from the canonical
 * Feature-014 fixtures; no engine, network or IndexedDB.
 */

import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { GameMetricsPartition, TrainingSetStats } from '@/domain/statistics';
import { setStatsFor } from '@/domain/statistics';
import { puzzleIdOf } from '@/domain/puzzle/id';
import { blockSetFixture, cycleFixture, attemptRowsForCycle } from '@/domain/training/test-support';
import type { TrainingCycleStatus } from '@/domain/training/cycleTypes';
import { renderWithProviders } from '@/test/test-utils';
import {
  HOME_FIXTURE_NOW,
  blockWithProgress,
  blockWithoutCycles,
  richHomeGameMetrics,
} from '@/test/fixtures/home/scenarios';
import type {
  HomeBlockData,
  HomeGameData,
  HomeMasteryData,
  HomeSlice,
  HomeTrainingData,
} from '@/hooks/useHome';
import { HomeStatsGrid, type HomeStatsGridProps } from './HomeStatsGrid';

const rich = richHomeGameMetrics();
const PARTITIONS: readonly GameMetricsPartition[] = rich.ok ? rich.result.partitions : [];

function partition(platform: string, timeControl: string): GameMetricsPartition {
  const found = PARTITIONS.find(
    (entry) => entry.platform === platform && entry.timeControl === timeControl,
  );
  if (found === undefined) {
    throw new Error(`missing fixture partition ${platform}:${timeControl}`);
  }
  return found;
}

const RAPID = partition('lichess', 'rapid');
const BLITZ = partition('chesscom', 'blitz');
const BULLET = partition('lichess', 'bullet');

function gameSlice(
  partitions: readonly GameMetricsPartition[],
  totalGames = 18,
): HomeSlice<HomeGameData> {
  return { data: { totalGames, partitions }, loading: false, error: null };
}

function trainingSlice(
  openBlock: HomeTrainingData['openBlock'] = null,
): HomeSlice<HomeTrainingData> {
  return { data: { sets: [], openBlock, cycles: [] }, loading: false, error: null };
}

function blockSlice(stats: TrainingSetStats | null): HomeSlice<HomeBlockData> {
  return { data: stats === null ? null : { stats }, loading: false, error: null };
}

const MASTERY: HomeSlice<HomeMasteryData> = {
  data: { mastered: 3, total: 8 },
  loading: false,
  error: null,
};

function renderGrid(overrides: Partial<HomeStatsGridProps> = {}) {
  const props: HomeStatsGridProps = {
    game: gameSlice([RAPID]),
    training: trainingSlice(),
    mastery: MASTERY,
    block: blockSlice(null),
    onRetry: () => {},
    ...overrides,
  };
  return renderWithProviders(<HomeStatsGrid {...props} />);
}

function statsWithCycleStatus(status: TrainingCycleStatus): TrainingSetStats {
  const ids = [puzzleIdOf('fixture:home-block', 1), puzzleIdOf('fixture:home-block', 2)];
  const block = blockSetFixture({ id: 'home-block', name: 'Woodpecker block', puzzleIds: ids });
  const cycle = cycleFixture({
    id: 'home-block-cycle',
    trainingSetId: block.id,
    cycleNumber: 1,
    status,
    puzzleIds: ids,
    startedAt: HOME_FIXTURE_NOW - 1000,
    ...(status === 'completed' ? { completedAt: HOME_FIXTURE_NOW } : {}),
    ...(status === 'abandoned' ? { abandonedAt: HOME_FIXTURE_NOW } : {}),
  });
  const attempts = attemptRowsForCycle({
    puzzleIds: ids,
    results: {
      [ids[0]!]: ['solvedFirstTry'],
      [ids[1]!]: ['solvedFirstTry'],
    },
    trainingSetId: block.id,
    cycleId: cycle.id,
    startedAt: HOME_FIXTURE_NOW - 1000,
  });
  return setStatsFor({ set: block, cycles: [cycle], attempts });
}

describe('HomeStatsGrid', () => {
  it('replaces the grid with a first-run empty state when no games exist', () => {
    renderGrid({ game: gameSlice([], 0) });
    expect(screen.getByTestId('home-empty-state')).toHaveTextContent('No games yet');
    expect(screen.queryByTestId('home-stat-games')).not.toBeInTheDocument();
  });

  it('shows "No recent games" when the window has no partition', () => {
    renderGrid({ game: gameSlice([]) });
    expect(screen.getByTestId('home-stat-games-empty')).toHaveTextContent('No recent games');
  });

  it('shows "No analyses yet" for a partition with no analyses', () => {
    renderGrid({ game: gameSlice([BULLET]) });
    expect(screen.getByTestId('home-stat-games-none')).toHaveTextContent('No analyses yet');
  });

  it('renders an ok accuracy value with its sample', () => {
    renderGrid({ game: gameSlice([RAPID]) });
    expect(screen.getByTestId('home-stat-accuracy-value')).toBeInTheDocument();
    expect(screen.getByTestId('home-stat-accuracy-sample')).toHaveTextContent(/n = \d+ games/);
  });

  it('renders the insufficient accuracy placeholder', () => {
    renderGrid({ game: gameSlice([BLITZ]) });
    expect(screen.getByTestId('home-stat-accuracy-placeholder')).toHaveTextContent(
      'Insufficient data (n = 4)',
    );
  });

  it('renders the empty accuracy placeholder', () => {
    renderGrid({ game: gameSlice([BULLET]) });
    expect(screen.getByTestId('home-stat-accuracy-placeholder')).toHaveTextContent('No data');
  });

  it('renders "Tactics not scanned" for a notDetected missed-tactics aggregate', () => {
    renderGrid({ game: gameSlice([BLITZ]) });
    expect(screen.getByTestId('home-stat-missed-tactics-placeholder')).toHaveTextContent(
      'Tactics not scanned',
    );
  });

  it('renders the mastered count', () => {
    renderGrid();
    expect(screen.getByTestId('home-stat-mastery-value')).toHaveTextContent(
      '3 of 8 puzzles mastered',
    );
  });

  it('shows "No puzzles yet" when none exist', () => {
    renderGrid({ mastery: { data: { mastered: 0, total: 0 }, loading: false, error: null } });
    expect(screen.getByTestId('home-stat-mastery-empty')).toHaveTextContent('No puzzles yet');
  });

  it('shows "No open block" with a Training link when there is no block', () => {
    renderGrid();
    expect(screen.getByTestId('home-stat-block-empty')).toHaveTextContent('No open block');
    expect(screen.getByRole('link', { name: 'Go to Training' })).toHaveAttribute(
      'href',
      '/training',
    );
  });

  it('shows "Not started" for an open block with no cycle', () => {
    const { block, stats } = blockWithoutCycles();
    renderGrid({ training: trainingSlice(block), block: blockSlice(stats) });
    expect(screen.getByTestId('home-stat-block-not-started')).toHaveTextContent('Not started');
  });

  it('renders a partial inProgress block cycle', () => {
    const { block, stats } = blockWithProgress();
    renderGrid({ training: trainingSlice(block), block: blockSlice(stats) });
    expect(screen.getByTestId('home-stat-block-value')).toHaveTextContent(
      'Cycle 1 · 2 of 5 puzzles done',
    );
    expect(screen.getByTestId('home-stat-block-status')).toHaveTextContent('In progress · partial');
  });

  it('renders a completed block cycle without the partial label', () => {
    const stats = statsWithCycleStatus('completed');
    const block = blockSetFixture({ id: 'home-block', name: 'Woodpecker block' });
    renderGrid({ training: trainingSlice(block), block: blockSlice(stats) });
    expect(screen.getByTestId('home-stat-block-status')).toHaveTextContent('Completed');
    expect(screen.getByTestId('home-stat-block-status')).not.toHaveTextContent('partial');
  });

  it('renders an abandoned block cycle status', () => {
    const stats = statsWithCycleStatus('abandoned');
    const block = blockSetFixture({ id: 'home-block', name: 'Woodpecker block' });
    renderGrid({ training: trainingSlice(block), block: blockSlice(stats) });
    expect(screen.getByTestId('home-stat-block-status')).toHaveTextContent('Abandoned');
  });

  it('shows a loading skeleton with aria-busy', () => {
    renderGrid({ game: { data: null, loading: true, error: null } });
    expect(screen.getByTestId('home-stat-games-loading')).toBeInTheDocument();
    expect(screen.getByTestId('home-stat-games')).toHaveAttribute('aria-busy', 'true');
  });

  it('shows an inline error and retries without blanking the other cards', () => {
    const onRetry = vi.fn();
    renderGrid({
      game: { data: null, loading: false, error: 'Could not load statistics.' },
      onRetry,
    });

    expect(screen.getByTestId('home-stat-games-error')).toHaveTextContent(
      'Could not load statistics.',
    );
    expect(screen.getByTestId('home-stat-mastery-value')).toBeInTheDocument();
    screen.getByTestId('home-stat-games-retry').click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
