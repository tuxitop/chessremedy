import type * as React from 'react';
import { PlaceholderPanel } from './PlaceholderPanel';

export function PuzzlesPage(): React.JSX.Element {
  return (
    <PlaceholderPanel
      heading="Puzzles"
      description="Solve personalised tactical puzzles generated from your own games. Spaced repetition schedules the right puzzle at the right time."
      badge="Coming in Features 010 / 011 — Puzzle Generation & Training"
    />
  );
}
