/**
 * Feature 018 — `HomeContinueCard` tests.
 */

import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/test-utils';
import { QUICK_TRAIN_SET_ID } from '@/domain/training/autoSet';
import { HomeContinueCard } from './HomeContinueCard';

describe('HomeContinueCard', () => {
  it('renders a cycle target with its label, status and href', () => {
    renderWithProviders(
      <HomeContinueCard
        target={{
          kind: 'cycle',
          setId: 'home-set',
          cycleNumber: 2,
          label: 'Rapid review',
          quickTrain: false,
        }}
      />,
    );

    expect(screen.getByTestId('home-continue-label')).toHaveTextContent('Rapid review');
    expect(screen.getByTestId('home-continue-status')).toHaveTextContent(/Cycle 2 in progress/);
    expect(screen.getByTestId('home-continue-link')).toHaveAttribute(
      'href',
      '/training/sets/home-set/cycles/2',
    );
  });

  it('renders a Quick-train cycle as "Quick train"', () => {
    renderWithProviders(
      <HomeContinueCard
        target={{
          kind: 'cycle',
          setId: QUICK_TRAIN_SET_ID,
          cycleNumber: 4,
          label: 'Quick train',
          quickTrain: true,
        }}
      />,
    );

    expect(screen.getByTestId('home-continue-label')).toHaveTextContent('Quick train');
    expect(screen.getByTestId('home-continue-status')).toHaveTextContent(/Quick train/);
    expect(screen.getByTestId('home-continue-link')).toHaveAttribute(
      'href',
      `/training/sets/${QUICK_TRAIN_SET_ID}/cycles/4`,
    );
  });

  it('renders an open block target', () => {
    renderWithProviders(
      <HomeContinueCard
        target={{ kind: 'block', setId: 'home-block', label: 'Woodpecker block' }}
      />,
    );

    expect(screen.getByTestId('home-continue-label')).toHaveTextContent('Woodpecker block');
    expect(screen.getByTestId('home-continue-status')).toHaveTextContent(/Open block/);
    expect(screen.getByTestId('home-continue-link')).toHaveAttribute(
      'href',
      '/training/sets/home-block',
    );
  });

  it('renders a set target', () => {
    renderWithProviders(
      <HomeContinueCard target={{ kind: 'set', setId: 'home-set', label: 'Rapid review' }} />,
    );

    expect(screen.getByTestId('home-continue-status')).toHaveTextContent(/Continue this set/);
    expect(screen.getByTestId('home-continue-link')).toHaveAttribute(
      'href',
      '/training/sets/home-set',
    );
  });

  it('renders nothing for a none target', () => {
    const { container } = renderWithProviders(<HomeContinueCard target={{ kind: 'none' }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
