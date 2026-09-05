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
} from './browser';
