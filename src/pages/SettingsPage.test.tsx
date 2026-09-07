import { describe, expect, it, beforeEach, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { db } from '@/infrastructure/db/database';
import { settingsRepository } from '@/infrastructure/db/settings-repository';
import { SETTINGS_KEYS } from '@/config/app-config';
import { renderWithProviders } from '@/test/test-utils';
import { SettingsPage } from '@/pages/SettingsPage';
import type { AnalysisServiceLike } from '@/hooks/useGameAnalysis';

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
    // Blank threads input means "engine default"; the field is disabled on a
    // single-threaded engine build (no Threads option exists for it).
    const threads = screen.getByTestId('setting-game-analysis-threads');
    expect(threads).toHaveValue(null);
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
        threadsOverride: number | null;
      }>(SETTINGS_KEYS.analysisGame);
      expect(stored).toMatchObject({
        engine: 'stockfish',
        profile: 'deep',
        depthOverride: 28,
        searchSeconds: 4,
        threadsOverride: null,
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

describe('Settings page — Analysis maintenance (orphan-job cleanup)', () => {
  beforeEach(async () => {
    await db.settings.clear();
  });

  it('clears interrupted analysis jobs and reports the result', async () => {
    const clearPaused = vi.fn(async () => 2);
    const service = { clearPausedAnalysisJobs: clearPaused } as unknown as AnalysisServiceLike;
    renderWithProviders(<SettingsPage analysisService={service} />, { withRouter: false });

    await screen.findByTestId('settings-row-maintenance');
    expect(screen.getByTestId('settings-clear-orphan-jobs')).toBeEnabled();

    fireEvent.click(screen.getByTestId('settings-clear-orphan-jobs'));

    await waitFor(() =>
      expect(screen.getByTestId('settings-clear-orphan-result')).toHaveTextContent(
        'Removed 2 interrupted analysis jobs.',
      ),
    );
    expect(clearPaused).toHaveBeenCalledTimes(1);
  });

  it('reports when there is nothing to clear and stays disabled without a service', async () => {
    const clearPaused = vi.fn(async () => 0);
    const service = { clearPausedAnalysisJobs: clearPaused } as unknown as AnalysisServiceLike;
    const { unmount } = renderWithProviders(<SettingsPage analysisService={service} />, {
      withRouter: false,
    });
    await screen.findByTestId('settings-row-maintenance');
    fireEvent.click(screen.getByTestId('settings-clear-orphan-jobs'));
    await waitFor(() =>
      expect(screen.getByTestId('settings-clear-orphan-result')).toHaveTextContent(
        'No interrupted analysis jobs to clear.',
      ),
    );
    unmount();

    // Without an analysis service the action is disabled.
    renderWithProviders(<SettingsPage analysisService={null} />, { withRouter: false });
    await screen.findByTestId('settings-row-maintenance');
    expect(screen.getByTestId('settings-clear-orphan-jobs')).toBeDisabled();
  });
});
