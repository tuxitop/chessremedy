import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { db } from '@/infrastructure/db/database';
import { gamesRepository } from '@/infrastructure/db/games-repository';
import { fixtureGame } from '@/domain/chess/fixtures';
import { createFakeImportService } from '@/components/games/test-support/fakeImportService';
import { GamesPage } from './GamesPage';

describe('GamesPage', () => {
  beforeEach(async () => {
    await db.games.clear();
    await db.settings.clear();
  });

  it('shows the import panels and an empty state when no games are stored', async () => {
    const rig = createFakeImportService();
    render(<GamesPage service={rig.service} />);
    expect(screen.getByTestId('games-page')).toBeInTheDocument();
    expect(screen.getByTestId('import-panel-chesscom')).toBeInTheDocument();
    expect(screen.getByTestId('import-panel-lichess')).toBeInTheDocument();
    expect(await screen.findByTestId('imported-games-empty')).toBeInTheDocument();
  });

  it('lists stored games and filters them by platform and opponent', async () => {
    const blitz = fixtureGame('cc-blitz-clean'); // chesscom, user black vs eagereddie
    const rapid = fixtureGame('li-rapid-clean'); // lichess, user black vs rapidron
    await gamesRepository.saveGame(blitz);
    await gamesRepository.saveGame(rapid);

    const rig = createFakeImportService();
    render(<GamesPage service={rig.service} />);

    await waitFor(() => expect(screen.getAllByTestId('game-row')).toHaveLength(2));
    expect(screen.getByTestId('gfilter-count')).toHaveTextContent('2 of 2 games');

    const user = userEvent.setup();
    await user.click(screen.getByTestId('gfilter-source-lichess'));
    await waitFor(() => expect(screen.getAllByTestId('game-row')).toHaveLength(1));
    expect(screen.getByTestId('gfilter-count')).toHaveTextContent('1 of 2 games');
    expect(screen.getByTestId('game-source')).toHaveTextContent('Lichess');

    await user.click(screen.getByTestId('gfilter-reset'));
    await waitFor(() => expect(screen.getAllByTestId('game-row')).toHaveLength(2));

    await user.type(screen.getByTestId('gfilter-opponent'), 'eagereddie');
    await waitFor(() => expect(screen.getAllByTestId('game-row')).toHaveLength(1));
    expect(screen.getByTestId('gfilter-count')).toHaveTextContent('1 of 2 games');
  });

  it('runs an import through the injected service and refreshes after completion', async () => {
    const rig = createFakeImportService();
    render(<GamesPage service={rig.service} />);
    const user = userEvent.setup();

    await user.type(screen.getByTestId('import-username-chesscom'), 'remy');
    await user.click(screen.getByTestId('import-run-chesscom'));
    await waitFor(() => expect(rig.starts).toHaveLength(1));
    expect(rig.starts[0]).toMatchObject({ provider: 'chesscom', username: 'remy' });
  });
});
