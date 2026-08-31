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

export const router = createBrowserRouter(
  [
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
  ],
  {
    future: {
      v7_relativeSplatPath: true,
    },
  },
);
