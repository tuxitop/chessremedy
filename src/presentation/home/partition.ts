/**
 * Feature 018 — Home primary-partition selector (pure, no React).
 *
 * Selects the busiest concrete `(platform, timeControl)` partition from the
 * Feature-014 `gameMetrics` result. It never merges partitions and never
 * computes a count: it only compares the canonical `metrics.games.total`
 * Feature 014 already returns. Ties keep Feature 014's canonical order (strict
 * `>`), so the selection is deterministic for a fixed input.
 */

import type { PlatformDimension, TimeControlDimension } from '@/domain/statistics/types';

/** The minimal partition shape the selector reads (Feature-014 result compatible). */
export interface PrimaryPartitionLike {
  readonly platform: PlatformDimension;
  readonly timeControl: TimeControlDimension;
  readonly combined: boolean;
  readonly metrics: { readonly games: { readonly total: number } };
}

/**
 * The concrete partition with the most games, or `null` when none qualifies.
 * `combined === true` and `fixture`-platform partitions are skipped; ties keep
 * the input (canonical Feature-014) order.
 */
export function selectPrimaryPartition<T extends PrimaryPartitionLike>(
  partitions: readonly T[],
): T | null {
  let best: T | null = null;
  for (const partition of partitions) {
    if (partition.combined || partition.platform === 'fixture') {
      continue;
    }
    if (best === null || partition.metrics.games.total > best.metrics.games.total) {
      best = partition;
    }
  }
  return best;
}
