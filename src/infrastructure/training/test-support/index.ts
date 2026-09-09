/**
 * Feature 012 — puzzle-training test-support (barrel).
 *
 * The deterministic hosted-session harness (`HostedSession` / `HostedPresentation`):
 * a test-only stand-in for the Feature-013 cycle host over an ordered queue of
 * fixture `PuzzleRow`s, driving presentations through the Stage-A solver and
 * recording attempts through the Stage-C recorder over an injected in-memory
 * repository fake. Consumed by Feature-012 tests (and later Feature-013 tests
 * until its real host lands). Deliberately NOT exported from the production
 * `../index.ts` barrel (mirrors the Feature-011 fixture precedent).
 */

export { HostedPresentation, HostedSession } from './hosted-session';
export type {
  HostedBeginResult,
  HostedFinalization,
  HostedFinalizeResult,
  HostedHintResult,
  HostedPlayResult,
  HostedPresentationStatus,
  HostedPresentationSummary,
  HostedRestartResult,
  HostedRetryFailedMode,
  HostedSessionOptions,
} from './hosted-session';
