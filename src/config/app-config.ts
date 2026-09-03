export const APP_NAME = 'ChessRemedy';
export const APP_VERSION = '0.1.0';
// Schema v1 = settings (Foundation); v2 adds the games table (Feature 004).
export const PERSISTENCE_SCHEMA_VERSION = 2;
export const DEFAULT_THEME: 'light' | 'dark' = 'light';

export const SETTINGS_KEYS = {
  theme: 'theme',
  engineDefaults: 'engine.defaults',
} as const;
export type SettingsKey = (typeof SETTINGS_KEYS)[keyof typeof SETTINGS_KEYS];

export const FOUC_THEME_HINT_KEY = 'chessremedy:theme-hint';
