import { useCallback, useEffect, useState } from 'react';
import { gamesRepository } from '@/infrastructure/db/games-repository';
import { analysesRepository } from '@/infrastructure/db/analysis-repository';
import { analysisJobsRepository } from '@/infrastructure/db/analysis-jobs-repository';
import type { Game } from '@/domain/chess/game';
import type { MoveAnalysis } from '@/domain/chess';
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
  });

  const load = useCallback(() => {
    let cancelled = false;
    void (async () => {
      const game = await gamesRepository.getGame(gameId);
      const jobs = game ? await analysisJobsRepository.listByGame(gameId) : [];
      const status = analysisStatusOf(jobs);
      const completed = latestCompletedJob(jobs);
      let records: readonly MoveAnalysis[] = [];
      if (game && completed) {
        records = await analysesRepository.listForGameAndAnalysis(gameId, completed.id);
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
