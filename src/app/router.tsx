import { createBrowserRouter } from 'react-router-dom';
import { ROUTES } from './routes';
import { AppShell } from '@/components/layout/AppShell';
import { HomePage } from '@/pages/HomePage';
import { GamesPage } from '@/pages/GamesPage';
import { AnalysisPage } from '@/pages/AnalysisPage';
import { PuzzlesPage } from '@/pages/PuzzlesPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

// react-router-dom@7 enables v7 future flags by default; no `future` option
// is needed (and the option is no longer accepted in v7).
export const router = createBrowserRouter([
  {
    path: ROUTES.home,
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'games', element: <GamesPage /> },
      { path: 'analysis', element: <AnalysisPage /> },
      { path: 'puzzles', element: <PuzzlesPage /> },
      { path: 'dashboard', element: <DashboardPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
