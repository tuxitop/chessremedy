import { test, expect } from '@playwright/test';

test.describe('PWA foundation', () => {
  test('manifest link is present and parseable', async ({ page }) => {
    await page.goto('/');
    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(manifestHref).toBeTruthy();
    const res = await page.request.get(manifestHref!);
    expect(res.status()).toBe(200);
    const manifest = await res.json();
    expect(manifest.name).toBeTruthy();
    expect(manifest.start_url).toBeTruthy();
    expect(manifest.display).toBe('standalone');
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.some((i: { sizes?: string }) => (i.sizes ?? '').includes('192'))).toBe(
      true,
    );
  });

  test('service worker registers', async ({ page }) => {
    await page.goto('/');
    // Wait for the SW to register and become the controller. The
    // service worker registers asynchronously after `window.load`.
    await page.waitForFunction(() => 'serviceWorker' in navigator);
    // Trigger a reload so the SW takes control of the page, then verify.
    await page.reload();
    const registered = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return reg !== undefined;
    });
    expect(registered).toBe(true);
  });
});
