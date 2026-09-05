import { test, expect, type Page } from '@playwright/test';

// Feature 010 end-to-end (Game Library milestone): import → analyze (real
// Stockfish) → completed row shows the insights strip → analysis-result
// filters behave. Engine-tolerant: everything asserted here is guaranteed by
// persisted state (a completed analysis job + its per-analysis summary);
// real-engine specifics (accuracy coverage, verified missed tactics) are
// never asserted.
const LONG = 180_000;
const RESULT_TIMEOUT = 120_000;
const USERNAME = 'chessremedy';

function pgn(white: string, black: string, result: string, moves: string): string {
  return [
    '[Event "Live Chess"]',
    '[Site "Chess.com"]',
    '[Date "2026.05.25"]',
    `[White "${white}"]`,
    `[Black "${black}"]`,
    `[Result "${result}"]`,
    '[WhiteElo "1500"]',
    '[BlackElo "1520"]',
    '[TimeControl "60"]',
    '',
    moves,
    result,
    '',
  ].join('\n');
}

const BULLET_PGN = pgn(
  USERNAME,
  'bulletpete',
  '0-1',
  '1. f3 {[%clk 0:05:00]} e5 {[%clk 0:04:59]} 2. g4 {[%clk 0:04:57]} Qh4# {[%clk 0:04:55]}',
);

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
      body = JSON.stringify({
        games: [
          {
            url: 'https://www.chess.com/game/live/7123456701',
            pgn: BULLET_PGN,
            time_control: '60',
            time_class: 'standard',
            end_time: Math.floor(Date.parse('2026-05-25T00:00:00Z') / 1000),
            rated: true,
            rules: 'chess',
            white: { username: USERNAME, rating: 1500 },
            black: { username: 'bulletpete', rating: 1520 },
          },
        ],
      });
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body });
  });
}

test.describe('Game Library analysis stats & filters (Feature 010)', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(LONG);

  test('shows the insights strip for a completed analysis and filters by it', async ({ page }) => {
    const gameId = 'chesscom:7123456701';
    await enableChessMock(page);

    // A fresh context → a fresh IndexedDB library.
    await page.goto('/games');
    await expect(page.getByTestId('library-empty')).toBeVisible();

    // Import the fixture bullet game through the mocked Chess.com archive.
    await page.getByTestId('import-toggle').click();
    await page.getByTestId('import-username-chesscom').fill(USERNAME);
    await page.getByTestId('import-run-chesscom').click();
    await expect(page.getByTestId('import-status-chesscom')).toContainText('Done');
    await expect(page.getByTestId('game-row')).toHaveCount(1);

    // Use the fast profile for bulk analysis (set the engine default).
    await page.goto('/settings');
    await expect(page.getByTestId('setting-default-profile')).toBeVisible();
    await page.getByTestId('setting-default-profile').selectOption('fast');

    await page.goto('/games');
    await expect(page.getByTestId('game-row')).toHaveCount(1);
    expect(page.getByTestId(`game-analysis-${gameId}`)).toHaveAttribute(
      'data-status',
      'unanalyzed',
    );

    // Select the game and start bulk analysis (real Stockfish in a Worker).
    await page.getByTestId(`game-select-${gameId}`).click();
    await page.getByTestId('library-analyze').click();
    await expect(page.getByTestId(`game-review-${gameId}`)).toBeVisible({
      timeout: RESULT_TIMEOUT,
    });
    await expect(page.getByTestId(`game-analysis-${gameId}`)).toHaveAttribute(
      'data-status',
      'completed',
    );

    // Open the Review once (the entrypoint proves the run completed), then
    // return to the Library so the rows reload with the persisted summary.
    await page.getByTestId(`game-review-${gameId}`).click();
    await expect(page.getByTestId('review-layout')).toBeVisible();
    await page.getByTestId('review-back').click();
    await expect(page.getByTestId('games-page')).toBeVisible();

    // The completed row shows the insights strip. The container is guaranteed
    // (completed status + persisted per-analysis summary); the classification
    // count items render whenever the summary exists. Accuracy is real-engine
    // derived (may be absent) and missed tactics wait on the detection pass —
    // neither is asserted.
    await expect(page.getByTestId(`game-analysis-${gameId}`)).toHaveAttribute(
      'data-status',
      'completed',
    );
    const strip = page.getByTestId(`row-insights-${gameId}`);
    await expect(strip).toBeVisible();
    await expect(strip.getByTestId('row-insights-blunders')).toBeVisible();

    // The three Feature-010 filter controls exist on the toolbar.
    await expect(page.getByTestId('filter-analysis')).toBeVisible();
    await expect(page.getByTestId('filter-has-blunders')).toBeVisible();
    await expect(page.getByTestId('filter-has-missed-tactics')).toBeVisible();

    // "Analyzed" matches the completed game.
    await page.getByTestId('filter-analysis').selectOption('analyzed');
    await expect(page.getByTestId('game-row')).toHaveCount(1);
    await expect(page.getByTestId(`row-insights-${gameId}`)).toBeVisible();

    // The only imported game is analyzed, so "Not analyzed" matches nothing.
    await page.getByTestId('filter-analysis').selectOption('notAnalyzed');
    await expect(page.getByTestId('library-no-match')).toBeVisible();
    await expect(page.getByTestId('library-count')).toHaveText('0 of 1 games');

    // Resetting the filters restores the analyzed row and its strip.
    await page.getByTestId('filter-clear-all').click();
    await expect(page.getByTestId('game-row')).toHaveCount(1);
    await expect(page.getByTestId(`row-insights-${gameId}`)).toBeVisible();
  });
});
