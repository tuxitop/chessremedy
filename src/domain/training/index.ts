/**
 * Feature 012 — puzzle-training domain (barrel).
 *
 * The pure, engine/network/IndexedDB-free heart of the solving experience:
 * presentation solving over an immutable Feature-011 `PuzzleRow`, hint-level
 * gating/content, outcome derivation, and the immutable `PuzzleAttemptRow`
 * builder. Feature-013 hosts the solving screen and consumes the attempt rows
 * this domain shapes; the deterministic fixtures live in `test-support.ts`
 * (imported directly, mirroring the Feature-011 surface).
 */

export type {
  HintLevel,
  PresentationCounters,
  PresentationOutcome,
  PuzzleAttemptRow,
  SessionPuzzleContext,
  SolveHintConfig,
  TrainingResult,
} from './types';
export {
  acceptedMovesOf,
  applyMove,
  beginPresentation,
  playedLine,
  positionAtPly,
  presentationSolved,
  restartPresentation,
} from './solve';
export type {
  PresentationBeginResult,
  PresentationMoveResult,
  PresentationPositionResult,
  PresentationState,
} from './solve';
export { DEFAULT_SOLVE_HINT_CONFIG, hintContent, nextHintLevel, revealNextHint } from './hints';
export type { HintContent, HintContentResult, HintRevealResult } from './hints';
export { buildAttemptRow, deriveResult, presentationOutcomeOf } from './outcome';
export type { BuildAttemptRowInput, OutcomeTrigger } from './outcome';
