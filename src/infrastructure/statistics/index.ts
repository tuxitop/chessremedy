/**
 * Feature 014 — statistics infrastructure (application service + Worker).
 * Barrel.
 */

export { StatisticsService, STATISTICS_WORKER_ROW_THRESHOLD } from './statistics-service';
export type {
  GameMetricsReport,
  PhaseMetricsReport,
  StatisticsFailureReason,
  StatisticsReadOptions,
  StatisticsResult,
  StatisticsServiceDiagnostics,
  StatisticsServiceOptions,
  StatisticsServiceQuery,
  StatisticsTrendOptions,
} from './statistics-service';
export { createInlineStatisticsCompute, createStatisticsCompute } from './worker-client';
export type { StatisticsWorkerClientOptions } from './worker-client';
export type {
  StatisticsCompute,
  StatisticsComputeRequest,
  StatisticsComputeResponse,
} from './worker-protocol';
export { getBrowserStatisticsService } from './browser';
