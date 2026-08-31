import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeToggle } from './ThemeToggle';
import { db } from '@/infrastructure/db/database';
import { SETTINGS_KEYS } from '@/config/app-config';

async function waitForThemeSettled() {
  // The useTheme hook reads Dexie on mount and may update state once.
  // Use waitFor with a no-op callback to flush pending state updates.
  await waitFor(() => {
    expect(screen.getByTestId('theme-toggle')).toBeInTheDocument();
  });
  // Let the Dexie write/resolve complete.
  await new Promise((resolve) => setTimeout(resolve, 10));
}

describe('ThemeToggle', () => {
  beforeEach(async () => {
    await db.settings.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('reflects the current data-theme on the document', async () => {
    document.documentElement.setAttribute('data-theme', 'light');
    render(<ThemeToggle />);
    await waitForThemeSettled();
    const button = screen.getByTestId('theme-toggle');
    expect(button.getAttribute('data-theme-mode')).toBe('light');
  });

  it('toggles the data-theme attribute when clicked', async () => {
    document.documentElement.setAttribute('data-theme', 'light');
    const user = userEvent.setup();
    render(<ThemeToggle />);
    await waitForThemeSettled();
    await user.click(screen.getByTestId('theme-toggle'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(await db.settings.get(SETTINGS_KEYS.theme)).toMatchObject({ value: 'dark' });
  });
});
