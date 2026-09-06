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

export interface LibraryAnalysisApi {
  /** Per-game analysis status for the currently displayed rows. */
  readonly statuses: Readonly<Record<string, GameAnalysisStatus>>;
  /** Per-game live progress for rows with an active queued/in-progress job. */
  readonly perGameProgress: Readonly<Record<string, GameAnalysisProgress>>;
  /** True while a batch run is active (progress is live). */
  readonly running: boolean;
  /** Human-readable batch/per-game progress while running, or `null`. */
  readonly progressLine: string | null;
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

/**
 * Ties the Game Library's selected games to the analysis service: exposes
 * persisted per-game statuses and per-game progress (refreshed on row changes,
 * after runs and polled while a batch is running or an active job persists)
 * plus the batch analyze / per-row and batch cancel actions and a
 * human-readable progress line built from persistent job state (no fabricated
 * ETA).
 */
export function useLibraryAnalysis(
  service: AnalysisServiceLike | null,
  gameIds: readonly string[],
): LibraryAnalysisApi {
  const { busy, error, analyze, cancel } = useGameAnalysis(service);
  const [statuses, setStatuses] = useState<Readonly<Record<string, GameAnalysisStatus>>>({});
  const [perGameProgress, setPerGameProgress] = useState<
    Readonly<Record<string, GameAnalysisProgress>>
  >({});
  const [running, setRunning] = useState(false);
  const [progressLine, setProgressLine] = useState<string | null>(null);
  const [queuedNote, setQueuedNote] = useState<string | null>(null);
  const activeIdsRef = useRef<readonly string[] | null>(null);
  const queuedCountRef = useRef(0);

  const key = gameIds.join('\u0000');

  async function runBatch(ids: readonly string[], force: boolean): Promise<void> {
    if (!service) {
      return;
    }
    activeIdsRef.current = ids;
    queuedCountRef.current += 1;
    setRunning(true);
    setProgressLine(force ? 'Queued re-analysis…' : 'Queued…');
    setQueuedNote(
      queuedCountRef.current > 1 ? `${queuedCountRef.current - 1} batch(es) queued` : null,
    );
    try {
      const resolved = await resolvedGameAnalysis();
      await analyze([...ids], resolved.profile, force, resolved.config);
    } finally {
      queuedCountRef.current = Math.max(0, queuedCountRef.current - 1);
      setQueuedNote(
        queuedCountRef.current > 0 ? `${queuedCountRef.current} batch(es) queued` : null,
      );
      setRunning(false);
      activeIdsRef.current = null;
    }
  }

  async function refreshRowsAndProgress(ids: readonly string[]): Promise<void> {
    if (!service) {
      return;
    }
    const activeIds = activeIdsRef.current ?? ids;
    const expected = await expectedAnalysisConfig();
    const [rows, progress] = await Promise.all([
      service.statusesOf(ids, expected).catch(() => null),
      service.jobProgress
        ? service.jobProgress(activeIds).catch(() => null)
        : Promise.resolve(null),
    ]);
    if (rows !== null) {
      setStatuses(rows);
    }
    if (progress !== null) {
      const collected = collectProgress(progress);
      setPerGameProgress(collected);
      const sts = await service.statusesOf(activeIds, expected).catch(() => null);
      if (sts !== null) {
        setProgressLine(buildProgressLine(activeIds, sts, collected));
      }
    } else {
      setPerGameProgress({});
      setProgressLine(null);
    }
  }

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
    // Reload whenever the displayed row set changes or after each run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, service, busy, running]);

  const hasActiveRows = useMemo(
    () => Object.values(statuses).some((status) => status === 'inProgress' || status === 'queued'),
    [statuses],
  );

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

  return useMemo<LibraryAnalysisApi>(() => {
    const api: LibraryAnalysisApi = {
      statuses,
      perGameProgress,
      running,
      progressLine,
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
        cancel();
      },
      cancelGame(gameId: string) {
        if (!service) {
          return;
        }
        void (async () => {
          try {
            await service.cancelGame(gameId);
          } catch {
            // Ignore transient cancel errors; the next poll reconciles state.
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
    queuedNote,
    error,
    service,
    analyze,
    cancel,
  ]);
}

function buildProgressLine(
  ids: readonly string[],
  statuses: Readonly<Record<string, GameAnalysisStatus>>,
  progress: Readonly<Record<string, GameAnalysisProgress>>,
): string {
  const completed = countBy(statuses, 'completed');
  const inProgress = countBy(statuses, 'inProgress');
  const queued = countBy(statuses, 'queued');
  const failed = countBy(statuses, 'failed');
  const total = ids.length;

  const parts: string[] = [];
  const underway = completed + inProgress;
  if (inProgress > 0 || queued > 0 || underway < total) {
    parts.push(`Analyzing ${Math.min(underway || 1, total)} of ${total} games`);
  } else if (completed === total) {
    parts.push(`Analyzed ${total} games`);
  }
  if (failed > 0) {
    parts.push(`${failed} failed`);
  }
  const active = Object.entries(progress).find(([, value]) => value.state === 'inProgress');
  if (active?.[1]) {
    const detail = active[1]!;
    if (detail.totalPositions > 0) {
      parts.push(`${detail.completedPositions}/${detail.totalPositions} positions`);
    }
    parts.push(`${detail.profile} profile`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'Analyzing…';
}
