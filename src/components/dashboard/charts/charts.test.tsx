import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/test-utils';
import type { RatingChartPoint } from '@/presentation/dashboard';
import { CycleTrendChart, type CycleChartPoint } from './CycleTrendChart';
import { PhaseErrorsChart, type PhaseErrorRow } from './PhaseErrorsChart';
import { RatingProgressChart } from './RatingProgressChart';
import { WeakestCategoriesChart, type WeakestCategoryPoint } from './WeakestCategoriesChart';

function setMatchMedia(matches: boolean): void {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  setMatchMedia(false);
});

const ratingPoints: readonly RatingChartPoint[] = [
  { gameId: 'g1', x: Date.UTC(2026, 7, 3), y: 1500 },
  { gameId: 'g2', x: Date.UTC(2026, 7, 10), y: 1510 },
];

const phaseRows: readonly PhaseErrorRow[] = [
  {
    phase: 'opening',
    label: 'Opening',
    cells: {
      inaccuracies: { value: 1.2, state: 'ok', n: 6 },
      mistakes: { value: 0.5, state: 'ok', n: 6 },
      blunders: { value: 0.2, state: 'ok', n: 6 },
      missedTactics: { value: null, state: 'notDetected', n: 0 },
    },
  },
  {
    phase: 'middlegame',
    label: 'Middlegame',
    cells: {
      inaccuracies: { value: null, state: 'insufficient', n: 3 },
      mistakes: { value: 0.4, state: 'ok', n: 6 },
      blunders: { value: 0.1, state: 'ok', n: 6 },
      missedTactics: { value: null, state: 'notDetected', n: 0 },
    },
  },
];

const categoryPoints: readonly WeakestCategoryPoint[] = [
  { category: 'forcing_mate', label: 'Forcing mate', value: 0.4, state: 'ok', n: 6 },
  { category: 'winning_material', label: 'Winning material', value: 0.7, state: 'ok', n: 8 },
];

const cyclePoints: readonly CycleChartPoint[] = [
  { cycleNumber: 1, label: 'Cycle 1', value: 0.6, state: 'ok', n: 6 },
  { cycleNumber: 2, label: 'Cycle 2', value: null, state: 'insufficient', n: 3 },
  { cycleNumber: 3, label: 'Cycle 3', value: 0.7, state: 'ok', n: 8 },
];

describe('chart primitives', () => {
  it('renders a rating progress chart', () => {
    renderWithProviders(
      <RatingProgressChart points={ratingPoints} width={320} height={180} testId="rating" />,
    );
    expect(screen.getByTestId('rating').querySelector('svg')).not.toBeNull();
  });

  it('renders a grouped phase-errors bar chart', () => {
    renderWithProviders(
      <PhaseErrorsChart
        rows={phaseRows}
        valueLabel="Errors per 100 moves"
        width={320}
        height={180}
        testId="phase"
      />,
    );
    expect(screen.getByTestId('phase').querySelector('svg')).not.toBeNull();
  });

  it('renders a horizontal weakest-categories chart', () => {
    renderWithProviders(
      <WeakestCategoriesChart
        points={categoryPoints}
        width={320}
        height={180}
        testId="categories"
      />,
    );
    expect(screen.getByTestId('categories').querySelector('svg')).not.toBeNull();
  });

  it('renders a per-cycle line chart with a gap and honours reduced motion', () => {
    setMatchMedia(true);
    renderWithProviders(
      <CycleTrendChart points={cyclePoints} kind="line" width={320} height={180} testId="cycles" />,
    );
    const frame = screen.getByTestId('cycles');
    expect(frame.querySelector('svg')).not.toBeNull();
    expect(frame).toHaveAttribute('data-reduced-motion', 'true');
  });

  it('renders a per-cycle bar chart', () => {
    renderWithProviders(
      <CycleTrendChart points={cyclePoints} kind="bar" width={320} height={180} testId="cycles" />,
    );
    expect(screen.getByTestId('cycles').querySelector('svg')).not.toBeNull();
  });
});
