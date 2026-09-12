import { test, expect, type Page } from '@playwright/test';

const USERNAME = 'chessremedy';

function pgn(
  event: string,
  white: string,
  black: string,
  date: string,
  timeControl: string,
  result: string,
  moves: string,
): string {
  return [
    `[Event "${event}"]`,
    `[Site "Chess.com"]`,
    `[Date "${date}"]`,
    `[White "${white}"]`,
    `[Black "${black}"]`,
    `[Result "${result}"]`,
    `[WhiteElo "1500"]`,
    `[BlackElo "1520"]`,
    `[TimeControl "${timeControl}"]`,
    '',
    moves,
    result,
    '',
  ].join('\n');
}

const BULLET_PGN = pgn(
  'Live Chess',
  USERNAME,
  'bulletpete',
  '2026.05.25',
  '60',
  '0-1',
  '1. f3 e5 2. g4 Qh4#',
);
const BLITZ_PGN = pgn(
  'Live Chess',
  'eagereddie',
  USERNAME,
  '2026.05.28',
  '300+0',
  '0-1',
  '1. e4 e5 2. Nf3 Nc6 3. Bc4 Nd4 4. Nxe5 Qg5 5. Nxf7 Qxg2 6. Rf1 Qxe4+ 7. Be2 Nf3#',
);

function gameJson(
  id: number,
  pgnText: string,
  white: string,
  black: string,
  endDate: string,
  tc: string,
) {
  return {
    url: `https://www.chess.com/game/live/${id}`,
    pgn: pgnText,
    time_control: tc,
    time_class: 'standard',
    end_time: Math.floor(Date.parse(`${endDate}T00:00:00Z`) / 1000),
    rated: true,
    rules: 'chess',
    white: { username: white, rating: 1500 },
    black: { username: black, rating: 1520 },
  };
}

const monthGames = [
  gameJson(7123456701, BULLET_PGN, USERNAME, 'bulletpete', '2026-05-25', '60'),
  gameJson(7123456702, BLITZ_PGN, 'eagereddie', USERNAME, '2026-05-28', '300+0'),
];

async function enableChessMock(page: Page): Promise<void> {
  await page.route('**/api.chess.com/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const base = `/pub/player/${USERNAME}`;
    let body = '{}';
    if (path === base) {
      body = JSON.stringify({ username: USERNAME, player_id: 1 });
    } else if (path === `${base}/games/archives`) {
      body = JSON.stringify({
        archives: [`https://api.chess.com/pub/player/${USERNAME}/games/2026/05`],
      });
    } else if (path === `${base}/games/2026/05`) {
      body = JSON.stringify({ games: monthGames });
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body });
  });
}

test.describe('Game Library (Chess.com, mocked)', () => {
  test('import → browse → filter → search → select → delete, and never runs the engine', async ({
    page,
  }) => {
    await enableChessMock(page);
    await page.goto('/games');
    await expect(page.getByTestId('library-empty')).toBeVisible();

    // Import two May games through the (collapsible) import section.
    await page.getByTestId('import-toggle').click();
    await page.getByTestId('import-username-chesscom').fill(USERNAME);
    await page.getByTestId('import-run-chesscom').click();
    await expect(page.getByTestId('import-status-chesscom')).toContainText('Done');
    await expect(page.getByTestId('game-row')).toHaveCount(2);

    // Filter by platform, time control and side; results narrow (AND).
    await page.getByTestId('filter-platform').selectOption('chesscom');
    await expect(page.getByTestId('game-row')).toHaveCount(2);
    await page.getByTestId('filter-timecontrol').selectOption('bullet');
    await expect(page.getByTestId('game-row')).toHaveCount(1);
    await page.getByTestId('filter-side').selectOption('white');
    await expect(page.getByTestId('game-row')).toHaveCount(1);
    await expect(page.getByTestId('library-count')).toHaveText('Showing 1 of 1 game');

    // Search for the other game's opponent and verify no-match, then clear.
    await page.getByTestId('library-search').fill('eagereddie');
    await expect(page.getByTestId('library-no-match')).toBeVisible();
    await page.getByTestId('filter-clear-all').click();
    await expect(page.getByTestId('game-row')).toHaveCount(2);

    // Search alone finds the blitz game.
    await page.getByTestId('library-search').fill('eagereddie');
    await expect(page.getByTestId('game-row')).toHaveCount(1);
    await page.getByTestId('library-search-clear').click();
    await expect(page.getByTestId('game-row')).toHaveCount(2);

    // Select all (current filtered set = both), then delete with confirmation.
    await page.getByTestId('library-select-all').click();
    await expect(page.getByTestId('library-clear-selection')).toContainText('Clear selection (2)');
    await page.getByTestId('library-delete').click();
    await page.getByTestId('delete-confirm').click();
    await expect(page.getByTestId('library-empty')).toBeVisible();
    await expect(page.getByTestId('game-row')).toHaveCount(0);

    // No Stockfish worker was ever spawned.
    const engineWorkers = page.workers().filter((w) => w.url().includes('stockfish'));
    expect(engineWorkers).toHaveLength(0);
  });
});
