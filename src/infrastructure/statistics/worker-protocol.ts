/**
 * Feature 014 — statistics Worker wire protocol (infrastructure).
 *
 * The structured-cloneable request/response envelope and the `StatisticsCompute`
 * seam shared by the inline path and the off-thread Worker path. The payload
 * types themselves live in the pure domain (`@/domain/statistics`) so the
 * Worker entry never needs an infrastructure runtime import.
 */

import type { StatisticsComputeInput, StatisticsComputeResult } from '@/domain/statistics';

/** One compute request; `id` correlates the asynchronous response. */
export interface StatisticsComputeRequest {
  readonly id: number;
  readonly input: StatisticsComputeInput;
}

/** A successful or failed compute response, correlated by `id`. */
export type StatisticsComputeResponse =
  | {
      readonly id: number;
      readonly ok: true;
      readonly result: StatisticsComputeResult;
    }
  | {
      readonly id: number;
      readonly ok: false;
      readonly error: string;
    };

/**
 * The off-thread compute seam. The inline path and the Worker client both
 * satisfy it, so the application service is agnostic to where the pure
 * aggregation runs.
 */
export interface StatisticsCompute {
  compute(request: StatisticsComputeRequest): Promise<StatisticsComputeResponse>;
  /** Release the underlying Worker (no-op for the inline implementation). */
  terminate?(): void;
}
