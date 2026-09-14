/**
 * Feature 020 — review-scheduling application infrastructure (barrel).
 *
 * The `TsFsrsScheduler` adapter (the only `ts-fsrs` import) and the
 * `ReviewService` coordination layer. Consumers import from here rather than
 * the library.
 */

export { TsFsrsScheduler, tsFsrsScheduler } from './ts-fsrs-adapter';
export { ReviewService } from './review-service';
export type {
  ReviewApplyResult,
  ReviewReconcileResult,
  ReviewServiceOptions,
  ReviewStartOutcome,
} from './review-service';
