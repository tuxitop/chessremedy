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

describe('Settings page — Puzzles (Feature 012 solve UX)', () => {
  beforeEach(async () => {
    await db.settings.clear();
  });

  it('shows the puzzle-timer checkbox off by default and persists enabling it', async () => {
    renderWithProviders(<SettingsPage />, { withRouter: false });

    const toggle = (await screen.findByTestId('setting-puzzle-timer')) as HTMLInputElement;
    expect(toggle.checked).toBe(false);

    fireEvent.click(toggle);
    await waitFor(async () => {
      const stored = await settingsRepository.get<boolean>(SETTINGS_KEYS.puzzleTimer);
      expect(stored).toBe(true);
    });

    // A fresh read reflects the stored value.
    renderWithProviders(<SettingsPage />, { withRouter: false });
    const second = (await screen.findByTestId('setting-puzzle-timer')) as HTMLInputElement;
    expect(second.checked).toBe(true);
  });
});

describe('Settings page — Timed-training settings (Feature 019 §8)', () => {
  beforeEach(async () => {
    await db.settings.clear();
  });

  it('renders the three new controls with the documented defaults', async () => {
    renderWithProviders(<SettingsPage />, { withRouter: false });

    const row = await screen.findByTestId('settings-row-puzzles');
    const threshold = (await within(row).findByTestId(
      'setting-puzzle-timer-threshold',
    )) as HTMLInputElement;
    expect(threshold).toHaveValue(30);
    expect(threshold.min).toBe('5');
    expect(threshold.max).toBe('600');
    expect(within(row).getByTestId('setting-session-duration')).toHaveValue(10);
    expect(within(row).getByTestId('setting-session-warning')).toHaveValue(30);
  });

  it('persists the red threshold, default session length and warning threshold', async () => {
    renderWithProviders(<SettingsPage />, { withRouter: false });
    const row = await screen.findByTestId('settings-row-puzzles');

    fireEvent.change(await within(row).findByTestId('setting-puzzle-timer-threshold'), {
      target: { value: '45' },
    });
    await waitFor(async () => {
      expect(await settingsRepository.get(SETTINGS_KEYS.puzzleTimerRedThreshold)).toBe(45);
    });

    fireEvent.change(within(row).getByTestId('setting-session-duration'), {
      target: { value: '15' },
    });
    await waitFor(async () => {
      expect(await settingsRepository.get(SETTINGS_KEYS.sessionDefaultMinutes)).toBe(15);
    });

    fireEvent.change(within(row).getByTestId('setting-session-warning'), {
      target: { value: '20' },
    });
    await waitFor(async () => {
      expect(await settingsRepository.get(SETTINGS_KEYS.sessionWarningSeconds)).toBe(20);
    });
    // Editing one session value keeps the other.
    expect(await settingsRepository.get(SETTINGS_KEYS.sessionDefaultMinutes)).toBe(15);
  });

  it('clamps invalid values before persisting', async () => {
    renderWithProviders(<SettingsPage />, { withRouter: false });
    const row = await screen.findByTestId('settings-row-puzzles');

    fireEvent.change(await within(row).findByTestId('setting-puzzle-timer-threshold'), {
      target: { value: '999' },
    });
    await waitFor(async () => {
      expect(await settingsRepository.get(SETTINGS_KEYS.puzzleTimerRedThreshold)).toBe(600);
    });
    expect(within(row).getByTestId('setting-puzzle-timer-threshold')).toHaveValue(600);

    fireEvent.change(within(row).getByTestId('setting-session-duration'), {
      target: { value: '0' },
    });
    await waitFor(async () => {
      expect(await settingsRepository.get(SETTINGS_KEYS.sessionDefaultMinutes)).toBe(1);
    });

    fireEvent.change(within(row).getByTestId('setting-session-warning'), {
      target: { value: '1' },
    });
    await waitFor(async () => {
      expect(await settingsRepository.get(SETTINGS_KEYS.sessionWarningSeconds)).toBe(5);
    });
    expect(within(row).getByTestId('setting-session-warning')).toHaveValue(5);
  });
});

describe('Settings page — Puzzle hints default (Feature 017 §7)', () => {
  beforeEach(async () => {
    await db.settings.clear();
  });

  it('renders the hint default row with levels, first level and help copy', async () => {
    renderWithProviders(<SettingsPage />, { withRouter: false });

    const row = await screen.findByTestId('settings-row-hints');
    expect(await within(row).findByTestId('setting-hint-level-1')).toBeChecked();
    expect(within(row).getByTestId('setting-hint-level-2')).toBeChecked();
    expect(within(row).getByTestId('setting-hint-level-3')).toBeChecked();
    expect(within(row).getByTestId('setting-hint-level-4')).toBeChecked();
    expect(within(row).getByTestId('setting-first-hint-level')).toHaveValue('2');

    expect(within(row).getByTestId('setting-hints-help')).toHaveTextContent(
      'Level 1 — Relevant piece',
    );
    expect(within(row).getByTestId('setting-hints-help')).toHaveTextContent('Level 4 — Move');
    expect(within(row).getByTestId('setting-hints-help')).toHaveTextContent(
      'never count as a wrong move',
    );
    expect(within(row).getByTestId('setting-targets-help')).toHaveTextContent('informational only');

    // The stale Feature-012 placeholder is gone.
    expect(screen.queryByText('Hint behaviour')).not.toBeInTheDocument();
  });

  it('persists level and first-level changes, including an empty (hints off) set', async () => {
    renderWithProviders(<SettingsPage />, { withRouter: false });
    const row = await screen.findByTestId('settings-row-hints');
    const user = userEvent.setup();

    await user.click(await within(row).findByTestId('setting-hint-level-1'));
    await waitFor(async () => {
      expect(await settingsRepository.get(SETTINGS_KEYS.defaultHintConfig)).toEqual({
        enabledLevels: [2, 3, 4],
        firstHintLevel: 2,
      });
    });

    await user.selectOptions(within(row).getByTestId('setting-first-hint-level'), '4');
    await waitFor(async () => {
      expect(await settingsRepository.get(SETTINGS_KEYS.defaultHintConfig)).toEqual({
        enabledLevels: [2, 3, 4],
        firstHintLevel: 4,
      });
    });

    // Unchecking every remaining level is a valid "hints off" default.
    await user.click(within(row).getByTestId('setting-hint-level-2'));
    await user.click(within(row).getByTestId('setting-hint-level-3'));
    await user.click(within(row).getByTestId('setting-hint-level-4'));
    await waitFor(async () => {
      expect(await settingsRepository.get(SETTINGS_KEYS.defaultHintConfig)).toEqual({
        enabledLevels: [],
        firstHintLevel: 4,
      });
    });
  });
});

describe('Settings page — Tactical detection (Feature 010 W2)', () => {
  beforeEach(async () => {
    await db.settings.clear();
  });

  it('renders the verification-depth control with the default and bounds', async () => {
    renderWithProviders(<SettingsPage />, { withRouter: false });

    const row = await screen.findByTestId('settings-row-tactical-detection');
    const depth = (await within(row).findByTestId(
      'setting-verification-depth',
    )) as HTMLInputElement;
    expect(depth.value).toBe('18');
    expect(depth.min).toBe('10');
    expect(depth.max).toBe('40');
    expect(within(row).getByTestId('setting-verification-depth-help')).toHaveTextContent(
      'Default 18',
    );
  });

  it('persists a changed depth immediately', async () => {
    renderWithProviders(<SettingsPage />, { withRouter: false });
    await screen.findByTestId('settings-row-tactical-detection');

    const depth = await screen.findByTestId('setting-verification-depth');
    fireEvent.change(depth, { target: { value: '30' } });

    await waitFor(async () => {
      const stored = await settingsRepository.get<{ verificationDepth: number }>(
        SETTINGS_KEYS.analysisTacticalDetection,
      );
      expect(stored).toEqual({ verificationDepth: 30 });
    });
  });

  it('clamps an out-of-bounds depth before persisting', async () => {
    renderWithProviders(<SettingsPage />, { withRouter: false });
    await screen.findByTestId('settings-row-tactical-detection');

    const depth = await screen.findByTestId('setting-verification-depth');
    fireEvent.change(depth, { target: { value: '999' } });

    await waitFor(async () => {
      const stored = await settingsRepository.get<{ verificationDepth: number }>(
        SETTINGS_KEYS.analysisTacticalDetection,
      );
      expect(stored).toEqual({ verificationDepth: 40 });
    });
    expect(screen.getByTestId('setting-verification-depth')).toHaveValue(40);
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
