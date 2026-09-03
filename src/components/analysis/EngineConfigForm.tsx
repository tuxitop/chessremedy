import type * as React from 'react';
import type { EngineCapabilities } from '@/infrastructure/engine/capabilities';
import type { AnalysisProfile } from '@/domain/chess';
import { ANALYSIS_PROFILE_ORDER } from '@/infrastructure/engine/engineProfiles';
import {
  AVAILABLE_ENGINES,
  LIVE_LINES_MAX,
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
    <>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Engine</span>
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
        {singleEngine && <span className={styles.hint}>Only one engine available.</span>}
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Profile</span>
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
        <span className={styles.hint}>Profile auto-configures the settings below.</span>
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Search time (seconds)</span>
        <input
          type="number"
          min={1}
          value={settings.searchSeconds}
          onChange={(e) => update('searchSeconds', clampSearchSeconds(Number(e.target.value) || 1))}
          data-testid="setting-search-seconds"
        />
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Number of lines</span>
        <input
          type="number"
          min={1}
          max={LIVE_LINES_MAX}
          value={settings.lines}
          onChange={(e) => update('lines', clampLines(Number(e.target.value) || 1))}
          data-testid="setting-lines"
        />
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Threads</span>
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
        <span className={styles.fieldLabel}>Memory (MB)</span>
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
    </>
  );
}
