import { useEffect, useMemo, useState } from 'react';
import type * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import {
  CycleConfigForm,
  MembershipList,
  type MembershipListItem,
} from '@/components/puzzles/cycles';
import { ROUTES, puzzlesSetPath } from '@/app/routes';
import { GAME_SOURCE_LABELS, GAME_SOURCES } from '@/domain/chess/gameSource';
import { TIME_CONTROL_CATEGORIES } from '@/domain/chess/timeControl';
import type { GameSource } from '@/domain/chess/gameSource';
import type { TimeControlCategory } from '@/domain/chess/timeControl';
import { DIFFICULTY_BUCKETS, difficultyBucketOf, puzzleObjectiveLabel } from '@/domain/puzzle';
import type { DifficultyBucketName, PuzzleOrigin, PuzzleRow } from '@/domain/puzzle';
import { OBJECTIVE_LABELS } from '@/domain/puzzle/objectiveLabel';
import type { TacticalObjective } from '@/domain/tactics';
import {
  DEFAULT_CYCLE_CONFIG,
  DEFAULT_TARGET_SIZE,
  resolveSetMembership,
  type CycleConfig,
  type OrderingPolicy,
  type PuzzlePoolEntry,
  type PuzzlePoolFilters,
  type SetSource,
} from '@/domain/training';
import { TrainingSetsService } from '@/infrastructure/training';
import { trainingSetsRepository } from '@/infrastructure/db/training-sets-repository';
import type { TrainingSetsRepository } from '@/infrastructure/db/training-sets-repository';
import { puzzlesRepository } from '@/infrastructure/db/puzzles-repository';
import type { PuzzlesRepository } from '@/infrastructure/db/puzzles-repository';
import { gamesRepository } from '@/infrastructure/db/games-repository';
import type { GamesRepository, GameSummary } from '@/infrastructure/db/games-repository';
import { attemptsRepository } from '@/infrastructure/db/attempts-repository';
import styles from './SetEditorPage.module.css';

type SourceKind = SetSource['kind'];

interface FilterState {
  readonly origin: PuzzleOrigin | '';
  readonly tacticalObjective: TacticalObjective | '';
  readonly difficultyBucket: DifficultyBucketName | '';
  readonly sourceGameId: string;
  readonly platform: GameSource | '';
  readonly timeControlCategory: TimeControlCategory | '';
}

const EMPTY_FILTERS: FilterState = {
  origin: '',
  tacticalObjective: '',
  difficultyBucket: '',
  sourceGameId: '',
  platform: '',
  timeControlCategory: '',
};

export interface SetEditorPageProps {
  /** Injectable for tests; defaults to the singleton-backed service. */
  readonly setsService?: TrainingSetsService;
  readonly puzzles?: PuzzlesRepository;
  readonly games?: GamesRepository;
  readonly setsRepository?: TrainingSetsRepository;
}

/**
 * Create or edit a training set. Creation seeds membership from a game, the
 * filtered puzzle pool or a manual multi-selection, resolves it once and shows
 * the exact membership and effective config before committing. Editing (via
 * `?setId=…`) edits the name and config; membership is immutable in V1.
 */
export function SetEditorPage({
  setsService: providedSets,
  puzzles: providedPuzzles,
  games: providedGames,
  setsRepository: providedSetsRepo,
}: SetEditorPageProps = {}): React.JSX.Element {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editingSetId = searchParams.get('setId');
  const initialGameId = searchParams.get('gameId') ?? '';
  const initialSource = searchParams.get('source');

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
  const puzzlesRepo = providedPuzzles ?? puzzlesRepository;
  const gamesRepo = providedGames ?? gamesRepository;
  const setsRepo = providedSetsRepo ?? trainingSetsRepository;

  const [allPuzzles, setAllPuzzles] = useState<readonly PuzzleRow[]>([]);
  const [summaries, setSummaries] = useState<readonly GameSummary[]>([]);
  const [dataLoaded, setDataLoaded] = useState(false);

  const [name, setName] = useState('');
  const [sourceKind, setSourceKind] = useState<SourceKind>(
    initialSource === 'game' || initialSource === 'manual' || initialSource === 'pool'
      ? initialSource
      : 'pool',
  );
  const [gameId, setGameId] = useState(initialGameId);
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [manualSelected, setManualSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [ordering, setOrdering] = useState<OrderingPolicy>(DEFAULT_CYCLE_CONFIG.ordering);
  const [targetSize, setTargetSize] = useState(DEFAULT_TARGET_SIZE);
  const [config, setConfig] = useState<CycleConfig>(DEFAULT_CYCLE_CONFIG);
  const [storedMembership, setStoredMembership] = useState<readonly string[]>([]);

  const [loading, setLoading] = useState(editingSetId !== null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [puzzles, games] = await Promise.all([
          puzzlesRepo.listAll(),
          gamesRepo.listGameSummaries(),
        ]);
        if (!cancelled) {
          setAllPuzzles(puzzles);
          setSummaries(games);
          setDataLoaded(true);
        }
      } catch {
        if (!cancelled) {
          setError('Could not read your puzzles from local storage.');
          setDataLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [puzzlesRepo, gamesRepo]);

  useEffect(() => {
    if (editingSetId === null) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const set = await setsRepo.get(editingSetId);
        if (cancelled) {
          return;
        }
        if (set === undefined) {
          setError('That set no longer exists.');
          setLoading(false);
          return;
        }
        setName(set.name);
        setSourceKind(set.source.kind);
        if (set.source.kind === 'game') {
          setGameId(set.source.gameId);
        }
        setOrdering(set.config.ordering);
        setTargetSize(set.targetSize);
        setConfig(set.config);
        setStoredMembership(set.puzzleIds);
        setLoading(false);
      } catch {
        if (!cancelled) {
          setError('Could not load that set.');
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editingSetId, setsRepo]);

  const rowById = useMemo(() => {
    const map = new Map<string, PuzzleRow>();
    for (const puzzle of allPuzzles) {
      map.set(`${puzzle.sourceGameId}:${puzzle.sourcePly}`, puzzle);
    }
    return map;
  }, [allPuzzles]);

  const summaryByGame = useMemo(
    () => new Map(summaries.map((summary) => [summary.id, summary])),
    [summaries],
  );

  const poolEntries = useMemo<readonly PuzzlePoolEntry[]>(() => {
    const entries: PuzzlePoolEntry[] = [];
    for (const puzzle of allPuzzles) {
      const summary = summaryByGame.get(puzzle.sourceGameId);
      if (summary === undefined) {
        continue;
      }
      entries.push({
        puzzle,
        platform: summary.source,
        timeControlCategory: summary.normalizedTimeControl,
      });
    }
    return entries;
  }, [allPuzzles, summaryByGame]);

  const poolFilters = useMemo(() => toPoolFilters(filters), [filters]);

  const filteredPoolIds = useMemo(
    () =>
      resolveSetMembership({
        source: { kind: 'pool', filters: poolFilters },
        puzzles: allPuzzles,
        poolEntries,
        ordering,
        targetSize: Number.MAX_SAFE_INTEGER,
      }),
    [allPuzzles, poolEntries, poolFilters, ordering],
  );

  const previewIds = useMemo(() => {
    if (editingSetId !== null) {
      return storedMembership;
    }
    if (sourceKind === 'game') {
      if (gameId === '') {
        return [];
      }
      return resolveSetMembership({
        source: { kind: 'game', gameId },
        puzzles: allPuzzles.filter((puzzle) => puzzle.sourceGameId === gameId),
        ordering,
        targetSize,
        ...(filters.origin === '' ? {} : { originFilter: filters.origin }),
        ...(filters.difficultyBucket === '' ? {} : { difficultyFilter: filters.difficultyBucket }),
      });
    }
    if (sourceKind === 'pool') {
      return resolveSetMembership({
        source: { kind: 'pool', filters: poolFilters },
        puzzles: allPuzzles,
        poolEntries,
        ordering,
        targetSize,
      });
    }
    return resolveSetMembership({
      source: { kind: 'manual' },
      puzzles: allPuzzles,
      manualIds: [...manualSelected],
      ordering,
      targetSize,
    });
  }, [
    editingSetId,
    storedMembership,
    sourceKind,
    gameId,
    allPuzzles,
    filters,
    ordering,
    targetSize,
    poolFilters,
    poolEntries,
    manualSelected,
  ]);

  const previewItems = useMemo(() => membershipItemsOf(previewIds, rowById), [previewIds, rowById]);
  const manualCandidates = useMemo(
    () => membershipItemsOf(filteredPoolIds, rowById),
    [filteredPoolIds, rowById],
  );

  const toggleManual = (id: string): void => {
    setManualSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const save = async (): Promise<void> => {
    const trimmedName = name.trim();
    if (trimmedName === '') {
      setError('Give the set a name.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (editingSetId !== null) {
        const renamed = await setsService.rename(editingSetId, trimmedName);
        if (!renamed.ok) {
          setError(renameErrorMessage(renamed));
          return;
        }
        const configured = await setsService.updateConfig(editingSetId, config);
        if (!configured.ok) {
          setError(configErrorMessage(configured));
          return;
        }
        navigate(puzzlesSetPath(editingSetId));
        return;
      }

      let result;
      if (sourceKind === 'game') {
        if (gameId === '') {
          setError('Choose a game to seed the set.');
          return;
        }
        result = await setsService.createFromGame({
          gameId,
          name: trimmedName,
          ordering,
          targetSize,
          ...(filters.origin === '' ? {} : { originFilter: filters.origin }),
          ...(filters.difficultyBucket === ''
            ? {}
            : { difficultyFilter: filters.difficultyBucket }),
        });
      } else if (sourceKind === 'pool') {
        result = await setsService.createFromPool({
          filters: poolFilters,
          name: trimmedName,
          ordering,
          targetSize,
        });
      } else {
        result = await setsService.createManual({
          puzzleIds: [...manualSelected],
          name: trimmedName,
          ordering,
          targetSize,
        });
      }
      if (!result.ok) {
        setError(result.message);
        return;
      }
      await setsService.updateConfig(result.set.id, config);
      navigate(puzzlesSetPath(result.set.id));
    } catch {
      setError('Could not save the set. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.page} data-testid="set-editor">
        <p className={styles.state} data-testid="set-editor-loading">
          Loading set…
        </p>
      </div>
    );
  }

  const editing = editingSetId !== null;
  const gameOptions = summaries.filter((summary) =>
    allPuzzles.some((puzzle) => puzzle.sourceGameId === summary.id),
  );

  return (
    <div className={styles.page} data-testid="set-editor">
      <header className={styles.header}>
        <div>
          <Link className={styles.backLink} to={ROUTES.puzzles} data-testid="set-editor-back">
            ← Training
          </Link>
          <h1 className={styles.heading}>{editing ? 'Edit set' : 'New training set'}</h1>
        </div>
      </header>

      {error !== null ? (
        <p className={styles.error} role="alert" data-testid="set-editor-error">
          {error}
        </p>
      ) : null}

      <label className={styles.field}>
        <span className={styles.label}>Set name</span>
        <input
          className={styles.textInput}
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          data-testid="set-editor-name"
        />
      </label>

      {editing ? (
        <p className={styles.note} data-testid="set-editor-edit-note">
          Membership is fixed once a set is created. Create a new set to change its puzzles.
        </p>
      ) : (
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Source</legend>
          <div className={styles.radios}>
            <SourceRadio
              value="game"
              current={sourceKind}
              label="From a game"
              testId="set-editor-source-game"
              onChange={setSourceKind}
            />
            <SourceRadio
              value="pool"
              current={sourceKind}
              label="From the puzzle pool"
              testId="set-editor-source-pool"
              onChange={setSourceKind}
            />
            <SourceRadio
              value="manual"
              current={sourceKind}
              label="Manual selection"
              testId="set-editor-source-manual"
              onChange={setSourceKind}
            />
          </div>

          {sourceKind === 'game' ? (
            <label className={styles.field}>
              <span className={styles.label}>Game</span>
              <select
                value={gameId}
                onChange={(event) => setGameId(event.target.value)}
                data-testid="set-editor-game"
              >
                <option value="">Choose a game…</option>
                {gameOptions.map((summary) => (
                  <option key={summary.id} value={summary.id}>
                    {summary.whitePlayer.name} vs {summary.blackPlayer.name} ·{' '}
                    {GAME_SOURCE_LABELS[summary.source]}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </fieldset>
      )}

      {!editing && (sourceKind === 'pool' || sourceKind === 'manual') ? (
        <PoolFilterFields
          filters={filters}
          onChange={setFilters}
          games={summaries}
          idPrefix="set-editor"
        />
      ) : null}

      {!editing && sourceKind === 'game' ? (
        <div className={styles.filterGrid}>
          <label className={styles.field}>
            <span className={styles.label}>Origin</span>
            <select
              value={filters.origin}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  origin: event.target.value as PuzzleOrigin | '',
                }))
              }
              data-testid="set-editor-origin"
            >
              <option value="">All origins</option>
              <option value="tactical">Tactical</option>
              <option value="blunder">Blunder</option>
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Difficulty</span>
            <select
              value={filters.difficultyBucket}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  difficultyBucket: event.target.value as DifficultyBucketName | '',
                }))
              }
              data-testid="set-editor-difficulty"
            >
              <option value="">All difficulties</option>
              {DIFFICULTY_BUCKETS.map((bucket) => (
                <option key={bucket.name} value={bucket.name}>
                  {bucket.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      <div className={styles.filterGrid}>
        <label className={styles.field}>
          <span className={styles.label}>Ordering</span>
          <select
            value={ordering}
            onChange={(event) => setOrdering(event.target.value as OrderingPolicy)}
            data-testid="set-editor-ordering"
          >
            <option value="difficultyAsc">Difficulty (easiest first)</option>
            <option value="sourcePly">Game and move order</option>
            <option value="manual">Selection order</option>
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Target size</span>
          <input
            className={styles.textInput}
            type="number"
            min={0}
            value={targetSize}
            onChange={(event) => setTargetSize(Math.max(0, Number(event.target.value)))}
            data-testid="set-editor-target-size"
          />
        </label>
      </div>

      <section aria-labelledby="set-editor-config-title">
        <h2 className={styles.sectionTitle} id="set-editor-config-title">
          Cycle configuration
        </h2>
        <CycleConfigForm config={config} onChange={setConfig} idPrefix="set-editor" />
      </section>

      {!editing && sourceKind === 'manual' ? (
        <section aria-labelledby="set-editor-manual-title">
          <h2 className={styles.sectionTitle} id="set-editor-manual-title">
            Select puzzles
          </h2>
          <MembershipList
            items={manualCandidates}
            selectedIds={manualSelected}
            onToggle={toggleManual}
            emptyMessage="No puzzles match these filters."
            testId="set-editor-manual-list"
            ariaLabel="Puzzle pool selection"
          />
        </section>
      ) : null}

      <section aria-labelledby="set-editor-preview-title">
        <h2 className={styles.sectionTitle} id="set-editor-preview-title">
          Membership preview
        </h2>
        <p className={styles.previewCount} data-testid="set-editor-preview-count">
          {previewItems.length === 0
            ? 'No puzzles selected yet — the set will be created empty.'
            : `${previewItems.length} ${
                previewItems.length === 1 ? 'puzzle' : 'puzzles'
              } will be stored in this set.`}
        </p>
        <MembershipList
          items={previewItems}
          emptyMessage="No puzzles in this set."
          testId="set-editor-membership"
          ariaLabel="Set membership preview"
        />
      </section>

      <div className={styles.actions}>
        <Link className={styles.cancelLink} to={ROUTES.puzzles} data-testid="set-editor-cancel">
          Cancel
        </Link>
        <Button
          data-testid="set-editor-save"
          disabled={saving || !dataLoaded}
          onClick={() => void save()}
        >
          {saving ? 'Saving…' : editing ? 'Save changes' : 'Create set'}
        </Button>
      </div>
    </div>
  );
}

function SourceRadio({
  value,
  current,
  label,
  testId,
  onChange,
}: {
  readonly value: SourceKind;
  readonly current: SourceKind;
  readonly label: string;
  readonly testId: string;
  readonly onChange: (kind: SourceKind) => void;
}): React.JSX.Element {
  return (
    <label className={styles.radio}>
      <input
        type="radio"
        name="set-source"
        value={value}
        checked={current === value}
        onChange={() => onChange(value)}
        data-testid={testId}
      />
      <span>{label}</span>
    </label>
  );
}

function PoolFilterFields({
  filters,
  onChange,
  games,
  idPrefix,
}: {
  readonly filters: FilterState;
  readonly onChange: (filters: FilterState) => void;
  readonly games: readonly GameSummary[];
  readonly idPrefix: string;
}): React.JSX.Element {
  const update = (partial: Partial<FilterState>): void => onChange({ ...filters, ...partial });
  return (
    <div className={styles.filterGrid}>
      <label className={styles.field}>
        <span className={styles.label}>Origin</span>
        <select
          value={filters.origin}
          onChange={(event) => update({ origin: event.target.value as PuzzleOrigin | '' })}
          data-testid={`${idPrefix}-origin`}
        >
          <option value="">All origins</option>
          <option value="tactical">Tactical</option>
          <option value="blunder">Blunder</option>
        </select>
      </label>
      <label className={styles.field}>
        <span className={styles.label}>Objective</span>
        <select
          value={filters.tacticalObjective}
          onChange={(event) =>
            update({ tacticalObjective: event.target.value as TacticalObjective | '' })
          }
          data-testid={`${idPrefix}-objective`}
        >
          <option value="">All objectives</option>
          {Object.entries(OBJECTIVE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        <span className={styles.label}>Difficulty</span>
        <select
          value={filters.difficultyBucket}
          onChange={(event) =>
            update({ difficultyBucket: event.target.value as DifficultyBucketName | '' })
          }
          data-testid={`${idPrefix}-difficulty`}
        >
          <option value="">All difficulties</option>
          {DIFFICULTY_BUCKETS.map((bucket) => (
            <option key={bucket.name} value={bucket.name}>
              {bucket.name}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        <span className={styles.label}>Platform</span>
        <select
          value={filters.platform}
          onChange={(event) => update({ platform: event.target.value as GameSource | '' })}
          data-testid={`${idPrefix}-platform`}
        >
          <option value="">All platforms</option>
          {GAME_SOURCES.map((source) => (
            <option key={source} value={source}>
              {GAME_SOURCE_LABELS[source]}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        <span className={styles.label}>Time control</span>
        <select
          value={filters.timeControlCategory}
          onChange={(event) =>
            update({ timeControlCategory: event.target.value as TimeControlCategory | '' })
          }
          data-testid={`${idPrefix}-time-control`}
        >
          <option value="">All time controls</option>
          {TIME_CONTROL_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        <span className={styles.label}>Source game</span>
        <select
          value={filters.sourceGameId}
          onChange={(event) => update({ sourceGameId: event.target.value })}
          data-testid={`${idPrefix}-source-game`}
        >
          <option value="">All games</option>
          {games.map((summary) => (
            <option key={summary.id} value={summary.id}>
              {summary.whitePlayer.name} vs {summary.blackPlayer.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/** Build display rows for resolved membership ids (skipping absent rows). */
function membershipItemsOf(
  ids: readonly string[],
  rowById: ReadonlyMap<string, PuzzleRow>,
): MembershipListItem[] {
  const items: MembershipListItem[] = [];
  for (const id of ids) {
    const row = rowById.get(id);
    if (row === undefined) {
      continue;
    }
    items.push({
      id,
      sourceGameId: row.sourceGameId,
      sourcePly: row.sourcePly,
      origin: row.origin ?? 'tactical',
      objective: puzzleObjectiveLabel(row),
      difficulty: row.difficulty,
      difficultyBucket: difficultyBucketOf(row.difficulty).name,
    });
  }
  return items;
}

/** Drop the empty-string "all" selections from the filter form state. */
function toPoolFilters(state: FilterState): PuzzlePoolFilters {
  return {
    ...(state.origin === '' ? {} : { origin: state.origin }),
    ...(state.tacticalObjective === '' ? {} : { tacticalObjective: state.tacticalObjective }),
    ...(state.difficultyBucket === '' ? {} : { difficultyBucket: state.difficultyBucket }),
    ...(state.sourceGameId === '' ? {} : { sourceGameId: state.sourceGameId }),
    ...(state.platform === '' ? {} : { platform: state.platform }),
    ...(state.timeControlCategory === '' ? {} : { timeControlCategory: state.timeControlCategory }),
  };
}

function renameErrorMessage(result: {
  readonly reason: string;
  readonly message?: string;
}): string {
  return result.reason === 'not-found' ? 'That set no longer exists.' : 'Could not rename the set.';
}

function configErrorMessage(result: {
  readonly reason: string;
  readonly message?: string;
}): string {
  return result.reason === 'invalid-config' && result.message !== undefined
    ? result.message
    : 'Could not save the configuration.';
}
