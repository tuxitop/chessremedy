import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VERIFICATION_ENGINE_IDLE_MS, createLazyEngineService } from './lazyEngineService';
import type { AnalysisJob, AnalysisJobOutcome, EngineService, EngineServiceStatus } from './types';

const FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function readyStatus(overrides: Partial<EngineServiceStatus> = {}): EngineServiceStatus {
  return {
    lifecycle: 'ready',
    engine: {
      engineName: 'stockfish',
      engineVersion: '18.0.8',
      engineBuild: 'stockfish-18-lite-single',
    },
    build: 'lite-single',
    activeJobId: null,
    queued: 0,
    ...overrides,
  };
}

class FakeInnerEngine implements EngineService {
  status: EngineServiceStatus = readyStatus();
  disposeCount = 0;
  analyzeCount = 0;
  readonly cancelled: string[] = [];
  cancelAllCount = 0;

  private readonly listeners = new Set<(status: EngineServiceStatus) => void>();

  analyze(): AnalysisJob {
    this.analyzeCount += 1;
    const outcome = Promise.resolve<AnalysisJobOutcome>({ kind: 'cancelled' });
    return {
      id: `fake-${this.analyzeCount}`,
      fen: FEN,
      profile: 'tactical',
      status: 'queued',
      subscribe: () => () => {},
      outcome,
      cancel: () => {},
    };
  }

  cancel(jobId: string): void {
    this.cancelled.push(jobId);
  }

  cancelAll(): void {
    this.cancelAllCount += 1;
  }

  getStatus(): EngineServiceStatus {
    return this.status;
  }

  onStatusChange(listener: (status: EngineServiceStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async dispose(): Promise<void> {
    this.disposeCount += 1;
  }

  setStatus(next: EngineServiceStatus): void {
    this.status = next;
    for (const listener of this.listeners) listener(next);
  }
}

describe('lazy verification engine (ADR-034)', () => {
  let inners: FakeInnerEngine[];
  let createCount: number;

  function build(options?: { idleMs?: number }): EngineService {
    return createLazyEngineService({
      create: () => {
        createCount += 1;
        const inner = new FakeInnerEngine();
        inners.push(inner);
        return inner;
      },
      ...(options?.idleMs !== undefined ? { idleMs: options.idleMs } : {}),
    });
  }

  beforeEach(() => {
    inners = [];
    createCount = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not create the inner engine before the first analyze', () => {
    const service = build();
    expect(createCount).toBe(0);
    expect(service.getStatus().lifecycle).toBe('uninitialized');
  });

  it('creates the inner engine once and reuses it', () => {
    const service = build();
    service.analyze(FEN, { profile: 'tactical' });
    service.analyze(FEN, { profile: 'tactical' });
    expect(createCount).toBe(1);
    expect(inners[0]!.analyzeCount).toBe(2);
  });

  it('disposes the inner engine after the idle window and recreates it on demand', async () => {
    const service = build();
    service.analyze(FEN, { profile: 'tactical' });
    expect(inners).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(VERIFICATION_ENGINE_IDLE_MS - 1);
    expect(inners[0]!.disposeCount).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(inners[0]!.disposeCount).toBe(1);
    expect(service.getStatus().lifecycle).toBe('uninitialized');

    service.analyze(FEN, { profile: 'tactical' });
    expect(createCount).toBe(2);
    expect(inners).toHaveLength(2);
  });

  it('does not dispose while a job is active or queued, and resets on activity', async () => {
    const service = build();
    service.analyze(FEN, { profile: 'tactical' });
    const inner = inners[0]!;

    inner.setStatus(readyStatus({ activeJobId: 'job-1', queued: 0 }));
    await vi.advanceTimersByTimeAsync(VERIFICATION_ENGINE_IDLE_MS * 2);
    expect(inner.disposeCount).toBe(0);

    inner.setStatus(readyStatus({ activeJobId: null, queued: 1 }));
    await vi.advanceTimersByTimeAsync(VERIFICATION_ENGINE_IDLE_MS * 2);
    expect(inner.disposeCount).toBe(0);

    inner.setStatus(readyStatus());
    await vi.advanceTimersByTimeAsync(VERIFICATION_ENGINE_IDLE_MS);
    expect(inner.disposeCount).toBe(1);
  });

  it('buffers status listeners registered before the inner exists', () => {
    const service = build();
    const seen: EngineServiceStatus[] = [];
    service.onStatusChange((status) => seen.push(status));
    service.analyze(FEN, { profile: 'tactical' });
    inners[0]!.setStatus(readyStatus({ activeJobId: 'job-1' }));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.activeJobId).toBe('job-1');
  });

  it('delegates cancel and cancelAll to the inner engine', () => {
    const service = build();
    service.analyze(FEN, { profile: 'tactical' });
    service.cancel('job-1');
    service.cancelAll();
    expect(inners[0]!.cancelled).toEqual(['job-1']);
    expect(inners[0]!.cancelAllCount).toBe(1);
  });

  it('explicit dispose tears down the inner engine permanently', async () => {
    const service = build();
    service.analyze(FEN, { profile: 'tactical' });
    const inner = inners[0]!;
    await service.dispose();
    expect(inner.disposeCount).toBe(1);
    expect(service.getStatus().lifecycle).toBe('disposed');

    const job = service.analyze(FEN, { profile: 'tactical' });
    const outcome = await job.outcome;
    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') expect(outcome.error.reason).toBe('disposed');
    expect(createCount).toBe(1);
  });
});
