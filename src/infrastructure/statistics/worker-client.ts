/**
 * Feature 014 — statistics Worker client (infrastructure).
 *
 * Lazily creates the module Worker (`new Worker(new URL(...), { type: 'module' })`),
 * correlates requests/responses by id, and falls back to the pure inline
 * aggregation when Workers are unavailable or construction fails. The inline
 * path calls the same `computeStatistics` the Worker runs, so results are
 * identical regardless of transport.
 */

import { computeStatistics } from '@/domain/statistics';
import type {
  StatisticsCompute,
  StatisticsComputeRequest,
  StatisticsComputeResponse,
} from './worker-protocol';

export interface StatisticsWorkerClientOptions {
  /** Test seam: build the Worker (return `null` to force the inline path). */
  readonly workerFactory?: () => Worker | null;
}

/** The pure inline implementation (no Worker; used as the fallback). */
export function createInlineStatisticsCompute(): StatisticsCompute {
  return {
    compute: (request: StatisticsComputeRequest): Promise<StatisticsComputeResponse> => {
      try {
        return Promise.resolve({
          id: request.id,
          ok: true,
          result: computeStatistics(request.input),
        });
      } catch (error) {
        return Promise.resolve({
          id: request.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}

/**
 * A `StatisticsCompute` backed by a lazily-created module Worker, with an
 * automatic inline fallback. The service decides *when* to use it (row
 * threshold); this client decides *how* (Worker vs inline).
 */
export function createStatisticsCompute(
  options: StatisticsWorkerClientOptions = {},
): StatisticsCompute {
  const inline = createInlineStatisticsCompute();
  let worker: Worker | null = null;
  let workerUnavailable = false;
  const pending = new Map<number, (response: StatisticsComputeResponse) => void>();

  const ensureWorker = (): Worker | null => {
    if (worker !== null) {
      return worker;
    }
    if (workerUnavailable) {
      return null;
    }
    try {
      const created = options.workerFactory ? options.workerFactory() : createModuleWorker();
      if (created === null) {
        workerUnavailable = true;
        return null;
      }
      created.onmessage = (event: MessageEvent<unknown>) => {
        const response = event.data as StatisticsComputeResponse;
        const resolve = pending.get(response.id);
        if (resolve !== undefined) {
          pending.delete(response.id);
          resolve(response);
        }
      };
      created.onerror = () => {
        workerUnavailable = true;
        worker?.terminate();
        worker = null;
        for (const [id, resolve] of pending) {
          pending.delete(id);
          resolve({ id, ok: false, error: 'statistics worker error' });
        }
      };
      worker = created;
      return worker;
    } catch {
      workerUnavailable = true;
      return null;
    }
  };

  return {
    compute(request: StatisticsComputeRequest): Promise<StatisticsComputeResponse> {
      const active = ensureWorker();
      if (active === null) {
        return inline.compute(request);
      }
      return new Promise<StatisticsComputeResponse>((resolve) => {
        pending.set(request.id, resolve);
        try {
          active.postMessage(request);
        } catch {
          pending.delete(request.id);
          void inline.compute(request).then(resolve);
        }
      });
    },

    terminate(): void {
      worker?.terminate();
      worker = null;
      workerUnavailable = true;
      for (const [id, resolve] of pending) {
        resolve({ id, ok: false, error: 'statistics worker terminated' });
      }
      pending.clear();
    },
  };
}

function createModuleWorker(): Worker | null {
  if (typeof Worker === 'undefined') {
    return null;
  }
  return new Worker(new URL('./statistics-worker.ts', import.meta.url), { type: 'module' });
}
