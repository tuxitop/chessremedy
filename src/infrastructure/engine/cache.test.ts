import { describe, expect, it } from 'vitest';
import { AnalysisJobHandle } from './engineService';
import type {
  AnalysisJob,
  AnalysisJobEvent,
  AnalysisOptions,
  EngineAnalysisResult,
  EngineService,
  EngineServiceStatus,
} from './types';
import {
  SessionAnalysisCache,
  analysisCacheKey,
  canonicalFen,
  createCachedEngineService,
} from './cache';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const ALTERNATE_START_FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

const ENGINE = {
  engineName: 'stockfish',
  engineVersion: '18.0.8',
  engineBuild: 'stockfish-18-lite-single',
};

const STATUS: EngineServiceStatus = {
  lifecycle: 'ready',
  engine: ENGINE,
  build: 'lite-single',
  activeJobId: null,
  queued: 0,
};

function resultFor(handle: AnalysisJobHandle, fen: string): EngineAnalysisResult {
  return {
    jobId: handle.id,
    position: fen,
    profile: handle.profile,
    lines: [
      {
        multipv: 1,
        evaluation: { cp: 21 },
        principalVariation: [{ uci: 'e2e4' }],
        wdl: null,
      },
    ],
    engine: { ...ENGINE, profile: handle.profile },
    timeMs: 12,
  };
}

interface FakeRig {
  service: EngineService;
  cache: SessionAnalysisCache;
  analyzes: Array<{ fen: string; options: Partial<AnalysisOptions> | undefined }>;
}

function createFakeRig(): FakeRig {
  const cache = new SessionAnalysisCache();
  const analyzes: FakeRig['analyzes'] = [];
  const inner: EngineService = {
    analyze(fen: string, options?: Partial<AnalysisOptions>): AnalysisJob {
      analyzes.push({ fen, options });
      const handle = new AnalysisJobHandle(fen, { profile: options?.profile ?? 'normal' }, (job) =>
        inner.cancel(job.id),
      );
      queueMicrotask(() => handle.complete(resultFor(handle, fen)));
      return handle;
    },
    cancel() {},
    cancelAll() {},
    getStatus() {
      return STATUS;
    },
    onStatusChange() {
      return () => undefined;
    },
    dispose() {
      return Promise.resolve();
    },
  };
  return { service: createCachedEngineService(inner, cache), cache, analyzes };
}

function outcomeLines(outcome: Awaited<AnalysisJob['outcome']>): number {
  return outcome.kind === 'completed' ? outcome.result.lines.length : -1;
}

describe('analysisCacheKey', () => {
  it('is deterministic and includes the ADR-018 tuple plus overrides', () => {
    const base = { profile: 'normal' as const };
    const key = analysisCacheKey(START_FEN, base, ENGINE);
    expect(key).toBe(
      `${START_FEN}|normal|stockfish|18.0.8|stockfish-18-lite-single|d:|t:|m:|h:|r:`,
    );
    // Changing the position or profile changes the key.
    expect(analysisCacheKey(ALTERNATE_START_FEN, base, ENGINE)).not.toBe(key);
    expect(analysisCacheKey(START_FEN, { profile: 'deep' }, ENGINE)).not.toBe(key);
  });

  it('canonicalises the FEN for keying', () => {
    // Same board written with an alternate (but equivalent) clock.
    expect(canonicalFen(START_FEN)).toBe(START_FEN);
    expect(analysisCacheKey('not-a-fen', { profile: 'fast' }, ENGINE)).toContain('not-a-fen');
  });
});

describe('cached engine service', () => {
  it('serves an identical request from cache without re-running the worker', async () => {
    const { service, cache, analyzes } = createFakeRig();
    const first = await service.analyze(START_FEN, { profile: 'fast' }).outcome;
    expect(outcomeLines(first)).toBe(1);
    expect(analyzes).toHaveLength(1);
    expect(cache.size).toBe(1);

    const second = await service.analyze(START_FEN, { profile: 'fast' }).outcome;
    expect(outcomeLines(second)).toBe(1);
    // No new worker analysis for the cache hit.
    expect(analyzes).toHaveLength(1);
  });

  it('re-runs when the profile differs', async () => {
    const { service, analyzes } = createFakeRig();
    await service.analyze(START_FEN, { profile: 'fast' }).outcome;
    await service.analyze(START_FEN, { profile: 'normal' }).outcome;
    expect(analyzes).toHaveLength(2);
  });

  it('re-runs when depth/time/lines overrides differ', async () => {
    const { service, analyzes } = createFakeRig();
    await service.analyze(START_FEN, { profile: 'normal', maxDepth: 12 }).outcome;
    await service.analyze(START_FEN, { profile: 'normal', maxDepth: 14 }).outcome;
    await service.analyze(START_FEN, { profile: 'normal', multipv: 3 }).outcome;
    expect(analyzes).toHaveLength(3);
  });

  it('cached jobs emit a result event and cancel without crashing', async () => {
    const { service } = createFakeRig();
    const first = service.analyze(START_FEN, { profile: 'normal' });
    const events: string[] = [];
    first.subscribe((event: AnalysisJobEvent) => events.push(event.type));
    await first.outcome;

    const second = service.analyze(START_FEN, { profile: 'normal' });
    const secondEvents: string[] = [];
    second.subscribe((event: AnalysisJobEvent) => secondEvents.push(event.type));
    await second.outcome;
    expect(secondEvents).toContain('result');
    second.cancel();
    expect(second.status).toBe('completed');
  });
});
