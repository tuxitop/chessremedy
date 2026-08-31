import type * as React from 'react';
import { PlaceholderPanel } from './PlaceholderPanel';

export function DashboardPage(): React.JSX.Element {
  return (
    <PlaceholderPanel
      heading="Dashboard"
      description="Rating trends, accuracy, blunders and missed tactics — separated by time control and platform. The dashboard is a presentation layer over the statistics service."
      badge="Coming in Feature 014 — Dashboard"
    />
  );
}
