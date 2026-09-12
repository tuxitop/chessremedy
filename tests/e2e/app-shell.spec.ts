import { test, expect } from '@playwright/test';

test.describe('App shell (production build)', () => {
  test('home page renders with brand and nav links', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/ChessRemedy/);
    await expect(page.getByRole('heading', { name: 'ChessRemedy' })).toBeVisible();
    await expect(page.getByTestId('app-shell')).toBeVisible();
    for (const label of ['Home', 'Games', 'Training', 'Statistics', 'Analysis', 'Settings']) {
      await expect(page.getByTestId(`nav-${label.toLowerCase()}`)).toBeVisible();
    }
  });

  test('navigating to Games renders the Game Library', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-games').click();
    await expect(page.getByTestId('games-page')).toBeVisible();
    await expect(page.getByTestId('game-library')).toBeVisible();
    await expect(page.getByTestId('import-toggle')).toBeVisible();
  });

  test('theme toggle persists across reloads', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    // Restore light theme for subsequent tests.
    await page.getByTestId('theme-toggle').click();
  });
});
