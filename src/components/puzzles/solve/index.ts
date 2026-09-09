/**
 * Feature 012 — solving screen (barrel).
 *
 * The Feature-012-owned solving surface and its host contract — Feature 013
 * hosts this screen in its own route/page, supplies the ordered `PuzzleRow`
 * queue, the `SolveHintConfig`, the per-puzzle `SessionPuzzleContext` (incl.
 * `presentationIndex`), a `PuzzleAttemptRecorderLike`, and drives navigation
 * from the returned `PresentationOutcome`. Feature 012 ships no route, no nav
 * entry and no Library action; the shared Chessboard (ADR-002/014) stays the
 * only chessboard this surface uses, and the post-solve step is engine-free
 * and stored-data-only (ADR-033).
 */

export { SolveScreen } from './SolveScreen';
export type { SolveScreenProps } from './SolveScreen';
export { OutcomePanel, highestHintText } from './OutcomePanel';
export type { OutcomePanelProps } from './OutcomePanel';
export { PostSolvePanel } from './PostSolvePanel';
export type { PostSolvePanelProps, StoredAnalysisLookup } from './PostSolvePanel';
export { KeyboardMoveEntry, textMoveToUci } from './KeyboardMoveEntry';
export type { KeyboardMoveEntryProps, TextMoveParseResult } from './KeyboardMoveEntry';
export { usePuzzleSolve } from '@/hooks/usePuzzleSolve';
export type {
  MoveSubmission,
  PuzzleSolveController,
  SolveStage,
  UsePuzzleSolveOptions,
  WritePhase,
} from '@/hooks/usePuzzleSolve';

// The host-contract vocabulary the screen/hook props reference (Feature 013
// imports the pieces it needs from this single seam).
export type { PresentationOutcome } from '@/domain/training';
export type { PuzzleRow } from '@/domain/puzzle';
export type { SessionPuzzleContext, SolveHintConfig } from '@/domain/training';
export type { PuzzleAttemptRecorderLike } from '@/infrastructure/training';
