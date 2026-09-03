import { expect, test, type Page } from '@playwright/test';

/**
 * Real-engine browser tests for Feature 006 (Live Analysis Board). These run
 * the shipped Stockfish WASM through `/analysis/live` and assert engine
 * *characteristics* (eval appears, toggle controls analysis, re-analysis after
 * a move) rather than exact numbers.
 */

async function squareCenter(page: Page, square: string): Promise<{ x: number; y: number }> {
  const host = page.getByTestId('chessground-host');
  const box = await host.boundingBox();
  if (!box) {
    throw new Error('chessground host has no bounding box');
  }
  const file = square.charCodeAt(0) - 97;
  const rank = Number.parseInt(square[1]!, 10) - 1;
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

const LONG = 120_000;
const RESULT_TIMEOUT = 60_000;

test.describe('Live Analysis Board', () => {
  test.describe.configure({ mode: 'serial' });

  test('starts with the engine on and shows an evaluation for the starting position', async ({
    page,
  }) => {
    test.setTimeout(LONG);
    await page.goto('/analysis/live');
    await expect(page.getByTestId('live-analysis-page')).toBeVisible();
    // The engine toggle is on by default on this page.
    await expect(page.getByTestId('engine-toggle')).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('engine-settings-gear').click();
    await page.getByTestId('setting-profile').selectOption('fast');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('engine-status')).toContainText('Ready', {
      timeout: RESULT_TIMEOUT,
    });
    await expect(page.getByTestId('position-eval')).toHaveText(/^[+-]?\d+\.\d\d$/);
  });

  test('playing a move triggers a re-analysis of the new position', async ({ page }) => {
    test.setTimeout(LONG);
    await page.goto('/analysis/live');
    await page.getByTestId('engine-settings-gear').click();
    await page.getByTestId('setting-profile').selectOption('fast');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('engine-status')).toContainText('Ready', {
      timeout: RESULT_TIMEOUT,
    });
    // Play 1. e4 (requires no promotion).
    await playMove(page, 'e2', 'e4');
    const move = page.getByTestId('move-list-move').filter({ hasText: 'e4' }).first();
    await expect(move).toBeVisible();
    await expect(page.getByTestId('position-eval')).toHaveText(/^[+-]?\d+\.\d\d$/);
  });

  test('toggling the engine off clears the evaluation', async ({ page }) => {
    test.setTimeout(LONG);
    await page.goto('/analysis/live');
    await page.getByTestId('engine-settings-gear').click();
    await page.getByTestId('setting-profile').selectOption('fast');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('engine-status')).toContainText('Ready', {
      timeout: RESULT_TIMEOUT,
    });
    await page.getByTestId('engine-toggle').click();
    await expect(page.getByTestId('engine-status')).toContainText('Off');
    await expect(page.getByTestId('position-eval')).toHaveText('\u2014');
  });

  test('an invalid start FEN is rejected and does not break the board', async ({ page }) => {
    await page.goto('/analysis/live');
    await page.getByTestId('live-fen-input').fill('not-a-fen');
    await page.getByTestId('live-fen-set').click();
    await expect(page.getByTestId('live-fen-error')).toBeVisible();
    await expect(page.getByTestId('chessground-host')).toBeVisible();
  });
});
