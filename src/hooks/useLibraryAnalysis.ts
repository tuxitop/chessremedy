import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameAnalysisStatus } from '@/domain/analysis';
import { SETTINGS_KEYS } from '@/config/app-config';
import { settingsRepository } from '@/infrastructure/db/settings-repository';
import { useGameAnalysis, type AnalysisServiceLike } from './useGameAnalysis';

export interface LibraryAnalysisApi {
  /** Per-game analysis status for the currently displayed rows. */
  readonly statuses: Readonly<Record<string, GameAnalysisStatus>>;
  /** True while a batch run is active (progress is live). */
  readonly running: boolean;
  /** Human-readable batch/per-game progress while running, or `null`. */
  readonly progressLine: string | null;
  readonly error: string | null;
  readonly enabled: boolean;
  analyze(ids: readonly string[]): void;
  retry(gameId: string): void;
  cancel(): void;
}

type BulkProfile = 'fast' | 'normal' | 'deep';

/**
 * The profile used for bulk game analysis: the user's configured engine
 * default when it is one of `fast`/`normal`/`deep`. The `tactical` profile is
 * reserved for verification (Feature 010) and never used for bulk analysis;
 * an absent/unset default falls back to `normal`.
 */
async function defaultBulkProfile(): Promise<BulkProfile> {
  try {
    const stored = await settingsRepository.get<{ profile?: string }>(SETTINGS_KEYS.engineDefaults);
    const profile = stored?.profile;
    return profile === 'fast' || profile === 'deep' ? profile : 'normal';
  } catch {
    return 'normal';
  }
}

function countBy(
  statuses: Readonly<Record<string, GameAnalysisStatus>>,
  status: GameAnalysisStatus,
): number {
  return Object.values(statuses).filter((value) => value === status).length;
}

/**
 * Ties the Game Library's selected games to the analysis service: exposes
 * persisted per-game statuses (refreshed on row changes, after runs and
 * polled while a batch is running) plus the batch analyze / cancel actions
 * and a human-readable progress line built from persistent job state (no
 * fabricated ETA).
 */
export function useLibraryAnalysis(
  service: AnalysisServiceLike | null,
  gameIds: readonly string[],
): LibraryAnalysisApi {
  const { busy, error, analyze, cancel } = useGameAnalysis(service);
  const [statuses, setStatuses] = useState<Readonly<Record<string, GameAnalysisStatus>>>({});
  const [running, setRunning] = useState(false);
  const [progressLine, setProgressLine] = useState<string | null>(null);
  const activeIdsRef = useRef<readonly string[] | null>(null);

  const key = gameIds.join('\u0000');

  async function refreshRowsAndProgress(): Promise<void> {
    if (!service) {
      return;
    }
    const activeIds = activeIdsRef.current ?? gameIds;
    const [rows, progress] = await Promise.all([
      service.statusesOf(gameIds).catch(() => null),
      service.jobProgress
        ? service.jobProgress(activeIds).catch(() => null)
        : Promise.resolve(null),
    ]);
    if (rows !== null) {
      setStatuses(rows);
    }
    if (progress !== null) {
      const sts = await service.statusesOf(activeIds).catch(() => null);
      if (sts !== null) {
        setProgressLine(buildProgressLine(activeIds, sts, progress));
      }
    } else {
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
        const next = await service.statusesOf(gameIds);
        if (!cancelled) {
          setStatuses(next);
        }
      } catch {
        // Ignore transient read errors; the Library surface reports its own.
      }
    }
    // Reload whenever the displayed row set changes or after each run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, service, busy, running]);

  useEffect(() => {
    if (!running) {
      return;
    }
    const timer = setInterval(() => {
      void refreshRowsAndProgress();
    }, 900);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, key, service]);

  return useMemo<LibraryAnalysisApi>(() => {
    const api: LibraryAnalysisApi = {
      statuses,
      running,
      progressLine,
      error,
      enabled: service !== null,
      analyze(ids: readonly string[]) {
        activeIdsRef.current = ids;
        setRunning(true);
        setProgressLine('Queued…');
        const selected = [...ids];
        void (async () => {
          const profile = await defaultBulkProfile();
          await analyze(selected, profile);
        })().finally(() => {
          setRunning(false);
          activeIdsRef.current = null;
          setProgressLine(null);
        });
      },
      retry(gameId: string) {
        api.analyze([gameId]);
      },
      cancel() {
        cancel();
      },
    };
    return api;
  }, [statuses, running, progressLine, error, service, analyze, cancel]);
}

function buildProgressLine(
  ids: readonly string[],
  statuses: Readonly<Record<string, GameAnalysisStatus>>,
  progress: Readonly<
    Record<
      string,
      | {
          state: 'queued' | 'inProgress';
          completedPositions: number;
          totalPositions: number;
          profile: string;
        }
      | undefined
    >
  >,
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
  const active = Object.entries(progress).find(([, value]) => value?.state === 'inProgress');
  if (active?.[1]) {
    const detail = active[1]!;
    if (detail.totalPositions > 0) {
      parts.push(`${detail.completedPositions}/${detail.totalPositions} positions`);
    }
    parts.push(`${detail.profile} profile`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'Analyzing…';
}
