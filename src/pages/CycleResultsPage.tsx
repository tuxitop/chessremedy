import { useCallback, useEffect, useMemo, useState } from 'react';
import type * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import {
  CycleComparison,
  CycleMetricsPanel,
  PuzzleOutcomeList,
  cycleStatusLabel,
  formatTimestamp,
} from '@/components/puzzles/cycles';
import { puzzleObjectiveLabel } from '@/domain/puzzle';
import { puzzleIdOf } from '@/domain/puzzle/id';
import type { PuzzleRow } from '@/domain/puzzle';
import { compareCycleMetrics } from '@/domain/training';
import type { TacticalTrainingSetRow } from '@/domain/training';
import { CycleService } from '@/infrastructure/training';
import type { CycleResults } from '@/infrastructure/training';
import { trainingSetsRepository } from '@/infrastructure/db/training-sets-repository';
import type { TrainingSetsRepository } from '@/infrastructure/db/training-sets-repository';
import { trainingCyclesRepository } from '@/infrastructure/db/training-cycles-repository';
import type { TrainingCyclesRepository } from '@/infrastructure/db/training-cycles-repository';
import { puzzlesRepository } from '@/infrastructure/db/puzzles-repository';
import type { PuzzlesRepository } from '@/infrastructure/db/puzzles-repository';
import { attemptsRepository } from '@/infrastructure/db/attempts-repository';
import { ROUTES, puzzlesCyclePath, puzzlesSetPath } from '@/app/routes';
import styles from './CycleResultsPage.module.css';

interface ResultsData {
  readonly set: TacticalTrainingSetRow;
  readonly results: CycleResults;
  readonly puzzles: ReadonlyMap<string, PuzzleRow>;
}

export interface CycleResultsPageProps {
  /** Injectable for tests; defaults to the singleton-backed service. */
  readonly cycleService?: CycleService;
  readonly setsRepository?: TrainingSetsRepository;
  readonly cyclesRepository?: TrainingCyclesRepository;
  readonly puzzles?: PuzzlesRepository;
  /** Injectable clock for deterministic tests. */
  readonly now?: () => number;
}

/**
 * The read-only cycle results (`…/cycles/:cycleNumber/results`): status, cycle
 * number, timing, per-puzzle outcomes, the canonical aggregates with their
 * sample sizes (`empty`, never `0`, when nothing is definite), a same-set
 * cross-cycle comparison of measured deltas, and "Start next cycle". An
 * abandoned cycle is shown separately and is never resumable.
 */
export function CycleResultsPage({
  cycleService: providedCycles,
  setsRepository: providedSets,
  cyclesRepository: providedCyclesRepo,
  puzzles: providedPuzzles,
  now: providedNow,
}: CycleResultsPageProps = {}): React.JSX.Element {
  const { setId = '', cycleNumber: cycleNumberParam = '' } = useParams<'setId' | 'cycleNumber'>();
  const cycleNumber = Number.parseInt(cycleNumberParam, 10);
  const navigate = useNavigate();

  const setsRepo = providedSets ?? trainingSetsRepository;
  const cyclesRepo = providedCyclesRepo ?? trainingCyclesRepository;
  const puzzlesRepo = providedPuzzles ?? puzzlesRepository;
  const now = useMemo(() => providedNow ?? (() => Date.now()), [providedNow]);
  const cycleService = useMemo(
    () =>
      providedCycles ??
      new CycleService({
        cycles: cyclesRepo,
        sets: setsRepo,
        puzzles: puzzlesRepo,
        attempts: attemptsRepository,
        now,
      }),
    [providedCycles, cyclesRepo, setsRepo, puzzlesRepo, now],
  );

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ResultsData | null>(null);
  const [busy, setBusy] = useState(false);

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
        const result = await cycleService.results(cycle.id);
        if (!result.ok) {
          if (!cancelled) {
            setError(
              result.reason === 'invalid-config'
                ? 'This cycle has an unsupported saved configuration.'
                : 'This cycle could not be found.',
            );
            setLoading(false);
          }
          return;
        }
        const rows = await puzzlesRepo.getPuzzles(result.results.cycle.puzzleIds);
        if (cancelled) {
          return;
        }
        const map = new Map(
          rows.map((row) => [puzzleIdOf(row.sourceGameId, row.sourcePly), row] as const),
        );
        setData({ set, results: result.results, puzzles: map });
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
  }, [setId, cycleNumber, setsRepo, cyclesRepo, puzzlesRepo, cycleService]);

  const startNext = useCallback((): void => {
    void (async () => {
      setBusy(true);
      setError(null);
      try {
        const started = await cycleService.repeat(setId);
        if (!started.ok) {
          setError(
            started.reason === 'empty-set'
              ? 'This set has no puzzles to train.'
              : started.reason === 'invalid-config'
                ? started.message
                : 'Could not start the next cycle.',
          );
          return;
        }
        navigate(puzzlesCyclePath(setId, started.cycle.cycleNumber));
      } catch {
        setError('Could not start the next cycle.');
      } finally {
        setBusy(false);
      }
    })();
  }, [cycleService, setId, navigate]);

  if (loading) {
    return (
      <div className={styles.page} data-testid="cycle-results">
        <p className={styles.state} data-testid="cycle-results-loading">
          Loading cycle results…
        </p>
      </div>
    );
  }

  if (data === null) {
    return (
      <div className={styles.page} data-testid="cycle-results">
        <section className={styles.statePanel} data-testid="cycle-results-missing">
          <h1 className={styles.heading}>Cycle results unavailable</h1>
          <p className={styles.state}>{error ?? 'This cycle could not be found.'}</p>
          <Link className={styles.backLink} to={ROUTES.puzzles} data-testid="cycle-results-back">
            Back to training
          </Link>
        </section>
      </div>
    );
  }

  const { set, results, puzzles } = data;
  const cycle = results.cycle;
  const status = cycleStatusLabel(cycle.status);
  const comparison =
    results.previous === null
      ? null
      : compareCycleMetrics(results.metrics, results.previous.metrics);
  const labelFor = (puzzleId: string): string => {
    const row = puzzles.get(puzzleId);
    return row === undefined ? puzzleId : puzzleObjectiveLabel(row);
  };

  return (
    <div className={styles.page} data-testid="cycle-results">
      <header className={styles.header}>
        <div>
          <Link
            className={styles.backLink}
            to={puzzlesSetPath(set.id)}
            data-testid="cycle-results-set-back"
          >
            ← {set.name}
          </Link>
          <h1 className={styles.heading} data-testid="cycle-results-set-name">
            {set.name}
          </h1>
          <p className={styles.subtitle}>
            <span data-testid="cycle-results-cycle-number">Cycle {cycle.cycleNumber}</span> ·{' '}
            <span data-testid="cycle-results-status">{status}</span>
          </p>
        </div>
        <div className={styles.headerActions}>
          {cycle.status === 'inProgress' ? (
            <Link
              className={styles.primaryLink}
              to={puzzlesCyclePath(set.id, cycle.cycleNumber)}
              data-testid="cycle-results-resume"
            >
              Resume cycle
            </Link>
          ) : (
            <Button data-testid="cycle-results-next-cycle" disabled={busy} onClick={startNext}>
              Start next cycle
            </Button>
          )}
        </div>
      </header>

      {error !== null ? (
        <p className={styles.error} role="alert" data-testid="cycle-results-error">
          {error}
        </p>
      ) : null}

      {cycle.status === 'abandoned' ? (
        <section
          className={styles.abandoned}
          aria-labelledby="cycle-results-abandoned-title"
          data-testid="cycle-results-abandoned"
        >
          <h2 className={styles.sectionTitle} id="cycle-results-abandoned-title">
            Abandoned cycle
          </h2>
          <p className={styles.state} data-testid="cycle-results-abandoned-note">
            This cycle was abandoned. Its recorded attempts are kept, but it cannot be resumed.
          </p>
        </section>
      ) : null}

      {cycle.status === 'inProgress' ? (
        <p className={styles.state} data-testid="cycle-results-partial-note">
          This cycle is still in progress — the figures below are partial.
        </p>
      ) : null}

      <dl className={styles.times}>
        <div className={styles.timeRow}>
          <dt>Started</dt>
          <dd data-testid="cycle-results-started">{formatTimestamp(cycle.startedAt) ?? '—'}</dd>
        </div>
        {cycle.completedAt !== null ? (
          <div className={styles.timeRow}>
            <dt>Completed</dt>
            <dd data-testid="cycle-results-completed">
              {formatTimestamp(cycle.completedAt) ?? '—'}
            </dd>
          </div>
        ) : null}
        {cycle.abandonedAt !== null ? (
          <div className={styles.timeRow}>
            <dt>Abandoned</dt>
            <dd data-testid="cycle-results-abandoned-at">
              {formatTimestamp(cycle.abandonedAt) ?? '—'}
            </dd>
          </div>
        ) : null}
      </dl>

      {results.missingPuzzleIds.length > 0 ? (
        <p className={styles.notice} role="status" data-testid="cycle-results-missing-puzzles">
          {results.missingPuzzleIds.length}{' '}
          {results.missingPuzzleIds.length === 1 ? 'puzzle is' : 'puzzles are'} no longer available
          and {results.missingPuzzleIds.length === 1 ? 'is' : 'are'} excluded from these figures.
        </p>
      ) : null}

      <section aria-labelledby="cycle-results-outcomes-title">
        <h2 className={styles.sectionTitle} id="cycle-results-outcomes-title">
          Puzzle outcomes
        </h2>
        <PuzzleOutcomeList
          resolutions={results.resolutions}
          labelFor={labelFor}
          testId="cycle-results-outcomes"
        />
      </section>

      <section aria-labelledby="cycle-results-metrics-title">
        <h2 className={styles.sectionTitle} id="cycle-results-metrics-title">
          Aggregate results
        </h2>
        <CycleMetricsPanel metrics={results.metrics} testId="cycle-results-metrics" />
      </section>

      {comparison !== null && results.previous !== null ? (
        <section aria-labelledby="cycle-results-comparison-title">
          <h2 className={styles.sectionTitle} id="cycle-results-comparison-title">
            Compared with the previous cycle
          </h2>
          <CycleComparison
            comparison={comparison}
            currentCycleNumber={cycle.cycleNumber}
            previousCycleNumber={results.previous.cycle.cycleNumber}
            testId="cycle-results-comparison"
          />
        </section>
      ) : null}
    </div>
  );
}
