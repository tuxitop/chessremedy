/**
 * Feature 014 — statistics Worker entry.
 *
 * Runs the pure Feature-014 aggregation off the UI thread. This module imports
 * **only** the pure domain (`@/domain/statistics`); the wire-protocol types are
 * imported type-only and erased at build time, so the Worker bundle never
 * touches Dexie, React, repositories or any other infrastructure.
 */

import { computeStatistics } from '@/domain/statistics';
import type { StatisticsComputeRequest, StatisticsComputeResponse } from './worker-protocol';

interface WorkerMessageScope {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage: (message: unknown) => void;
}

const scope = globalThis as unknown as WorkerMessageScope;

scope.onmessage = (event: MessageEvent<unknown>): void => {
  const request = event.data as StatisticsComputeRequest;
  let response: StatisticsComputeResponse;
  try {
    response = { id: request.id, ok: true, result: computeStatistics(request.input) };
  } catch (error) {
    response = {
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  scope.postMessage(response);
};
