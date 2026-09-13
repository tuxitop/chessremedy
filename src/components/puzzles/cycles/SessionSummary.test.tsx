import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { SessionSummary } from './SessionSummary';
import type { SessionSummary as SessionSummaryData } from '@/domain/training';
import { renderWithProviders } from '@/test/test-utils';

const summaryFixture: SessionSummaryData = {
  puzzlesAttempted: 8,
  solvedFirstTry: 3,
  solvedWithHelp: 2,
  failed: 1,
  skipped: 1,
  completed: 6,
  firstTryAccuracy: 0.5,
  totalTimeMs: 750_000,
  averageTimeMs: 125_000,
  medianTimeMs: 100_000,
};

describe('SessionSummary', () => {
  it('renders the session result values', () => {
    renderWithProviders(
      <SessionSummary
        summary={summaryFixture}
        remainingPuzzles={4}
        cycleCompleted={false}
        onResume={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    expect(screen.getByTestId('session-summary-solved')).toHaveTextContent('5');
    expect(screen.getByTestId('session-summary-first-try')).toHaveTextContent('3');
    expect(screen.getByTestId('session-summary-solved-with-help')).toHaveTextContent('2');
    expect(screen.getByTestId('session-summary-failed')).toHaveTextContent('1');
    expect(screen.getByTestId('session-summary-skipped')).toHaveTextContent('1');
    expect(screen.getByTestId('session-summary-accuracy')).toHaveTextContent('50%');
    expect(screen.getByTestId('session-summary-time')).toHaveTextContent('12:30');
    expect(screen.getByTestId('session-summary-average')).toHaveTextContent('2:05');
    expect(screen.getByTestId('session-summary-remaining')).toHaveTextContent('4');
  });

  it('shows an em dash for empty rates and averages', () => {
    renderWithProviders(
      <SessionSummary
        summary={{ ...summaryFixture, firstTryAccuracy: null, averageTimeMs: null }}
        remainingPuzzles={0}
        cycleCompleted={false}
        onResume={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    expect(screen.getByTestId('session-summary-accuracy')).toHaveTextContent('—');
    expect(screen.getByTestId('session-summary-average')).toHaveTextContent('—');
  });

  it('shows View cycle results only when the cycle completed', () => {
    const onViewResults = vi.fn();
    const { rerender } = renderWithProviders(
      <SessionSummary
        summary={summaryFixture}
        remainingPuzzles={0}
        cycleCompleted={false}
        onResume={vi.fn()}
        onBack={vi.fn()}
        onViewResults={onViewResults}
      />,
    );
    expect(screen.queryByTestId('session-summary-view-results')).not.toBeInTheDocument();

    rerender(
      <SessionSummary
        summary={summaryFixture}
        remainingPuzzles={0}
        cycleCompleted
        onResume={vi.fn()}
        onBack={vi.fn()}
        onViewResults={onViewResults}
      />,
    );
    fireEvent.click(screen.getByTestId('session-summary-view-results'));
    expect(onViewResults).toHaveBeenCalledTimes(1);
  });

  it('calls the resume and back actions', () => {
    const onResume = vi.fn();
    const onBack = vi.fn();
    renderWithProviders(
      <SessionSummary
        summary={summaryFixture}
        remainingPuzzles={2}
        cycleCompleted={false}
        onResume={onResume}
        onBack={onBack}
      />,
    );

    fireEvent.click(screen.getByTestId('session-summary-resume'));
    expect(onResume).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('session-summary-back'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
