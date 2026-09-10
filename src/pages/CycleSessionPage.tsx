import { useCallback, useEffect, useMemo, useState } from 'react';
import type * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { SolveScreen } from '@/components/puzzles/solve';
import { usePuzzleTimerSetting } from '@/hooks/usePuzzleTimerSetting';
import { useCycleSession } from '@/hooks/useCycleSession';
import { puzzleIdOf } from '@/domain/puzzle/id';
import type { PuzzleRow } from '@/domain/puzzle';
import type {
  PresentationOutcome,
  TacticalTrainingSetRow,
  TrainingCycleRow,
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
import { ROUTES, puzzlesCycleResultsPath, puzzlesSetPath } from '@/app/routes';
import styles from './CycleSessionPage.module.css';

/** Everything the mounted session needs, once loaded. */
interface SessionData {
  readonly set: TacticalTrainingSetRow;
  readonly cycle: TrainingCycleRow;
  readonly puzzles: ReadonlyMap<string, PuzzleRow>;
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
 * The real training-cycle session (`/puzzles/sets/:setId/cycles/:cycleNumber`):
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
        const set = await setsRepo.get(setId);
        const cycle =
          set === undefined ? undefined : await cyclesRepo.getByNumber(setId, cycleNumber);
        if (set === undefined || cycle === undefined) {
          if (!cancelled) {
            setError('This cycle could not be found.');
            setLoading(false);
          }
          return;
        }
        const rows = await puzzlesRepo.getPuzzles(cycle.puzzleIds);
        if (cancelled) {
          return;
        }
        const map = new Map(rows.map((row) => [puzzleIdOf(row.sourceGameId, row.sourcePly), row]));
        setData({ set, cycle, puzzles: map });
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
  }, [setId, cycleNumber, setsRepo, cyclesRepo, puzzlesRepo]);

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
          <Link className={styles.backLink} to={ROUTES.puzzles} data-testid="cycle-session-back">
            Back to training
          </Link>
        </section>
      </div>
    );
  }

  return (
    <CycleSessionView
      set={data.set}
      cycle={data.cycle}
      puzzles={data.puzzles}
      recorder={recorder}
      attemptsRepository={attemptsRepo}
      cycleService={cycleService}
      now={now}
    />
  );
}

interface CycleSessionViewProps {
  readonly set: TacticalTrainingSetRow;
  readonly cycle: TrainingCycleRow;
  readonly puzzles: ReadonlyMap<string, PuzzleRow>;
  readonly recorder: PuzzleAttemptRecorderLike;
  readonly attemptsRepository: PuzzleAttemptsRepository;
  readonly cycleService: CycleService;
  readonly now: () => number;
}

/** The mounted session: the chrome plus the Feature-012 solving screen. */
function CycleSessionView({
  set,
  cycle,
  puzzles,
  recorder,
  attemptsRepository,
  cycleService,
  now,
}: CycleSessionViewProps): React.JSX.Element {
  const navigate = useNavigate();
  const { showPuzzleTimer } = usePuzzleTimerSetting();
  const [restartTick, setRestartTick] = useState(0);

  const session = useCycleSession({
    set,
    cycle,
    puzzles,
    recorder,
    attemptsRepository,
    cycleService,
    now,
  });

  const resultsPath = puzzlesCycleResultsPath(set.id, cycle.cycleNumber);

  // Completion (the queue emptied and the cycle was marked completed, or the
  // cycle was already terminal on load) lands on the results view.
  useEffect(() => {
    if (session.status === 'complete') {
      navigate(resultsPath, { replace: true });
    }
  }, [session.status, navigate, resultsPath]);

  const handleExit = useCallback((): void => {
    // Leave the cycle inProgress and resumable; discard the presentation.
    session.exit();
    navigate(puzzlesSetPath(set.id));
  }, [session, navigate, set.id]);

  const handleOutcome = useCallback(
    (outcome: PresentationOutcome | null): void => {
      void session.handleOutcome(outcome);
    },
    [session],
  );

  const current = session.current;
  const total = session.progress.total;

  return (
    <div className={styles.page} data-testid="cycle-session">
      <header className={styles.chrome} data-testid="cycle-session-chrome">
        <div className={styles.chromeText}>
          <p className={styles.setName} data-testid="cycle-session-set-name">
            {set.name}
          </p>
          <h1 className={styles.heading} data-testid="cycle-session-cycle-number">
            Cycle {cycle.cycleNumber}
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
        </div>
        <Button
          variant="secondary"
          data-testid="cycle-session-exit"
          onClick={handleExit}
          disabled={session.status === 'complete'}
        >
          Exit
        </Button>
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

      {current !== null ? (
        <SolveScreen
          key={`${current.row.sourceGameId}:${current.row.sourcePly}:${current.context.presentationIndex}:${restartTick}`}
          row={current.row}
          context={current.context}
          config={current.config}
          recorder={session.recorder}
          onExit={handleOutcome}
          allowSkip={session.allowSkip}
          showTimer={showPuzzleTimer}
          onRestart={() => setRestartTick((tick) => tick + 1)}
        />
      ) : null}
    </div>
  );
}
