import type * as React from 'react';
import { useTheme } from '@/hooks/useTheme';
import styles from './ThemeToggle.module.css';

export interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className }: ThemeToggleProps): React.JSX.Element {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  const label = isDark ? 'Switch to light theme' : 'Switch to dark theme';
  return (
    <button
      type="button"
      className={[styles.toggle, className].filter(Boolean).join(' ')}
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      data-testid="theme-toggle"
      data-theme-mode={theme}
    >
      <span aria-hidden="true" className={styles.icon}>
        {isDark ? '☀' : '☾'}
      </span>
    </button>
  );
}
