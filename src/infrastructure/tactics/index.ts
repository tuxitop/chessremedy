/**
 * Tactical detection infrastructure barrel (Feature 010).
 *
 * The `TacticalDetectionService` orchestration (Stage-1 + Stage-2 pass over a
 * completed analysis run, cache-aware and resumable) plus the browser assembly
 * getter. The service is engine/repository-based and framework-free; only the
 * browser assembly touches browser-only infrastructure.
 */

export {
  TacticalDetectionService,
  type BackfillOptions,
  type TacticalDetectionServiceOptions,
} from './tacticalDetectionService';
export {
  createBrowserTacticalDetectionService,
  getBrowserTacticalDetectionService,
  resolveStoredVerificationDepth,
} from './browser';
export {
  DEFAULT_VERIFICATION_DEPTH,
  MAX_VERIFICATION_DEPTH,
  MIN_VERIFICATION_DEPTH,
  clampTacticalDetectionSettings,
  clampVerificationDepth,
  defaultTacticalDetectionSettings,
} from './verificationDepth';
export type { TacticalDetectionSettings } from './verificationDepth';
