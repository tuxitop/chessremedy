import { useCallback, useEffect, useMemo, useState } from 'react';
import type * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import {
  ConfirmDialog,
  CycleConfigForm,
  CycleHistory,
  MembershipList,
  type MembershipListItem,
} from '@/components/puzzles/cycles';
import { ROUTES, puzzlesCyclePath, puzzlesCycleResultsPath } from '@/app/routes';
import { difficultyBucketOf, puzzleObjectiveLabel } from '@/domain/puzzle';
import type { PuzzleRow } from '@/domain/puzzle';
import {
  setSourceLabel,
  type CycleConfig,
  type TacticalTrainingSetRow,
  type TrainingCycleRow,
} from '@/domain/training';
import { CycleService, TrainingSetsService } from '@/infrastructure/training';
import { trainingSetsRepository } from '@/infrastructure/db/training-sets-repository';
import type { TrainingSetsRepository } from '@/infrastructure/db/training-sets-repository';
import { trainingCyclesRepository } from '@/infrastructure/db/training-cycles-repository';
import { puzzlesRepository } from '@/infrastructure/db/puzzles-repository';
import type { PuzzlesRepository } from '@/infrastructure/db/puzzles-repository';
import { attemptsRepository } from '@/infrastructure/db/attempts-repository';
import type { PuzzleAttemptsRepository } from '@/infrastructure/db/attempts-repository';
import { gamesRepository } from '@/infrastructure/db/games-repository';
import styles from './SetDetailPage.module.css';

interface DetailData {
  readonly set: TacticalTrainingSetRow | null;
  readonly membership: readonly PuzzleRow[];
  readonly cycles: readonly TrainingCycleRow[];
  readonly attemptCount: number;
}

export interface SetDetailPageProps {
  /** Injectable for tests; defaults to the singleton-backed service. */
  readonly setsService?: TrainingSetsService;
  readonly cycleService?: CycleService;
  readonly puzzles?: PuzzlesRepository;
  readonly setsRepository?: TrainingSetsRepository;
  readonly attempts?: PuzzleAttemptsRepository;
}

/**
 * One training set's detail: rename, edit the cycle config, view membership and
 * cycle history, start/continue a cycle, archive/unarchive and delete (with a
 * confirmation naming the set and its cycle/attempt counts).
 */
export function SetDetailPage({
  setsService: providedSets,
  cycleService: providedCycles,
  puzzles: providedPuzzles,
  setsRepository: providedSetsRepo,
  attempts: providedAttempts,
}: SetDetailPageProps = {}): React.JSX.Element {
  const { setId = '' } = useParams<'setId'>();
  const navigate = useNavigate();

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
  const setsRepo = providedSetsRepo ?? trainingSetsRepository;
  const puzzlesRepo = providedPuzzles ?? puzzlesRepository;
  const attemptsRepo = providedAttempts ?? attemptsRepository;

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<DetailData>({
    set: null,
    membership: [],
    cycles: [],
    attemptCount: 0,
  });
  const [name, setName] = useState('');
  const [config, setConfig] = useState<CycleConfig | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  const reload = useCallback(() => setReloadTick((tick) => tick + 1), []);

  useEffect(() => {
    if (setId === '') {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const set = await setsRepo.get(setId);
        if (cancelled) {
          return;
        }
        if (set === undefined) {
          setData({ set: null, membership: [], cycles: [], attemptCount: 0 });
          setLoading(false);
          return;
        }
        const [membership, cycles] = await Promise.all([
          puzzlesRepo.getPuzzles(set.puzzleIds),
          cycleService.listForSet(setId),
        ]);
        const attemptRows = await Promise.all(
          cycles.map((cycle) => attemptsRepo.listForCycle(cycle.id)),
        );
        if (cancelled) {
          return;
        }
        setData({
          set,
          membership,
          cycles,
          attemptCount: attemptRows.reduce((sum, rows) => sum + rows.length, 0),
        });
        setName(set.name);
        setConfig(set.config);
        setLoading(false);
      } catch {
        if (!cancelled) {
          setError('Could not load this set from local storage.');
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setId, setsRepo, puzzlesRepo, cycleService, attemptsRepo, reloadTick]);

  const membershipItems = useMemo(() => membershipItemsOf(data.membership), [data.membership]);

  const inProgress = useMemo(() => {
    let found: TrainingCycleRow | null = null;
    for (const cycle of data.cycles) {
      if (cycle.status === 'inProgress') {
        found = cycle;
      }
    }
    return found;
  }, [data.cycles]);

  const set = data.set;

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

  const saveName = (): void =>
    void run(async () => {
      const trimmed = name.trim();
      if (trimmed === '') {
        setError('Give the set a name.');
        return;
      }
      const result = await setsService.rename(setId, trimmed);
      if (!result.ok) {
        setError(
          result.reason === 'not-found' ? 'That set no longer exists.' : 'Could not rename.',
        );
        return;
      }
      setNotice('Set renamed.');
      reload();
    });

  const saveConfig = (): void =>
    void run(async () => {
      if (config === null) {
        return;
      }
      const result = await setsService.updateConfig(setId, config);
      if (!result.ok) {
        setError(
          result.reason === 'invalid-config' ? result.message : 'Could not save the config.',
        );
        return;
      }
      setNotice('Configuration saved.');
      reload();
    });

  const toggleArchive = (): void =>
    void run(async () => {
      if (set === null) {
        return;
      }
      const result =
        set.status === 'active'
          ? await setsService.archive(setId)
          : await setsService.unarchive(setId);
      if (!result.ok) {
        setError(
          result.reason === 'not-found' ? 'That set no longer exists.' : 'Could not update.',
        );
        return;
      }
      setNotice(set.status === 'active' ? 'Set archived.' : 'Set restored.');
      reload();
    });

  const confirmDeletion = (): void =>
    void run(async () => {
      setConfirmDelete(false);
      const result = await setsService.delete(setId);
      if (!result.ok) {
        setError('That set no longer exists.');
        return;
      }
      navigate(ROUTES.puzzles);
    });

  const startOrContinue = (): void =>
    void run(async () => {
      if (inProgress !== null) {
        const resumed = await cycleService.resume(inProgress.id);
        if (!resumed.ok) {
          setError('Could not continue that cycle.');
          return;
        }
        if (resumed.complete) {
          setNotice(`Cycle ${inProgress.cycleNumber} is already complete.`);
          reload();
          return;
        }
        navigate(puzzlesCyclePath(setId, inProgress.cycleNumber));
        return;
      }
      const started = await cycleService.start(setId);
      if (!started.ok) {
        setError(startErrorMessage(started));
        return;
      }
      navigate(puzzlesCyclePath(setId, started.cycle.cycleNumber));
    });

  if (loading) {
    return (
      <div className={styles.page} data-testid="set-detail">
        <p className={styles.state} data-testid="set-detail-loading">
          Loading set…
        </p>
      </div>
    );
  }

  if (set === null) {
    return (
      <div className={styles.page} data-testid="set-detail">
        <Link className={styles.backLink} to={ROUTES.puzzles}>
          ← Training
        </Link>
        <section className={styles.statePanel} data-testid="set-detail-missing">
          <h1 className={styles.heading}>Set not found</h1>
          <p className={styles.state}>This set may have been deleted.</p>
        </section>
      </div>
    );
  }

  const empty = set.puzzleIds.length === 0;

  return (
    <div className={styles.page} data-testid="set-detail">
      <header className={styles.header}>
        <div>
          <Link className={styles.backLink} to={ROUTES.puzzles} data-testid="set-detail-back">
            ← Training
          </Link>
          <h1 className={styles.heading} data-testid="set-detail-name">
            {set.name}
          </h1>
          <p className={styles.subtitle} data-testid="set-detail-source">
            {setSourceLabel(set.source)} · {set.status === 'active' ? 'Active' : 'Archived'}
          </p>
        </div>
        <div className={styles.headerActions}>
          {inProgress !== null ? (
            <Button
              data-testid="set-detail-continue-cycle"
              disabled={busy || empty}
              onClick={startOrContinue}
            >
              Continue cycle {inProgress.cycleNumber}
            </Button>
          ) : (
            <Button
              data-testid="set-detail-start-cycle"
              disabled={busy || empty}
              onClick={startOrContinue}
            >
              Start cycle
            </Button>
          )}
        </div>
      </header>

      {notice !== null ? (
        <p className={styles.notice} role="status" data-testid="set-detail-notice">
          {notice}
        </p>
      ) : null}
      {error !== null ? (
        <p className={styles.error} role="alert" data-testid="set-detail-error">
          {error}
        </p>
      ) : null}

      {empty ? (
        <section className={styles.statePanel} data-testid="set-detail-empty">
          <h2 className={styles.sectionTitle}>This set has no puzzles</h2>
          <p className={styles.state}>
            Generate puzzles from a game and create a new set from them.
          </p>
          <Link
            className={styles.primaryLink}
            to={ROUTES.puzzlesNew}
            data-testid="set-detail-empty-new"
          >
            Create a set
          </Link>
        </section>
      ) : null}

      <section aria-labelledby="set-detail-rename-title">
        <h2 className={styles.sectionTitle} id="set-detail-rename-title">
          Name
        </h2>
        <div className={styles.inlineForm}>
          <label className={styles.field}>
            <span className={styles.label}>Set name</span>
            <input
              className={styles.textInput}
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              data-testid="set-detail-name-input"
            />
          </label>
          <Button
            variant="secondary"
            data-testid="set-detail-save-name"
            disabled={busy}
            onClick={saveName}
          >
            Save name
          </Button>
        </div>
      </section>

      <section aria-labelledby="set-detail-config-title">
        <h2 className={styles.sectionTitle} id="set-detail-config-title">
          Cycle configuration
        </h2>
        {config !== null ? (
          <>
            <CycleConfigForm config={config} onChange={setConfig} idPrefix="set-detail" />
            <div className={styles.inlineActions}>
              <Button
                variant="secondary"
                data-testid="set-detail-save-config"
                disabled={busy}
                onClick={saveConfig}
              >
                Save configuration
              </Button>
            </div>
          </>
        ) : null}
      </section>

      <section aria-labelledby="set-detail-membership-title">
        <h2 className={styles.sectionTitle} id="set-detail-membership-title">
          Membership
        </h2>
        <p className={styles.previewCount} data-testid="set-detail-membership-count">
          {membershipItems.length === 0
            ? 'No puzzles in this set.'
            : `${membershipItems.length} ${
                membershipItems.length === 1 ? 'puzzle' : 'puzzles'
              } in this set.`}
        </p>
        <MembershipList
          items={membershipItems}
          emptyMessage="No puzzles in this set."
          testId="set-detail-membership"
          ariaLabel="Set membership"
        />
      </section>

      <section aria-labelledby="set-detail-history-title">
        <h2 className={styles.sectionTitle} id="set-detail-history-title">
          Cycle history
        </h2>
        <CycleHistory
          cycles={data.cycles}
          emptyMessage="No cycles yet."
          testId="set-detail-history"
          resultsPathFor={(cycle) => puzzlesCycleResultsPath(setId, cycle.cycleNumber)}
        />
      </section>

      <section aria-labelledby="set-detail-manage-title">
        <h2 className={styles.sectionTitle} id="set-detail-manage-title">
          Manage
        </h2>
        <div className={styles.inlineActions}>
          <Button
            variant="secondary"
            data-testid="set-detail-archive"
            disabled={busy}
            onClick={toggleArchive}
          >
            {set.status === 'active' ? 'Archive set' : 'Unarchive set'}
          </Button>
          <Button
            data-testid="set-detail-delete"
            disabled={busy}
            onClick={() => setConfirmDelete(true)}
          >
            Delete set
          </Button>
        </div>
      </section>

      {confirmDelete ? (
        <ConfirmDialog
          testId="set-detail-delete-dialog"
          title={`Delete “${set.name}”?`}
          message="This permanently removes the set, its cycles and their recorded attempts from your local library. The puzzles themselves are kept. This cannot be undone."
          details={[
            `${data.cycles.length} ${data.cycles.length === 1 ? 'cycle' : 'cycles'}`,
            `${data.attemptCount} recorded ${data.attemptCount === 1 ? 'attempt' : 'attempts'}`,
          ]}
          confirmLabel="Delete set"
          onConfirm={confirmDeletion}
          onCancel={() => setConfirmDelete(false)}
        />
      ) : null}
    </div>
  );
}

/** Hydrate membership rows into display items. */
function membershipItemsOf(rows: readonly PuzzleRow[]): MembershipListItem[] {
  return rows.map((row) => ({
    id: `${row.sourceGameId}:${row.sourcePly}`,
    sourceGameId: row.sourceGameId,
    sourcePly: row.sourcePly,
    origin: row.origin ?? 'tactical',
    objective: puzzleObjectiveLabel(row),
    difficulty: row.difficulty,
    difficultyBucket: difficultyBucketOf(row.difficulty).name,
  }));
}

function startErrorMessage(result: { readonly reason: string; readonly message?: string }): string {
  switch (result.reason) {
    case 'empty-set':
      return 'This set has no puzzles to train.';
    case 'not-found':
      return 'That set no longer exists.';
    case 'invalid-config':
      return result.message ?? 'The saved configuration is invalid.';
    default:
      return 'Could not start a cycle.';
  }
}
