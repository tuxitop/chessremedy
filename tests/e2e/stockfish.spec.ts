import { expect, test, type Page } from '@playwright/test';

/**
 * Real-engine browser tests for Feature 005 (spec §19/§22). These run the
 * shipped Stockfish WASM inside a Web Worker through the playground UI and
 * assert engine *characteristics* (mate vs numeric evaluation, metadata,
 * interactivity) rather than exact evaluation numbers (spec §16).
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

test.describe('Stockfish engine playground', () => {
  test.describe.configure({ mode: 'serial' });

  test(
    'loads the engine worker, reports metadata and a numeric result',
    { timeout: LONG },
    async ({ page }) => {
      await page.goto('/playground');
      await page.getByTestId('fixture-select').selectOption('engine-quiet-start');
      await page.getByTestId('engine-start').click();
      await expect(page.getByTestId('engine-result')).toBeVisible({ timeout: RESULT_TIMEOUT });
      const evalText = await page.getByTestId('engine-eval').textContent();
      expect(evalText).toMatch(/^[+-]?\d+\.\d\d$/);
      await expect(page.getByTestId('engine-meta')).toContainText('stockfish');
      await expect(page.getByTestId('engine-status')).toContainText('Ready');
    },
  );

  test(
    'finds the mate-in-1 and reports a mate evaluation with the mating move',
    { timeout: LONG },
    async ({ page }) => {
      await page.goto('/playground');
      await page.getByTestId('fixture-select').selectOption('engine-mate-in-1');
      await page.getByTestId('engine-start').click();
      await expect(page.getByTestId('engine-result')).toBeVisible({ timeout: RESULT_TIMEOUT });
      await expect(page.getByTestId('engine-eval')).toHaveText(/^M\d+$/, {
        timeout: RESULT_TIMEOUT,
      });
      await expect(page.getByTestId('engine-pv')).toContainText('Rb8');
    },
  );

  test('analyzes the en-passant and castling FEN fixtures', { timeout: LONG }, async ({ page }) => {
    await page.goto('/playground');
    for (const id of ['engine-en-passant', 'engine-castling']) {
      await page.getByTestId('fixture-select').selectOption(id);
      await page.getByTestId('engine-start').click();
      await expect(page.getByTestId('engine-result')).toBeVisible({ timeout: RESULT_TIMEOUT });
      const evalText = await page.getByTestId('engine-eval').textContent();
      expect(evalText?.length ?? 0).toBeGreaterThan(0);
    }
  });

  test('can cancel an active analysis', { timeout: LONG }, async ({ page }) => {
    await page.goto('/playground');
    await page.getByTestId('fixture-select').selectOption('engine-quiet-start');
    await page.getByTestId('engine-profile').selectOption('deep');
    await page.getByTestId('engine-start').click();
    await expect(page.getByTestId('engine-stop')).toBeVisible();
    await page.getByTestId('engine-stop').click();
    await expect(page.getByTestId('engine-cancelled')).toBeVisible();
    await expect(page.getByTestId('engine-start')).toBeVisible();
  });

  test(
    'the board stays interactive while the engine is analyzing',
    { timeout: LONG },
    async ({ page }) => {
      await page.goto('/playground');
      await page.getByTestId('engine-profile').selectOption('deep');
      await page.getByTestId('engine-start').click();
      await expect(page.getByTestId('engine-stop')).toBeVisible();
      // Play e2e-e4 while analysis is running.
      await playMove(page, 'e2', 'e4');
      const moved = page.getByTestId('move-list-move').filter({ hasText: 'e4' }).first();
      await expect(moved).toBeVisible();
      await page.getByTestId('engine-stop').click();
    },
  );
});
