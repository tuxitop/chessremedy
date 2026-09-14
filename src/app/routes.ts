export const ROUTES = {
  home: '/',
  games: '/games',
  analysis: '/analysis',
  analysisLive: '/analysis/live',
  training: '/training',
  trainingNew: '/training/new',
  trainingMastered: '/training/mastered',
  trainingSet: '/training/sets/:setId',
  trainingCycle: '/training/sets/:setId/cycles/:cycleNumber',
  trainingCycleResults: '/training/sets/:setId/cycles/:cycleNumber/results',
  trainingReview: '/training/review',
  statistics: '/statistics',
  settings: '/settings',
  playground: '/playground',
} as const;

export type RoutePath = (typeof ROUTES)[keyof typeof ROUTES];

/** Concrete set-detail path for a set id (`ROUTES.trainingSet` with `:setId`). */
export function trainingSetPath(setId: string): string {
  return `/training/sets/${setId}`;
}

/**
 * Concrete cycle-session path for a set id and 1-based cycle number (plan R-7).
 */
export function trainingCyclePath(setId: string, cycleNumber: number): string {
  return `/training/sets/${setId}/cycles/${cycleNumber}`;
}

/** Concrete cycle-results path for a set id and 1-based cycle number (plan R-7). */
export function trainingCycleResultsPath(setId: string, cycleNumber: number): string {
  return `/training/sets/${setId}/cycles/${cycleNumber}/results`;
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
  { path: ROUTES.training, label: 'Training' },
  { path: ROUTES.statistics, label: 'Insights' },
  { path: ROUTES.analysisLive, label: 'Analysis' },
  { path: ROUTES.settings, label: 'Settings' },
];
