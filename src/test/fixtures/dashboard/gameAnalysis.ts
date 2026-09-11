/**
 * Feature 015 — component-test helper: build the `DashboardGameAnalysis` shape
 * the game section consumes directly from a deterministic scenario. No hook,
 * engine, network or IndexedDB.
 */

import type { StatisticsResult } from '@/infrastructure/statistics';
import { DASHBOARD_TREND_METRICS } from '@/hooks/useDashboard';
import type {
  DashboardGameAnalysis,
  DashboardSlice,
  DashboardTrendComputation,
  DashboardTrendMetric,
} from '@/hooks/useDashboard';
import { richDashboardScenario, type DashboardScenario } from './scenarios';

/** Convert one Feature-014 typed result into a settled dashboard slice. */
export function okSlice<T>(result: StatisticsResult<T>): DashboardSlice<T> {
  return result.ok
    ? { data: result.result, loading: false, error: null }
    : { data: null, loading: false, error: result.message ?? 'Could not load statistics.' };
}

/** Build a settled `DashboardGameAnalysis` from a scenario's fake results. */
export function gameAnalysisFromScenario(
  scenario: DashboardScenario = richDashboardScenario(),
): DashboardGameAnalysis {
  const data = scenario.data;
  const trends = {} as Record<DashboardTrendMetric, DashboardSlice<DashboardTrendComputation>>;
  for (const metric of DASHBOARD_TREND_METRICS) {
    trends[metric] = okSlice(data.trends[metric]);
  }
  return {
    metrics: okSlice(data.gameMetrics),
    ratings: okSlice(data.ratings),
    phases: okSlice(data.phases),
    trends,
  };
}
