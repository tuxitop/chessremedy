/**
 * Game Library filter predicates (Feature 007).
 *
 * ANDs every dimension. Equality filters run against stored normalized
 * fields (source, normalizedTimeControl, userColor); date filtering is an
 * inclusive local-time-zone window; search matches any field. The
 * Feature-010 analysis-result dimensions are evaluated over a row's
 * **insights** (persisted analysis-job status + per-analysis summary, never
 * a `MoveAnalysis` scan) with the spec's absent-vs-zero semantics
 * (specs/domain/game-library.md §2, features/010-tactical-detection.md).
 */

import type { LibraryGameRow } from './index';
import type { GameLibraryFilters } from './filters';
import { matchesSearch } from './search';
import { playedAtInWindow, type TimeWindow } from './timeframe';
import type { GameRowInsights } from './rowView';

/** Completed/outdated analysis — the statuses with a usable completed run. */
function isAnalyzed(status: GameRowInsights['analysisStatus']): boolean {
  return status === 'completed' || status === 'outdated';
}

/**
 * The Feature-010 analysis-result dimensions over a row's insights. Shared
 * by the full row predicate and the pushed-down Library query restriction
 * (analysis-result-query.ts) so both apply exactly the same semantics:
 * - `analysis`: `analyzed` ⇔ status `completed`/`outdated`; otherwise not.
 * - `hasBlunders`: requires a completed analysis whose summary carries
 *   user-side counts; `yes` = ≥ 1 blunder, `no` = zero. No completed
 *   analysis matches neither.
 * - `hasMissedTactics`: requires a completed detection pass; `yes` = ≥ 1,
 *   `no` = zero. Absent detection (or no analysis) matches neither —
 *   absent is never zero.
 */
export function matchesAnalysisResultFilters(
  insights: GameRowInsights,
  filters: Pick<GameLibraryFilters, 'analysis' | 'hasBlunders' | 'hasMissedTactics'>,
): boolean {
  const analyzed = isAnalyzed(insights.analysisStatus);
  if (filters.analysis === 'analyzed' && !analyzed) {
    return false;
  }
  if (filters.analysis === 'notAnalyzed' && analyzed) {
    return false;
  }
  if (filters.hasBlunders !== 'all') {
    const counts = insights.classificationCounts;
    const hasCounts = analyzed && counts !== undefined;
    if (filters.hasBlunders === 'yes' && !(hasCounts && counts.blunder >= 1)) {
      return false;
    }
    if (filters.hasBlunders === 'no' && !(hasCounts && counts.blunder === 0)) {
      return false;
    }
  }
  if (filters.hasMissedTactics !== 'all') {
    const detectionCompleted = insights.hasCompletedDetection === true;
    if (
      filters.hasMissedTactics === 'yes' &&
      !(detectionCompleted && (insights.missedTactics ?? 0) >= 1)
    ) {
      return false;
    }
    if (
      filters.hasMissedTactics === 'no' &&
      !(detectionCompleted && insights.missedTactics === 0)
    ) {
      return false;
    }
  }
  return true;
}

export function matchesLibraryFilters(
  row: LibraryGameRow,
  filters: GameLibraryFilters,
  window: TimeWindow,
): boolean {
  if (filters.platform !== 'all' && row.source !== filters.platform) {
    return false;
  }
  if (filters.timeControl !== 'all' && row.normalizedTimeControl !== filters.timeControl) {
    return false;
  }
  if (filters.side !== 'all' && row.userColor !== filters.side) {
    return false;
  }
  if (!playedAtInWindow(row.playedAt, window)) {
    return false;
  }
  if (!matchesSearch(row, filters.search)) {
    return false;
  }
  return matchesAnalysisResultFilters(row, filters);
}
