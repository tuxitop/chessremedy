/**
 * Game-analysis domain barrel (Features 008 + 009). Pure, deterministic,
 * framework-agnostic logic: persistent jobs, position planning, MoveAnalysis
 * building, library status derivation, classification presentation
 * (`classificationMeta`) and ADR-024 accuracy (`accuracy`).
 */

export {
  createAnalysisJob,
  analysisJobId,
  gameAnalysisConfigFingerprint,
  jobForRun,
  markCancelled,
  markCompleted,
  markFailed,
  markInProgress,
  markProgress,
  patchJob,
  DEFAULT_ANALYSIS_PROFILE,
} from './job';
export type { AnalysisJob, AnalysisJobPatch, GameAnalysisConfig } from './job';
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
export type { EngineIdentity, ExpectedAnalysisConfig } from './status';
export {
  CLASSIFICATION_LABELS,
  CLASSIFICATION_NAG,
  nagForClassification,
  isEmphasized,
  CLASSIFICATION_LABEL_TEXT,
  CLASSIFICATION_EXPLANATION,
  accuracyText,
  formatAccuracy,
} from './classificationMeta';
export { moveAccuracy, gameAccuracy, MOVE_ACCURACY_VERSION } from './accuracy';
export type { GameAccuracy, GameAccuracyOptions } from './accuracy';
