import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import type { ReviewOverview } from '@/domain/review';
import { renderWithProviders } from '@/test/test-utils';
import { ReviewCard } from './ReviewCard';

const NOW = new Date(2023, 10, 14, 12, 0, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;

function overview(overrides: Partial<ReviewOverview> = {}): ReviewOverview {
  return {
    dueNow: 3,
    newCount: 2,
    queue: [
      { puzzleId: 'p:a', kind: 'review', dueAt: NOW - 1_000 },
      { puzzleId: 'p:b', kind: 'review', dueAt: NOW - 2_000 },
      { puzzleId: 'p:c', kind: 'new', dueAt: null },
      { puzzleId: 'p:d', kind: 'new', dueAt: null },
    ],
    retention: 0.82,
    nextDueAt: NOW + 4 * DAY,
    pendingRebuild: 0,
    caps: { newCap: 20, reviewCap: 100 },
    dayUsage: { newCount: 0, reviewCount: 0 },
    ...overrides,
  };
}

describe('ReviewCard (Feature 020 §1)', () => {
  it('renders due/new counts, retention and the next due', () => {
    renderWithProviders(<ReviewCard overview={overview()} now={NOW} />);
    expect(screen.getByTestId('review-due')).toHaveTextContent('2');
    expect(screen.getByTestId('review-due')).toHaveTextContent('3 due in total');
    expect(screen.getByTestId('review-new')).toHaveTextContent('2');
    expect(screen.getByTestId('review-retention')).toHaveTextContent('82%');
    expect(screen.getByTestId('review-next-due')).toHaveTextContent('in 4 days');
    expect(screen.getByTestId('review-start')).toHaveAttribute('aria-disabled', 'false');
  });

  it('shows the explicit empty state and a disabled start with an explanation', () => {
    renderWithProviders(
      <ReviewCard
        overview={overview({
          dueNow: 0,
          newCount: 0,
          queue: [],
          retention: null,
          nextDueAt: null,
        })}
        now={NOW}
      />,
    );
    expect(screen.getByTestId('review-empty')).toHaveTextContent('All caught up');
    expect(screen.getByTestId('review-start')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('review-start-note')).toBeInTheDocument();
    expect(screen.getByTestId('review-retention')).toHaveTextContent('Not enough data yet');
    expect(screen.getByTestId('review-next-due')).toHaveTextContent('Nothing scheduled');
  });

  it('shows "New puzzles available" when nothing is scheduled ahead but intake exists', () => {
    renderWithProviders(
      <ReviewCard
        overview={overview({
          dueNow: 0,
          newCount: 1,
          queue: [{ puzzleId: 'p:a', kind: 'new', dueAt: null }],
          nextDueAt: null,
        })}
        now={NOW}
      />,
    );
    expect(screen.getByTestId('review-next-due')).toHaveTextContent('New puzzles available');
  });

  it('surfaces a load error', () => {
    renderWithProviders(<ReviewCard overview={null} isReady={false} error="boom" now={NOW} />);
    expect(screen.getByTestId('review-error')).toHaveTextContent('boom');
  });
});
