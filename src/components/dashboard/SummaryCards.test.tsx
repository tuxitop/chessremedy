import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/test-utils';
import { richDashboardScenario } from '@/test/fixtures/dashboard/scenarios';
import { SummaryCards } from './SummaryCards';

function partition(key: string) {
  const data = richDashboardScenario().data;
  if (!data.gameMetrics.ok) {
    throw new Error('gameMetrics fixture must be ok');
  }
  const found = data.gameMetrics.result.partitions.find(
    (entry) => `${entry.platform}:${entry.timeControl}` === key,
  );
  if (found === undefined) {
    throw new Error(`missing fixture partition ${key}`);
  }
  return found;
}

describe('SummaryCards', () => {
  it('shows the value and sample size for an ok aggregate', () => {
    const rapid = partition('lichess:rapid');
    renderWithProviders(
      <SummaryCards metrics={rapid.metrics} partitionLabel="Lichess · Rapid" testId="rapid" />,
    );

    expect(screen.getByTestId('rapid-partition')).toHaveTextContent('Lichess · Rapid');
    expect(screen.getByTestId('rapid-accuracy-value')).not.toBeEmptyDOMElement();
    expect(screen.getByTestId('rapid-accuracy-sample')).toHaveTextContent(/^n = \d+ games$/);
    expect(screen.getByTestId('rapid-games-total')).toHaveTextContent('n = 12 games');
  });

  it('hides the value and shows the insufficient placeholder with n', () => {
    const blitz = partition('chesscom:blitz');
    renderWithProviders(
      <SummaryCards metrics={blitz.metrics} partitionLabel="Chess.com · Blitz" testId="blitz" />,
    );

    expect(screen.getByTestId('blitz-blunders-per-game-placeholder')).toHaveTextContent(
      'Insufficient data (n = 4)',
    );
    expect(screen.queryByTestId('blitz-blunders-per-game-value')).toBeNull();
  });

  it('shows "Tactics not scanned" for a notDetected missed-tactics aggregate', () => {
    const blitz = partition('chesscom:blitz');
    renderWithProviders(
      <SummaryCards metrics={blitz.metrics} partitionLabel="Chess.com · Blitz" testId="blitz" />,
    );

    expect(screen.getByTestId('blitz-missed-tactics-per-game-placeholder')).toHaveTextContent(
      'Tactics not scanned',
    );
  });

  it('shows "No data" for an empty aggregate', () => {
    const bullet = partition('lichess:bullet');
    renderWithProviders(
      <SummaryCards metrics={bullet.metrics} partitionLabel="Lichess · Bullet" testId="bullet" />,
    );

    expect(screen.getByTestId('bullet-accuracy-placeholder')).toHaveTextContent('No data');
  });
});
