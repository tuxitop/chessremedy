import { describe, expect, it, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { db } from '@/infrastructure/db/database';
import { gamesRepository } from '@/infrastructure/db/games-repository';
import { fixtureGame } from '@/domain/chess/fixtures';
import { createFakeImportService } from '@/components/games/test-support/fakeImportService';
import { renderWithProviders } from '@/test/test-utils';
import { GamesPage } from './GamesPage';

async function seedGames(ids: string[]): Promise<void> {
  for (const id of ids) {
    await gamesRepository.saveGame(fixtureGame(id));
  }
}

function renderGames(): void {
  const rig = createFakeImportService();
  renderWithProviders(<GamesPage service={rig.service} />, { initialEntries: ['/games'] });
}

describe('GamesPage (Game Library)', () => {
  beforeEach(async () => {
    await db.games.clear();
    await db.settings.clear();
  });

  it('shows a distinct empty state when no games are stored', async () => {
    renderGames();
    expect(await screen.findByTestId('library-empty')).toBeInTheDocument();
  });

  it('lists stored games newest-first and filters by platform, search and clear-all', async () => {
    await seedGames(['cc-blitz-clean', 'li-rapid-clean']);
    renderGames();

    await waitFor(() => expect(screen.getAllByTestId('game-row')).toHaveLength(2));
    expect(screen.getByTestId('library-count')).toHaveTextContent('2 of 2 games');

    const user = userEvent.setup();
    // Platform filter → Lichess only.
    await user.selectOptions(screen.getByTestId('filter-platform'), 'lichess');
    await waitFor(() => expect(screen.getAllByTestId('game-row')).toHaveLength(1));
    expect(screen.getByTestId('game-source')).toHaveTextContent('Lichess');

    // Search (opponent) narrows further.
    await user.type(screen.getByTestId('library-search'), 'eagereddie');
    await waitFor(() => expect(screen.queryAllByTestId('game-row')).toHaveLength(0));
    expect(screen.getByTestId('library-no-match')).toBeInTheDocument();

    // Clearing search keeps the platform filter.
    await user.click(screen.getByTestId('library-search-clear'));
    await waitFor(() => expect(screen.getAllByTestId('game-row')).toHaveLength(1));

    // Clear-all removes the platform filter too.
    await user.click(screen.getByTestId('filter-clear-all'));
    await waitFor(() => expect(screen.getAllByTestId('game-row')).toHaveLength(2));
  });

  it('selects rows, shows the bulk bar, and deletes with confirmation', async () => {
    const bullet = fixtureGame('cc-bullet-blunder');
    const blitz = fixtureGame('cc-blitz-clean');
    await seedGames(['cc-bullet-blunder', 'cc-blitz-clean']);
    renderGames();

    const user = userEvent.setup();
    await waitFor(() => expect(screen.getAllByTestId('game-row')).toHaveLength(2));

    await user.click(screen.getByTestId(`game-select-${bullet.id}`));
    expect(screen.getByTestId('library-selection-bar')).toHaveTextContent('Selected: 1');
    expect(screen.getByTestId('library-analyze')).toBeDisabled();

    // Cancel keeps the games.
    await user.click(screen.getByTestId('library-delete'));
    await user.click(screen.getByTestId('delete-cancel'));
    expect(await gamesRepository.countGames()).toBe(2);

    // Confirming deletes the selected game from the database.
    await user.click(screen.getByTestId('library-delete'));
    await user.click(screen.getByTestId('delete-confirm'));
    await waitFor(async () => expect(await gamesRepository.countGames()).toBe(1));
    expect(await gamesRepository.hasGame(bullet.id)).toBe(false);
    expect(await gamesRepository.hasGame(blitz.id)).toBe(true);
    await waitFor(() => expect(screen.getAllByTestId('game-row')).toHaveLength(1));
  });

  it('select-all operates on the current filtered result set', async () => {
    await seedGames(['cc-bullet-blunder', 'cc-blitz-clean']);
    renderGames();
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getAllByTestId('game-row')).toHaveLength(2));

    await user.click(screen.getByTestId('library-select-all'));
    expect(screen.getByTestId('library-selection-bar')).toHaveTextContent('Selected: 2');
  });

  it('clears the selection when filters change', async () => {
    const bullet = fixtureGame('cc-bullet-blunder');
    await seedGames(['cc-bullet-blunder', 'cc-blitz-clean']);
    renderGames();

    const user = userEvent.setup();
    await waitFor(() => expect(screen.getAllByTestId('game-row')).toHaveLength(2));
    await user.click(screen.getByTestId(`game-select-${bullet.id}`));
    expect(screen.getByTestId('library-selection-bar')).toBeInTheDocument();

    await user.selectOptions(screen.getByTestId('filter-side'), 'white');
    await waitFor(() =>
      expect(screen.queryByTestId('library-selection-bar')).not.toBeInTheDocument(),
    );
  });
});
