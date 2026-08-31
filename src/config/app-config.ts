export const APP_NAME = 'ChessRemedy';
export const APP_VERSION = '0.1.0';
export const PERSISTENCE_SCHEMA_VERSION = 1;
export const DEFAULT_THEME: 'light' | 'dark' = 'light';

export const SETTINGS_KEYS = {
  theme: 'theme',
} as const;
export type SettingsKey = (typeof SETTINGS_KEYS)[keyof typeof SETTINGS_KEYS];

export const FOUC_THEME_HINT_KEY = 'chessremedy:theme-hint';
