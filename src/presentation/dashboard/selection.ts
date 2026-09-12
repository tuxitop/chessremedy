/**
 * Feature 015 — dashboard selection helpers (pure, no React).
 *
 * Deterministic selection of the default training set (open block, else the
 * most recently active set), the concrete partition options for the partition
 * selector, and the presentation-only "weakest phase" label. No scheduling or
 * statistics logic lives here.
 */

import type { GamePhase } from '@/domain/chess/analysis';
import type { TacticalTrainingSetRow } from '@/domain/training/cycleTypes';
import type {
  PhaseMetricCounts,
  PhaseMetrics,
  PlatformDimension,
  TimeControlDimension,
} from '@/domain/statistics';
import { partitionLabel } from './labels';

/** Recency order: greatest `updatedAt`, then `createdAt`, then id ascending. */
function compareByRecency(a: TacticalTrainingSetRow, b: TacticalTrainingSetRow): number {
  return b.updatedAt - a.updatedAt || b.createdAt - a.createdAt || compareText(a.id, b.id);
}

/**
 * Default training set: the open Woodpecker block first, else the most
 * recently active set, else the most recently updated archived set, else
 * `null`. Deterministic (A5).
 */
export function selectDefaultTrainingSet(
  active: readonly TacticalTrainingSetRow[],
  archived: readonly TacticalTrainingSetRow[],
  openBlock: TacticalTrainingSetRow | undefined,
): TacticalTrainingSetRow | null {
  if (openBlock !== undefined) {
    return openBlock;
  }
  const activeSorted = [...active].sort(compareByRecency);
  if (activeSorted.length > 0) {
    return activeSorted[0] ?? null;
  }
  const archivedSorted = [...archived].sort(compareByRecency);
  return archivedSorted[0] ?? null;
}

/** Stable selector value of one concrete partition. */
export function partitionKey(
  platform: PlatformDimension,
  timeControl: TimeControlDimension,
): string {
  return `${platform}:${timeControl}`;
}

/** The minimal partition shape the selector reads (Feature-014 result compatible). */
export interface PartitionLike {
  readonly platform: PlatformDimension;
  readonly timeControl: TimeControlDimension;
  readonly combined: boolean;
}

/** One partition-selector option. */
export interface PartitionOption {
  readonly value: string;
  readonly platform: PlatformDimension;
  readonly timeControl: TimeControlDimension;
  readonly combined: boolean;
  readonly label: string;
}

/**
 * A concrete partition candidate for default selection: the selector shape plus
 * the canonical Feature-014 game count (`metrics.games.total`). The count is
 * read, never recomputed.
 */
export interface PartitionCandidate extends PartitionLike {
  readonly gameCount: number;
}

/** Canonical platform order: Lichess, Chess.com, then other real sources. */
const PLATFORM_RANK: Readonly<Record<PlatformDimension, number>> = {
  lichess: 0,
  chesscom: 1,
  local: 2,
  fixture: 3,
  all: 4,
};

/** ADR-013 time-control category order. */
const TIME_CONTROL_RANK: Readonly<Record<TimeControlDimension, number>> = {
  bullet: 0,
  blitz: 1,
  rapid: 2,
  classical: 3,
  correspondence: 4,
  unknown: 5,
  all: 6,
};

/**
 * Build the concrete partition options for the selector. Every Feature-014
 * partition is preserved as its own option (no merge); the caller prepends the
 * explicit all-partitions choice.
 */
export function partitionOptions(partitions: readonly PartitionLike[]): readonly PartitionOption[] {
  return partitions.map((partition) => ({
    value: partitionKey(partition.platform, partition.timeControl),
    platform: partition.platform,
    timeControl: partition.timeControl,
    combined: partition.combined,
    label: partitionLabel(partition.platform, partition.timeControl),
  }));
}

/**
 * The default selector value (Feature 017 §8): the concrete partition with the
 * most games, or `all` when none qualifies.
 *
 * Only `combined === false` partitions whose platform is not `fixture` are
 * considered. Ties break by canonical platform order (Lichess, Chess.com, then
 * other real sources), then ADR-013 time-control order, then partition key
 * ascending. Deterministic; computes no statistic (the count is read from the
 * loaded Feature-014 result).
 */
export function selectDefaultPartition(partitions: readonly PartitionCandidate[]): string {
  const candidates = partitions.filter(
    (partition) => !partition.combined && partition.platform !== 'fixture',
  );
  if (candidates.length === 0) {
    return 'all';
  }
  const sorted = [...candidates].sort((a, b) => {
    if (b.gameCount !== a.gameCount) {
      return b.gameCount - a.gameCount;
    }
    const platform = PLATFORM_RANK[a.platform] - PLATFORM_RANK[b.platform];
    if (platform !== 0) {
      return platform;
    }
    const timeControl = TIME_CONTROL_RANK[a.timeControl] - TIME_CONTROL_RANK[b.timeControl];
    if (timeControl !== 0) {
      return timeControl;
    }
    return compareText(
      partitionKey(a.platform, a.timeControl),
      partitionKey(b.platform, b.timeControl),
    );
  });
  const winner = sorted[0]!;
  return partitionKey(winner.platform, winner.timeControl);
}

/** Which phase-metric field the weakest-phase label reads. */
export type PhaseMetricField = 'counts' | 'errorsPer100Moves';

const PHASE_ERROR_KEYS: readonly (keyof PhaseMetricCounts)[] = [
  'inaccuracies',
  'mistakes',
  'blunders',
  'missedTactics',
];

/**
 * Presentation-only weakest-phase label.
 *
 * "Highest normalized rate" is undefined across four error classes, so the
 * displayed rates are summed per phase and the maximum is labeled. Phases with
 * no available value are skipped; ties keep the canonical phase order. This is
 * a label, never a computed statistic.
 */
export function weakestPhase(
  phases: readonly PhaseMetrics[],
  field: PhaseMetricField = 'errorsPer100Moves',
): GamePhase | null {
  let bestPhase: GamePhase | null = null;
  let bestTotal = Number.NEGATIVE_INFINITY;
  for (const phase of phases) {
    const metrics = phase[field];
    let total = 0;
    let hasValue = false;
    for (const key of PHASE_ERROR_KEYS) {
      const value = metrics[key].value;
      if (value !== null) {
        total += value;
        hasValue = true;
      }
    }
    if (!hasValue) {
      continue;
    }
    if (total > bestTotal) {
      bestTotal = total;
      bestPhase = phase.phase;
    }
  }
  return bestPhase;
}

function compareText(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}
