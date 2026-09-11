import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { SpacingNudge } from './SpacingNudge';
import { renderWithProviders } from '@/test/test-utils';

describe('SpacingNudge', () => {
  it('recommends a break and never blocks the session', () => {
    const onStartAnyway = vi.fn();
    renderWithProviders(
      <SpacingNudge
        setName="Woodpecker block"
        previousCycleNumber={2}
        onStartAnyway={onStartAnyway}
        testId="nudge"
      />,
    );

    expect(screen.getByTestId('nudge')).toHaveTextContent('Spacing guidance');
    expect(screen.getByTestId('nudge-text')).toHaveTextContent('cycle 2');
    expect(screen.getByTestId('nudge-text')).toHaveTextContent('different days');
    expect(screen.getByTestId('nudge-text')).toHaveTextContent('guidance, not a rule');

    const start = screen.getByTestId('nudge-start');
    expect(start).toHaveTextContent('Start anyway');
    fireEvent.click(start);
    expect(onStartAnyway).toHaveBeenCalledTimes(1);
  });

  it('announces the guidance politely', () => {
    renderWithProviders(
      <SpacingNudge
        setName="Block"
        previousCycleNumber={1}
        onStartAnyway={() => undefined}
        testId="nudge"
      />,
    );

    const text = screen.getByTestId('nudge-text');
    expect(text).toHaveAttribute('role', 'status');
    expect(text).toHaveAttribute('aria-live', 'polite');
  });
});
