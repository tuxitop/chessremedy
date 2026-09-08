/**
 * Game-analysis infrastructure (Feature 008). Barrel.
 */

export { AnalysisService, AnalysisServiceError } from './analysisService';
export type {
  AnalysisRunOptions,
  AnalysisServiceOptions,
  GameAnalysisProgress,
  PuzzleGenerationOutcome,
  ReconcileResult,
  ScanGameOutcome,
} from './analysisService';
export { createBrowserAnalysisService, getBrowserAnalysisService } from './browser';
