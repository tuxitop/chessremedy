import { describe, expect, it, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { db } from '@/infrastructure/db/database';
import { settingsRepository } from '@/infrastructure/db/settings-repository';
import { SETTINGS_KEYS } from '@/config/app-config';
import { renderWithProviders } from '@/test/test-utils';
import { SettingsPage } from '@/pages/SettingsPage';

describe('Settings page — Game analysis group (Feature 008 polish)', () => {
  beforeEach(async () => {
    await db.settings.clear();
  });

  it('renders the Game-analysis row with the canonical defaults', async () => {
    renderWithProviders(<SettingsPage />, { withRouter: false });

    expect(await screen.findByTestId('settings-row-game-analysis')).toBeInTheDocument();
    const profile = (await screen.findByTestId(
      'setting-game-analysis-profile',
    )) as HTMLSelectElement;
    expect(profile.value).toBe('normal');
    // Blank depth/search inputs mean "profile default / no time bound".
    expect(screen.getByTestId('setting-game-analysis-depth')).toHaveValue(null);
    expect(screen.getByTestId('setting-game-analysis-search-seconds')).toHaveValue(null);
  });

  it('persists profile, depth override and search time', async () => {
    renderWithProviders(<SettingsPage />, { withRouter: false });
    await screen.findByTestId('settings-row-game-analysis');
    const user = userEvent.setup();

    const profile = await screen.findByTestId('setting-game-analysis-profile');
    const depth = screen.getByTestId('setting-game-analysis-depth');
    const search = screen.getByTestId('setting-game-analysis-search-seconds');

    await user.selectOptions(profile, 'deep');
    await user.type(depth, '28');
    await user.type(search, '4');

    await waitFor(async () => {
      const stored = await settingsRepository.get<{
        profile: string;
        depthOverride: number | null;
        searchSeconds: number | null;
      }>(SETTINGS_KEYS.analysisGame);
      expect(stored).toMatchObject({
        engine: 'stockfish',
        profile: 'deep',
        depthOverride: 28,
        searchSeconds: 4,
      });
    });
  });

  it('maps a cleared override back to null (profile default)', async () => {
    renderWithProviders(<SettingsPage />, { withRouter: false });
    await screen.findByTestId('settings-row-game-analysis');
    const user = userEvent.setup();

    const depth = await screen.findByTestId('setting-game-analysis-depth');
    await user.type(depth, '30');
    await waitFor(async () => {
      const stored = await settingsRepository.get<{
        profile: string;
        depthOverride: number | null;
        searchSeconds: number | null;
      }>(SETTINGS_KEYS.analysisGame);
      expect(stored?.depthOverride).toBe(30);
    });

    await user.clear(depth);
    await waitFor(async () => {
      const stored = await settingsRepository.get<{
        profile: string;
        depthOverride: number | null;
        searchSeconds: number | null;
      }>(SETTINGS_KEYS.analysisGame);
      expect(stored?.depthOverride).toBeNull();
    });
  });

  it('clamps overrides to the canonical bounds', async () => {
    renderWithProviders(<SettingsPage />, { withRouter: false });
    await screen.findByTestId('settings-row-game-analysis');
    const user = userEvent.setup();

    const depth = await screen.findByTestId('setting-game-analysis-depth');
    await user.type(depth, '999');
    const search = screen.getByTestId('setting-game-analysis-search-seconds');
    await user.type(search, '0');

    await waitFor(async () => {
      const stored = await settingsRepository.get<{
        profile: string;
        depthOverride: number | null;
        searchSeconds: number | null;
      }>(SETTINGS_KEYS.analysisGame);
      expect(stored?.depthOverride).toBe(128);
      expect(stored?.searchSeconds).toBe(1);
    });

    const row = screen.getByTestId('settings-row-game-analysis');
    expect(within(row).getByTestId('setting-game-analysis-depth')).toHaveValue(128);
  });
});
