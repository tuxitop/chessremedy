/**
 * Feature 012 — puzzle-training application infrastructure (barrel).
 *
 * The `PuzzleAttemptRecorder` outcome-write service (the seam the Feature-013
 * host and the Stage-D solving UI consume) plus the attempt-row domain types a
 * Feature-013/014 consumer reads back. This is the 012→013 boundary: 013 hosts
 * the solving screen in its own route/page, supplies the ordered puzzle queue,
 * the `SolveHintConfig`, and the per-puzzle `SessionPuzzleContext` (incl.
 * `presentationIndex`), decides retry-failed behaviour, and derives every cycle
 * aggregate from the recorded rows. The Feature-012 test-support hosted-session
 * harness is deliberately NOT exported here (it lives under `test-support/`,
 * mirroring the Feature-011 fixture precedent).
 */

export {
  PuzzleAttemptRecorder,
  PuzzleAttemptWriteError,
  type PuzzleAttemptRecorderLike,
  type PuzzleAttemptRecorderOptions,
} from './attempts-service';
export type { AttemptWriteResult, RecordAttemptInput } from './attempts-service';

// Feature 013 — training-set lifecycle (Stage C): resolve + persist a fixed
// membership from a game, the pool or a manual selection, then rename/
// configure/archive/delete it; the derived pool, the one-click Woodpecker block
// and the close/return-to-pool lifecycle. Typed results; never throws for
// expected states.
export { TrainingSetsService } from './training-sets-service';
export type {
  AutoSetImmutable,
  BlockAlreadyOpen,
  BlockEmptyPool,
  CreateBlockResult,
  CreateBlockSuccess,
  CreateSetFromGameInput,
  CreateSetFromPoolInput,
  CreateSetManualInput,
  CreateSetResult,
  CreateSetSuccess,
  CreateWoodpeckerBlockInput,
  InvalidSetConfig,
  NotABlock,
  SetDeleteResult,
  SetMutationResult,
  SetNotFound,
  TrainingSetsServiceOptions,
} from './training-sets-service';

// Feature 013 — training-cycle lifecycle (Stage C): start/resume/abandon/repeat,
// the Quick-train ad-hoc session, and the results read model, all over persisted
// rows and the Stage-A domain.
export { CycleService } from './cycle-service';
export type {
  CycleAbandonResult,
  CycleComparisonInput,
  CycleEmptyPool,
  CycleEmptySet,
  CycleInvalidConfig,
  CycleNotAbandonable,
  CycleNotFound,
  CycleNotResumable,
  CycleQuickTrainResult,
  CycleResults,
  CycleResultsResult,
  CycleResumeResult,
  CycleServiceOptions,
  CycleStartResult,
} from './cycle-service';

// The attempt-row domain vocabulary consumers of the recorder need (re-exported
// from the pure domain barrel so this layer is their single import seam).
export type {
  PresentationCounters,
  PresentationOutcome,
  PuzzleAttemptRow,
  SessionPuzzleContext,
  SolveHintConfig,
  TrainingResult,
} from '@/domain/training';
export type { OutcomeTrigger } from '@/domain/training';
