import type * as React from 'react';
import { Navigate, useLocation, type RouteObject } from 'react-router-dom';

interface LegacySectionRedirectProps {
  /** Legacy section prefix, e.g. `/puzzles`. */
  from: string;
  /** New section prefix, e.g. `/training`. */
  to: string;
}

/**
 * Client-side redirect for a renamed section. It maps the leading prefix while
 * preserving the query string and hash, and uses `replace` so the browser back
 * button does not loop through the old path.
 */
export function LegacySectionRedirect({ from, to }: LegacySectionRedirectProps): React.JSX.Element {
  const location = useLocation();
  const suffix = location.pathname.startsWith(from) ? location.pathname.slice(from.length) : '';
  return (
    <Navigate
      to={{ pathname: `${to}${suffix}`, search: location.search, hash: location.hash }}
      replace
    />
  );
}

/**
 * Legacy section routes for W1's Puzzles→Training and Dashboard→Statistics
 * renames. Explicit nested routes preserve the suffix plus query/hash; the
 * `puzzles/*` catch-all sends an unknown suffix to `/training` rather than a
 * 404. `/games/:id/puzzles` is never matched here.
 */
export const legacyRedirectRoutes: RouteObject[] = [
  { path: 'puzzles', element: <LegacySectionRedirect from="/puzzles" to="/training" /> },
  { path: 'puzzles/new', element: <LegacySectionRedirect from="/puzzles" to="/training" /> },
  {
    path: 'puzzles/mastered',
    element: <LegacySectionRedirect from="/puzzles" to="/training" />,
  },
  {
    path: 'puzzles/sets/:setId',
    element: <LegacySectionRedirect from="/puzzles" to="/training" />,
  },
  {
    path: 'puzzles/sets/:setId/cycles/:cycleNumber',
    element: <LegacySectionRedirect from="/puzzles" to="/training" />,
  },
  {
    path: 'puzzles/sets/:setId/cycles/:cycleNumber/results',
    element: <LegacySectionRedirect from="/puzzles" to="/training" />,
  },
  {
    path: 'dashboard',
    element: <LegacySectionRedirect from="/dashboard" to="/statistics" />,
  },
  { path: 'puzzles/*', element: <Navigate to="/training" replace /> },
];
