/**
 * Feature 011 — ADR-025 difficulty buckets (domain, pure).
 *
 * The ADR-025 difficulty formula lives in `domain/tactics/difficulty.ts`; the
 * *buckets* are display/ordering metadata owned here next to the puzzle model
 * so the per-game view and (later) Feature-013 share one canonical mapping.
 */

export type DifficultyBucketName = 'Trivial' | 'Easy' | 'Medium' | 'Hard' | 'Expert';

export interface DifficultyBucket {
  readonly name: DifficultyBucketName;
  /** Inclusive lower bound of the ADR-025 range. */
  readonly min: number;
  /** Inclusive upper bound of the ADR-025 range. */
  readonly max: number;
}

/** ADR-025 display buckets in ascending order (contiguous 0-100). */
export const DIFFICULTY_BUCKETS: readonly DifficultyBucket[] = [
  { name: 'Trivial', min: 0, max: 14 },
  { name: 'Easy', min: 15, max: 34 },
  { name: 'Medium', min: 35, max: 59 },
  { name: 'Hard', min: 60, max: 79 },
  { name: 'Expert', min: 80, max: 100 },
];

/**
 * Bucket for an ADR-025 difficulty score. Scores outside `[0, 100]` clamp to
 * the nearest bucket (`< 0` → Trivial, `> 100` → Expert).
 */
export function difficultyBucketOf(score: number): DifficultyBucket {
  for (const bucket of DIFFICULTY_BUCKETS) {
    if (score <= bucket.max) {
      return bucket;
    }
  }
  return DIFFICULTY_BUCKETS[DIFFICULTY_BUCKETS.length - 1]!;
}
