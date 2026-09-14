import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { SolveScreen } from '@/components/puzzles/solve';
import {
  SessionSetup,
  SessionSummary,
  SessionTimer,
  formatPercent,
} from '@/components/puzzles/cycles';
import { usePuzzleTimerSetting } from '@/hooks/usePuzzleTimerSetting';
import { usePuzzleTimerThreshold } from '@/hooks/usePuzzleTimerThreshold';
import { useTrainingSession } from '@/hooks/useTrainingSession';
import { useTrainingSessionSettings } from '@/hooks/useTrainingSessionSettings';
import { useCycleSession } from '@/hooks/useCycleSession';
import { formatRelativeDue } from '@/presentation/review/relativeTime';
import type { PuzzleRow } from '@/domain/puzzle';
import { SCHEDULE_REBUILD_BATCH, type ReviewOverview, type Scheduler } from '@/domain/review';
import {
  summarizeSession,
  type PresentationOutcome,
  type SessionConfig,
  type SessionSummary as SessionSummaryData,
  type TacticalTrainingSetRow,
  type TrainingCycleRow,
} from '@/domain/training';
import {
  CycleService,
  PuzzleAttemptRecorder,
  type PuzzleAttemptRecorderLike,
} from '@/infrastructure/training';
import { ReviewService, tsFsrsScheduler } from '@/infrastructure/review';
import { trainingSetsRepository } from '@/infrastructure/db/training-sets-repository';
import type { TrainingSetsRepository } from '@/infrastructure/db/training-sets-repository';
import { trainingCyclesRepository } from '@/infrastructure/db/training-cycles-repository';
import type { TrainingCyclesRepository } from '@/infrastructure/db/training-cycles-repository';
import { puzzlesRepository } from '@/infrastructure/db/puzzles-repository';
import type { PuzzlesRepository } from '@/infrastructure/db/puzzles-repository';
import { attemptsRepository } from '@/infrastructure/db/attempts-repository';
import type { PuzzleAttemptsRepository } from '@/infrastructure/db/attempts-repository';
import { reviewSchedulesRepository } from '@/infrastructure/db/review-schedules-repository';
import { settingsRepository } from '@/infrastructure/db/settings-repository';
import { ROUTES } from '@/app/routes';
import styles from './ReviewSessionPage.module.css';

/** Everything the mounted review session needs, once started. */
interface ReviewSessionData {
  readonly set: TacticalTrainingSetRow;
  readonly cycle: TrainingCycleRow;
  readonly puzzles: ReadonlyMap<string, PuzzleRow>;
  /** The duration chosen in the setup panel (`null` = no time limit). */
  readonly durationMs: number | null;
}

export interface ReviewSessionPageProps {
  /** Injectable for tests; defaults to the singleton-backed service. */
  readonly reviewService?: ReviewService;
  /** Injectable for tests; defaults to the singleton-backed service. */
  readonly cycleService?: CycleService;
  /** Injectable for tests; defaults to the repository-backed recorder. */
  readonly recorder?: PuzzleAttemptRecorderLike;
  readonly setsRepository?: TrainingSetsRepository;
  readonly cyclesRepository?: TrainingCyclesRepository;
  readonly puzzles?: PuzzlesRepository;
  readonly attempts?: PuzzleAttemptsRepository;
  /** Injectable scheduler (defaults to the `ts-fsrs` adapter). */
  readonly scheduler?: Scheduler;
  /** Injectable clock for deterministic tests. */
  readonly now?: () => number;
}

/** Bounded reconcile passes before the first overview (non-blocking rebuild). */
const MAX_RECONCILE_PASSES = 20;

/**
 * The review session route (`/training/review`): a setup panel showing the
 * due/new counts and the caps in force, then the Feature-013 session host over
 * Feature 012's `SolveScreen` with the Feature-019 timer/summary chrome, and a
 * review summary. Each definite outcome applies one grade to the puzzle's
 * schedule projection; the session queue is fixed at start (`retryFailed:
 * 'none'`).
 */
export function ReviewSessionPage({
  reviewService: providedReview,
  cycleService: providedCycle,
  recorder: providedRecorder,
  setsRepository: providedSets,
  cyclesRepository: providedCyclesRepo,
  puzzles: providedPuzzles,
  attempts: providedAttempts,
  scheduler: providedScheduler,
  now: providedNow,
}: ReviewSessionPageProps = {}): React.JSX.Element {
  const setsRepo = providedSets ?? trainingSetsRepository;
  const cyclesRepo = providedCyclesRepo ?? trainingCyclesRepository;
  const puzzlesRepo = providedPuzzles ?? puzzlesRepository;
  const attemptsRepo = providedAttempts ?? attemptsRepository;
  const scheduler = providedScheduler ?? tsFsrsScheduler;
  const now = useMemo(() => providedNow ?? (() => Date.now()), [providedNow]);

  const reviewService = useMemo(
    () =>
      providedReview ??
      new ReviewService({
        cycles: cyclesRepo,
        sets: setsRepo,
        puzzles: puzzlesRepo,
        attempts: attemptsRepo,
        schedules: reviewSchedulesRepository,
        settings: settingsRepository,
        scheduler,
        now,
      }),
    [providedReview, cyclesRepo, setsRepo, puzzlesRepo, attemptsRepo, scheduler, now],
  );
  const cycleService = useMemo(
    () =>
      providedCycle ??
      new CycleService({
        cycles: cyclesRepo,
        sets: setsRepo,
        puzzles: puzzlesRepo,
        attempts: attemptsRepo,
        now,
      }),
    [providedCycle, cyclesRepo, setsRepo, puzzlesRepo, attemptsRepo, now],
  );
  const recorder = useMemo(
    () => providedRecorder ?? new PuzzleAttemptRecorder({ attempts: attemptsRepo, now }),
    [providedRecorder, attemptsRepo, now],
  );

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<ReviewOverview | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [session, setSession] = useState<ReviewSessionData | null>(null);
  const [epoch, setEpoch] = useState(0);

  const loadOverview = useCallback(async (): Promise<ReviewOverview | null> => {
    for (let pass = 0; pass < MAX_RECONCILE_PASSES; pass += 1) {
      const result = await reviewService.reconcile({ batchSize: SCHEDULE_REBUILD_BATCH });
      if (result.done) {
        break;
      }
    }
    return reviewService.overview(now());
  }, [reviewService, now]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await loadOverview();
        if (!cancelled) {
          setOverview(next);
          setError(null);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError('Could not load your review queue from local storage.');
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadOverview, epoch]);

  const handleBegin = useCallback(
    async (durationMs: number | null): Promise<void> => {
      const result = await reviewService.startSession(now());
      if (!result.ok) {
        setNotice(
          result.reason === 'empty-queue'
            ? 'Nothing is due and no new puzzles are available right now.'
            : 'The review session could not be started.',
        );
        return;
      }
      setNotice(null);
      setSession({ set: result.set, cycle: result.cycle, puzzles: result.puzzles, durationMs });
    },
    [reviewService, now],
  );

  const handleCancel = useCallback((): void => {
    setSession(null);
  }, []);

  const handleReviewAgain = useCallback((): void => {
    setSession(null);
    setEpoch((value) => value + 1);
  }, []);

  const navigate = useNavigate();
  const handleBack = useCallback((): void => {
    navigate(ROUTES.training);
  }, [navigate]);

  if (session !== null) {
    return (
      <ReviewSessionView
        key={session.cycle.id}
        set={session.set}
        cycle={session.cycle}
        puzzles={session.puzzles}
        initialDurationMs={session.durationMs}
        recorder={recorder}
        attemptsRepository={attemptsRepo}
        cycleService={cycleService}
        reviewService={reviewService}
        now={now}
        onReviewAgain={handleReviewAgain}
        onBack={handleBack}
      />
    );
  }

  return (
    <div className={styles.page} data-testid="review-session">
      <header className={styles.header}>
        <h1 className={styles.heading}>Review</h1>
        <p className={styles.subtitle}>
          Puzzles resurface when they are about to be forgotten, one presentation each.
        </p>
      </header>

      {loading ? (
        <p className={styles.state} data-testid="review-session-loading">
          Loading your review queue…
        </p>
      ) : error !== null ? (
        <section className={styles.statePanel} role="alert" data-testid="review-session-error">
          <p className={styles.state}>{error}</p>
          <Button
            variant="secondary"
            data-testid="review-session-retry"
            onClick={() => {
              setLoading(true);
              setEpoch((value) => value + 1);
            }}
          >
            Try again
          </Button>
        </section>
      ) : (
        <ReviewSetup
          overview={overview}
          notice={notice}
          onBegin={handleBegin}
          onCancel={handleCancel}
        />
      )}
    </div>
  );
}

interface ReviewSetupProps {
  readonly overview: ReviewOverview | null;
  readonly notice: string | null;
  readonly onBegin: (durationMs: number | null) => void;
  readonly onCancel: () => void;
}

/** The review setup panel: due/new counts, caps in force and the duration choice. */
function ReviewSetup({ overview, notice, onBegin, onCancel }: ReviewSetupProps): React.JSX.Element {
  const { defaultDurationMs } = useTrainingSessionSettings();
  const dueCount = overview?.queue.filter((entry) => entry.kind === 'review').length ?? 0;
  const newCount = overview?.queue.filter((entry) => entry.kind === 'new').length ?? 0;
  const caps = overview?.caps ?? null;
  const empty = (overview?.queue.length ?? 0) === 0;

  return (
    <>
      {notice !== null ? (
        <p className={styles.notice} role="status" data-testid="review-session-notice">
          {notice}
        </p>
      ) : null}
      <SessionSetup
        defaultDurationMs={defaultDurationMs}
        title="Review session"
        description="A fixed queue of due reviews and new puzzles. Each puzzle is shown once."
        beginLabel="Start"
        disabled={empty}
        onBegin={onBegin}
        onCancel={onCancel}
        details={
          <dl className={styles.details} data-testid="review-setup-details">
            <div className={styles.detailRow}>
              <dt className={styles.detailLabel}>Due reviews</dt>
              <dd className={styles.detailValue} data-testid="review-setup-due">
                {dueCount}
              </dd>
            </div>
            <div className={styles.detailRow}>
              <dt className={styles.detailLabel}>New puzzles</dt>
              <dd className={styles.detailValue} data-testid="review-setup-new">
                {newCount}
              </dd>
            </div>
            <div className={styles.detailRow}>
              <dt className={styles.detailLabel}>Daily caps</dt>
              <dd className={styles.detailValue} data-testid="review-setup-caps">
                {caps === null ? '—' : `${caps.newCap} new · ${caps.reviewCap} reviews`}{' '}
                <Link className={styles.capsLink} to={ROUTES.settings}>
                  Change
                </Link>
              </dd>
            </div>
          </dl>
        }
      />
    </>
  );
}

interface ReviewSessionViewProps {
  readonly set: TacticalTrainingSetRow;
  readonly cycle: TrainingCycleRow;
  readonly puzzles: ReadonlyMap<string, PuzzleRow>;
  readonly initialDurationMs: number | null;
  readonly recorder: PuzzleAttemptRecorderLike;
  readonly attemptsRepository: PuzzleAttemptsRepository;
  readonly cycleService: CycleService;
  readonly reviewService: ReviewService;
  readonly now: () => number;
  readonly onReviewAgain: () => void;
  readonly onBack: () => void;
}

type SessionPhase = 'running' | 'summary';

interface ReviewSummaryState {
  readonly summary: SessionSummaryData;
  readonly retention: number | null;
  readonly nextDueAt: number | null;
  readonly introduced: number;
  readonly remainingDue: number;
}

/** The mounted review session: the chrome plus the Feature-012 solving screen. */
function ReviewSessionView({
  set,
  cycle,
  puzzles,
  initialDurationMs,
  recorder,
  attemptsRepository,
  cycleService,
  reviewService,
  now,
  onReviewAgain,
  onBack,
}: ReviewSessionViewProps): React.JSX.Element {
  const { showPuzzleTimer } = usePuzzleTimerSetting();
  const { thresholdMs: puzzleRedThresholdMs } = usePuzzleTimerThreshold();
  const { warningMs } = useTrainingSessionSettings();
  const [restartTick, setRestartTick] = useState(0);
  const [phase, setPhase] = useState<SessionPhase>('running');
  const [sessionConfig] = useState<SessionConfig>({
    durationMs: initialDurationMs,
    warningMs,
  });
  const [summaryState, setSummaryState] = useState<ReviewSummaryState | null>(null);
  const [reviewAnnouncement, setReviewAnnouncement] = useState<string | null>(null);

  const session = useCycleSession({
    set,
    cycle,
    puzzles,
    recorder,
    attemptsRepository,
    cycleService,
    now,
  });

  const endingRef = useRef(false);
  const startedAtRef = useRef<number | null>(null);
  const statusRef = useRef(session.status);
  useEffect(() => {
    statusRef.current = session.status;
  }, [session.status]);

  const finishSession = useCallback(async (): Promise<void> => {
    if (endingRef.current) {
      return;
    }
    endingRef.current = true;
    session.exit();
    const sessionStart = startedAtRef.current ?? cycle.startedAt;
    try {
      const attempts = await attemptsRepository.listForCycle(cycle.id);
      const sessionAttempts = attempts.filter((row) => row.endedAt >= sessionStart);
      const summary = summarizeSession(sessionAttempts);
      const nextOverview = await reviewService.overview(now());
      const earlier = await attemptsRepository.listAll();
      const introduced = countIntroduced(sessionAttempts, earlier, sessionStart);
      setSummaryState({
        summary,
        retention: nextOverview.retention,
        nextDueAt: nextOverview.nextDueAt,
        introduced,
        remainingDue: nextOverview.dueNow,
      });
      setPhase('summary');
    } catch {
      onBack();
    }
  }, [session, attemptsRepository, cycle.id, cycle.startedAt, reviewService, now, onBack]);

  const handleExpire = useCallback((): void => {
    void finishSession();
  }, [finishSession]);

  const timer = useTrainingSession({
    config: phase === 'running' ? sessionConfig : null,
    now,
    onExpire: handleExpire,
  });
  useEffect(() => {
    startedAtRef.current = timer.startedAt;
  }, [timer.startedAt]);

  useEffect(() => {
    if (session.status === 'complete' && phase === 'running') {
      void finishSession();
    }
  }, [session.status, phase, finishSession]);

  const handleEnd = useCallback((): void => {
    void finishSession();
  }, [finishSession]);

  const handleOutcome = useCallback(
    (outcome: PresentationOutcome | null): void => {
      if (outcome !== null) {
        void reviewService.applyOutcome(outcome.attemptRow).then((result) => {
          if (result.nextDueAt !== null) {
            setReviewAnnouncement(`Next review ${formatRelativeDue(result.nextDueAt, now())}`);
          } else if (result.applied) {
            setReviewAnnouncement('Schedule updated.');
          }
        });
      }
      void session.handleOutcome(outcome);
    },
    [session, reviewService, now],
  );

  const current = session.current;
  const total = session.progress.total;
  const firstTryAccuracyLabel = formatPercent(session.metrics.firstTryAccuracy) ?? '—';
  const currentNextDue = currentNextDueLabel(reviewAnnouncement);

  return (
    <div className={styles.page} data-testid="review-session">
      <header className={styles.chrome} data-testid="review-session-chrome">
        <div className={styles.chromeText}>
          <p className={styles.setName}>{set.name}</p>
          <h1 className={styles.heading} data-testid="review-session-title">
            Review
          </h1>
          <p
            className={styles.progress}
            role="status"
            aria-live="polite"
            data-testid="review-session-progress"
          >
            {session.status === 'complete'
              ? `Review complete — all ${total} ${total === 1 ? 'puzzle' : 'puzzles'} answered`
              : `Puzzle ${session.progress.index} of ${total}`}
          </p>
          {phase === 'running' ? (
            <div className={styles.sessionStatus}>
              <SessionTimer
                remainingMs={timer.remainingMs}
                warning={timer.warning}
                expired={timer.expired}
              />
              <p className={styles.stats} data-testid="review-session-stats">
                · {session.metrics.puzzlesCompleted} solved · {firstTryAccuracyLabel}
              </p>
            </div>
          ) : null}
        </div>
        <div className={styles.chromeActions}>
          {phase === 'running' ? (
            <Button variant="secondary" data-testid="session-end" onClick={handleEnd}>
              End session
            </Button>
          ) : null}
        </div>
      </header>

      <p
        className={styles.srOnly}
        role="status"
        aria-live="polite"
        data-testid="review-announcement"
      >
        {currentNextDue}
      </p>

      {session.notice !== null ? (
        <p className={styles.notice} role="status" data-testid="review-session-notice">
          {session.notice}
        </p>
      ) : null}

      {phase === 'summary' && summaryState !== null ? (
        <SessionSummary
          summary={summaryState.summary}
          remainingPuzzles={summaryState.remainingDue}
          cycleCompleted
          title="Review summary"
          description="This review session has ended. Every definite outcome was recorded and scheduled."
          remainingLabel="Due for the next session"
          resumeLabel="Review again"
          backLabel="Back to training"
          onResume={onReviewAgain}
          onBack={onBack}
          extraRows={[
            {
              label: 'Retention',
              value:
                summaryState.retention === null
                  ? 'Not enough data yet'
                  : (formatPercent(summaryState.retention) ?? '—'),
              testId: 'review-summary-retention',
            },
            {
              label: 'Next due',
              value:
                summaryState.nextDueAt === null
                  ? 'Nothing scheduled'
                  : formatRelativeDue(summaryState.nextDueAt, now()),
              testId: 'review-summary-next-due',
            },
            {
              label: 'Introduced',
              value: String(summaryState.introduced),
              testId: 'review-summary-introduced',
            },
          ]}
        />
      ) : current !== null ? (
        <SolveScreen
          key={`${current.row.sourceGameId}:${current.row.sourcePly}:${current.context.presentationIndex}:${restartTick}`}
          row={current.row}
          context={current.context}
          config={current.config}
          recorder={session.recorder}
          onExit={handleOutcome}
          allowSkip={session.allowSkip}
          showTimer={showPuzzleTimer}
          puzzleRedThresholdMs={puzzleRedThresholdMs}
          onRestart={() => setRestartTick((tick) => tick + 1)}
        />
      ) : null}
    </div>
  );
}

/** The polite next-review announcement, or an empty string when none. */
function currentNextDueLabel(announcement: string | null): string {
  return announcement ?? '';
}

/** Puzzles in the session whose first-ever gradeable attempt is in the window. */
function countIntroduced(
  sessionAttempts: readonly {
    readonly puzzleId: string;
    readonly endedAt: number;
    readonly result: string;
  }[],
  allAttempts: readonly {
    readonly puzzleId: string;
    readonly endedAt: number;
    readonly result: string;
  }[],
  sessionStart: number,
): number {
  const firstGradeable = new Map<string, number>();
  for (const attempt of allAttempts) {
    if (attempt.result === 'skipped') {
      continue;
    }
    const current = firstGradeable.get(attempt.puzzleId);
    if (current === undefined || attempt.endedAt < current) {
      firstGradeable.set(attempt.puzzleId, attempt.endedAt);
    }
  }
  let introduced = 0;
  const seen = new Set<string>();
  for (const attempt of sessionAttempts) {
    if (attempt.result === 'skipped' || seen.has(attempt.puzzleId)) {
      continue;
    }
    seen.add(attempt.puzzleId);
    const first = firstGradeable.get(attempt.puzzleId);
    if (first === undefined || first >= sessionStart) {
      introduced += 1;
    }
  }
  return introduced;
}
