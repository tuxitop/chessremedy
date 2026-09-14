import { useCallback, useEffect, useMemo, useState } from 'react';
import type * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { SetCard, formatPercent } from '@/components/puzzles/cycles';
import { ReviewCard } from '@/components/puzzles/review/ReviewCard';
import { Button } from '@/components/ui/Button';
import { InfoCard, type InfoCardRow } from '@/components/ui/InfoCard';
import { ROUTES, trainingCyclePath, trainingSetPath } from '@/app/routes';
import { useReviewOverview } from '@/hooks/useReviewOverview';
import type { ReviewService } from '@/infrastructure/review';
import {
  activeCycleOf,
  BLOCK_SIZE_OPTIONS,
  DEFAULT_BLOCK_SIZE,
  QUICK_TRAIN_SET_ID,
  derivePool,
  masteredPuzzleIds,
  type CycleMetrics,
  type TacticalTrainingSetRow,
  type TrainingCycleRow,
} from '@/domain/training';
import { CycleService, TrainingSetsService } from '@/infrastructure/training';
import { trainingSetsRepository } from '@/infrastructure/db/training-sets-repository';
import { trainingCyclesRepository } from '@/infrastructure/db/training-cycles-repository';
import { puzzlesRepository } from '@/infrastructure/db/puzzles-repository';
import type { PuzzlesRepository } from '@/infrastructure/db/puzzles-repository';
import { gamesRepository } from '@/infrastructure/db/games-repository';
import { attemptsRepository } from '@/infrastructure/db/attempts-repository';
import type { PuzzleAttemptsRepository } from '@/infrastructure/db/attempts-repository';
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
  /** Canonical partial metrics for the in-progress cycle; `null` if unreadable. */
  readonly metrics: CycleMetrics | null;
}

interface HomeData {
  /** Active custom (game/pool/manual) sets, excluding the one open block. */
  readonly customActive: readonly SetSummary[];
  /** Archived sets, including closed Woodpecker blocks (history is retained). */
  readonly archived: readonly SetSummary[];
  /** The single open Woodpecker block, if one exists. */
  readonly openBlock: SetSummary | null;
  /** The derived pool: unmastered puzzles not in the open block. */
  readonly poolCount: number;
  /** Total persisted puzzles; `0` means no puzzles have been generated yet. */
  readonly totalPuzzleCount: number;
  readonly resume: ResumeTarget | null;
}

const EMPTY_HOME: HomeData = {
  customActive: [],
  archived: [],
  openBlock: null,
  poolCount: 0,
  totalPuzzleCount: 0,
  resume: null,
};

export interface TrainingHomePageProps {
  /** Injectable for tests; defaults to the singleton-backed service. */
  readonly setsService?: TrainingSetsService;
  /** Injectable for tests; defaults to the singleton-backed service. */
  readonly cycleService?: CycleService;
  /** Injectable for tests; defaults to the singleton repository. */
  readonly puzzles?: PuzzlesRepository;
  /** Injectable for tests; defaults to the singleton repository. */
  readonly attempts?: PuzzleAttemptsRepository;
  /** Injectable for tests; defaults to the singleton-backed review service. */
  readonly reviewService?: ReviewService;
}

/**
 * Training home (`/training`): the derived puzzle pool and the one-click
 * Woodpecker block, a Quick train action, the active custom sets as cards, a
 * resume banner for an in-progress cycle, an archived-sets affordance, a New
 * set action and an explicit empty state pointing at the Game Library. The app
 * never forms a block on its own; absent data is stated in words (never a bare
 * `0`).
 */
export function TrainingHomePage({
  setsService: providedSets,
  cycleService: providedCycles,
  puzzles: providedPuzzles,
  attempts: providedAttempts,
  reviewService: providedReview,
}: TrainingHomePageProps = {}): React.JSX.Element {
  const navigate = useNavigate();
  const review = useReviewOverview(providedReview === undefined ? {} : { service: providedReview });
  const setsService = useMemo(
    () =>
      providedSets ??
      new TrainingSetsService({
        sets: trainingSetsRepository,
        puzzles: puzzlesRepository,
        games: gamesRepository,
        attempts: attemptsRepository,
        cycles: trainingCyclesRepository,
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

  const puzzlesRepo = providedPuzzles ?? puzzlesRepository;
  const attemptsRepo = providedAttempts ?? attemptsRepository;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<HomeData>(EMPTY_HOME);
  const [showArchived, setShowArchived] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [blockSize, setBlockSize] = useState<number>(DEFAULT_BLOCK_SIZE);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  const reload = useCallback(() => setReloadTick((tick) => tick + 1), []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await loadHome(setsService, cycleService, puzzlesRepo, attemptsRepo);
        if (!cancelled) {
          setData(next);
          setError(null);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError('Could not load your training sets from local storage.');
          setData(EMPTY_HOME);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setsService, cycleService, puzzlesRepo, attemptsRepo, reloadTick]);

  const hasUserSets =
    data.customActive.length > 0 || data.archived.length > 0 || data.openBlock !== null;
  const showEmptyState = !hasUserSets && data.totalPuzzleCount === 0;
  const poolEmpty = data.poolCount === 0;
  const openBlock = data.openBlock;
  const resumeProgress =
    data.resume !== null && data.resume.metrics !== null
      ? progressOf(data.resume.cycle, data.resume.metrics)
      : null;
  const resumeRows: readonly InfoCardRow[] =
    data.resume !== null
      ? [
          { label: 'Set', value: data.resume.set.name },
          {
            label: 'Cycle',
            value: String(data.resume.cycle.cycleNumber),
            testId: 'training-resume-cycle',
          },
          ...(resumeProgress !== null
            ? [
                {
                  label: 'Solved',
                  value: `${resumeProgress.completed} of ${resumeProgress.total}`,
                  testId: 'training-resume-solved',
                },
                {
                  label: 'First-try',
                  value: formatPercent(resumeProgress.accuracy) ?? '—',
                  testId: 'training-resume-accuracy',
                },
                {
                  label: 'Remaining',
                  value: String(resumeProgress.remaining),
                  testId: 'training-resume-remaining',
                },
              ]
            : []),
        ]
      : [];

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const createBlock = (): void =>
    void run(async () => {
      const result = await setsService.createWoodpeckerBlock({ size: blockSize });
      if (!result.ok) {
        if (result.reason === 'block-open') {
          setNotice(
            'A Woodpecker block is already open. Finish or abandon it before creating the next one.',
          );
          reload();
          return;
        }
        setNotice('The puzzle pool is empty. Generate puzzles from a game first.');
        return;
      }
      navigate(trainingSetPath(result.set.id));
    });

  const quickTrain = (): void =>
    void run(async () => {
      const result = await cycleService.startQuickTrain();
      if (!result.ok) {
        setNotice(
          result.reason === 'empty-pool'
            ? 'The puzzle pool is empty. Generate puzzles from a game first.'
            : 'Could not start Quick train.',
        );
        return;
      }
      navigate(trainingCyclePath(QUICK_TRAIN_SET_ID, result.cycle.cycleNumber));
    });

  return (
    <div className={styles.page} data-testid="training-home">
      <header className={styles.header}>
        <div>
          <h1 className={styles.heading}>Training</h1>
          <p className={styles.subtitle}>
            Build fixed Woodpecker blocks from your own puzzles and train them in repeated cycles.
          </p>
        </div>
        <div className={styles.headerActions}>
          <Link
            className={styles.secondaryLink}
            to={ROUTES.trainingMastered}
            data-testid="training-mastered-link"
          >
            Mastered puzzles
          </Link>
          <Link
            className={styles.primaryLink}
            to={ROUTES.trainingNew}
            data-testid="training-new-set"
          >
            New set
          </Link>
        </div>
      </header>

      <div className={styles.actionRow}>
        {data.resume !== null ? (
          <InfoCard
            title="Resume cycle"
            titleId="training-resume-title"
            testId="training-resume"
            role="status"
            pill={{ label: 'In progress' }}
            description="Pick up at the next unanswered puzzle."
            rows={resumeRows}
            rowsTestId="training-resume-progress"
            action={{
              label: 'Resume cycle',
              to: trainingCyclePath(data.resume.set.id, data.resume.cycle.cycleNumber),
              testId: 'training-resume-link',
            }}
          />
        ) : null}

        <ReviewCard
          overview={review.overview}
          isReady={!review.loading}
          error={review.error}
          now={review.now()}
          to={ROUTES.trainingReview}
        />
      </div>

      {loading ? (
        <p className={styles.state} data-testid="training-home-loading">
          Loading your training…
        </p>
      ) : error !== null ? (
        <section className={styles.statePanel} role="alert" data-testid="training-home-error">
          <p className={styles.state}>{error}</p>
          <Button variant="secondary" data-testid="training-home-retry" onClick={reload}>
            Try again
          </Button>
        </section>
      ) : showEmptyState ? (
        <section
          className={styles.statePanel}
          data-testid="training-home-empty"
          aria-labelledby="training-home-empty-title"
        >
          <h2 className={styles.stateTitle} id="training-home-empty-title">
            No puzzles yet
          </h2>
          <p className={styles.state}>
            Puzzles must first be generated from your games before you can build a block or a set.
            Open the Game Library, analyze a game and generate its puzzles.
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
          <section
            className={styles.blockSection}
            aria-labelledby="training-block-title"
            data-testid="training-block"
          >
            <h2 className={styles.sectionTitle} id="training-block-title">
              Woodpecker block
            </h2>

            {openBlock !== null ? (
              <>
                <SetCard
                  set={openBlock.set}
                  puzzleCount={openBlock.puzzleCount}
                  cycle={openBlock.cycle}
                  lastActivityAt={openBlock.lastActivityAt}
                  to={trainingSetPath(openBlock.set.id)}
                />
                <p className={styles.state} data-testid="training-block-open-note">
                  A block is open. Finish or abandon it before creating the next block.
                </p>
              </>
            ) : null}

            <div className={styles.poolCard} data-testid="training-pool">
              <h3 className={styles.poolTitle}>Puzzle pool</h3>
              <p className={styles.poolCount} data-testid="training-pool-count">
                {data.poolCount > 0
                  ? `${data.poolCount} ${data.poolCount === 1 ? 'puzzle' : 'puzzles'} ready to train`
                  : data.totalPuzzleCount > 0
                    ? 'No puzzles ready to train — every puzzle is mastered or already in the open block.'
                    : 'No puzzles yet — generate puzzles from a game to fill the pool.'}
              </p>
              <p className={styles.poolGuidance} data-testid="training-pool-guidance">
                A block is fixed once created; new puzzles wait for the next block. Recommended
                200–400; below ~100 risks memorising diagrams.
              </p>

              {openBlock === null ? (
                <div className={styles.poolActions}>
                  <Button
                    data-testid="training-block-create"
                    aria-label={`Create Woodpecker block (${blockSize} puzzles, fixed membership)`}
                    disabled={busy || poolEmpty}
                    onClick={createBlock}
                  >
                    Create Woodpecker block
                  </Button>
                  <Button
                    variant="secondary"
                    aria-expanded={showAdvanced}
                    aria-controls="training-block-advanced"
                    data-testid="training-block-advanced-toggle"
                    onClick={() => setShowAdvanced((current) => !current)}
                  >
                    Advanced
                  </Button>
                </div>
              ) : null}

              {openBlock === null && showAdvanced ? (
                <div id="training-block-advanced" data-testid="training-block-advanced">
                  <label className={styles.sizeField}>
                    <span className={styles.label}>Block size</span>
                    <select
                      className={styles.select}
                      value={blockSize}
                      data-testid="training-block-size"
                      onChange={(event) => setBlockSize(Number(event.target.value))}
                    >
                      {BLOCK_SIZE_OPTIONS.map((size) => (
                        <option key={size} value={size}>
                          {size} puzzles
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ) : null}

              <div className={styles.poolActions}>
                <Button
                  variant="secondary"
                  data-testid="training-quick-train"
                  aria-label="Quick train over the puzzle pool"
                  disabled={busy || poolEmpty}
                  onClick={quickTrain}
                >
                  Quick train
                </Button>
                <span className={styles.poolHint}>
                  Practise the pool now without committing a block.
                </span>
              </div>
            </div>

            {notice !== null ? (
              <p className={styles.notice} role="status" data-testid="training-block-notice">
                {notice}
              </p>
            ) : null}
          </section>

          <section aria-labelledby="training-active-title" data-testid="training-active">
            <h2 className={styles.sectionTitle} id="training-active-title">
              Your sets
            </h2>
            {data.customActive.length > 0 ? (
              <div className={styles.cards} data-testid="training-sets">
                {data.customActive.map((summary) => (
                  <SetCard
                    key={summary.set.id}
                    set={summary.set}
                    puzzleCount={summary.puzzleCount}
                    cycle={summary.cycle}
                    lastActivityAt={summary.lastActivityAt}
                    to={trainingSetPath(summary.set.id)}
                  />
                ))}
              </div>
            ) : (
              <p className={styles.state} data-testid="training-no-active">
                No custom sets. Restore an archived set or create a new one.
              </p>
            )}
          </section>

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
                      to={trainingSetPath(summary.set.id)}
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

/** Solved/total/remaining for a cycle, derived from its canonical metrics. */
function progressOf(
  cycle: TrainingCycleRow,
  metrics: CycleMetrics,
): {
  readonly completed: number;
  readonly total: number;
  readonly remaining: number;
  readonly accuracy: number | null;
} {
  const total = cycle.puzzleIds.length;
  const completed = metrics.puzzlesCompleted;
  const remaining = Math.max(0, total - completed - metrics.puzzlesSkipped);
  return { completed, total, remaining, accuracy: metrics.firstTryAccuracy };
}

/** Load the derived pool, the open block, custom set summaries and the resume target. */
async function loadHome(
  setsService: TrainingSetsService,
  cycleService: CycleService,
  puzzlesRepo: PuzzlesRepository,
  attemptsRepo: PuzzleAttemptsRepository,
): Promise<HomeData> {
  const [activeSets, archivedSets, puzzles, attempts, openBlockRow, cycles] = await Promise.all([
    setsService.list({ status: 'active' }),
    setsService.list({ status: 'archived' }),
    puzzlesRepo.listAll(),
    attemptsRepo.listAll(),
    setsService.getOpenBlock(),
    trainingCyclesRepository.listAll(),
  ]);

  const pool = derivePool({
    puzzles,
    masteredIds: masteredPuzzleIds(attempts, cycles),
    openBlockPuzzleIds: new Set(openBlockRow?.puzzleIds ?? []),
  });

  const customActiveSets = activeSets.filter((set) => set.source.kind !== 'auto');
  const summarySets = [
    ...customActiveSets,
    ...archivedSets,
    ...(openBlockRow === undefined ? [] : [openBlockRow]),
  ];
  const cyclesBySet = await Promise.all(summarySets.map((set) => cycleService.listForSet(set.id)));

  const summaries = new Map<string, SetSummary>();
  summarySets.forEach((set, index) => {
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
  });

  let resumeCandidate: { set: TacticalTrainingSetRow; cycle: TrainingCycleRow } | null = null;
  let resumeStartedAt = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < summarySets.length; index += 1) {
    const set = summarySets[index]!;
    // Prefer the in-progress pass with the most recent attempt activity so a
    // stray later in-progress cycle never shadows the one being solved.
    const active = activeCycleOf(cyclesBySet[index]!, attempts);
    if (active !== null && active.startedAt > resumeStartedAt) {
      resumeStartedAt = active.startedAt;
      resumeCandidate = { set, cycle: active };
    }
  }

  let resume: ResumeTarget | null = null;
  if (resumeCandidate !== null) {
    const result = await cycleService.results(resumeCandidate.cycle.id);
    resume = {
      set: resumeCandidate.set,
      cycle: resumeCandidate.cycle,
      metrics: result.ok ? result.results.metrics : null,
    };
  }

  return {
    customActive: customActiveSets.map((set) => summaries.get(set.id)!),
    archived: archivedSets.map((set) => summaries.get(set.id)!),
    openBlock: openBlockRow === undefined ? null : summaries.get(openBlockRow.id)!,
    poolCount: pool.length,
    totalPuzzleCount: puzzles.length,
    resume,
  };
}
