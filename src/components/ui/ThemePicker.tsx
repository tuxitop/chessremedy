import type * as React from 'react';
import { useTheme, type Theme } from '@/hooks/useTheme';
import styles from './ThemePicker.module.css';

export interface ThemePickerProps {
  className?: string;
}

const OPTIONS: Array<{ value: Theme; label: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export function ThemePicker({ className }: ThemePickerProps): React.JSX.Element {
  const { theme, setTheme } = useTheme();
  return (
    <section
      className={[styles.picker, className].filter(Boolean).join(' ')}
      data-testid="theme-picker"
      aria-labelledby="theme-picker-label"
    >
      <h2 id="theme-picker-label" className={styles.label}>
        Theme
      </h2>
      <p className={styles.helper}>
        Choose how ChessRemedy looks. Your choice is remembered on this device.
      </p>
      <div className={styles.options} role="radiogroup" aria-labelledby="theme-picker-label">
        {OPTIONS.map((option) => {
          const isActive = theme === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={isActive}
              className={[styles.optionButton, isActive ? styles.active : '']
                .filter(Boolean)
                .join(' ')}
              onClick={() => setTheme(option.value)}
              data-testid={`theme-option-${option.value}`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
