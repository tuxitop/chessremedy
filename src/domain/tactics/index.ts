/**
 * Tactical detection domain barrel (Feature 010).
 *
 * Pure, deterministic, framework-agnostic logic: the shared types, Stage-1
 * candidate generation, the verified-miss annotation, line walking, objective
 * classification, Stage-2 verification and the ADR-025 difficulty estimate.
 */

export type {
  CandidateVerificationStatus,
  DetectionPassState,
  RawCandidate,
  TacticalObjective,
  VerificationMetadata,
  VerificationSource,
  VerifiedTacticalCandidate,
} from './types';
export { CANDIDATE_GENERATION_VERSION, DETECTION_VERSION } from './types';
export { generateCandidates } from './stage1';
export { annotateVerifiedMisses } from './annotate';
export { walkLine, forcingness, materialDelta, lineTermination, isTerminalDraw } from './line';
export type {
  LineEnd,
  LinePly,
  LineWalk,
  LineWalkResult,
  MaterialBalance,
  LineTermination,
} from './line';
export { classifyObjective } from './objective';
export type { ObjectiveInputs } from './objective';
export { estimateDifficulty } from './difficulty';
export type { DifficultyInputs } from './difficulty';
export { verifyCandidate, VERIFICATION_REJECTION_REASONS } from './verify';
export type {
  PrefixScanOutcome,
  TacticalCandidateLine,
  TacticalVerificationInput,
  VerificationRejectionReason,
  VerifyResult,
} from './verify';
export { FAST_PATH_MIN_STORED_DEPTH, fastPathVerifiedCandidate } from './fastPath';
export type { StoredLineSource } from './fastPath';
