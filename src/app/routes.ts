export const ROUTES = {
  home: '/',
  games: '/games',
  analysis: '/analysis',
  puzzles: '/puzzles',
  dashboard: '/dashboard',
  settings: '/settings',
} as const;

export type RoutePath = (typeof ROUTES)[keyof typeof ROUTES];

export interface NavItem {
  path: RoutePath;
  label: string;
}

export const NAV_ITEMS: NavItem[] = [
  { path: ROUTES.home, label: 'Home' },
  { path: ROUTES.games, label: 'Games' },
  { path: ROUTES.analysis, label: 'Analysis' },
  { path: ROUTES.puzzles, label: 'Puzzles' },
  { path: ROUTES.dashboard, label: 'Dashboard' },
  { path: ROUTES.settings, label: 'Settings' },
];
