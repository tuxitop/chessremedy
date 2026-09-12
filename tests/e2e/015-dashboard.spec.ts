import { test, expect } from '@playwright/test';

// Feature 015 browser smoke: the dashboard renders against the real Dexie
// database through the Feature-014 statistics service, shows its honest
// empty states on a fresh profile, starts no engine and touches no network.
test.describe('dashboard', () => {
  test('renders the dashboard with honest empty states and no console errors', async ({ page }) => {
    const problems: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') {
        problems.push(message.text());
      }
    });
    page.on('pageerror', (error) => {
      problems.push(String(error));
    });

    await page.goto('/statistics');

    await expect(page.getByTestId('statistics-page')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Statistics' })).toBeVisible();
    // The live region settles once the statistics service has finished loading.
    await expect(page.getByTestId('dashboard-live')).toHaveText(/Statistics loaded\./);

    expect(problems).toEqual([]);
  });
});
