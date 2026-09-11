import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/test-utils';
import { mergeTrendSeries } from '@/presentation/dashboard';
import { richDashboardScenario } from '@/test/fixtures/dashboard/scenarios';
import { TrendLineChart } from './TrendLineChart';

function rapidAccuracy() {
  const data = richDashboardScenario().data;
  if (!data.trends.accuracy.ok) {
    throw new Error('accuracy fixture must be ok');
  }
  const series = data.trends.accuracy.result.series.filter(
    (entry) => entry.platform === 'lichess' && entry.timeControl === 'rapid',
  );
  return mergeTrendSeries(series);
}

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

describe('TrendLineChart', () => {
  it('preserves gaps as null values and renders an SVG with a fixed test size', () => {
    const merged = rapidAccuracy();
    // Week 33 / 35 are explicit gaps, not zeros.
    expect(merged.rows.some((row) => row['lichess:rapid'] === null)).toBe(true);

    renderWithProviders(
      <TrendLineChart
        series={merged.series}
        rows={merged.rows}
        metricLabel="Accuracy"
        granularity="week"
        width={400}
        height={200}
      />,
    );

    const frame = screen.getByTestId('trend-line-chart');
    expect(frame).toHaveAttribute('data-granularity', 'week');
    expect(frame.querySelector('svg')).not.toBeNull();
  });

  it('disables animation when the user prefers reduced motion', () => {
    setMatchMedia(true);
    const merged = rapidAccuracy();
    renderWithProviders(
      <TrendLineChart
        series={merged.series}
        rows={merged.rows}
        metricLabel="Accuracy"
        granularity="week"
        width={400}
        height={200}
      />,
    );

    expect(screen.getByTestId('trend-line-chart')).toHaveAttribute('data-reduced-motion', 'true');
  });
});
