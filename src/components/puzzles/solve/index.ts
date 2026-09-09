/**
 * Feature 012 — solving screen (barrel).
 *
 * The Feature-012-owned solving surface and its host contract — Feature 013
 * hosts this screen in its own route/page, supplies the ordered `PuzzleRow`
 * queue, the `SolveHintConfig`, the per-puzzle `SessionPuzzleContext` (incl.
 * `presentationIndex`), a `PuzzleAttemptRecorderLike`, and drives navigation
 * from the returned `PresentationOutcome`. Feature 012 ships no route, no nav
 * entry and no Library action; the shared Chessboard (ADR-002/014) stays the
 * only chessboard this surface uses. Solving is a single analysis-style view:
 * the game-prefix move list with in-list results, drawable board, and an
 * engine toggle that becomes available once the puzzle is finished (ADR-033).
 */

export { SolveScreen, SOLVE_RESULT_LABELS } from './SolveScreen';
export type { SolveScreenProps, StoredAnalysisLookup } from './SolveScreen';
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
