import { test, expect, type Page } from '@playwright/test';

// Feature 011 end-to-end: analysis → detection → puzzle generation auto-runs
// (engine-free) and the generated puzzle is inspectable from the Game Library
// row and the read-only per-game puzzle view. No solving, no engine in the
// generation path itself (the detection pass that feeds it uses real
// Stockfish on the deterministic missed-mate fixture).
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

// Feature 010/011 fixture: White (the user) plays 4.d3, missing 4.Qxf7#.
const MISSED_MATE_PGN = pgn(
  USERNAME,
  'bulletbob',
  '1-0',
  '1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. d3 Nd4 5. Qxf7#',
);

async function enableMissedMateMock(page: Page): Promise<void> {
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
            url: 'https://www.chess.com/game/live/7123456703',
            pgn: MISSED_MATE_PGN,
            time_control: '60',
            time_class: 'standard',
            end_time: Math.floor(Date.parse('2026-05-25T00:02:00Z') / 1000),
            rated: true,
            rules: 'chess',
            white: { username: USERNAME, rating: 1821 },
            black: { username: 'bulletbob', rating: 1795 },
          },
        ],
      });
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body });
  });
}

test.describe('Puzzle generation (Feature 011)', () => {
  test.setTimeout(LONG);

  test('auto-generates a puzzle after detection and shows it in Library + per-game view', async ({
    page,
  }) => {
    const gameId = 'chesscom:7123456703';
    await enableMissedMateMock(page);

    // A fresh context → a fresh IndexedDB library.
    await page.goto('/games');
    await expect(page.getByTestId('library-empty')).toBeVisible();
    await page.getByTestId('import-toggle').click();
    await page.getByTestId('import-username-chesscom').fill(USERNAME);
    await page.getByTestId('import-run-chesscom').click();
    await expect(page.getByTestId('import-status-chesscom')).toContainText('Done');
    await expect(page.getByTestId('game-row')).toHaveCount(1);

    // Fast Game-analysis profile keeps the engine run short (depth 10).
    await page.goto('/settings');
    await expect(page.getByTestId('setting-game-analysis-profile')).toBeVisible();
    await page.getByTestId('setting-game-analysis-profile').selectOption('fast');
    await page.goto('/games');
    await expect(page.getByTestId('game-row')).toHaveCount(1);

    // Analyze (real Stockfish). 4.d3 missed 4.Qxf7# → a decisive candidate is
    // verified, then puzzle generation auto-runs engine-free after detection.
    await page.getByTestId(`game-select-${gameId}`).click();
    await page.getByTestId('library-analyze').click();
    await expect(page.getByTestId(`game-analysis-${gameId}`)).toHaveAttribute(
      'data-status',
      'completed',
      { timeout: RESULT_TIMEOUT },
    );

    // Library row proof: the generated puzzle count appears once generation
    // settles (absent-vs-zero: a real 1 here, not a state note).
    const rowPuzzles = page
      .getByTestId(`row-insights-${gameId}`)
      .getByTestId('row-insights-puzzles');
    await expect(rowPuzzles).toBeVisible({ timeout: RESULT_TIMEOUT });
    await expect(rowPuzzles).toHaveText('Puzzles 1');

    // Open the read-only per-game puzzle view.
    await page.getByTestId(`game-puzzles-${gameId}`).click();
    await expect(page.getByTestId('puzzles-page')).toBeVisible();

    // Generation state line shows the completed count.
    await expect(page.getByTestId('puzzles-state-note')).toContainText('1', {
      timeout: RESULT_TIMEOUT,
    });

    // The single card for the missed mate at sourcePly 6 (4.d3).
    const card = page.getByTestId('puzzle-card-6');
    await expect(card).toBeVisible();

    // Exclusivity (ADR-023 amendment): the ply is a current-version verified
    // candidate *and* a raw blunder, but it yields exactly one puzzle — the
    // blunder-origin input must not add a duplicate row for the same ply.
    await expect(page.locator('[data-testid^="puzzle-card-"]')).toHaveCount(1);

    // Board present (starting position rendered through the shared wrapper).
    await expect(card.getByTestId('puzzle-board-6')).toBeVisible();
    await expect(card.getByTestId('puzzle-board-6').locator('cg-board')).toBeVisible();

    // Provenance: you played 4.d3; solution is the mate Qxf7#. The solution is
    // hidden behind the per-card "Show solution" reveal until pressed.
    await expect(card.getByTestId('puzzle-provenance-6')).toContainText('Move 4');
    await expect(card.getByTestId('puzzle-played-6')).toContainText('d3');
    await expect(card.getByTestId('puzzle-solution-6')).not.toBeVisible();
    await expect(card.getByTestId('puzzle-reveal-6')).toContainText('Show solution');
    await card.getByTestId('puzzle-reveal-6').click();
    await expect(card.getByTestId('puzzle-solution-6')).toContainText('Qxf7#');
    await expect(card.getByTestId('puzzle-reveal-6')).toContainText('Hide solution');

    // Objective + difficulty bucket/score are rendered read-only.
    await expect(card.getByTestId('puzzle-objective-6')).toHaveText('Forced mate');
    await expect(card.getByTestId('puzzle-difficulty-6')).toBeVisible();
  });
});
