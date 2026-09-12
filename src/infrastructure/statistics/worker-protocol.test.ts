/**
 * Feature 014 Stage D — Worker protocol + inline fallback tests.
 *
 * Covers the structured-cloneable request/response round-trip, request
 * correlation and the inline fallback when Workers are unavailable, fail to
 * construct, or error.
 */

import { describe, expect, it } from 'vitest';
import {
  computeStatistics,
  STATISTICS_VERSION,
  type StatisticsComputeInput,
} from '@/domain/statistics';
import type { StatisticsComputeRequest, StatisticsComputeResponse } from './worker-protocol';
import { createInlineStatisticsCompute, createStatisticsCompute } from './worker-client';

const NOW = Date.parse('2026-09-15T12:00:00.000Z');

function gameInput(): StatisticsComputeInput {
  return {
    operation: 'gameMetrics',
    query: {
      platform: 'all',
      timeControl: 'all',
      side: 'all',
      result: 'all',
      dateRange: { preset: 'all' },
      now: NOW,
    },
    snapshot: { games: [], jobs: [], summaries: [] },
  };
}

function request(id: number, input: StatisticsComputeInput): StatisticsComputeRequest {
  return { id, input };
}

class FakeWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly posted: StatisticsComputeRequest[] = [];
  terminated = false;
  mode: 'ok' | 'error' = 'ok';

  postMessage(message: unknown): void {
    const req = message as StatisticsComputeRequest;
    this.posted.push(req);
    queueMicrotask(() => {
      const response: StatisticsComputeResponse =
        this.mode === 'ok'
          ? { id: req.id, ok: true, result: computeStatistics(req.input) }
          : { id: req.id, ok: false, error: 'boom' };
      this.onmessage?.({ data: response } as MessageEvent<unknown>);
    });
  }

  terminate(): void {
    this.terminated = true;
  }
}

describe('statistics compute protocol', () => {
  it('round-trips a structured-cloneable request through the pure compute', () => {
    const input = gameInput();
    const result = computeStatistics(input);
    expect(result.operation).toBe('gameMetrics');
    if (result.operation === 'gameMetrics') {
      expect(result.partitions).toEqual([]);
      expect(result.diagnostics.missingSummary).toBe(0);
      expect(result.statisticsVersion).toBe(STATISTICS_VERSION);
    }
  });

  it('correlates a Worker response by request id', async () => {
    const fake = new FakeWorker();
    const compute = createStatisticsCompute({ workerFactory: () => fake as unknown as Worker });

    const response = await compute.compute(request(7, gameInput()));

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.id).toBe(7);
      expect(response.result).toEqual(computeStatistics(gameInput()));
    }
    expect(fake.posted.map((entry) => entry.id)).toEqual([7]);
    compute.terminate?.();
    expect(fake.terminated).toBe(true);
  });

  it('falls back inline when the Worker is unavailable', async () => {
    const compute = createStatisticsCompute({ workerFactory: () => null });
    const response = await compute.compute(request(1, gameInput()));
    expect(response).toEqual({ id: 1, ok: true, result: computeStatistics(gameInput()) });
  });

  it('falls back inline when Worker construction throws', async () => {
    const compute = createStatisticsCompute({
      workerFactory: () => {
        throw new Error('no worker here');
      },
    });
    const response = await compute.compute(request(2, gameInput()));
    expect(response.ok).toBe(true);
  });

  it('surfaces a Worker error response without losing correlation', async () => {
    const fake = new FakeWorker();
    fake.mode = 'error';
    const compute = createStatisticsCompute({ workerFactory: () => fake as unknown as Worker });
    const response = await compute.compute(request(3, gameInput()));
    expect(response).toEqual({ id: 3, ok: false, error: 'boom' });
  });

  it('inline compute is the same pure aggregation', async () => {
    const response = await createInlineStatisticsCompute().compute(request(4, gameInput()));
    expect(response).toEqual({ id: 4, ok: true, result: computeStatistics(gameInput()) });
  });
});
