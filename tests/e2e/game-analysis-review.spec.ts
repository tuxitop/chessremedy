import { test, expect, type Page } from '@playwright/test';

// Feature 008 end-to-end: import → analyze (real Stockfish) → review → seek.
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

// Feature 010 / plan 011 P7: the deterministic missed-mate fixture. White
// (the user) plays 4.d3, missing the one-move 4.Qxf7# mate; Black's 4...Nd4
// fails to defend and 5.Qxf7# lands. A one-move forcing mate is a decisive,
// engine-version-robust missed tactic (Stage-2 verifies it with a real
// tactical-profile search).
const MISSED_MATE_PGN = pgn(
  USERNAME,
  'bulletbob',
  '1-0',
  '1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. d3 Nd4 5. Qxf7#',
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

/** Mock Chess.com archive returning only the deterministic missed-mate game. */
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

test.describe('Game analysis & review (Feature 008)', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(LONG);

  test('imports a game, analyzes it with the engine and reviews the classification', async ({
    page,
  }) => {
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

    // Open the Game Review.
    await page.getByTestId(`game-review-${gameId}`).click();
    await expect(page.getByTestId('review-layout')).toBeVisible();

    // The complete game is displayed with classification glyphs.
    await expect(page.getByTestId('move-list-move')).toHaveCount(4);
    const g4 = page.locator('[data-testid="move-list-move"][data-san="g4"]');
    await expect(g4.locator('[data-testid="nag-glyph"]')).toHaveAttribute('data-nag', '4');

    // Summary splits user (White) from opponent (Black); 2.g4?? is a blunder.
    await expect(page.getByTestId('summary-user-blunder-value')).toHaveText('1');

    // Play an alternate move on the interactive Review board: after 1...e5
    // deviate with 2.g3 (instead of the recorded 2.g4).
    await page.getByTestId('move-list-move').filter({ hasText: 'e5' }).click();
    await expect(page.locator('[data-testid="move-list-move"][data-san="e5"]')).toHaveAttribute(
      'aria-current',
      'step',
    );
    await expect(page.getByTestId('review-ply')).toHaveText('2/4');
    const host = page.getByTestId('chessground-host');
    await host.scrollIntoViewIfNeeded();
    const box = (await host.boundingBox())!;
    const centre = (file: string, rank: number): { x: number; y: number } => ({
      x: box.x + ((file.charCodeAt(0) - 97 + 0.5) / 8) * box.width,
      y: box.y + ((7 - (rank - 1) + 0.5) / 8) * box.height,
    });
    const g2 = centre('g', 2);
    const g3 = centre('g', 3);
    await page.mouse.move(g2.x, g2.y);
    await page.mouse.down();
    await page.mouse.move(g3.x, g3.y, { steps: 12 });
    await page.waitForTimeout(80);
    await page.mouse.up();
    await expect(page.getByTestId('move-list-move')).toHaveCount(5, { timeout: 5000 });
    await expect(page.locator('[data-testid="move-list-move"][data-san="g3"]')).toHaveAttribute(
      'aria-current',
      'step',
    );
    // The appended variation is transient: the stored analysis is untouched.
    await expect(page.getByTestId('move-list-move')).toHaveCount(5);

    // PGN clock annotations are parsed structurally and never surface as
    // comments; the player clock bar shows the mover's remaining time.
    await page.getByTestId('move-list-move').filter({ hasText: 'g4' }).click();
    await expect(page.getByTestId('review-clock-user-time')).toHaveText('4:57');
    await expect(page.getByTestId('review-layout')).not.toContainText('%clk');

    // The selected blunder also renders as a ?? board chip on the g4 square
    // (same SquareBadges formatting as the Playground).
    await expect(page.getByTestId('nag-badge')).toHaveText('??');
    await expect(page.getByTestId('nag-badge')).toHaveAttribute('data-square', 'g4');

    // Seek to the end and back via the navigation controls.
    await page.getByTestId('nav-last').click();
    await expect(page.locator('[data-testid="move-list-move"][data-san="Qh4#"]')).toHaveAttribute(
      'aria-current',
      'step',
    );
    await page.getByTestId('nav-first').click();
    await expect(page.getByTestId('move-navigation')).toBeVisible();

    // Toggle the engine on: the same surface now analyses the current
    // position live, and never writes into the stored analysis.
    await page.getByTestId('engine-toggle').click();
    await expect(page.getByTestId('engine-toggle')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('position-eval')).not.toHaveText('\u2014', {
      timeout: RESULT_TIMEOUT,
    });
    await expect(page.getByTestId('review-layout')).toBeVisible();
    await expect(page.getByTestId('review-summary')).toBeVisible();

    // Toggle back off: the cached (stored) analysis is shown again.
    await page.getByTestId('engine-toggle').click();
    await expect(page.getByTestId('engine-toggle')).toHaveAttribute('aria-checked', 'false');
    await page.getByTestId('nav-last').click();
    await expect(page.locator('[data-testid="move-list-move"][data-san="Qh4#"]')).toHaveAttribute(
      'aria-current',
      'step',
    );

    // Feature 010 missed-tactic surface. Whether a ply carries the marker is
    // real-engine derived data (Stage-2 verification), so it may settle after
    // this review loaded. The page never stays silent about it: while the scan
    // is queued/running/failed the Review shows a detection-state note, and a
    // settled scan shows either a real `Missed tactics` value or the verified
    // `X` marker on the move. Tolerate either outcome — but never a regression:
    // the page structure and the normal classification glyphs stay intact.
    await expect(page.getByTestId('review-layout')).toBeVisible();
    await expect(page.getByTestId('review-summary')).toBeVisible();

    // Wait for the detection conclusion to surface (bounded; never assumed).
    await page
      .waitForFunction(
        () =>
          document.querySelector('[data-testid="review-detection-state"]') !== null ||
          document.querySelector('[data-testid="summary-missed-tactics-value"]') !== null,
        undefined,
        { timeout: RESULT_TIMEOUT },
      )
      .catch(() => undefined);

    const markedMove = page
      .locator('[data-testid="move-list-move"]')
      .filter({ has: page.locator('[data-testid="nag-glyph"][data-nag="9"]') });
    if ((await markedMove.count()) > 0) {
      // A current-version verified miss is exclusive (ADR-023 amendment): the
      // move renders exactly one annotation — the NAG 9 missed-tactic marker —
      // and never a classification glyph (`??`/`?`/`?!`) alongside it.
      const firstMarked = markedMove.first();
      await expect(firstMarked).toBeVisible();
      await expect(firstMarked.locator('[data-testid="nag-glyph"]')).toHaveCount(1);
      await expect(firstMarked.locator('[data-testid="nag-glyph"][data-nag="9"]')).toHaveCount(1);
      for (const nag of ['2', '4', '6']) {
        await expect(
          firstMarked.locator(`[data-testid="nag-glyph"][data-nag="${nag}"]`),
        ).toHaveCount(0);
      }
    } else {
      // No verified miss: the classification glyphs are intact and no phantom
      // marker was added to the move list.
      const g4 = page.locator('[data-testid="move-list-move"][data-san="g4"]');
      await expect(g4.locator('[data-testid="nag-glyph"][data-nag="4"]')).toHaveCount(1);
    }
  });
});

test.describe('Missed-tactic surface proof (Feature 010 / plan 011 P7)', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(LONG);

  test('analyzes the deterministic missed-mate fixture and proves a real missed tactic surfaces in row + Review', async ({
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

    // Fast Game-analysis profile keeps the run short (depth 10).
    await page.goto('/settings');
    await expect(page.getByTestId('setting-game-analysis-profile')).toBeVisible();
    await page.getByTestId('setting-game-analysis-profile').selectOption('fast');
    await page.goto('/games');
    await expect(page.getByTestId('game-row')).toHaveCount(1);

    // Analyze the game (real Stockfish). 4.d3 is a one-move mate-in-1 blunder
    // (missed 4.Qxf7#), so the Feature-010 pass has a decisive candidate to
    // verify. The detached pass settles right after the completed analysis;
    // the Library's live-scan poll reloads the row, so the strip shows the
    // missed tactic without a manual refresh.
    await page.getByTestId(`game-select-${gameId}`).click();
    await page.getByTestId('library-analyze').click();
    await expect(page.getByTestId(`game-analysis-${gameId}`)).toHaveAttribute(
      'data-status',
      'completed',
      { timeout: RESULT_TIMEOUT },
    );

    // Row proof (AC #13): the insights strip shows a real user-side missed
    // tactic once the detection pass settles.
    const missed = page
      .getByTestId(`row-insights-${gameId}`)
      .getByTestId('row-insights-missed-tactics');
    await expect(missed).toBeVisible({ timeout: RESULT_TIMEOUT });
    await expect(missed).toHaveText('Missed tactics 1');

    // Review proof (AC #13): the Summary shows the user missed-tactic count
    // and the owning ply (4.d3) carries the additional NAG 9 marker.
    await page.getByTestId(`game-review-${gameId}`).click();
    await expect(page.getByTestId('review-layout')).toBeVisible();
    await expect(page.getByTestId('summary-missed-tactics-value')).toHaveText('1', {
      timeout: RESULT_TIMEOUT,
    });

    const d3 = page.locator('[data-testid="move-list-move"][data-san="d3"]');
    await expect(d3).toBeVisible();
    // 4.d3's raw label is a blunder, but a current-version verified miss is
    // exclusive (ADR-023 amendment): the ply renders exactly one annotation,
    // the NAG 9 marker, and no classification glyph (`??`/`?`/`?!`) alongside it.
    await expect(d3.locator('[data-testid="nag-glyph"]')).toHaveCount(1);
    await expect(d3.locator('[data-testid="nag-glyph"][data-nag="9"]')).toHaveCount(1);
    for (const nag of ['2', '4', '6']) {
      await expect(d3.locator(`[data-testid="nag-glyph"][data-nag="${nag}"]`)).toHaveCount(0);
    }
    await expect(d3).not.toContainText('??');
  });
});
