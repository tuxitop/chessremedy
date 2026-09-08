import { useCallback, useEffect, useState } from 'react';
import { gamesRepository } from '@/infrastructure/db/games-repository';
import { analysesRepository } from '@/infrastructure/db/analysis-repository';
import { analysisJobsRepository } from '@/infrastructure/db/analysis-jobs-repository';
import { summariesRepository } from '@/infrastructure/db/summaries-repository';
import type { Game } from '@/domain/chess/game';
import type { MoveAnalysis } from '@/domain/chess';
import type { SummaryDetectionState } from '@/domain/analysis/summaryDerivation';
import {
  analysisStatusOf,
  isAnalysisObsolete,
  latestCompletedJob,
  type AnalysisJob,
  type GameAnalysisStatus,
} from '@/domain/analysis';

export interface ReviewData {
  readonly loading: boolean;
  readonly game: Game | null;
  /** Job backing the currently shown analysis (completed), if any. */
  readonly job: AnalysisJob | null;
  readonly records: readonly MoveAnalysis[];
  readonly status: GameAnalysisStatus | null;
  /** Persisted versions predate the current pipeline (re-analysis advised). */
  readonly obsolete: boolean;
  readonly progress: { readonly done: number; readonly total: number } | null;
  /**
   * Feature-010 detection-pass state of the shown analysis, read from its
   * persisted per-analysis summary; `null` when the run has no summary row
   * yet (older analyses pre-date the summary table). `'absent'` means the run
   * was never scanned; only `'completed'` carries a real missed-tactic count.
   */
  readonly detectionState: SummaryDetectionState | null;
  /**
   * Detection-pipeline version of the shown analysis's persisted result
   * (Feature 010, plan 015): the version that produced a `'completed'` pass,
   * or `null` while none exists. A completed result whose version differs
   * from the current constant is outdated and is not rendered/counted.
   */
  readonly detectionVersion: number | null;
  /**
   * Live Stage-2 scan progress (`done`/`total` settled candidates) of the shown
   * analysis's detection pass (plan 013 W3); `null` when the pass has not
   * recorded progress. Rendered as a progress bar only while the pass is live.
   */
  readonly scanProgress: { readonly done: number; readonly total: number } | null;
  reload(): void;
}

/**
 * Loads the persisted analysis state for one game on the Review route. Pure
 * read of IndexedDB — no engine traffic, so Review works fully offline.
 */
export function useGameReview(gameId: string): ReviewData {
  const [state, setState] = useState<Omit<ReviewData, 'reload'>>({
    loading: true,
    game: null,
    job: null,
    records: [],
    status: null,
    obsolete: false,
    progress: null,
    detectionState: null,
    detectionVersion: null,
    scanProgress: null,
  });

  const load = useCallback(() => {
    let cancelled = false;
    void (async () => {
      const game = await gamesRepository.getGame(gameId);
      const jobs = game ? await analysisJobsRepository.listByGame(gameId) : [];
      const status = analysisStatusOf(jobs);
      const completed = latestCompletedJob(jobs);
      let records: readonly MoveAnalysis[] = [];
      let detectionState: SummaryDetectionState | null = null;
      let detectionVersion: number | null = null;
      let scanProgress: { readonly done: number; readonly total: number } | null = null;
      if (game && completed) {
        records = await analysesRepository.listForGameAndAnalysis(gameId, completed.id);
        const summary = await summariesRepository.getForAnalysis(completed.id);
        // `absent` (older analyses that predate the summary table) is kept as a
        // real state so the Review can say "not scanned" instead of staying
        // silent about missed tactics.
        detectionState = summary ? summary.detectionState : 'absent';
        detectionVersion = summary?.detectionVersion ?? null;
        scanProgress = summary?.scanProgress ?? null;
      }
      if (cancelled) {
        return;
      }
      const active = jobs.find((job) => job.state === 'inProgress');
      const newest = [...jobs].sort((a, b) => b.updatedAt - a.updatedAt)[0];
      setState({
        loading: false,
        game: game ?? null,
        job: completed ?? newest ?? null,
        records,
        status: game ? status : null,
        obsolete: completed ? isAnalysisObsolete(completed) : false,
        progress:
          active && active.totalPositions > 0
            ? { done: active.completedPositions, total: active.totalPositions }
            : null,
        detectionState,
        detectionVersion,
        scanProgress,
      });
    })().catch(() => {
      if (!cancelled) {
        setState((prev) => ({ ...prev, loading: false, game: null, status: null }));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  useEffect(() => {
    const dispose = load();
    return dispose;
  }, [load]);

  return { ...state, reload: load };
}
