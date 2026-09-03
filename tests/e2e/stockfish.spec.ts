import { expect, test, type Page } from '@playwright/test';

/**
 * Real-engine browser tests for Feature 005 (spec §19/§22) driven through the
 * Feature 006 engine chrome on the playground. These run the shipped Stockfish
 * WASM inside a Web Worker through the playground UI and assert engine
 * *characteristics* (mate vs numeric evaluation, metadata, interactivity)
 * rather than exact evaluation numbers (spec §16).
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

async function enableEngine(page: Page, profile: 'fast' | 'normal' | 'tactical' | 'deep' = 'fast') {
  const gear = page.getByTestId('engine-settings-gear');
  await gear.click();
  await page.getByTestId('setting-profile').selectOption(profile);
  await page.keyboard.press('Escape');
  // Engine off by default on the playground; turn it on.
  const toggle = page.getByTestId('engine-toggle');
  if ((await toggle.getAttribute('aria-checked')) === 'false') {
    await toggle.click();
  }
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
      await enableEngine(page, 'fast');
      await expect(page.getByTestId('engine-result')).toBeVisible({ timeout: RESULT_TIMEOUT });
      const evalText = await page.getByTestId('engine-eval').textContent();
      expect(evalText).toMatch(/^[+-]?\d+\.\d\d$/);
      await expect(page.getByTestId('engine-version')).toContainText('stockfish');
      await expect(page.getByTestId('engine-status')).toContainText('Ready');
    },
  );

  test(
    'finds the mate-in-1 and reports a mate evaluation with the mating move',
    { timeout: LONG },
    async ({ page }) => {
      await page.goto('/playground');
      await page.getByTestId('fixture-select').selectOption('engine-mate-in-1');
      await enableEngine(page, 'fast');
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
      await enableEngine(page, 'fast');
      await expect(page.getByTestId('engine-result')).toBeVisible({ timeout: RESULT_TIMEOUT });
      const evalText = await page.getByTestId('engine-eval').textContent();
      expect(evalText?.length ?? 0).toBeGreaterThan(0);
      // Toggle off so the next fixture starts from a clean state.
      await page.getByTestId('engine-toggle').click();
    }
  });

  test('can cancel an active analysis', { timeout: LONG }, async ({ page }) => {
    await page.goto('/playground');
    await page.getByTestId('fixture-select').selectOption('engine-quiet-start');
    await enableEngine(page, 'deep');
    await expect(page.getByTestId('engine-cancel')).toBeVisible();
    await page.getByTestId('engine-cancel').click();
    // Cancel returns to the pre-analysis state.
    await expect(page.getByTestId('position-eval')).toHaveText('\u2014');
    await expect(page.getByTestId('engine-toggle')).toHaveAttribute('aria-checked', 'true');
  });

  test(
    'the board stays interactive while the engine is analyzing',
    { timeout: LONG },
    async ({ page }) => {
      await page.goto('/playground');
      await page.getByTestId('fixture-select').selectOption('engine-quiet-start');
      await enableEngine(page, 'deep');
      await expect(page.getByTestId('engine-cancel')).toBeVisible();
      // Play e2e-e4 while analysis is running.
      await playMove(page, 'e2', 'e4');
      const moved = page.getByTestId('move-list-move').filter({ hasText: 'e4' }).first();
      await expect(moved).toBeVisible();
      await page.getByTestId('engine-toggle').click();
    },
  );
});
