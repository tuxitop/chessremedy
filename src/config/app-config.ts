export const APP_NAME = 'ChessRemedy';
export const APP_VERSION = '0.1.0';
// Schema v1 = settings (Foundation); v2 adds the games table (Feature 004);
// v3 adds the importJobs table (Feature 007); v4 adds the game-analysis
// tables analysisJobs/analyses/positionAnalysisCache (Feature 008);
// v5 stores the structured time control on each game (Feature 008 revision);
// v6 moveCount/termination backfill; v7 analysisSummaries/puzzleCandidates
// (Feature 010).
export const PERSISTENCE_SCHEMA_VERSION = 7;
export const DEFAULT_THEME: 'light' | 'dark' = 'light';

export const SETTINGS_KEYS = {
  theme: 'theme',
  engineDefaults: 'engine.defaults',
  boardAppearance: 'board.appearance',
  analysisGame: 'analysis.game',
  chessComUsername: 'import.chesscom.username',
  lichessUsername: 'import.lichess.username',
  chessComFilters: 'import.chesscom.filters',
  lichessFilters: 'import.lichess.filters',
} as const;
export type SettingsKey = (typeof SETTINGS_KEYS)[keyof typeof SETTINGS_KEYS];

export const FOUC_THEME_HINT_KEY = 'chessremedy:theme-hint';
