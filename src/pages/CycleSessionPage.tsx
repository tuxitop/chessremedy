import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { SolveScreen } from '@/components/puzzles/solve';
import {
  SessionSetup,
  SessionSummary,
  SessionTimer,
  SpacingNudge,
  formatPercent,
} from '@/components/puzzles/cycles';
import { usePuzzleTimerSetting } from '@/hooks/usePuzzleTimerSetting';
import { usePuzzleTimerThreshold } from '@/hooks/usePuzzleTimerThreshold';
import { useTrainingSession } from '@/hooks/useTrainingSession';
import { useTrainingSessionSettings } from '@/hooks/useTrainingSessionSettings';
import { useCycleSession } from '@/hooks/useCycleSession';
import { puzzleIdOf } from '@/domain/puzzle/id';
import type { PuzzleRow } from '@/domain/puzzle';
import {
  QUICK_TRAIN_SET_ID,
  isWoodpeckerBlock,
  spacingNudgeFor,
  summarizeSession,
  type CycleSpacingNudge,
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
import { trainingSetsRepository } from '@/infrastructure/db/training-sets-repository';
import type { TrainingSetsRepository } from '@/infrastructure/db/training-sets-repository';
import { trainingCyclesRepository } from '@/infrastructure/db/training-cycles-repository';
import type { TrainingCyclesRepository } from '@/infrastructure/db/training-cycles-repository';
import { puzzlesRepository } from '@/infrastructure/db/puzzles-repository';
import type { PuzzlesRepository } from '@/infrastructure/db/puzzles-repository';
import { attemptsRepository } from '@/infrastructure/db/attempts-repository';
import type { PuzzleAttemptsRepository } from '@/infrastructure/db/attempts-repository';
import { ROUTES, trainingCycleResultsPath, trainingSetPath } from '@/app/routes';
import styles from './CycleSessionPage.module.css';

/** Everything the mounted session needs, once loaded. */
interface SessionData {
  readonly set: TacticalTrainingSetRow;
  readonly cycle: TrainingCycleRow;
  readonly puzzles: ReadonlyMap<string, PuzzleRow>;
  /** The same-block spacing nudge to show before solving, or `null`. */
  readonly spacing: CycleSpacingNudge | null;
}

export interface CycleSessionPageProps {
  /** Injectable for tests; defaults to the singleton-backed service. */
  readonly cycleService?: CycleService;
  /** Injectable for tests; defaults to the repository-backed recorder. */
  readonly recorder?: PuzzleAttemptRecorderLike;
  readonly setsRepository?: TrainingSetsRepository;
  readonly cyclesRepository?: TrainingCyclesRepository;
  readonly puzzles?: PuzzlesRepository;
  readonly attempts?: PuzzleAttemptsRepository;
  /** Injectable clock for deterministic tests. */
  readonly now?: () => number;
}

/**
 * The real training-cycle session (`/training/sets/:setId/cycles/:cycleNumber`):
 * the session chrome (set name, cycle number, "Puzzle X of Y", Exit, Skip when
 * configured) above Feature 012's `SolveScreen`, driven by `useCycleSession`
 * over the persisted attempt rows. Completion navigates to the cycle results;
 * Exit leaves the cycle `inProgress` and resumable. No difficulty, ordering or
 * scheduling language is shown (ADR-031).
 */
export function CycleSessionPage({
  cycleService: providedCycles,
  recorder: providedRecorder,
  setsRepository: providedSets,
  cyclesRepository: providedCyclesRepo,
  puzzles: providedPuzzles,
  attempts: providedAttempts,
  now: providedNow,
}: CycleSessionPageProps = {}): React.JSX.Element {
  const { setId = '', cycleNumber: cycleNumberParam = '' } = useParams<'setId' | 'cycleNumber'>();
  const cycleNumber = Number.parseInt(cycleNumberParam, 10);
  // Quick train has no `trainingSets` row; its cycle lives under the sentinel
  // `trainingSetId` (spec §3c), so the set lookup is skipped and a synthetic
  // "Quick train" set is supplied to the session host.
  const isQuickTrain = setId === QUICK_TRAIN_SET_ID;

  const setsRepo = providedSets ?? trainingSetsRepository;
  const cyclesRepo = providedCyclesRepo ?? trainingCyclesRepository;
  const puzzlesRepo = providedPuzzles ?? puzzlesRepository;
  const attemptsRepo = providedAttempts ?? attemptsRepository;
  const now = useMemo(() => providedNow ?? (() => Date.now()), [providedNow]);

  const cycleService = useMemo(
    () =>
      providedCycles ??
      new CycleService({
        cycles: cyclesRepo,
        sets: setsRepo,
        puzzles: puzzlesRepo,
        attempts: attemptsRepo,
        now,
      }),
    [providedCycles, cyclesRepo, setsRepo, puzzlesRepo, attemptsRepo, now],
  );
  const recorder = useMemo(
    () => providedRecorder ?? new PuzzleAttemptRecorder({ attempts: attemptsRepo, now }),
    [providedRecorder, attemptsRepo, now],
  );

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SessionData | null>(null);
  // Bumped when the summary's "Resume cycle" action asks for a fresh session
  // mount: the previous session view exited (its outcome seam is closed), so a
  // remount is what re-opens the cycle for solving.
  const [sessionEpoch, setSessionEpoch] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (setId === '' || !Number.isFinite(cycleNumber)) {
          if (!cancelled) {
            setError('This cycle could not be found.');
            setLoading(false);
          }
          return;
        }
        const set = isQuickTrain ? undefined : await setsRepo.get(setId);
        const cycle = await cyclesRepo.getByNumber(setId, cycleNumber);
        if (cycle === undefined || (!isQuickTrain && set === undefined)) {
          if (!cancelled) {
            setError('This cycle could not be found.');
            setLoading(false);
          }
          return;
        }
        const resolvedSet = isQuickTrain ? quickTrainSet(cycle) : set!;
        const rows = await puzzlesRepo.getPuzzles(cycle.puzzleIds);
        if (cancelled) {
          return;
        }
        const map = new Map(rows.map((row) => [puzzleIdOf(row.sourceGameId, row.sourcePly), row]));
        // The spacing nudge is a block rule (spec §4): find the previous cycle of
        // this block and nudge when it ended less than ~1 day before this one.
        const spacing = isWoodpeckerBlock(resolvedSet)
          ? spacingNudgeFor(await cyclesRepo.listForSet(setId), cycle)
          : null;
        setData({ set: resolvedSet, cycle, puzzles: map, spacing });
        setError(null);
        setLoading(false);
      } catch {
        if (!cancelled) {
          setError('Could not load this cycle from local storage.');
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setId, isQuickTrain, cycleNumber, setsRepo, cyclesRepo, puzzlesRepo]);

  if (loading) {
    return (
      <div className={styles.page} data-testid="cycle-session">
        <p className={styles.state} data-testid="cycle-session-loading">
          Loading cycle…
        </p>
      </div>
    );
  }

  if (data === null) {
    return (
      <div className={styles.page} data-testid="cycle-session">
        <section className={styles.statePanel} data-testid="cycle-session-missing">
          <h1 className={styles.heading}>Cycle not found</h1>
          <p className={styles.state}>{error ?? 'This cycle could not be found.'}</p>
          <Link className={styles.backLink} to={ROUTES.training} data-testid="cycle-session-back">
            Back to training
          </Link>
        </section>
      </div>
    );
  }

  return (
    <CycleSessionView
      key={sessionEpoch}
      set={data.set}
      cycle={data.cycle}
      puzzles={data.puzzles}
      spacing={data.spacing}
      recorder={recorder}
      attemptsRepository={attemptsRepo}
      cycleService={cycleService}
      now={now}
      onResumeSession={() => setSessionEpoch((epoch) => epoch + 1)}
    />
  );
}

/**
 * The synthetic set for a Quick-train session: there is no `trainingSets` row,
 * so the host is given the sentinel id and a "Quick train" label. The cycle's
 * own snapshot is authoritative for the membership and config.
 */
function quickTrainSet(cycle: TrainingCycleRow): TacticalTrainingSetRow {
  return {
    id: QUICK_TRAIN_SET_ID,
    name: 'Quick train',
    createdAt: cycle.startedAt,
    updatedAt: cycle.startedAt,
    status: 'active',
    source: { kind: 'manual' },
    puzzleIds: cycle.puzzleIds,
    targetSize: cycle.puzzleIds.length,
    config: cycle.config,
  };
}

interface CycleSessionViewProps {
  readonly set: TacticalTrainingSetRow;
  readonly cycle: TrainingCycleRow;
  readonly puzzles: ReadonlyMap<string, PuzzleRow>;
  readonly spacing: CycleSpacingNudge | null;
  readonly recorder: PuzzleAttemptRecorderLike;
  readonly attemptsRepository: PuzzleAttemptsRepository;
  readonly cycleService: CycleService;
  readonly now: () => number;
  /** Ask the page to remount a fresh session (summary's Resume cycle action). */
  readonly onResumeSession: () => void;
}

/** The ephemeral session phase (Feature 019 §1/§5). */
type SessionPhase = 'setup' | 'running' | 'summary';

/** The end-of-session projection rendered by the summary. */
interface SessionSummaryState {
  readonly summary: SessionSummaryData;
  readonly remainingPuzzles: number;
  readonly cycleCompleted: boolean;
}

/** The mounted session: the chrome plus the Feature-012 solving screen. */
function CycleSessionView({
  set,
  cycle,
  puzzles,
  spacing,
  recorder,
  attemptsRepository,
  cycleService,
  now,
  onResumeSession,
}: CycleSessionViewProps): React.JSX.Element {
  const navigate = useNavigate();
  const { showPuzzleTimer } = usePuzzleTimerSetting();
  const { thresholdMs: puzzleRedThresholdMs } = usePuzzleTimerThreshold();
  const { defaultDurationMs, warningMs } = useTrainingSessionSettings();
  const [restartTick, setRestartTick] = useState(0);
  const [spacingAcknowledged, setSpacingAcknowledged] = useState(false);
  const [phase, setPhase] = useState<SessionPhase>('setup');
  const [sessionConfig, setSessionConfig] = useState<SessionConfig | null>(null);
  const [summaryState, setSummaryState] = useState<SessionSummaryState | null>(null);

  const session = useCycleSession({
    set,
    cycle,
    puzzles,
    recorder,
    attemptsRepository,
    cycleService,
    now,
  });

  const isQuickTrain = set.id === QUICK_TRAIN_SET_ID;
  // A Quick-train cycle has no set detail or set-scoped results view, so it
  // returns to the training home on completion/exit; a set-backed cycle lands
  // on its results/set detail as before.
  const resultsPath = isQuickTrain
    ? ROUTES.training
    : trainingCycleResultsPath(set.id, cycle.cycleNumber);

  const exitSession = session.exit;
  // Latest values for the stable end-of-session callback without re-creating it.
  const startedAtRef = useRef<number | null>(null);
  const remainingRef = useRef(0);
  const statusRef = useRef(session.status);
  // Guards the one-shot transition into the summary (expiry vs completion).
  const endingRef = useRef(false);
  useEffect(() => {
    remainingRef.current = session.remaining;
  }, [session.remaining]);
  useEffect(() => {
    statusRef.current = session.status;
  }, [session.status]);

  /**
   * End the running session: discard the in-progress presentation (no outcome
   * is applied, so no row is written), project the session's persisted rows and
   * show the ephemeral summary (Feature 019 §3/§4/§5). The cycle stays
   * `inProgress` and resumable.
   */
  const finishSession = useCallback(
    async (cycleCompleted: boolean): Promise<void> => {
      if (endingRef.current) {
        return;
      }
      endingRef.current = true;
      exitSession();
      const startedAt = startedAtRef.current;
      let summary: SessionSummaryData;
      try {
        const attempts = await attemptsRepository.listForCycle(cycle.id);
        const sessionAttempts =
          startedAt === null ? attempts : attempts.filter((row) => row.endedAt >= startedAt);
        summary = summarizeSession(sessionAttempts);
      } catch {
        // The cycle/attempts could not be read; fall back to the training home
        // rather than fabricating a summary.
        navigate(isQuickTrain ? ROUTES.training : trainingSetPath(set.id));
        return;
      }
      setSummaryState({
        summary,
        remainingPuzzles: remainingRef.current,
        cycleCompleted: cycleCompleted || statusRef.current === 'complete',
      });
      setPhase('summary');
    },
    [exitSession, attemptsRepository, cycle.id, navigate, isQuickTrain, set.id],
  );

  const handleExpire = useCallback((): void => {
    void finishSession(false);
  }, [finishSession]);

  const timer = useTrainingSession({
    config: phase === 'running' ? sessionConfig : null,
    now,
    onExpire: handleExpire,
  });
  useEffect(() => {
    startedAtRef.current = timer.startedAt;
  }, [timer.startedAt]);

  // A cycle that completes mid-session shows the summary first, then results
  // (Feature 019 §6); a cycle already terminal on load goes straight to results.
  useEffect(() => {
    if (session.status === 'complete' && phase === 'running') {
      void finishSession(true);
    }
  }, [session.status, phase, finishSession]);

  useEffect(() => {
    if (session.status === 'complete' && phase === 'setup' && summaryState === null) {
      navigate(resultsPath, { replace: true });
    }
  }, [session.status, phase, summaryState, navigate, resultsPath]);

  const handleBegin = useCallback(
    (durationMs: number | null): void => {
      endingRef.current = false;
      setSummaryState(null);
      setSessionConfig({ durationMs, warningMs });
      setPhase('running');
    },
    [warningMs],
  );

  const handleEnd = useCallback((): void => {
    void finishSession(false);
  }, [finishSession]);

  const handleResume = useCallback((): void => {
    onResumeSession();
  }, [onResumeSession]);

  const handleBack = useCallback((): void => {
    navigate(isQuickTrain ? ROUTES.training : trainingSetPath(set.id));
  }, [navigate, isQuickTrain, set.id]);

  const handleViewResults = useCallback((): void => {
    navigate(resultsPath, { replace: true });
  }, [navigate, resultsPath]);

  const handleExit = useCallback((): void => {
    // Leave the cycle inProgress and resumable; discard the presentation.
    session.exit();
    navigate(isQuickTrain ? ROUTES.training : trainingSetPath(set.id));
  }, [session, navigate, isQuickTrain, set.id]);

  const handleOutcome = useCallback(
    (outcome: PresentationOutcome | null): void => {
      void session.handleOutcome(outcome);
    },
    [session],
  );

  const current = session.current;
  const total = session.progress.total;
  // The spacing nudge gates the first presentation of a too-soon block cycle;
  // "Start anyway" acknowledges it and the session proceeds. It never blocks and
  // is shown before the pre-session gate (Feature 019 §1 ordering).
  const showSpacingNudge =
    spacing !== null && !spacingAcknowledged && phase === 'setup' && session.status === 'solving';
  const firstTryAccuracyLabel = formatPercent(session.metrics.firstTryAccuracy) ?? '—';

  return (
    <div className={styles.page} data-testid="cycle-session">
      <header className={styles.chrome} data-testid="cycle-session-chrome">
        <div className={styles.chromeText}>
          <p className={styles.setName} data-testid="cycle-session-set-name">
            {set.name}
          </p>
          <h1 className={styles.heading} data-testid="cycle-session-cycle-number">
            {isQuickTrain ? 'Quick train' : `Cycle ${cycle.cycleNumber}`}
          </h1>
          <p
            className={styles.progress}
            role="status"
            aria-live="polite"
            data-testid="cycle-session-progress"
          >
            {session.status === 'complete'
              ? `Cycle complete — all ${total} ${total === 1 ? 'puzzle' : 'puzzles'} answered`
              : `Puzzle ${session.progress.index} of ${total}`}
          </p>
          {phase === 'running' ? (
            <div className={styles.sessionStatus}>
              <SessionTimer
                remainingMs={timer.remainingMs}
                warning={timer.warning}
                expired={timer.expired}
              />
              <p className={styles.stats} data-testid="cycle-session-stats">
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
          <Button
            variant="secondary"
            data-testid="cycle-session-exit"
            onClick={handleExit}
            disabled={session.status === 'complete'}
          >
            Exit
          </Button>
        </div>
      </header>

      {session.notice !== null ? (
        <p className={styles.notice} role="status" data-testid="cycle-session-notice">
          {session.notice}
        </p>
      ) : null}
      {session.status === 'error' ? (
        <p className={styles.error} role="alert" data-testid="cycle-session-error">
          The cycle session could not continue. Exit and try again.
        </p>
      ) : null}

      {phase === 'summary' && summaryState !== null ? (
        <SessionSummary
          summary={summaryState.summary}
          remainingPuzzles={summaryState.remainingPuzzles}
          cycleCompleted={summaryState.cycleCompleted}
          onResume={handleResume}
          onBack={handleBack}
          onViewResults={handleViewResults}
        />
      ) : showSpacingNudge ? (
        <SpacingNudge
          setName={set.name}
          previousCycleNumber={spacing.previousCycleNumber}
          onStartAnyway={() => setSpacingAcknowledged(true)}
        />
      ) : phase === 'setup' && session.status === 'solving' ? (
        <SessionSetup defaultDurationMs={defaultDurationMs} onBegin={handleBegin} />
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
