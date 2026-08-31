import type * as React from 'react';
import { Hero } from '@/components/ui/Hero';

export function HomePage(): React.JSX.Element {
  return (
    <Hero
      title="ChessRemedy"
      tagline="Local-first chess training. Import your games, run Stockfish locally, and convert mistakes into personalised puzzles."
      actions={[
        { label: 'Get started', href: '/games' },
        { label: 'View on GitHub', href: 'https://github.com/' },
      ]}
    />
  );
}
