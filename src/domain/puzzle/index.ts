/**
 * Feature 011 — puzzle generation domain (barrel).
 */
export type { PuzzleRow, PuzzleGenerationState, PuzzleOrigin } from './types';
export { PUZZLE_GENERATOR_VERSION } from './types';
export { assemblePuzzle, assembleBlunderPuzzle, blunderDifficultyOf } from './assemble';
export type { BlunderPuzzleInput } from './assemble';
export { difficultyBucketOf, DIFFICULTY_BUCKETS } from './buckets';
export type { DifficultyBucket, DifficultyBucketName } from './buckets';
export { puzzleIdOf, parsePuzzleId } from './id';
export type { PuzzleIdParseResult } from './id';
export {
  objectiveLabel,
  OBJECTIVE_LABELS,
  BLUNDER_OBJECTIVE_LABEL,
  puzzleObjectiveLabel,
} from './objectiveLabel';
