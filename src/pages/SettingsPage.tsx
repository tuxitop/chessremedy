import type * as React from 'react';
import { ThemePicker } from '@/components/ui/ThemePicker';
import { useEngineDefaults } from '@/hooks/useEngineDefaults';
import { useBoardAppearance } from '@/hooks/useBoardAppearance';
import { useGameAnalysisSettings } from '@/hooks/useGameAnalysisSettings';
import {
  clampGameAnalysisDepth,
  clampGameAnalysisSearchSeconds,
  gameAnalysisProfileDepth,
  GAME_ANALYSIS_PROFILE_ORDER,
  type GameAnalysisProfile,
  type GameAnalysisSettings,
} from '@/components/analysis/gameAnalysisSettings';
import { readBrowserCapabilities } from '@/infrastructure/engine/capabilities';
import {
  ARROW_MODES,
  LIVE_DEPTH_MAX,
  LIVE_DEPTH_MIN,
  LIVE_LINES_MIN,
  LIVE_LINES_MAX,
  LIVE_SEARCH_SECONDS_MIN,
  clampDepth,
  clampLines,
  clampSearchSeconds,
  settingsWithProfile,
  type EngineArrowMode,
} from '@/components/analysis/engineSettings';
import type { AnalysisProfile } from '@/domain/chess';
import { ANALYSIS_PROFILE_ORDER } from '@/infrastructure/engine/engineProfiles';
import { BOARD_THEMES, PIECE_SETS } from '@/components/chessboard/themes';
import styles from './SettingsPage.module.css';

interface SettingPlaceholder {
  title: string;
  description: string;
  badge: string;
}

const SETTINGS_PLACEHOLDERS: SettingPlaceholder[] = [
  {
    title: 'Hint behaviour',
    description: 'Configure when the four progressive puzzle hints become available.',
    badge: 'Coming in Feature 012 — Puzzle Training',
  },
  {
    title: 'Synchronization',
    description: 'Optionally connect Dropbox to sync your library across devices.',
    badge: 'Coming in Feature 016 — Synchronization',
  },
];

interface GameAnalysisDefaultsProps {
  settings: GameAnalysisSettings;
  onSave(next: GameAnalysisSettings): void;
}

/** Number input whose blank value maps to `null` (profile default / no bound). */
function OptionalNumberField({
  label,
  value,
  placeholder,
  min,
  testId,
  onChange,
}: {
  label: string;
  value: number | null;
  placeholder: string;
  min: number;
  testId: string;
  onChange(value: number | null): void;
}): React.JSX.Element {
  return (
    <label className={styles.rowField}>
      <span className={styles.rowFieldLabel}>{label}</span>
      <input
        type="number"
        min={min}
        placeholder={placeholder}
        value={value ?? ''}
        onChange={(e) => {
          const raw = e.target.value.trim();
          onChange(raw === '' ? null : Number(raw));
        }}
        data-testid={testId}
      />
    </label>
  );
}

function GameAnalysisDefaults({ settings, onSave }: GameAnalysisDefaultsProps): React.JSX.Element {
  const saveProfile = (profile: GameAnalysisProfile): void => onSave({ ...settings, profile });
  const saveDepth = (v: number | null): void =>
    onSave({ ...settings, depthOverride: v === null ? null : clampGameAnalysisDepth(v) });
  const saveSearch = (v: number | null): void =>
    onSave({ ...settings, searchSeconds: v === null ? null : clampGameAnalysisSearchSeconds(v) });

  return (
    <div className={styles.engineDefaults}>
      <label className={styles.rowField}>
        <span className={styles.rowFieldLabel}>Profile</span>
        <select
          value={settings.profile}
          onChange={(e) => saveProfile(e.target.value as GameAnalysisProfile)}
          data-testid="setting-game-analysis-profile"
        >
          {GAME_ANALYSIS_PROFILE_ORDER.map((p) => (
            <option key={p} value={p}>
              {p} (depth {gameAnalysisProfileDepth(p)})
            </option>
          ))}
        </select>
      </label>
      <OptionalNumberField
        label="Depth override"
        value={settings.depthOverride}
        placeholder={`Profile depth (${gameAnalysisProfileDepth(settings.profile)})`}
        min={1}
        testId="setting-game-analysis-depth"
        onChange={saveDepth}
      />
      <OptionalNumberField
        label="Per-position search (s)"
        value={settings.searchSeconds}
        placeholder="None"
        min={1}
        testId="setting-game-analysis-search-seconds"
        onChange={saveSearch}
      />
    </div>
  );
}

export function SettingsPage(): React.JSX.Element {
  const { defaults, isReady, save } = useEngineDefaults();
  const {
    defaults: appearance,
    isReady: appearanceReady,
    save: saveAppearance,
  } = useBoardAppearance();
  const {
    settings: gameAnalysis,
    isReady: gameAnalysisReady,
    save: saveGameAnalysis,
  } = useGameAnalysisSettings();
  const capabilities = readBrowserCapabilities();

  return (
    <div className={styles.page} data-testid="settings-page">
      <h1 className={styles.heading}>Settings</h1>
      <ThemePicker />

      <ul className={styles.list}>
        <li className={styles.row} data-testid="settings-row-engine">
          <div className={styles.rowText}>
            <h2 className={styles.rowTitle}>Engine</h2>
            <p className={styles.rowDescription}>
              Default engine configuration used by Live Analysis (and, later, by game analysis and
              tactical verification). Analysis stops at the depth or the search time, whichever is
              reached first.
            </p>
          </div>
          {isReady && defaults ? (
            <EngineDefaults
              settings={defaults}
              capabilities={{
                threads: Math.max(1, capabilities.threads),
                hashCapMb: capabilities.hashCapMb,
              }}
              onProfile={(profile) =>
                void save(settingsWithProfile(defaults, profile, capabilities))
              }
              onSearchSeconds={(v) =>
                void save({ ...defaults, searchSeconds: clampSearchSeconds(v) })
              }
              onDepth={(v) => void save({ ...defaults, depth: clampDepth(v) })}
              onLines={(v) => void save({ ...defaults, lines: clampLines(v) })}
              onArrows={(v) => void save({ ...defaults, arrows: v })}
              onThreads={(v) =>
                void save({
                  ...defaults,
                  threads: Math.min(capabilities.threads, Math.max(1, v)),
                })
              }
              onMemory={(v) =>
                void save({
                  ...defaults,
                  memoryMb: Math.min(capabilities.hashCapMb, Math.max(1, v)),
                })
              }
            />
          ) : (
            <p className={styles.engineLoading}>Loading engine defaults…</p>
          )}
        </li>

        <li className={styles.row} data-testid="settings-row-game-analysis">
          <div className={styles.rowText}>
            <h2 className={styles.rowTitle}>Game analysis</h2>
            <p className={styles.rowDescription}>
              Engine configuration used when analyzing whole games (Library analysis and Review).
              The profile sets the analysis depth; optionally override the per-position depth or cap
              each position&apos;s search time. Analyses run under an older configuration read{' '}
              &quot;outdated&quot; and can be re-run with the current settings.
            </p>
          </div>
          {gameAnalysisReady && gameAnalysis ? (
            <GameAnalysisDefaults
              settings={gameAnalysis}
              onSave={(next) => void saveGameAnalysis(next)}
            />
          ) : (
            <p className={styles.engineLoading}>Loading game-analysis settings…</p>
          )}
        </li>

        <li className={styles.row} data-testid="settings-row-board">
          <div className={styles.rowText}>
            <h2 className={styles.rowTitle}>Board &amp; pieces</h2>
            <p className={styles.rowDescription}>
              Default look of the chessboard: theme, piece set and optional decorations used when a
              board opens.
            </p>
          </div>
          {appearanceReady && appearance ? (
            <div className={styles.boardForm}>
              <label className={styles.rowField}>
                <span className={styles.rowFieldLabel}>Board theme</span>
                <select
                  value={appearance.boardTheme}
                  onChange={(e) =>
                    void saveAppearance({
                      ...appearance,
                      boardTheme: e.target.value as (typeof BOARD_THEMES)[number],
                    })
                  }
                  data-testid="setting-default-board-theme"
                >
                  {BOARD_THEMES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.rowField}>
                <span className={styles.rowFieldLabel}>Piece set</span>
                <select
                  value={appearance.pieceSet}
                  onChange={(e) =>
                    void saveAppearance({
                      ...appearance,
                      pieceSet: e.target.value as (typeof PIECE_SETS)[number],
                    })
                  }
                  data-testid="setting-default-piece-set"
                >
                  {PIECE_SETS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={appearance.coordinates}
                  onChange={(e) =>
                    void saveAppearance({ ...appearance, coordinates: e.target.checked })
                  }
                  data-testid="setting-default-coordinates"
                />
                <span>Show coordinates</span>
              </label>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={appearance.animation}
                  onChange={(e) =>
                    void saveAppearance({ ...appearance, animation: e.target.checked })
                  }
                  data-testid="setting-default-animation"
                />
                <span>Piece animations</span>
              </label>
            </div>
          ) : (
            <p className={styles.engineLoading}>Loading board defaults…</p>
          )}
        </li>

        {SETTINGS_PLACEHOLDERS.map((setting) => (
          <li
            key={setting.title}
            className={styles.row}
            data-testid={`settings-row-${setting.title.toLowerCase().replace(/\s+/g, '-')}`}
          >
            <div className={styles.rowText}>
              <h2 className={styles.rowTitle}>{setting.title}</h2>
              <p className={styles.rowDescription}>{setting.description}</p>
            </div>
            <span className={styles.badge}>{setting.badge}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface EngineDefaultsProps {
  settings: ReturnType<typeof useEngineDefaults>['defaults'] & {};
  capabilities: { threads: number; hashCapMb: number };
  onProfile: (profile: AnalysisProfile) => void;
  onSearchSeconds: (v: number) => void;
  onDepth: (v: number) => void;
  onLines: (v: number) => void;
  onArrows: (v: EngineArrowMode) => void;
  onThreads: (v: number) => void;
  onMemory: (v: number) => void;
}

function EngineDefaults({
  settings,
  capabilities,
  onProfile,
  onSearchSeconds,
  onDepth,
  onLines,
  onArrows,
  onThreads,
  onMemory,
}: EngineDefaultsProps): React.JSX.Element {
  return (
    <div className={styles.engineDefaults}>
      <label className={styles.rowField}>
        <span className={styles.rowFieldLabel}>Profile</span>
        <select
          value={settings.profile}
          onChange={(e) => onProfile(e.target.value as AnalysisProfile)}
          data-testid="setting-default-profile"
        >
          {ANALYSIS_PROFILE_ORDER.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.rowField}>
        <span className={styles.rowFieldLabel}>Search time (seconds)</span>
        <input
          type="number"
          min={LIVE_SEARCH_SECONDS_MIN}
          value={settings.searchSeconds}
          onChange={(e) => onSearchSeconds(Number(e.target.value) || 1)}
          data-testid="setting-default-search-seconds"
        />
      </label>
      <label className={styles.rowField}>
        <span className={styles.rowFieldLabel}>Depth</span>
        <input
          type="number"
          min={LIVE_DEPTH_MIN}
          max={LIVE_DEPTH_MAX}
          value={settings.depth}
          onChange={(e) => onDepth(Number(e.target.value) || 1)}
          data-testid="setting-default-depth"
        />
      </label>
      <label className={styles.rowField}>
        <span className={styles.rowFieldLabel}>Lines</span>
        <input
          type="number"
          min={LIVE_LINES_MIN}
          max={LIVE_LINES_MAX}
          value={settings.lines}
          onChange={(e) => onLines(Number(e.target.value) || 1)}
          data-testid="setting-default-lines"
        />
      </label>
      <label className={styles.rowField}>
        <span className={styles.rowFieldLabel}>Threads</span>
        <input
          type="number"
          min={1}
          max={capabilities.threads}
          value={settings.threads}
          disabled={capabilities.threads <= 1}
          onChange={(e) => onThreads(Number(e.target.value) || 1)}
          data-testid="setting-default-threads"
        />
      </label>
      <label className={styles.rowField}>
        <span className={styles.rowFieldLabel}>Memory (MB)</span>
        <input
          type="number"
          min={1}
          max={capabilities.hashCapMb}
          value={settings.memoryMb}
          onChange={(e) => onMemory(Number(e.target.value) || 1)}
          data-testid="setting-default-memory"
        />
      </label>
      <label className={styles.rowField}>
        <span className={styles.rowFieldLabel}>Arrows</span>
        <select
          value={settings.arrows}
          onChange={(e) => onArrows(e.target.value as EngineArrowMode)}
          data-testid="setting-default-arrows"
        >
          {ARROW_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {mode === 'first' ? 'First line' : 'All lines'}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
