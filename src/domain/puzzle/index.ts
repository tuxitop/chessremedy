/**
 * Feature 011 — puzzle generation domain (barrel).
 */
export type { PuzzleRow, PuzzleGenerationState } from './types';
export { PUZZLE_GENERATOR_VERSION } from './types';
export { assemblePuzzle } from './assemble';
export { difficultyBucketOf, DIFFICULTY_BUCKETS } from './buckets';
export type { DifficultyBucket, DifficultyBucketName } from './buckets';
export { objectiveLabel, OBJECTIVE_LABELS } from './objectiveLabel';
