import type * as React from 'react';
import { useEffect, useState } from 'react';
import { ThemePicker } from '@/components/ui/ThemePicker';
import { Button } from '@/components/ui/Button';
import { useEngineDefaults } from '@/hooks/useEngineDefaults';
import { useBoardAppearance } from '@/hooks/useBoardAppearance';
import { useGameAnalysisSettings } from '@/hooks/useGameAnalysisSettings';
import { useTacticalDetectionSettings } from '@/hooks/useTacticalDetectionSettings';
import { usePuzzleTimerSetting } from '@/hooks/usePuzzleTimerSetting';
import {
  DEFAULT_VERIFICATION_DEPTH,
  MAX_VERIFICATION_DEPTH,
  MIN_VERIFICATION_DEPTH,
  clampVerificationDepth,
} from '@/infrastructure/tactics/verificationDepth';
import { useDefaultHintConfig } from '@/hooks/useDefaultHintConfig';
import { HINT_LEVELS } from '@/components/puzzles/cycles';
import type { HintConfig, HintLevel } from '@/domain/training';
import { getBrowserAnalysisService } from '@/infrastructure/analysis';
import type { AnalysisServiceLike } from '@/hooks/useGameAnalysis';
import {
  clampGameAnalysisDepth,
  clampGameAnalysisSearchSeconds,
  clampGameAnalysisThreads,
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
    title: 'Synchronization',
    description: 'Optionally connect Dropbox to sync your library across devices.',
    badge: 'Coming in Feature 016 — Synchronization',
  },
];

interface GameAnalysisDefaultsProps {
  settings: GameAnalysisSettings;
  /** Engine capability thread cap (1 on the single-threaded build). */
  maxThreads: number;
  onSave(next: GameAnalysisSettings): void;
}

/** Number input whose blank value maps to `null` (profile default / no bound). */
function OptionalNumberField({
  label,
  value,
  placeholder,
  min,
  max,
  disabled,
  testId,
  onChange,
}: {
  label: string;
  value: number | null;
  placeholder: string;
  min: number;
  max?: number;
  disabled?: boolean;
  testId: string;
  onChange(value: number | null): void;
}): React.JSX.Element {
  return (
    <label className={styles.rowField}>
      <span className={styles.rowFieldLabel}>{label}</span>
      <input
        type="number"
        min={min}
        {...(max !== undefined ? { max } : {})}
        disabled={disabled}
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

function GameAnalysisDefaults({
  settings,
  maxThreads,
  onSave,
}: GameAnalysisDefaultsProps): React.JSX.Element {
  const saveProfile = (profile: GameAnalysisProfile): void => onSave({ ...settings, profile });
  const saveDepth = (v: number | null): void =>
    onSave({ ...settings, depthOverride: v === null ? null : clampGameAnalysisDepth(v) });
  const saveSearch = (v: number | null): void =>
    onSave({ ...settings, searchSeconds: v === null ? null : clampGameAnalysisSearchSeconds(v) });
  const saveThreads = (v: number | null): void =>
    onSave({
      ...settings,
      // 1 is the single-threaded default, not an override: a blank field or a
      // value of 1 both mean "use the engine default".
      threadsOverride: v === null || v <= 1 ? null : clampGameAnalysisThreads(v, maxThreads),
    });

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
      <OptionalNumberField
        label="Threads"
        value={settings.threadsOverride}
        placeholder={`Auto (${maxThreads})`}
        min={1}
        max={maxThreads}
        disabled={maxThreads <= 1}
        testId="setting-game-analysis-threads"
        onChange={saveThreads}
      />
    </div>
  );
}

/**
 * The global default hint configuration (Feature 017 §7): Level 1–4
 * availability, the first hint level, and the level/target help copy. Every
 * control has an accessible name and the help is associated via
 * `aria-describedby` (never tooltip-only).
 */
function HintDefaults({
  hints,
  error,
  onSave,
}: {
  hints: HintConfig;
  error: string | null;
  onSave(next: HintConfig): void;
}): React.JSX.Element {
  const toggleLevel = (level: HintLevel, enabled: boolean): void => {
    const current = new Set(hints.enabledLevels);
    if (enabled) {
      current.add(level);
    } else {
      current.delete(level);
    }
    const enabledLevels = HINT_LEVELS.filter((candidate) => current.has(candidate));
    onSave({ enabledLevels, firstHintLevel: hints.firstHintLevel });
  };

  return (
    <div className={styles.hintForm}>
      <fieldset className={styles.hintFieldset}>
        <legend className={styles.rowFieldLabel}>Hint levels</legend>
        <div className={styles.hintChecks}>
          {HINT_LEVELS.map((level) => (
            <label key={level} className={styles.check}>
              <input
                type="checkbox"
                checked={hints.enabledLevels.includes(level)}
                onChange={(event) => toggleLevel(level, event.target.checked)}
                data-testid={`setting-hint-level-${level}`}
                aria-describedby="setting-hints-help"
              />
              <span>Level {level}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className={styles.rowField}>
        <span className={styles.rowFieldLabel}>First hint level</span>
        <select
          value={hints.firstHintLevel}
          onChange={(event) =>
            onSave({ ...hints, firstHintLevel: Number(event.target.value) as HintLevel })
          }
          data-testid="setting-first-hint-level"
          aria-describedby="setting-hints-help"
        >
          {HINT_LEVELS.map((level) => (
            <option key={level} value={level}>
              Level {level}
            </option>
          ))}
        </select>
      </label>
      <p id="setting-hints-help" className={styles.helpText} data-testid="setting-hints-help">
        <strong>Level 1 — Relevant piece:</strong> shows the piece type that starts the solution
        (text only). <strong>Level 2 — Piece square:</strong> highlights that piece&apos;s starting
        square. <strong>Level 3 — Destination:</strong> highlights the destination square of the
        first solution move. <strong>Level 4 — Move:</strong> shows the full first solution move in
        SAN. Hints never fail a puzzle and never count as a wrong move; the reveal starts at the
        configured first level and ascends, skipping disabled levels, capped at Level 4.
      </p>
      <p id="setting-targets-help" className={styles.helpText} data-testid="setting-targets-help">
        Target accuracy and target solving time are informational only — displayed targets, never
        gates. A cycle is never blocked, failed or completed differently because a target is missed.
      </p>
      {error ? (
        <p role="alert" className={styles.error} data-testid="setting-hints-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Clears interrupted (stuck) analysis runs from earlier sessions. */
function AnalysisMaintenance({
  service,
}: {
  service: AnalysisServiceLike | null;
}): React.JSX.Element {
  const [clearing, setClearing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const canClear = service !== null && typeof service.clearPausedAnalysisJobs === 'function';

  const clear = async (): Promise<void> => {
    if (!service || !canClear) {
      return;
    }
    setClearing(true);
    setMessage(null);
    try {
      const count = await service.clearPausedAnalysisJobs!();
      setMessage(
        count === 0
          ? 'No interrupted analysis jobs to clear.'
          : `Removed ${count} interrupted analysis ${count === 1 ? 'job' : 'jobs'}. Games and completed analyses were kept.`,
      );
    } catch {
      setMessage('Could not clear interrupted jobs. Please try again.');
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className={styles.engineDefaults}>
      <Button
        disabled={clearing || !canClear}
        data-testid="settings-clear-orphan-jobs"
        onClick={() => void clear()}
      >
        {clearing ? 'Clearing…' : 'Clear interrupted jobs'}
      </Button>
      {message ? (
        <p
          role="status"
          className={styles.rowDescription}
          data-testid="settings-clear-orphan-result"
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}

export function SettingsPage({
  analysisService,
}: {
  /** Injectable for tests; when omitted the page lazily builds the shared service. */
  readonly analysisService?: AnalysisServiceLike | null;
} = {}): React.JSX.Element {
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
  const {
    showPuzzleTimer,
    isReady: puzzleTimerReady,
    save: savePuzzleTimer,
  } = usePuzzleTimerSetting();
  const {
    settings: detectionSettings,
    isReady: detectionReady,
    save: saveDetection,
  } = useTacticalDetectionSettings();
  const {
    hints: defaultHints,
    isReady: hintsReady,
    error: hintsError,
    save: saveHints,
  } = useDefaultHintConfig();
  const [builtService, setBuiltService] = useState<AnalysisServiceLike | null>(null);
  const capabilities = readBrowserCapabilities();

  useEffect(() => {
    if (analysisService !== undefined) {
      return;
    }
    let active = true;
    getBrowserAnalysisService()
      .then((service) => {
        if (active) {
          setBuiltService(service);
        }
      })
      .catch(() => {
        // Analysis stays unavailable; the maintenance action stays disabled.
      });
    return () => {
      active = false;
    };
  }, [analysisService]);

  const resolvedAnalysis = analysisService !== undefined ? analysisService : builtService;

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
              maxThreads={Math.max(1, capabilities.threads)}
              onSave={(next) => void saveGameAnalysis(next)}
            />
          ) : (
            <p className={styles.engineLoading}>Loading game-analysis settings…</p>
          )}
        </li>

        <li className={styles.row} data-testid="settings-row-tactical-detection">
          <div className={styles.rowText}>
            <h2 className={styles.rowTitle}>Tactical detection</h2>
            <p className={styles.rowDescription}>
              Depth used by the tactical verification pass that finds missed tactics after a game is
              analyzed. A deeper setting searches harder and costs more; the 45-second per-candidate
              backstop still applies. Applies to new scans and explicit re-scans — existing results
              stay current.
            </p>
          </div>
          {detectionReady && detectionSettings ? (
            <div className={styles.engineDefaults}>
              <label className={styles.rowField}>
                <span className={styles.rowFieldLabel}>Verification depth</span>
                <input
                  type="number"
                  min={MIN_VERIFICATION_DEPTH}
                  max={MAX_VERIFICATION_DEPTH}
                  value={detectionSettings.verificationDepth}
                  aria-describedby="setting-verification-depth-help"
                  onChange={(e) =>
                    void saveDetection({
                      verificationDepth: clampVerificationDepth(Number(e.target.value)),
                    })
                  }
                  data-testid="setting-verification-depth"
                />
              </label>
              <p
                id="setting-verification-depth-help"
                className={styles.helpText}
                data-testid="setting-verification-depth-help"
              >
                Default {DEFAULT_VERIFICATION_DEPTH}, bounds {MIN_VERIFICATION_DEPTH}–
                {MAX_VERIFICATION_DEPTH}. Applies to new scans and explicit re-scans; completed
                results stay current.
              </p>
            </div>
          ) : (
            <p className={styles.engineLoading}>Loading tactical detection settings…</p>
          )}
        </li>

        <li className={styles.row} data-testid="settings-row-maintenance">
          <div className={styles.rowText}>
            <h2 className={styles.rowTitle}>Analysis maintenance</h2>
            <p className={styles.rowDescription}>
              Remove interrupted analysis runs — queued/in-progress jobs left behind by an earlier
              session or a crash — that may make new work appear stuck as &quot;queued&quot;. Your
              games and completed analyses are kept; re-run analysis to regenerate what is removed.
            </p>
          </div>
          <AnalysisMaintenance service={resolvedAnalysis} />
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

        <li className={styles.row} data-testid="settings-row-puzzles">
          <div className={styles.rowText}>
            <h2 className={styles.rowTitle}>Puzzles</h2>
            <p className={styles.rowDescription}>
              Options for the puzzle solving screen. The solve clock is hidden by default; hints
              never fail a puzzle, and the engine becomes available once a puzzle is finished.
            </p>
          </div>
          {puzzleTimerReady ? (
            <div className={styles.boardForm}>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={showPuzzleTimer}
                  onChange={(e) => void savePuzzleTimer(e.target.checked)}
                  data-testid="setting-puzzle-timer"
                />
                <span>Show puzzle timer</span>
              </label>
            </div>
          ) : (
            <p className={styles.engineLoading}>Loading puzzle settings…</p>
          )}
        </li>

        <li className={styles.row} data-testid="settings-row-hints">
          <div className={styles.rowText}>
            <h2 className={styles.rowTitle}>Puzzle hints</h2>
            <p className={styles.rowDescription}>
              Default hint configuration applied to new training sets and Woodpecker blocks. You can
              still override hints per set; existing sets and cycles are unchanged.
            </p>
          </div>
          {hintsReady ? (
            <HintDefaults
              hints={defaultHints}
              error={hintsError}
              onSave={(next) => void saveHints(next)}
            />
          ) : (
            <p className={styles.engineLoading}>Loading puzzle hint settings…</p>
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
