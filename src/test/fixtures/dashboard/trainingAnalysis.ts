/**
 * Feature 015 — component-test helper: build the `DashboardTrainingAnalysis`
 * shape the training section consumes directly from a deterministic scenario.
 * No hook, engine, network or IndexedDB.
 */

import type { DashboardSlice, DashboardTrainingAnalysis } from '@/hooks/useDashboard';
import type { TacticalTrainingSetRow } from '@/domain/training';
import { richDashboardScenario, type DashboardScenario } from './scenarios';

function sliceOf<T>(value: T | undefined): DashboardSlice<T> {
  return value === undefined
    ? { data: null, loading: false, error: null }
    : { data: value, loading: false, error: null };
}

/** Build a settled `DashboardTrainingAnalysis` from a scenario's fake results. */
export function trainingAnalysisFromScenario(
  scenario: DashboardScenario = richDashboardScenario(),
  selectedSetId?: string,
): DashboardTrainingAnalysis {
  const allSets: readonly TacticalTrainingSetRow[] = [
    ...(scenario.openBlock === undefined ? [] : [scenario.openBlock]),
    ...scenario.activeSets,
    ...scenario.archivedSets,
  ];
  const selected =
    selectedSetId ??
    scenario.openBlock?.id ??
    scenario.activeSets[0]?.id ??
    scenario.archivedSets[0]?.id ??
    null;
  const entry = selected === null ? undefined : scenario.data.training[selected];
  return {
    sets: scenario.activeSets,
    archivedSets: scenario.archivedSets,
    openBlock: scenario.openBlock ?? null,
    selectedSetId: selected,
    selectedSet: allSets.find((set) => set.id === selected) ?? null,
    stats: sliceOf(entry?.stats),
    categories: sliceOf(entry?.categories),
    failed: sliceOf(entry?.failed),
  };
}
