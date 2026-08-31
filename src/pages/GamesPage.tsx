import type * as React from 'react';
import { PlaceholderPanel } from './PlaceholderPanel';

export function GamesPage(): React.JSX.Element {
  return (
    <PlaceholderPanel
      heading="Your games"
      description="Connect a Chess.com or Lichess account and import your rated games. Until the importer lands, this page shows where it will live."
      badge="Coming in Feature 006 — Game Import"
    />
  );
}
