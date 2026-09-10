import { useCallback, useEffect, useMemo, useState } from 'react';
import type * as React from 'react';
import { Link } from 'react-router-dom';
import { SetCard } from '@/components/puzzles/cycles';
import { Button } from '@/components/ui/Button';
import { ROUTES, puzzlesCyclePath, puzzlesSetPath } from '@/app/routes';
import type { TacticalTrainingSetRow, TrainingCycleRow } from '@/domain/training';
import { CycleService, TrainingSetsService } from '@/infrastructure/training';
import { trainingSetsRepository } from '@/infrastructure/db/training-sets-repository';
import { trainingCyclesRepository } from '@/infrastructure/db/training-cycles-repository';
import { puzzlesRepository } from '@/infrastructure/db/puzzles-repository';
import { gamesRepository } from '@/infrastructure/db/games-repository';
import { attemptsRepository } from '@/infrastructure/db/attempts-repository';
import styles from './TrainingHomePage.module.css';

/** Per-set summary the home cards render. */
interface SetSummary {
  readonly set: TacticalTrainingSetRow;
  readonly puzzleCount: number;
  /** Latest cycle by number, if the set has any. */
  readonly cycle: TrainingCycleRow | null;
  readonly lastActivityAt: number;
}

/** The in-progress cycle surfaced by the resume banner. */
interface ResumeTarget {
  readonly set: TacticalTrainingSetRow;
  readonly cycle: TrainingCycleRow;
}

interface HomeData {
  readonly active: readonly SetSummary[];
  readonly archived: readonly SetSummary[];
  readonly resume: ResumeTarget | null;
}

export interface TrainingHomePageProps {
  /** Injectable for tests; defaults to the singleton-backed service. */
  readonly setsService?: TrainingSetsService;
  /** Injectable for tests; defaults to the singleton-backed service. */
  readonly cycleService?: CycleService;
}

/**
 * Training home (`/puzzles`): the user's active training sets as cards, a
 * resume banner for an in-progress cycle, an archived-sets affordance, a New set
 * action and an explicit empty state pointing at the Game Library. Absent data
 * is stated in words (never a bare `0`).
 */
export function TrainingHomePage({
  setsService: providedSets,
  cycleService: providedCycles,
}: TrainingHomePageProps = {}): React.JSX.Element {
  const setsService = useMemo(
    () =>
      providedSets ??
      new TrainingSetsService({
        sets: trainingSetsRepository,
        puzzles: puzzlesRepository,
        games: gamesRepository,
        attempts: attemptsRepository,
      }),
    [providedSets],
  );
  const cycleService = useMemo(
    () =>
      providedCycles ??
      new CycleService({
        cycles: trainingCyclesRepository,
        sets: trainingSetsRepository,
        puzzles: puzzlesRepository,
        attempts: attemptsRepository,
      }),
    [providedCycles],
  );

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<HomeData>({ active: [], archived: [], resume: null });
  const [showArchived, setShowArchived] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  const reload = useCallback(() => setReloadTick((tick) => tick + 1), []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await loadHome(setsService, cycleService);
        if (!cancelled) {
          setData(next);
          setError(null);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError('Could not load your training sets from local storage.');
          setData({ active: [], archived: [], resume: null });
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setsService, cycleService, reloadTick]);

  const hasAnySet = data.active.length > 0 || data.archived.length > 0;

  return (
    <div className={styles.page} data-testid="training-home">
      <header className={styles.header}>
        <div>
          <h1 className={styles.heading}>Training</h1>
          <p className={styles.subtitle}>
            Build fixed sets from your own puzzles and train them in repeated cycles.
          </p>
        </div>
        <Link className={styles.primaryLink} to={ROUTES.puzzlesNew} data-testid="training-new-set">
          New set
        </Link>
      </header>

      {data.resume !== null ? (
        <section
          className={styles.resume}
          role="status"
          data-testid="training-resume"
          aria-label="Resume training"
        >
          <div className={styles.resumeText}>
            <strong>Resume cycle {data.resume.cycle.cycleNumber}</strong>
            <span>
              {data.resume.set.name} has a cycle in progress. Pick up at the next unanswered puzzle.
            </span>
          </div>
          <Link
            className={styles.resumeLink}
            to={puzzlesCyclePath(data.resume.set.id, data.resume.cycle.cycleNumber)}
            data-testid="training-resume-link"
          >
            Resume cycle
          </Link>
        </section>
      ) : null}

      {loading ? (
        <p className={styles.state} data-testid="training-home-loading">
          Loading your training sets…
        </p>
      ) : error !== null ? (
        <section className={styles.statePanel} role="alert" data-testid="training-home-error">
          <p className={styles.state}>{error}</p>
          <Button variant="secondary" data-testid="training-home-retry" onClick={reload}>
            Try again
          </Button>
        </section>
      ) : !hasAnySet ? (
        <section
          className={styles.statePanel}
          data-testid="training-home-empty"
          aria-labelledby="training-home-empty-title"
        >
          <h2 className={styles.stateTitle} id="training-home-empty-title">
            No training sets yet
          </h2>
          <p className={styles.state}>
            Puzzles must first be generated from your games before you can build a set. Open the
            Game Library, analyze a game and generate its puzzles.
          </p>
          <Link
            className={styles.primaryLink}
            to={ROUTES.games}
            data-testid="training-home-empty-games-link"
          >
            Go to the Game Library
          </Link>
        </section>
      ) : (
        <>
          {data.active.length > 0 ? (
            <section aria-labelledby="training-active-title" data-testid="training-active">
              <h2 className={styles.sectionTitle} id="training-active-title">
                Active sets
              </h2>
              <div className={styles.cards} data-testid="training-sets">
                {data.active.map((summary) => (
                  <SetCard
                    key={summary.set.id}
                    set={summary.set}
                    puzzleCount={summary.puzzleCount}
                    cycle={summary.cycle}
                    lastActivityAt={summary.lastActivityAt}
                    to={puzzlesSetPath(summary.set.id)}
                  />
                ))}
              </div>
            </section>
          ) : (
            <p className={styles.state} data-testid="training-no-active">
              No active sets. Restore an archived set or create a new one.
            </p>
          )}

          {data.archived.length > 0 ? (
            <section aria-labelledby="training-archived-title" data-testid="training-archived">
              <h2 className={styles.sectionTitle} id="training-archived-title">
                Archived
              </h2>
              <Button
                variant="secondary"
                aria-expanded={showArchived}
                data-testid="training-archived-toggle"
                onClick={() => setShowArchived((current) => !current)}
              >
                {showArchived
                  ? 'Hide archived sets'
                  : `Show archived sets (${data.archived.length})`}
              </Button>
              {showArchived ? (
                <div className={styles.cards} data-testid="training-archived-list">
                  {data.archived.map((summary) => (
                    <SetCard
                      key={summary.set.id}
                      set={summary.set}
                      puzzleCount={summary.puzzleCount}
                      cycle={summary.cycle}
                      lastActivityAt={summary.lastActivityAt}
                      to={puzzlesSetPath(summary.set.id)}
                    />
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

/** Load the active/archived set summaries and the resume target. */
async function loadHome(
  setsService: TrainingSetsService,
  cycleService: CycleService,
): Promise<HomeData> {
  const [activeSets, archivedSets] = await Promise.all([
    setsService.list({ status: 'active' }),
    setsService.list({ status: 'archived' }),
  ]);
  const all = [...activeSets, ...archivedSets];
  const cyclesBySet = await Promise.all(all.map((set) => cycleService.listForSet(set.id)));
  const summaries = new Map<string, SetSummary>();
  let resume: ResumeTarget | null = null;
  all.forEach((set, index) => {
    const cycles = cyclesBySet[index]!;
    const current = cycles.length > 0 ? cycles[cycles.length - 1]! : null;
    let lastActivityAt = set.updatedAt;
    for (const cycle of cycles) {
      for (const timestamp of [cycle.startedAt, cycle.completedAt, cycle.abandonedAt]) {
        if (timestamp !== null && timestamp > lastActivityAt) {
          lastActivityAt = timestamp;
        }
      }
    }
    summaries.set(set.id, {
      set,
      puzzleCount: set.puzzleIds.length,
      cycle: current,
      lastActivityAt,
    });
    for (const cycle of cycles) {
      if (cycle.status === 'inProgress') {
        if (resume === null || cycle.startedAt > resume.cycle.startedAt) {
          resume = { set, cycle };
        }
      }
    }
  });
  return {
    active: activeSets.map((set) => summaries.get(set.id)!),
    archived: archivedSets.map((set) => summaries.get(set.id)!),
    resume,
  };
}
