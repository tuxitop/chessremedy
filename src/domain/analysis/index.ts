/**
 * Feature-008 analysis domain barrel. Pure, deterministic, framework-agnostic
 * game-analysis logic (persistent jobs, position planning, MoveAnalysis
 * building and library status derivation).
 */

export {
  createAnalysisJob,
  analysisJobId,
  jobForRun,
  markCancelled,
  markCompleted,
  markFailed,
  markInProgress,
  markProgress,
  patchJob,
  DEFAULT_ANALYSIS_PROFILE,
} from './job';
export type { AnalysisJob, AnalysisJobPatch } from './job';
export { planGameAnalysis, countLegalMoves } from './plan';
export type { GameAnalysisPlan, PlannedMove, PlanErrorCode, PlanResult } from './plan';
export { buildMoveAnalyses, negateEval, swapWdl, terminalEvalFor } from './build';
export type { BuildInput, InputLine, InputPositionResult } from './build';
export {
  analysisLibraryStatus,
  analysisStatusOf,
  GAME_ANALYSIS_STATUSES,
  isAnalysisObsolete,
  latestCompletedJob,
} from './status';
export type { GameAnalysisStatus } from './status';
export type { EngineIdentity } from './status';
