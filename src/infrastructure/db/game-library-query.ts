import type { GameLibraryFilters } from '@/domain/gameLibrary/filters';
import type { TimeWindow } from '@/domain/gameLibrary/timeframe';
import { toExclusiveQueryInstants } from '@/domain/gameLibrary/timeframe';
import type { GameId } from '@/domain/chess/game';
import type { GameQuery } from './games-repository';

/**
 * Push the Library filters down into a `GameQuery`. The Feature-010
 * analysis-result dimensions are resolved by the caller into the set of
 * game ids matching their outcome (from persisted analysis jobs +
 * per-analysis summaries — never a `MoveAnalysis` scan) and passed as
 * `analysisResultIds`; `null`/`undefined` means no id restriction. The
 * returned query stays `undefined` when nothing restricts (unchanged).
 */
export function gameLibraryQueryFor(
  filters: GameLibraryFilters,
  window: TimeWindow,
  analysisResultIds?: ReadonlySet<GameId> | null,
): GameQuery | undefined {
  const query: GameQuery = {
    ...(filters.platform !== 'all' ? { source: filters.platform } : {}),
    ...(filters.timeControl !== 'all' ? { normalizedTimeControl: filters.timeControl } : {}),
    ...(filters.side !== 'all' ? { userColor: filters.side } : {}),
    ...(analysisResultIds !== undefined && analysisResultIds !== null
      ? { ids: [...analysisResultIds] }
      : {}),
    ...toExclusiveQueryInstants(window),
  };
  return Object.keys(query).length === 0 ? undefined : query;
}
