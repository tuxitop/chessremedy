import { expect, test } from '@playwright/test';

test.describe('Chessboard Playground', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/playground');
    await expect(page.getByTestId('playground-page')).toBeVisible();
  });

  test('renders all ten fixtures in the position selector', async ({ page }) => {
    const select = page.getByTestId('fixture-select');
    await expect(select).toBeVisible();
    const options = select.locator('option');
    await expect(options).toHaveCount(10);
  });

  test('selecting a fixture updates the exercises line', async ({ page }) => {
    await page.getByTestId('fixture-select').selectOption('check');
    await expect(page.getByTestId('fixture-exercises')).toHaveText(/Check highlighting/);
  });

  test('selecting Scholar\u2019s Mate position and toggling orientation flips the board', async ({
    page,
  }) => {
    await page.getByTestId('fixture-select').selectOption('scholars-mate');
    // Coordinates orientation visible (board host present).
    await expect(page.getByTestId('chessground-host')).toBeVisible();
    await page.getByTestId('toggle-orientation').check();
    await expect(page.getByTestId('toggle-orientation')).toBeChecked();
  });

  test('reset position button returns the board to the fixture\u2019s initial FEN', async ({
    page,
  }) => {
    await page.getByTestId('fixture-select').selectOption('starting');
    await page.getByTestId('reset-position').click();
    await expect(page.getByTestId('reset-position')).toBeVisible();
  });

  test('reset board size button restores the 480 px default', async ({ page }) => {
    await page.getByTestId('reset-board-size').click();
    const board = page.getByTestId('board-container').first();
    await expect(board).toBeVisible();
  });

  test('PgnViewer is shown for PGN fixtures and hidden for single-FEN fixtures', async ({
    page,
  }) => {
    await page.getByTestId('fixture-select').selectOption('starting');
    await expect(page.getByTestId('pgn-viewer')).toHaveCount(0);
    await page.getByTestId('fixture-select').selectOption('scholars-mate-game');
    await expect(page.getByTestId('pgn-viewer')).toBeVisible();
  });

  test('navigation buttons become enabled once the PGN viewer mounts', async ({ page }) => {
    await page.getByTestId('fixture-select').selectOption('scholars-mate-game');
    // Give the PgnViewer time to mount and expose its API.
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="pgn-viewer"]');
      return el && el.getAttribute('data-api-ready') === 'true';
    });
    await expect(page.getByTestId('nav-first')).toBeEnabled();
    await expect(page.getByTestId('nav-prev')).toBeEnabled();
    await expect(page.getByTestId('nav-next')).toBeEnabled();
    await expect(page.getByTestId('nav-last')).toBeEnabled();
  });
});
