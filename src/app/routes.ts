import { ANALYSIS_GLYPH } from '@/components/ui/icons';

export const ROUTES = {
  home: '/',
  games: '/games',
  analysis: '/analysis',
  analysisLive: '/analysis/live',
  puzzles: '/puzzles',
  dashboard: '/dashboard',
  settings: '/settings',
  playground: '/playground',
} as const;

export type RoutePath = (typeof ROUTES)[keyof typeof ROUTES];

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
