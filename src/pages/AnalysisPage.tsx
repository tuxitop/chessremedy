import type * as React from 'react';
import { PlaceholderPanel } from './PlaceholderPanel';

export function AnalysisPage(): React.JSX.Element {
  return (
    <PlaceholderPanel
      heading="Analysis"
      description="Run local Stockfish analysis on imported games. See centipawn loss, WDL, classifications and missed tactical opportunities. Engine work belongs to later features."
      badge="Coming in Features 007 / 008 — Game Analysis & Move Classification"
    />
  );
}
