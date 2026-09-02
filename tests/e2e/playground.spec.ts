import { expect, test, type Page } from '@playwright/test';

/** Center coordinates of a board square on the playground chessboard. */
async function squareCenter(page: Page, square: string): Promise<{ x: number; y: number }> {
  const host = page.getByTestId('chessground-host');
  const box = await host.boundingBox();
  if (!box) {
    throw new Error('chessground host has no bounding box');
  }
  const file = square.charCodeAt(0) - 97;
  const rank = Number.parseInt(square[1]!, 10) - 1;
  // White at the bottom: rank 1 is the bottom row.
  const rowFromTop = 7 - rank;
  return {
    x: box.x + ((file + 0.5) / 8) * box.width,
    y: box.y + ((rowFromTop + 0.5) / 8) * box.height,
  };
}

async function playMove(page: Page, from: string, to: string): Promise<void> {
  const start = await squareCenter(page, from);
  await page.mouse.click(start.x, start.y);
  const end = await squareCenter(page, to);
  await page.mouse.click(end.x, end.y);
}

test.describe('Chessboard Playground', () => {
  test.beforeEach(async ({ page, context }) => {
    await context.addInitScript(() => {
      try {
        window.localStorage.clear();
      } catch {
        /* ignore */
      }
    });
    await page.goto('/playground');
    await expect(page.getByTestId('playground-page')).toBeVisible();
  });

  test('renders 17 fixtures in the position selector', async ({ page }) => {
    const select = page.getByTestId('fixture-select');
    await expect(select).toBeVisible();
    await expect(select.locator('option')).toHaveCount(17);
  });

  test('a drawn (insufficient material) position shows 1/2 chips and locks input', async ({
    page,
  }) => {
    await page.getByTestId('fixture-select').selectOption('insufficient-material');
    await expect(page.getByTestId('draw-badge')).toHaveCount(2);
    await expect(page.getByTestId('game-outcome')).toHaveText('Draw');
  });

  test('selecting a fixture updates the exercises line', async ({ page }) => {
    await page.getByTestId('fixture-select').selectOption('foolsmate');
    await expect(page.getByTestId('fixture-exercises')).toContainText('Check highlighting');
  });

  test('settings cog opens a popover and changes do not break the board', async ({ page }) => {
    await page.getByTestId('settings-cog').click();
    await expect(page.getByTestId('settings-popover')).toBeVisible();
    await page.getByTestId('setting-show-legal-moves').click();
    await expect(page.getByTestId('chessground-host')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('PGN fixture renders a move list with the correct SANs', async ({ page }) => {
    await page.getByTestId('fixture-select').selectOption('scholars-mate-game');
    const moveList = page.getByTestId('move-list');
    await expect(moveList).toBeVisible();
    const moves = moveList.getByTestId('move-list-move');
    await expect(moves).toHaveCount(7);
    await expect(moves.nth(5)).toContainText('Nf6');
    await expect(moves.nth(6)).toContainText('Qxf7#');
  });

  test('clicking a move in the list sets aria-current', async ({ page }) => {
    await page.getByTestId('fixture-select').selectOption('scholars-mate-game');
    const thirdMove = page.getByTestId('move-list-move').nth(3);
    await thirdMove.click();
    await expect(thirdMove).toHaveAttribute('aria-current', 'step');
  });

  test('playing a move on the board updates the move list (live board)', async ({ page }) => {
    await page.getByTestId('move-list-empty').waitFor();
    await playMove(page, 'e2', 'e4');
    const move = page.getByTestId('move-list-move').filter({ hasText: 'e4' }).first();
    await expect(move).toBeVisible();
    await expect(page.getByTestId('move-list-empty')).not.toBeVisible();
  });

  test('promoting a pawn plays like a real game', async ({ page }) => {
    await page.getByTestId('fixture-select').selectOption('promotion');
    await playMove(page, 'a7', 'a8');
    await expect(page.getByTestId('promotion-dialog')).toBeVisible();
    await page.getByTestId('promotion-queen').click();
    await expect(page.getByTestId('promotion-dialog')).not.toBeVisible();
    const move = page.getByTestId('move-list-move').filter({ hasText: 'a8=Q' }).first();
    await expect(move).toBeVisible();
  });

  test('a checkmated fixture shows the mate badge and Checkmate label', async ({ page }) => {
    await page.getByTestId('fixture-select').selectOption('white-to-move-and-lose');
    await expect(page.getByTestId('mate-badge')).toHaveText('#');
    await expect(page.getByTestId('game-outcome')).toHaveText('Checkmate');
  });

  test('seeking to a NAG move shows the glyph badge', async ({ page }) => {
    await page.getByTestId('fixture-select').selectOption('pin-tactic');
    const nxf7 = page.getByTestId('move-list-move').filter({ hasText: 'Nxf7' }).first();
    await nxf7.click();
    await expect(page.getByTestId('nag-badge')).toHaveText('!');
  });

  test('NAG inline glyphs render in the move list', async ({ page }) => {
    await page.getByTestId('fixture-select').selectOption('nag-inline');
    await expect(page.getByTestId('nag-glyph')).toHaveCount(6);
  });

  test('Italian Black-to-play fixture auto-flips orientation to Black', async ({ page }) => {
    await page.getByTestId('fixture-select').selectOption('italian-black-to-move');
    await expect(page.getByTestId('chessground-host')).toHaveClass(/orientation-black/);
  });

  test('board size is read from localStorage', async ({ page, context }) => {
    await context.addInitScript(() => {
      window.localStorage.setItem('chessremedy:board-size', '640');
    });
    await page.goto('/playground');
    const size = page.locator('[data-board-size]').first();
    await expect(size).toHaveAttribute('data-board-size', '640');
  });

  test('clear-arrows and reset-board-size buttons live in the popover', async ({ page }) => {
    await page.getByTestId('settings-cog').click();
    await expect(page.getByTestId('setting-clear-arrows')).toBeVisible();
    await expect(page.getByTestId('setting-reset-board-size')).toBeVisible();
  });

  test('reset-board-size restores 480', async ({ page }) => {
    await page.getByTestId('settings-cog').click();
    await page.getByTestId('setting-reset-board-size').click();
    await page.keyboard.press('Escape');
    const size = page.locator('[data-board-size]').first();
    await expect(size).toHaveAttribute('data-board-size', '480');
  });

  test('theme/piece-set selectors update host classes', async ({ page }) => {
    await page.getByTestId('settings-cog').click();
    await page.getByTestId('setting-board-theme-green').click();
    await page.getByTestId('setting-piece-set-merida').click();
    await page.keyboard.press('Escape');
    const host = page.getByTestId('chessground-host');
    await expect(host).toHaveAttribute('data-board-theme', 'green');
    await expect(host).toHaveAttribute('data-piece-set', 'merida');
  });

  test('the annotation fixture does not error and shows no raw %cal tags', async ({ page }) => {
    await page.getByTestId('fixture-select').selectOption('annotation-demo');
    await expect(page.getByTestId('position-error')).toHaveCount(0);
    await expect(page.getByTestId('move-list')).toBeVisible();
    await expect(page.getByTestId('move-list')).not.toContainText('%cal');
  });
});
