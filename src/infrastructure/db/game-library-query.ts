import type { GameLibraryFilters } from '@/domain/gameLibrary/filters';
import type { TimeWindow } from '@/domain/gameLibrary/timeframe';
import { toExclusiveQueryInstants } from '@/domain/gameLibrary/timeframe';
import type { GameQuery } from './games-repository';

export function gameLibraryQueryFor(
  filters: GameLibraryFilters,
  window: TimeWindow,
): GameQuery | undefined {
  const query: GameQuery = {
    ...(filters.platform !== 'all' ? { source: filters.platform } : {}),
    ...(filters.timeControl !== 'all' ? { normalizedTimeControl: filters.timeControl } : {}),
    ...(filters.side !== 'all' ? { userColor: filters.side } : {}),
    ...toExclusiveQueryInstants(window),
  };
  return Object.keys(query).length === 0 ? undefined : query;
}
