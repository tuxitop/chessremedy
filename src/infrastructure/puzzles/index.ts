/**
 * Puzzle-generation infrastructure barrel (Feature 011).
 *
 * The `PuzzleGenerationService` orchestration (engine-free pass over a
 * completed analysis's verified candidates) plus the synchronous browser
 * assembly getter. The service is repository-based and framework-free; only the
 * browser assembly touches browser-only infrastructure.
 */

export {
  PuzzleGenerationService,
  type PuzzleGenerationServiceOptions,
} from './puzzleGenerationService';
export { createBrowserPuzzleGenerationService, getBrowserPuzzleGenerationService } from './browser';
