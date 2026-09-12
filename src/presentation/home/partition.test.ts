/**
 * Feature 018 — `selectPrimaryPartition` selector tests (deterministic, no DOM).
 */

import { describe, expect, it } from 'vitest';
import type { PlatformDimension, TimeControlDimension } from '@/domain/statistics/types';
import { selectPrimaryPartition } from './partition';

function partition(
  platform: PlatformDimension,
  timeControl: TimeControlDimension,
  total: number,
  combined = false,
) {
  return { platform, timeControl, combined, metrics: { games: { total } } };
}

describe('selectPrimaryPartition', () => {
  it('returns the partition with the most games', () => {
    const rapid = partition('lichess', 'rapid', 12);
    const blitz = partition('chesscom', 'blitz', 4);

    expect(selectPrimaryPartition([blitz, rapid])).toBe(rapid);
  });

  it('keeps the canonical input order on a tie', () => {
    const first = partition('lichess', 'rapid', 5);
    const second = partition('chesscom', 'blitz', 5);

    expect(selectPrimaryPartition([first, second])).toBe(first);
  });

  it('skips combined partitions', () => {
    const combined = partition('all', 'all', 99, true);
    const concrete = partition('lichess', 'rapid', 3);

    expect(selectPrimaryPartition([combined, concrete])).toBe(concrete);
  });

  it('skips fixture-platform partitions', () => {
    const fixture = partition('fixture', 'rapid', 99);
    const concrete = partition('lichess', 'rapid', 2);

    expect(selectPrimaryPartition([fixture, concrete])).toBe(concrete);
  });

  it('returns the single qualifying partition', () => {
    const only = partition('chesscom', 'bullet', 7);
    expect(selectPrimaryPartition([only])).toBe(only);
  });

  it('returns null when nothing qualifies', () => {
    expect(selectPrimaryPartition([])).toBeNull();
    expect(selectPrimaryPartition([partition('fixture', 'rapid', 1)])).toBeNull();
    expect(selectPrimaryPartition([partition('all', 'all', 1, true)])).toBeNull();
  });
});
