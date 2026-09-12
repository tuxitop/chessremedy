import { lazy, Suspense } from 'react';
import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { ROUTES } from './routes';
import { legacyRedirectRoutes } from './redirects';
import { AppShell } from '@/components/layout/AppShell';
import { HomePage } from '@/pages/HomePage';
import { GamesPage } from '@/pages/GamesPage';
import { AnalysisPage } from '@/pages/AnalysisPage';
import { TrainingHomePage } from '@/pages/TrainingHomePage';
import { MasteredPuzzlesPage } from '@/pages/MasteredPuzzlesPage';
import { SetEditorPage } from '@/pages/SetEditorPage';
import { SetDetailPage } from '@/pages/SetDetailPage';
import { CycleResultsPage } from '@/pages/CycleResultsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

// The playground (and the Stockfish engine code it drives) is development
// tooling, not part of the core app; load it lazily so it stays out of the
// main bundle.
const PlaygroundPage = lazy(() =>
  import('@/pages/PlaygroundPage').then((m) => ({ default: m.PlaygroundPage })),
);

// The live-analysis board drives the Stockfish engine and is the busiest page
// in the app; keep it out of the initial bundle.
const LiveAnalysisPage = lazy(() =>
  import('@/pages/LiveAnalysisPage').then((m) => ({ default: m.LiveAnalysisPage })),
);

// Game Review (Feature 008) mounts the chessboard; keep it out of the initial
// bundle alongside the other board-heavy pages.
const GameReviewPage = lazy(() =>
  import('@/pages/GameReviewPage').then((m) => ({ default: m.GameReviewPage })),
);

// The read-only per-game puzzle list/preview (Feature 011) mounts a chessboard
// per puzzle; keep it out of the initial bundle like Game Review.
const GamePuzzlesPage = lazy(() =>
  import('@/pages/GamePuzzlesPage').then((m) => ({ default: m.GamePuzzlesPage })),
);

// The cycle session (Feature 013) hosts Feature 012's solving screen and its
// chessboard; keep it out of the initial bundle alongside the other board-heavy
// pages.
const CycleSessionPage = lazy(() =>
  import('@/pages/CycleSessionPage').then((m) => ({ default: m.CycleSessionPage })),
);

// The statistics page pulls in the Recharts bundle; keep it out of the initial
// bundle alongside the other heavy pages.
const StatisticsPage = lazy(() =>
  import('@/pages/StatisticsPage').then((m) => ({ default: m.StatisticsPage })),
);

// react-router-dom@7 enables v7 future flags by default; no `future` option
// is needed (and the option is no longer accepted in v7).
export const appRoutes: RouteObject[] = [
  {
    path: ROUTES.home,
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'games', element: <GamesPage /> },
      {
        path: 'games/:id/review',
        element: (
          <Suspense fallback={null}>
            <GameReviewPage />
          </Suspense>
        ),
      },
      {
        path: 'games/:id/puzzles',
        element: (
          <Suspense fallback={null}>
            <GamePuzzlesPage />
          </Suspense>
        ),
      },
      { path: 'analysis', element: <AnalysisPage /> },
      {
        path: 'analysis/live',
        element: (
          <Suspense fallback={null}>
            <LiveAnalysisPage />
          </Suspense>
        ),
      },
      { path: 'training', element: <TrainingHomePage /> },
      { path: 'training/new', element: <SetEditorPage /> },
      { path: 'training/mastered', element: <MasteredPuzzlesPage /> },
      { path: 'training/sets/:setId', element: <SetDetailPage /> },
      {
        path: 'training/sets/:setId/cycles/:cycleNumber',
        element: (
          <Suspense fallback={null}>
            <CycleSessionPage />
          </Suspense>
        ),
      },
      {
        path: 'training/sets/:setId/cycles/:cycleNumber/results',
        element: <CycleResultsPage />,
      },
      {
        path: 'statistics',
        element: (
          <Suspense fallback={null}>
            <StatisticsPage />
          </Suspense>
        ),
      },
      { path: 'settings', element: <SettingsPage /> },
      {
        path: 'playground',
        element: (
          <Suspense fallback={null}>
            <PlaygroundPage />
          </Suspense>
        ),
      },
      ...legacyRedirectRoutes,
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const router = createBrowserRouter(appRoutes);
