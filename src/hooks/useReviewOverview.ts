/**
 * Feature 020 — review overview hook.
 *
 * Runs a bounded `ReviewService.reconcile` loop (lazy, resumable rebuild of the
 * derived projection) and then reads the review overview for the entry card and
 * session setup. Non-blocking: a partial rebuild leaves puzzles pending rather
 * than showing a wrong due date.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ReviewService, tsFsrsScheduler } from '@/infrastructure/review';
import { trainingCyclesRepository } from '@/infrastructure/db/training-cycles-repository';
import { trainingSetsRepository } from '@/infrastructure/db/training-sets-repository';
import { puzzlesRepository } from '@/infrastructure/db/puzzles-repository';
import { attemptsRepository } from '@/infrastructure/db/attempts-repository';
import { reviewSchedulesRepository } from '@/infrastructure/db/review-schedules-repository';
import { settingsRepository } from '@/infrastructure/db/settings-repository';
import { SCHEDULE_REBUILD_BATCH, type ReviewOverview } from '@/domain/review';

/** Bounded reconcile passes per load (a resumable, non-blocking rebuild). */
const MAX_RECONCILE_PASSES = 20;

export interface UseReviewOverviewOptions {
  /** Injectable for tests; defaults to the singleton-backed service. */
  readonly service?: ReviewService;
  /** Injectable clock for deterministic tests. */
  readonly now?: () => number;
}

export interface UseReviewOverviewResult {
  readonly overview: ReviewOverview | null;
  readonly loading: boolean;
  readonly error: string | null;
  /** The injected clock (for callers that format a relative due time). */
  readonly now: () => number;
  reload(): void;
}

/** Load the review overview, reconciling the projection first. */
export function useReviewOverview(options: UseReviewOverviewOptions = {}): UseReviewOverviewResult {
  const now = useMemo(() => options.now ?? (() => Date.now()), [options.now]);
  const service = useMemo(
    () =>
      options.service ??
      new ReviewService({
        cycles: trainingCyclesRepository,
        sets: trainingSetsRepository,
        puzzles: puzzlesRepository,
        attempts: attemptsRepository,
        schedules: reviewSchedulesRepository,
        settings: settingsRepository,
        scheduler: tsFsrsScheduler,
        now,
      }),
    [options.service, now],
  );

  const [overview, setOverview] = useState<ReviewOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        for (let pass = 0; pass < MAX_RECONCILE_PASSES; pass += 1) {
          const result = await service.reconcile({ batchSize: SCHEDULE_REBUILD_BATCH });
          if (result.done) {
            break;
          }
        }
        const next = await service.overview(now());
        if (!cancelled) {
          setOverview(next);
          setError(null);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError('Could not load your review queue.');
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [service, now, tick]);

  const reload = useCallback((): void => {
    setLoading(true);
    setTick((value) => value + 1);
  }, []);

  return { overview, loading, error, now, reload };
}
