import { ANALYSIS_GLYPH } from '@/components/ui/icons';

export const ROUTES = {
  home: '/',
  games: '/games',
  analysis: '/analysis',
  analysisLive: '/analysis/live',
  puzzles: '/puzzles',
  puzzlesNew: '/puzzles/new',
  puzzlesMastered: '/puzzles/mastered',
  puzzlesSet: '/puzzles/sets/:setId',
  puzzlesCycle: '/puzzles/sets/:setId/cycles/:cycleNumber',
  puzzlesCycleResults: '/puzzles/sets/:setId/cycles/:cycleNumber/results',
  dashboard: '/dashboard',
  settings: '/settings',
  playground: '/playground',
} as const;

export type RoutePath = (typeof ROUTES)[keyof typeof ROUTES];

/** Concrete set-detail path for a set id (`ROUTES.puzzlesSet` with `:setId`). */
export function puzzlesSetPath(setId: string): string {
  return `/puzzles/sets/${setId}`;
}

/**
 * Concrete cycle-session path for a set id and 1-based cycle number (plan R-7).
 */
export function puzzlesCyclePath(setId: string, cycleNumber: number): string {
  return `/puzzles/sets/${setId}/cycles/${cycleNumber}`;
}

/** Concrete cycle-results path for a set id and 1-based cycle number (plan R-7). */
export function puzzlesCycleResultsPath(setId: string, cycleNumber: number): string {
  return `/puzzles/sets/${setId}/cycles/${cycleNumber}/results`;
}

export interface NavItem {
  path: RoutePath;
  label: string;
  /** Optional accessible-name-preserving icon/emoji shown before the label. */
  glyph?: string;
}

export const NAV_ITEMS: NavItem[] = [
  { path: ROUTES.home, label: 'Home' },
  { path: ROUTES.games, label: 'Games' },
  { path: ROUTES.analysisLive, label: 'Analysis', glyph: ANALYSIS_GLYPH },
  { path: ROUTES.puzzles, label: 'Puzzles' },
  { path: ROUTES.dashboard, label: 'Dashboard' },
  { path: ROUTES.settings, label: 'Settings' },
];
