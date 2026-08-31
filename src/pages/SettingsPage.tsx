import type * as React from 'react';
import { ThemePicker } from '@/components/ui/ThemePicker';
import styles from './SettingsPage.module.css';

interface SettingPlaceholder {
  title: string;
  description: string;
  badge: string;
}

const SETTINGS_PLACEHOLDERS: SettingPlaceholder[] = [
  {
    title: 'Engine strength',
    description: 'Choose the Stockfish profile used for analysis and tactical verification.',
    badge: 'Coming in Feature 005 — Stockfish',
  },
  {
    title: 'Hint behaviour',
    description: 'Configure when the four progressive puzzle hints become available.',
    badge: 'Coming in Feature 011 — Puzzle Training',
  },
  {
    title: 'Synchronization',
    description: 'Optionally connect Dropbox to sync your library across devices.',
    badge: 'Coming in Feature 015 — Synchronization',
  },
];

export function SettingsPage(): React.JSX.Element {
  return (
    <div className={styles.page} data-testid="settings-page">
      <h1 className={styles.heading}>Settings</h1>
      <ThemePicker />
      <ul className={styles.list}>
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
