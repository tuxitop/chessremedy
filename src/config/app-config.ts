export const APP_NAME = 'ChessRemedy';
export const APP_VERSION = '0.1.0';
// Schema v1 = settings (Foundation); v2 adds the games table (Feature 004);
// v3 adds the importJobs table (Feature 007); v4 adds the game-analysis
// tables analysisJobs/analyses/positionAnalysisCache (Feature 008);
// v5 stores the structured time control on each game (Feature 008 revision);
// v6 moveCount/termination backfill; v7 analysisSummaries/puzzleCandidates
// (Feature 010); v8 puzzles (Feature 011); v9 puzzleAttempts (Feature 012);
// v10 trainingSets/trainingCycles (Feature 013); v11 re-normalizes the
// platform-specific time control (ADR-013 revision); v12 adds the Feature-016
// sync tables (syncState/syncTombstones/syncBackups) and backfills the
// mutable-row `updatedAt` merge timestamps (additive).
export const PERSISTENCE_SCHEMA_VERSION = 12;
export const DEFAULT_THEME: 'light' | 'dark' = 'light';

export const SETTINGS_KEYS = {
  theme: 'theme',
  engineDefaults: 'engine.defaults',
  boardAppearance: 'board.appearance',
  analysisGame: 'analysis.game',
  analysisTacticalDetection: 'analysis.tacticalDetection',
  chessComUsername: 'import.chesscom.username',
  lichessUsername: 'import.lichess.username',
  chessComFilters: 'import.chesscom.filters',
  lichessFilters: 'import.lichess.filters',
  puzzleTimer: 'puzzle.timer',
  puzzleTimerRedThreshold: 'puzzle.timerRedThreshold',
  sessionDefaultMinutes: 'training.session.defaultMinutes',
  sessionWarningSeconds: 'training.session.warningSeconds',
  defaultHintConfig: 'training.hints',
  legacyAutoSetsCleaned: 'training.legacyAutoSetsCleaned',
} as const;
export type SettingsKey = (typeof SETTINGS_KEYS)[keyof typeof SETTINGS_KEYS];

export const FOUC_THEME_HINT_KEY = 'chessremedy:theme-hint';
