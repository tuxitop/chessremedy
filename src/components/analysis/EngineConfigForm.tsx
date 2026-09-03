import type * as React from 'react';
import type { EngineCapabilities } from '@/infrastructure/engine/capabilities';
import type { AnalysisProfile } from '@/domain/chess';
import { ANALYSIS_PROFILE_ORDER } from '@/infrastructure/engine/engineProfiles';
import {
  ARROW_MODES,
  AVAILABLE_ENGINES,
  LIVE_DEPTH_MAX,
  LIVE_DEPTH_MIN,
  LIVE_LINES_MAX,
  LIVE_LINES_MIN,
  LIVE_SEARCH_SECONDS_MIN,
  clampDepth,
  clampLines,
  clampSearchSeconds,
} from './engineSettings';
import type { LiveEngineSettings } from './engineSettings';
import styles from './EngineSettingsPopover.module.css';

export interface EngineConfigFormProps {
  readonly settings: LiveEngineSettings;
  readonly capabilities: EngineCapabilities;
  readonly onChange: (next: LiveEngineSettings) => void;
  readonly onApplyProfile: (profile: AnalysisProfile) => void;
}

export function HelpIcon({ text }: { readonly text: string }): React.JSX.Element {
  return (
    <span className={styles.helpWrap} aria-label={text} title={text}>
      <span className={styles.helpIcon} aria-hidden="true">
        ?
      </span>
    </span>
  );
}

/** Field group shared by the engine-settings popover and the Settings page. */
export function EngineConfigForm({
  settings,
  capabilities,
  onChange,
  onApplyProfile,
}: EngineConfigFormProps): React.JSX.Element {
  const singleEngine = AVAILABLE_ENGINES.length === 1;
  const update = <K extends keyof LiveEngineSettings>(
    key: K,
    value: LiveEngineSettings[K],
  ): void => {
    onChange({ ...settings, [key]: value });
  };

  return (
    <div className={styles.grid}>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>
          Engine
          <HelpIcon text="The chess engine used for live analysis." />
        </span>
        <select
          value={settings.engine}
          disabled={singleEngine}
          onChange={(e) => update('engine', e.target.value as LiveEngineSettings['engine'])}
          data-testid="setting-engine"
        >
          {AVAILABLE_ENGINES.map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>
          Profile
          <HelpIcon text="A preset that auto-configures depth, time, lines, threads and memory." />
        </span>
        <select
          value={settings.profile}
          onChange={(e) => onApplyProfile(e.target.value as AnalysisProfile)}
          data-testid="setting-profile"
        >
          {ANALYSIS_PROFILE_ORDER.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>
          Depth
          <HelpIcon text="Maximum search depth. Analysis stops at depth or time, whichever comes first." />
        </span>
        <div className={styles.rangeRow}>
          <input
            type="range"
            min={LIVE_DEPTH_MIN}
            max={LIVE_DEPTH_MAX}
            value={settings.depth}
            onChange={(e) => update('depth', clampDepth(Number(e.target.value)))}
            data-testid="setting-depth"
          />
          <output className={styles.rangeValue} data-testid="setting-depth-value">
            {settings.depth}
          </output>
        </div>
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>
          Search time (s)
          <HelpIcon text="Maximum time spent per position. Analysis stops at depth or time, whichever comes first." />
        </span>
        <div className={styles.rangeRow}>
          <input
            type="range"
            min={LIVE_SEARCH_SECONDS_MIN}
            max={60}
            value={Math.min(settings.searchSeconds, 60)}
            onChange={(e) => update('searchSeconds', clampSearchSeconds(Number(e.target.value)))}
            data-testid="setting-search-seconds"
          />
          <output className={styles.rangeValue} data-testid="setting-search-seconds-value">
            {settings.searchSeconds}
          </output>
        </div>
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>
          Lines
          <HelpIcon text="How many principal variations to display and draw as arrows." />
        </span>
        <div className={styles.rangeRow}>
          <input
            type="range"
            min={LIVE_LINES_MIN}
            max={LIVE_LINES_MAX}
            value={settings.lines}
            onChange={(e) => update('lines', clampLines(Number(e.target.value)))}
            data-testid="setting-lines"
          />
          <output className={styles.rangeValue} data-testid="setting-lines-value">
            {settings.lines}
          </output>
        </div>
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>
          Arrows
          <HelpIcon text="Show only the best move, or an arrow for every displayed line (later lines are greyed)." />
        </span>
        <select
          value={settings.arrows}
          onChange={(e) => update('arrows', e.target.value as LiveEngineSettings['arrows'])}
          data-testid="setting-arrows"
        >
          {ARROW_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {mode === 'first' ? 'First line' : 'All lines'}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>
          Threads
          <HelpIcon text="Search threads. Limited by the engine build and your device." />
        </span>
        <input
          type="number"
          min={1}
          max={capabilities.threads}
          value={settings.threads}
          disabled={capabilities.threads <= 1}
          onChange={(e) =>
            update(
              'threads',
              Math.min(capabilities.threads, Math.max(1, Number(e.target.value) || 1)),
            )
          }
          data-testid="setting-threads"
        />
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>
          Memory (MB)
          <HelpIcon text="Hash memory used by the engine, capped by your device." />
        </span>
        <input
          type="number"
          min={1}
          max={capabilities.hashCapMb}
          value={settings.memoryMb}
          onChange={(e) =>
            update(
              'memoryMb',
              Math.min(capabilities.hashCapMb, Math.max(1, Number(e.target.value) || 1)),
            )
          }
          data-testid="setting-memory"
        />
      </label>
    </div>
  );
}
