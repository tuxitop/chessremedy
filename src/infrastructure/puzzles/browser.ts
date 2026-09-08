/**
 * Browser puzzle-generation service assembly (Feature 011, Stage C).
 *
 * Wires the Feature-011 repositories (schema-v8 `puzzles`, Feature-010
 * `puzzleCandidates`, per-analysis summaries) into a `PuzzleGenerationService`
 * with a `Date.now`-based clock. The service is **engine-free by construction**
 * (no engine service, no ADR-018 cache), so this assembly is synchronous and
 * needs no engine initialisation — unlike the tactical-detection assembly.
 */

import { puzzlesRepository } from '@/infrastructure/db/puzzles-repository';
import { puzzleCandidatesRepository } from '@/infrastructure/db/candidates-repository';
import { summariesRepository } from '@/infrastructure/db/summaries-repository';
import { PuzzleGenerationService } from './puzzleGenerationService';

export function createBrowserPuzzleGenerationService(): PuzzleGenerationService {
  return new PuzzleGenerationService({
    puzzles: puzzlesRepository,
    candidates: puzzleCandidatesRepository,
    summaries: summariesRepository,
  });
}

let browserPuzzleGenerationService: PuzzleGenerationService | null = null;

/** Lazily-created shared puzzle-generation service for the browser (memoised). */
export function getBrowserPuzzleGenerationService(): PuzzleGenerationService {
  browserPuzzleGenerationService ??= createBrowserPuzzleGenerationService();
  return browserPuzzleGenerationService;
}
