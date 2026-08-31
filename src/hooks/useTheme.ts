import { useCallback, useEffect, useState } from 'react';
import { settingsRepository } from '@/infrastructure/db/settings-repository';
import { DEFAULT_THEME, FOUC_THEME_HINT_KEY, SETTINGS_KEYS } from '@/config/app-config';

export type Theme = 'light' | 'dark';

export interface UseTheme {
  theme: Theme;
  isReady: boolean;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

function readHint(): Theme {
  try {
    const stored = window.localStorage.getItem(FOUC_THEME_HINT_KEY);
    if (stored === 'light' || stored === 'dark') {
      return stored;
    }
  } catch {
    /* localStorage may throw in incognito / private mode */
  }
  if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return DEFAULT_THEME;
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    window.localStorage.setItem(FOUC_THEME_HINT_KEY, theme);
  } catch {
    /* ignore */
  }
}

export function useTheme(): UseTheme {
  // Initial value matches the pre-mount inline script in index.html,
  // so the first React render is consistent with the rendered theme.
  const [theme, setThemeState] = useState<Theme>(() => readHint());
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await settingsRepository.get<Theme>(SETTINGS_KEYS.theme);
      if (cancelled) return;
      if (stored === 'light' || stored === 'dark') {
        if (stored !== theme) {
          applyTheme(stored);
          setThemeState(stored);
          if (!cancelled) setIsReady(true);
        }
      } else {
        await settingsRepository.set(SETTINGS_KEYS.theme, theme);
        if (!cancelled) setIsReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    applyTheme(next);
    setThemeState(next);
    void settingsRepository.set(SETTINGS_KEYS.theme, next);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  }, [theme, setTheme]);

  return { theme, isReady, setTheme, toggleTheme };
}
