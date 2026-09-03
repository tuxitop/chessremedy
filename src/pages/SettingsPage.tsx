import type * as React from 'react';
import { ThemePicker } from '@/components/ui/ThemePicker';
import { useEngineDefaults } from '@/hooks/useEngineDefaults';
import { readBrowserCapabilities } from '@/infrastructure/engine/capabilities';
import { EngineConfigForm } from '@/components/analysis/EngineConfigForm';
import { settingsWithProfile } from '@/components/analysis/engineSettings';
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

export function SettingsPage(): React.JSX.Element {
  const { defaults, isReady, save } = useEngineDefaults();
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
              tactical verification).
            </p>
          </div>
          <div className={styles.engineDefaults}>
            {isReady && defaults ? (
              <EngineConfigForm
                settings={defaults}
                capabilities={capabilities}
                onChange={(next) => void save(next)}
                onApplyProfile={(profile) =>
                  void save(settingsWithProfile(defaults, profile, capabilities))
                }
              />
            ) : (
              <p className={styles.engineLoading}>Loading engine defaults…</p>
            )}
          </div>
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
