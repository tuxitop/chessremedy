import { useEffect, useMemo, useRef, useState } from 'react';
import type { ExpectedAnalysisConfig, GameAnalysisConfig } from '@/domain/analysis';
import type { GameAnalysisStatus } from '@/domain/analysis';
import type { GameAnalysisProgress } from '@/infrastructure/analysis';
import { SETTINGS_KEYS } from '@/config/app-config';
import { settingsRepository } from '@/infrastructure/db/settings-repository';
import {
  clampGameAnalysisDepth,
  clampGameAnalysisSearchSeconds,
  type GameAnalysisProfile,
  type GameAnalysisSettings,
} from '@/components/analysis/gameAnalysisSettings';
import { useGameAnalysis, type AnalysisServiceLike } from './useGameAnalysis';

/** Aggregate engine-position progress across a batch/queue. */
export interface AnalysisQueuePositions {
  readonly done: number;
  readonly total: number;
}

export interface LibraryAnalysisApi {
  /** Per-game analysis status for the currently displayed rows. */
  readonly statuses: Readonly<Record<string, GameAnalysisStatus>>;
  /** Per-game live progress for rows with an active queued/in-progress job. */
  readonly perGameProgress: Readonly<Record<string, GameAnalysisProgress>>;
  /**
   * True while any analysis work is queued or running (drives the top
   * progress banner; false once everything in the queue is finished/cancelled).
   */
  readonly running: boolean;
  /** Human-readable batch/per-game progress while running, or `null`. */
  readonly progressLine: string | null;
  /**
   * Aggregate engine positions across the games of the running batch (done/total
   * where the total is known), or `null` when no live totals exist yet.
   */
  readonly positions: AnalysisQueuePositions | null;
  /** True when a further batch is queued behind the active one. */
  readonly queuedNote: string | null;
  readonly error: string | null;
  readonly enabled: boolean;
  analyze(ids: readonly string[]): void;
  retry(gameId: string): void;
  /** Force a re-analysis of one game under the current Game-analysis settings. */
  reanalyze(gameId: string): void;
  /** Force a re-analysis of several games under the current settings. */
  reanalyzeMany(ids: readonly string[]): void;
  cancel(): void;
  /** Cancel one game's queued/in-progress job (others keep analysing). */
  cancelGame(gameId: string): void;
}

function clampProfile(profile: GameAnalysisProfile | undefined): GameAnalysisProfile {
  return profile === 'fast' || profile === 'deep' ? profile : 'normal';
}

/**
 * Read the Settings "Game analysis" group (Q2 = Option A) with the module's
 * clamps/defaults applied. A missing/partial stored value falls back to the
 * normal profile with no overrides.
 */
async function storedGameAnalysisSettings(): Promise<GameAnalysisSettings> {
  try {
    const stored = await settingsRepository.get<GameAnalysisSettings>(SETTINGS_KEYS.analysisGame);
    return {
      engine: stored?.engine ?? 'stockfish',
      profile: clampProfile(stored?.profile),
      depthOverride:
        stored?.depthOverride !== null && stored?.depthOverride !== undefined
          ? clampGameAnalysisDepth(stored.depthOverride)
          : null,
      searchSeconds:
        stored?.searchSeconds !== null && stored?.searchSeconds !== undefined
          ? clampGameAnalysisSearchSeconds(stored.searchSeconds)
          : null,
    };
  } catch {
    return { engine: 'stockfish', profile: 'normal', depthOverride: null, searchSeconds: null };
  }
}

/** Resolve stored settings into the overrides fed to the engine + identity. */
async function resolvedGameAnalysis(): Promise<{
  profile: GameAnalysisProfile;
  config?: GameAnalysisConfig;
}> {
  const settings = await storedGameAnalysisSettings();
  const overrides: Array<[keyof GameAnalysisConfig, number]> = [];
  if (settings.depthOverride !== null) {
    overrides.push(['maxDepth', settings.depthOverride]);
  }
  if (settings.searchSeconds !== null) {
    overrides.push(['movetimeMs', settings.searchSeconds * 1000]);
  }
  const config: GameAnalysisConfig = Object.fromEntries(overrides);
  const hasOverrides = overrides.length > 0;
  return hasOverrides ? { profile: settings.profile, config } : { profile: settings.profile };
}

/**
 * The config a fresh run would use under the current Game-analysis settings,
 * for the `outdated` derivation (a completed run under an older config reads
 * outdated → opt-in re-analysis).
 */
async function expectedAnalysisConfig(): Promise<ExpectedAnalysisConfig | undefined> {
  const resolved = await resolvedGameAnalysis();
  return {
    profile: resolved.profile,
    ...(resolved.config !== undefined ? { config: resolved.config } : {}),
  };
}

function countBy(
  statuses: Readonly<Record<string, GameAnalysisStatus>>,
  status: GameAnalysisStatus,
): number {
  return Object.values(statuses).filter((value) => value === status).length;
}

function collectProgress(
  progress: Readonly<Record<string, GameAnalysisProgress | undefined>>,
): Readonly<Record<string, GameAnalysisProgress>> {
  const out: Record<string, GameAnalysisProgress> = {};
  for (const [id, value] of Object.entries(progress)) {
    if (value) {
      out[id] = value;
    }
  }
  return out;
}

interface QueuedBatch {
  readonly ids: string[];
  readonly force: boolean;
}

interface ActiveRun {
  readonly ids: string[];
  readonly force: boolean;
}

/**
 * Ties the Game Library's selected games to the analysis service. Requests are
 * serialized through a real FIFO queue held here (one batch runs on the engine
 * at a time; the rest wait, visible as `queued` on their rows and cancellable
 * individually). Live per-game progress is read from persisted jobs (polled
 * while a batch runs), and the queue-facing statuses/progress are derived so
 * the top banner updates the instant a game is queued.
 */
export function useLibraryAnalysis(
  service: AnalysisServiceLike | null,
  gameIds: readonly string[],
): LibraryAnalysisApi {
  const { busy, error, analyze, cancel } = useGameAnalysis(service);
  const [persistedStatuses, setPersistedStatuses] = useState<
    Readonly<Record<string, GameAnalysisStatus>>
  >({});
  const [perGameProgress, setPerGameProgress] = useState<
    Readonly<Record<string, GameAnalysisProgress>>
  >({});
  /** Ids of the batch the engine is currently working on (for progress polls). */
  const [activeIds, setActiveIds] = useState<readonly string[]>([]);
  /** Ids of games whose request is still waiting behind the active batch. */
  const [queuedIds, setQueuedIds] = useState<readonly string[]>([]);
  /** How many logical batches are waiting behind the active one. */
  const [pendingBatchCount, setPendingBatchCount] = useState(0);
  const activeRef = useRef<ActiveRun | null>(null);
  const pendingRef = useRef<readonly QueuedBatch[]>([]);
  /** Last known per-game position totals, kept so a finished batch member still
   *  contributes to the aggregate queue progress until the batch is released. */
  const [knownTotals, setKnownTotals] = useState<Readonly<Record<string, number>>>({});
  const unmountedRef = useRef(false);

  const key = gameIds.join('\u0000');

  /** Hand one pending batch to the engine at a time (the rest stay queued). */
  async function drain(): Promise<void> {
    if (!service || unmountedRef.current) {
      return;
    }
    if (activeRef.current !== null) {
      return;
    }
    const next = pendingRef.current[0];
    if (!next) {
      setActiveIds([]);
      setQueuedIds([]);
      setPendingBatchCount(0);
      return;
    }
    pendingRef.current = pendingRef.current.slice(1);
    const run: ActiveRun = { ids: [...next.ids], force: next.force };
    activeRef.current = run;
    setActiveIds(run.ids);
    setQueuedIds(pendingRef.current.flatMap((batch) => batch.ids));
    setPendingBatchCount(pendingRef.current.length);
    try {
      const resolved = await resolvedGameAnalysis();
      await analyze([...run.ids], resolved.profile, run.force, resolved.config);
    } finally {
      // Only clear the slot we own: an explicit `cancel()` (or a newer run that
      // started after it) leaves the active marker alone.
      if (activeRef.current === run) {
        activeRef.current = null;
        setActiveIds([]);
        setQueuedIds(pendingRef.current.flatMap((batch) => batch.ids));
        setPendingBatchCount(pendingRef.current.length);
      }
      void drain();
    }
  }

  function runBatch(ids: readonly string[], force: boolean): void {
    if (!service) {
      return;
    }
    pendingRef.current = [...pendingRef.current, { ids: [...ids], force }];
    setQueuedIds(pendingRef.current.flatMap((batch) => batch.ids));
    setPendingBatchCount(pendingRef.current.length);
    if (activeRef.current === null) {
      void drain();
    }
  }

  async function refreshRowsAndProgress(ids: readonly string[]): Promise<void> {
    if (!service) {
      return;
    }
    // Progress is queried for the running batch (all its members have a
    // persisted queued/in-progress job); when nothing of ours is running but
    // the user landed on rows with an active job (resume after navigation),
    // fall back to the displayed rows.
    const active = activeRef.current;
    const progressTarget = active && active.ids.length > 0 ? active.ids : ids;
    const expected = await expectedAnalysisConfig();
    const [rows, progress] = await Promise.all([
      service.statusesOf(ids, expected).catch(() => null),
      service.jobProgress
        ? service.jobProgress(progressTarget).catch(() => null)
        : Promise.resolve(null),
    ]);
    if (rows !== null) {
      setPersistedStatuses(rows);
    }
    if (progress !== null) {
      const collected = collectProgress(progress);
      // Remember each member's total positions so a game that finishes keeps
      // contributing to the aggregate queue progress.
      setKnownTotals((previous) => {
        const totals: Record<string, number> = { ...previous };
        for (const [id, value] of Object.entries(collected)) {
          if (value.totalPositions > 0) {
            totals[id] = value.totalPositions;
          }
        }
        return totals;
      });
      setPerGameProgress(collected);
    } else {
      setPerGameProgress({});
    }
  }

  // Displayed statuses: persisted job status, overlaid with a `queued` marker
  // for games whose request is waiting behind the active batch. This makes a
  // queued re-analysis/analyze visible on its row before it ever touches the
  // engine (no persisted job exists yet).
  const statuses = useMemo<Readonly<Record<string, GameAnalysisStatus>>>(() => {
    const out: Record<string, GameAnalysisStatus> = {};
    for (const id of queuedIds) {
      out[id] = 'queued';
    }
    for (const [id, status] of Object.entries(persistedStatuses)) {
      if (!(id in out)) {
        out[id] = status;
      }
    }
    return out;
  }, [persistedStatuses, queuedIds]);

  const hasActiveRows = useMemo(
    () => Object.values(statuses).some((status) => status === 'inProgress' || status === 'queued'),
    [statuses],
  );

  /** True while there is any work queued or running (drives the top banner). */
  const running = activeIds.length > 0 || queuedIds.length > 0;

  /**
   * Aggregate engine positions across the members of the running batch. A
   * member still carrying a live job contributes its current position totals; a
   * member that already completed contributes its full remembered total, so the
   * percentage grows monotonically within a batch.
   */
  const positions = useMemo<AnalysisQueuePositions | null>(() => {
    if (activeIds.length === 0) {
      return null;
    }
    let done = 0;
    let total = 0;
    for (const id of activeIds) {
      const status = statuses[id];
      const live = perGameProgress[id];
      if (live && live.totalPositions > 0) {
        done += live.completedPositions;
        total += live.totalPositions;
      } else if (status === 'completed' || status === 'outdated') {
        const remembered = knownTotals[id];
        if (remembered && remembered > 0) {
          done += remembered;
          total += remembered;
        }
      }
    }
    return total > 0 ? { done, total } : null;
  }, [activeIds, statuses, perGameProgress, knownTotals]);

  const progressLine = useMemo<string | null>(() => {
    if (!running) {
      return null;
    }
    const work = new Set([...activeIds, ...queuedIds]);
    if (work.size === 0) {
      return null;
    }
    const workStatuses: Record<string, GameAnalysisStatus> = {};
    for (const id of work) {
      workStatuses[id] = statuses[id] ?? 'unanalyzed';
    }
    const total = work.size;
    const completed = countBy(workStatuses, 'completed') + countBy(workStatuses, 'outdated');
    const inProgress = countBy(workStatuses, 'inProgress');
    const queuedCount = countBy(workStatuses, 'queued');
    const failed = countBy(workStatuses, 'failed');

    const parts: string[] = [];
    const underway = completed + inProgress;
    if (inProgress > 0 || queuedCount > 0 || underway < total || failed > 0) {
      parts.push(`Analyzing ${Math.min(Math.max(underway, 1), total)} of ${total} games`);
    } else if (completed === total) {
      parts.push(`Analyzed ${total} games`);
    }
    if (failed > 0) {
      parts.push(`${failed} failed`);
    }
    if (positions) {
      parts.push(`${positions.done}/${positions.total} positions`);
    }
    return parts.length > 0 ? parts.join(' · ') : 'Analyzing…';
  }, [running, activeIds, queuedIds, statuses, positions]);

  const queuedNote = useMemo<string | null>(
    () =>
      pendingBatchCount > 0
        ? pendingBatchCount === 1
          ? '1 more batch queued'
          : `${pendingBatchCount} more batches queued`
        : null,
    [pendingBatchCount],
  );

  useEffect(() => {
    let cancelled = false;
    void refresh();
    return () => {
      cancelled = true;
    };
    async function refresh(): Promise<void> {
      if (!service || cancelled) {
        return;
      }
      try {
        await refreshRowsAndProgress(gameIds);
      } catch {
        // Ignore transient read errors; the Library surface reports its own.
      }
    }
    // Reload whenever the displayed row set changes, after each run, or when a
    // new batch becomes active (so its rows surface queued/in-progress at once).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, service, busy, running, activeIds]);

  // Poll live progress while a batch runs or while any displayed row still has
  // a persisted queued/in-progress job (progress survives navigation).
  useEffect(() => {
    if (!running && !hasActiveRows) {
      return;
    }
    const timer = setInterval(() => {
      void refreshRowsAndProgress(gameIds);
    }, 900);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, hasActiveRows, key, service]);

  // On unmount stop the active run and never start queued batches.
  useEffect(() => {
    return () => {
      unmountedRef.current = true;
      pendingRef.current = [];
      activeRef.current = null;
    };
  }, []);

  return useMemo<LibraryAnalysisApi>(() => {
    const api: LibraryAnalysisApi = {
      statuses,
      perGameProgress,
      running,
      progressLine,
      positions,
      queuedNote,
      error,
      enabled: service !== null,
      analyze(ids: readonly string[]) {
        void runBatch([...ids], false);
      },
      retry(gameId: string) {
        void runBatch([gameId], false);
      },
      reanalyze(gameId: string) {
        void runBatch([gameId], true);
      },
      reanalyzeMany(ids: readonly string[]) {
        void runBatch([...ids], true);
      },
      cancel() {
        // Explicit Cancel stops the active run and clears the queued requests
        // (their not-yet-started hook runs are dropped).
        pendingRef.current = [];
        activeRef.current = null;
        setActiveIds([]);
        setQueuedIds([]);
        setPendingBatchCount(0);
        cancel();
      },
      cancelGame(gameId: string) {
        if (!service) {
          return;
        }
        void (async () => {
          const waiting = pendingRef.current.some((batch) => batch.ids.includes(gameId));
          if (waiting) {
            // The game is waiting in the queue behind the active batch: pull it
            // out so it never runs (no persisted job exists for it yet).
            const kept = pendingRef.current
              .map((batch) => ({ ...batch, ids: batch.ids.filter((id) => id !== gameId) }))
              .filter((batch) => batch.ids.length > 0);
            pendingRef.current = kept;
            setQueuedIds(kept.flatMap((batch) => batch.ids));
            setPendingBatchCount(kept.length);
          } else {
            // The game has (or will have) a persisted job: cancel it at the
            // service. This covers both the running batch (its job is stopped
            // at the next boundary; the rest keeps going) and a persisted
            // queued/in-progress job left over from an earlier session.
            try {
              await service.cancelGame(gameId);
            } catch {
              // Ignore transient cancel errors; the next poll reconciles state.
            }
          }
          await refreshRowsAndProgress(gameIds);
        })();
      },
    };
    return api;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    statuses,
    perGameProgress,
    running,
    progressLine,
    positions,
    queuedNote,
    error,
    service,
    analyze,
    cancel,
  ]);
}
