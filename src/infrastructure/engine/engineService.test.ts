import { describe, expect, it } from 'vitest';
import { createEngineService } from './engineService';
import {
  createFakeEngineFactory,
  type FakeEngineTransport,
} from './test-support/fakeEngineTransport';
import type { EngineAssets } from './engineBuild';
import type { EngineCapabilities } from './capabilities';
import type { EngineServiceOptions } from './engineService';
import type { EngineService } from './types';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const CHECKMATE_FEN = '8/8/8/8/8/k7/1q6/K7 w - - 0 1';

const ASSETS: EngineAssets = {
  engineName: 'stockfish',
  engineRelease: '18',
  npmVersion: '18.0.8',
  builds: [
    { id: 'lite-single', js: 'stockfish-18-lite-single.js', wasm: 'stockfish-18-lite-single.wasm' },
    { id: 'lite', js: 'stockfish-18-lite.js', wasm: 'stockfish-18-lite.wasm' },
  ],
};

const CAPS: EngineCapabilities = {
  sharedArrayBuffer: false,
  crossOriginIsolated: false,
  hardwareConcurrency: 4,
  isMobile: false,
  build: 'lite-single',
  threads: 1,
  hashCapMb: 256,
};

interface Harness {
  service: EngineService;
  transports: FakeEngineTransport[];
  dispose(): Promise<void>;
}

function createService(options?: {
  configureTransport?: (transport: FakeEngineTransport) => void;
  serviceOverrides?: Partial<EngineServiceOptions>;
}): Harness {
  const rig = createFakeEngineFactory(options?.configureTransport);
  const service = createEngineService({
    transportFactory: rig.factory,
    capabilities: CAPS,
    assets: ASSETS,
    ...options?.serviceOverrides,
  });
  return {
    service,
    transports: rig.transports,
    dispose: () => service.dispose(),
  };
}

/** Wait until the job is running and its worker has received a `go`. */
async function waitForGo(
  harness: Harness,
  jobId: string,
  transportIndex = 0,
  minGo = 1,
): Promise<FakeEngineTransport> {
  await until(() => harness.service.getStatus().activeJobId === jobId, 'job starts');
  await until(() => {
    const sent = harness.transports[transportIndex]?.sent ?? [];
    return sent.filter((c) => c.startsWith('go ')).length >= minGo;
  }, `worker ${transportIndex} receives go #${minGo}`);
  return harness.transports[transportIndex]!;
}

async function until(predicate: () => boolean, message: string): Promise<void> {
  for (let i = 0; i < 2000; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`until() timed out: ${message}`);
}

function completeSearch(transport: FakeEngineTransport): void {
  transport.emit('info depth 3 score cp 21 pv e2e4 e7e5');
  transport.emit('bestmove e2e4 ponder e7e5');
}

/** Simulate the engine answering a `stop` with its current best move. */
function answerStop(transport: FakeEngineTransport): void {
  transport.emit('bestmove e2e4 ponder e7e5');
}

describe('engine service — request validation', () => {
  it('rejects an invalid FEN before any Worker traffic', async () => {
    const { service, transports, dispose } = createService();
    const job = service.analyze('not-a-fen', { profile: 'fast' });
    const outcome = await job.outcome;
    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') expect(outcome.error.reason).toBe('invalid-position');
    expect(job.status).toBe('failed');
    expect(transports.length).toBe(0);
    await dispose();
  });

  it('rejects terminal positions with no legal moves', async () => {
    const { service, transports, dispose } = createService();
    const job = service.analyze(CHECKMATE_FEN, { profile: 'normal' });
    const outcome = await job.outcome;
    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') expect(outcome.error.reason).toBe('invalid-position');
    expect(transports.length).toBe(0);
    await dispose();
  });
});

describe('engine service — successful analysis', () => {
  it('analyzes a valid FEN and delivers a complete, typed result', async () => {
    const { service, transports, dispose } = createService();
    const job = service.analyze(START_FEN, { profile: 'fast' });
    const outcome = await job.outcome;
    expect(outcome.kind).toBe('completed');
    if (outcome.kind !== 'completed') return;
    const result = outcome.result;
    expect(result.jobId).toBe(job.id);
    expect(result.position).toBe(START_FEN);
    expect(result.profile).toBe('fast');
    expect(result.lines.length).toBeGreaterThan(0);
    expect(result.lines[0]!.multipv).toBe(1);
    expect(result.lines[0]!.evaluation).toEqual({ cp: 21 });
    expect(result.lines[0]!.principalVariation.map((m) => m.uci)).toEqual(['e2e4', 'e7e5']);
    expect(result.lines[0]!.wdl).toBeNull();
    expect(result.engine).toEqual({
      engineName: 'stockfish',
      engineVersion: '18.0.8',
      engineBuild: 'stockfish-18-lite-single',
      profile: 'fast',
    });
    expect(job.status).toBe('completed');
    expect(service.getStatus().lifecycle).toBe('ready');

    const transport = transports[0]!;
    expect(transport.sent).toContain('setoption name Hash value 16');
    expect(transport.sent).toContain('setoption name MultiPV value 1');
    expect(transport.sent).toContain('setoption name UCI_ShowWDL value false');
    expect(transport.sent.some((c) => c.startsWith('position fen '))).toBe(true);
    expect(transport.sent).toContain('go depth 10');
    await dispose();
  });

  it('honours a maxDepth override', async () => {
    const { service, transports, dispose } = createService();
    await service.analyze(START_FEN, { profile: 'deep', maxDepth: 4 }).outcome;
    expect(transports[0]!.sent).toContain('go depth 4');
    await dispose();
  });

  it('combines depth and movetime when both are set (whichever-first)', async () => {
    const { service, transports, dispose } = createService();
    await service.analyze(START_FEN, { profile: 'normal', maxDepth: 12, movetimeMs: 5_000 })
      .outcome;
    expect(transports[0]!.sent).toContain('go depth 12 movetime 5000');
    await dispose();
  });

  it('replaces the profile MultiPV with a per-job override', async () => {
    const { service, transports, dispose } = createService();
    await service.analyze(START_FEN, { profile: 'normal', multipv: 3 }).outcome;
    const sent = transports[0]!.sent;
    expect(sent).toContain('setoption name MultiPV value 3');
    expect(sent).not.toContain('setoption name MultiPV value 1');
    await dispose();
  });

  it('clamps a requested MultiPV into 1..5', async () => {
    const { service, transports, dispose } = createService();
    await service.analyze(START_FEN, { profile: 'fast', multipv: 9 }).outcome;
    await service.analyze(START_FEN, { profile: 'fast', multipv: -3 }).outcome;
    const sent = transports[0]!.sent;
    expect(sent).toContain('setoption name MultiPV value 5');
    expect(sent).toContain('setoption name MultiPV value 1');
    await dispose();
  });

  it('overrides hash within the capability cap', async () => {
    const { service, transports, dispose } = createService();
    await service.analyze(START_FEN, { profile: 'deep', hashMb: 128 }).outcome;
    expect(transports[0]!.sent).toContain('setoption name Hash value 128');
    await dispose();
  });

  it('overrides threads only on the multi-threaded build', async () => {
    const { service, transports, dispose } = createService();
    await service.analyze(START_FEN, { profile: 'normal', threads: 2 }).outcome;
    expect(transports[0]!.sent).not.toContain('setoption name Threads');
    await dispose();
  });

  it('applies a threads override on the multi-threaded build', async () => {
    const liteCaps: EngineCapabilities = { ...CAPS, build: 'lite', threads: 2 };
    const rig = createFakeEngineFactory();
    const service = createEngineService({
      transportFactory: rig.factory,
      capabilities: liteCaps,
      assets: ASSETS,
    });
    await service.analyze(START_FEN, { profile: 'normal', threads: 2 }).outcome;
    expect(rig.transports[0]!.sent).toContain('setoption name Threads value 2');
    await service.dispose();
  });

  it('preserves MultiPV ordering and per-line evaluations', async () => {
    const { service, transports, dispose } = createService({
      configureTransport: (t) => {
        t.autoSearch = false;
      },
    });
    const job = service.analyze(START_FEN, { profile: 'tactical' });
    const transport = await waitForGo({ service, transports, dispose }, job.id);
    transport.emit('info depth 4 multipv 1 score cp 30 pv e2e4 e7e5');
    transport.emit('info depth 4 multipv 2 score cp 10 pv d2d4 d7d5');
    transport.emit('info depth 4 multipv 3 score cp -5 pv g1f3 g8f6');
    transport.emit('bestmove e2e4 ponder e7e5');
    const outcome = await job.outcome;
    expect(outcome.kind).toBe('completed');
    if (outcome.kind !== 'completed') return;
    expect(outcome.result.lines.map((l) => l.multipv)).toEqual([1, 2, 3]);
    expect(outcome.result.lines.map((l) => l.evaluation)).toEqual([
      { cp: 30 },
      { cp: 10 },
      { cp: -5 },
    ]);
    expect(outcome.result.lines[0]!.principalVariation.map((m) => m.uci)).toEqual(['e2e4', 'e7e5']);
    await dispose();
  });

  it('emits progress events with real fields, never a percentage', async () => {
    const { service, transports, dispose } = createService({
      configureTransport: (t) => {
        t.autoSearch = false;
      },
    });
    const job = service.analyze(START_FEN, { profile: 'normal' });
    const progress: Array<Record<string, unknown>> = [];
    job.subscribe((event) => {
      if (event.type === 'progress')
        progress.push(event.progress as unknown as Record<string, unknown>);
    });
    const transport = await waitForGo({ service, transports, dispose }, job.id);
    transport.emit('info depth 2 nodes 10 nps 5 time 3 pv e2e4');
    transport.emit('bestmove e2e4');
    await job.outcome;
    expect(progress.length).toBeGreaterThan(0);
    expect(progress[0]!.depth).toBe(2);
    expect(progress[0]!.nodes).toBe(10);
    expect('percent' in (progress[0] ?? {})).toBe(false);
    await dispose();
  });

  it('reports WDL when the engine sends it', async () => {
    const { service, transports, dispose } = createService({
      configureTransport: (t) => {
        t.autoSearch = false;
      },
    });
    const job = service.analyze(START_FEN, { profile: 'normal' });
    const transport = await waitForGo({ service, transports, dispose }, job.id);
    transport.emit('info depth 5 score cp 18 wdl 22 974 4 pv e2e4 e7e5');
    transport.emit('bestmove e2e4');
    const outcome = await job.outcome;
    expect(outcome.kind).toBe('completed');
    if (outcome.kind === 'completed') {
      expect(outcome.result.lines[0]!.wdl).toEqual({ w: 22, d: 974, l: 4 });
    }
    await dispose();
  });
});

describe('engine service — queue and job ids', () => {
  it('assigns unique ids and processes queued jobs in FIFO order', async () => {
    const { service, transports, dispose } = createService({
      configureTransport: (t) => {
        t.autoSearch = false;
      },
    });
    const j1 = service.analyze(START_FEN, { profile: 'fast' });
    const j2 = service.analyze(START_FEN, { profile: 'fast' });
    expect(j1.id).not.toBe(j2.id);

    const t1 = await waitForGo({ service, transports, dispose }, j1.id, 0);
    expect(j2.status).toBe('queued');
    expect(service.getStatus().queued).toBe(1);
    completeSearch(t1);
    expect((await j1.outcome).kind).toBe('completed');

    const t2 = await waitForGo({ service, transports, dispose }, j2.id, 0, 2);
    completeSearch(t2);
    const o2 = await j2.outcome;
    expect(o2.kind).toBe('completed');
    expect(service.getStatus().queued).toBe(0);
    await dispose();
  });
});

describe('engine service — cancellation', () => {
  it('cancels a queued job without Worker traffic', async () => {
    const { service, transports, dispose } = createService({
      configureTransport: (t) => {
        t.autoSearch = false;
      },
    });
    const j1 = service.analyze(START_FEN, { profile: 'fast' });
    const j2 = service.analyze(START_FEN, { profile: 'fast' });
    const t1 = await waitForGo({ service, transports, dispose }, j1.id, 0);

    service.cancel(j2.id);
    const outcome = await j2.outcome;
    expect(outcome.kind).toBe('cancelled');
    expect(j2.status).toBe('cancelled');
    expect(service.getStatus().queued).toBe(0);

    completeSearch(t1);
    expect((await j1.outcome).kind).toBe('completed');
    await dispose();
  });

  it('cancels an active job via stop and never reports it completed', async () => {
    const { service, transports, dispose } = createService({
      configureTransport: (t) => {
        t.autoSearch = false;
      },
    });
    const j1 = service.analyze(START_FEN, { profile: 'fast' });
    const events: string[] = [];
    j1.subscribe((e) => events.push(e.type));
    const t1 = await waitForGo({ service, transports, dispose }, j1.id, 0);

    service.cancel(j1.id);
    expect(transports[0]!.sent).toContain('stop');
    t1.emit('bestmove e2e4 ponder e7e5');
    const outcome = await j1.outcome;
    expect(outcome.kind).toBe('cancelled');
    expect(events).not.toContain('result');
    expect(service.getStatus().lifecycle).toBe('ready');
    await dispose();
  });

  it('recovers when the engine ignores stop (recreates the Worker lazily)', async () => {
    const { service, transports, dispose } = createService({
      configureTransport: (t) => {
        t.autoSearch = false;
      },
      serviceOverrides: { cancelTimeoutMs: 30 },
    });
    const job = service.analyze(START_FEN, { profile: 'fast' });
    await waitForGo({ service, transports, dispose }, job.id, 0);
    service.cancel(job.id);
    const outcome = await job.outcome;
    expect(outcome.kind).toBe('cancelled');
    // The stuck worker is torn down; the next analysis recreates it.
    await until(() => service.getStatus().lifecycle === 'uninitialized', 'worker torn down');
    const j2 = service.analyze(START_FEN, { profile: 'fast' });
    const t2 = await waitForGo({ service, transports, dispose }, j2.id, 1);
    completeSearch(t2);
    expect((await j2.outcome).kind).toBe('completed');
    expect(service.getStatus().lifecycle).toBe('ready');
    await dispose();
  });

  it('cancelAll cancels queued and active jobs', async () => {
    const { service, transports, dispose } = createService({
      configureTransport: (t) => {
        t.autoSearch = false;
      },
    });
    const j1 = service.analyze(START_FEN, { profile: 'fast' });
    const j2 = service.analyze(START_FEN, { profile: 'fast' });
    const t1 = await waitForGo({ service, transports, dispose }, j1.id, 0);
    service.cancelAll();
    // The engine answers the stop that cancelAll sent.
    answerStop(t1);
    expect((await j1.outcome).kind).toBe('cancelled');
    expect((await j2.outcome).kind).toBe('cancelled');
    await dispose();
  });
});

describe('engine service — failure handling', () => {
  it('fails a job with worker-crashed and preserves queued jobs', async () => {
    const { service, transports, dispose } = createService({
      configureTransport: (t) => {
        t.autoSearch = false;
      },
    });
    const j1 = service.analyze(START_FEN, { profile: 'fast' });
    const j2 = service.analyze(START_FEN, { profile: 'fast' });
    const t1 = await waitForGo({ service, transports, dispose }, j1.id, 0);

    t1.emitError(new Error('boom'));
    const o1 = await j1.outcome;
    expect(o1.kind).toBe('failed');
    if (o1.kind === 'failed') expect(o1.error.reason).toBe('worker-crashed');

    await until(() => transports.length >= 2, 'worker recreated');
    const t2 = await waitForGo({ service, transports, dispose }, j2.id, 1);
    completeSearch(t2);
    expect((await j2.outcome).kind).toBe('completed');
    await dispose();
  });

  it('fails with a timeout when the engine goes silent', async () => {
    const { service, transports, dispose } = createService({
      configureTransport: (t) => {
        t.autoSearch = false;
      },
      serviceOverrides: { stallTimeoutMs: 150 },
    });
    const job = service.analyze(START_FEN, { profile: 'fast' });
    await waitForGo({ service, transports, dispose }, job.id, 0);
    const outcome = await job.outcome;
    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') expect(outcome.error.reason).toBe('timeout');
    // The stuck worker is torn down; the next analysis recreates it.
    await until(() => service.getStatus().lifecycle === 'uninitialized', 'worker torn down');
    const j2 = service.analyze(START_FEN, { profile: 'fast' });
    const t2 = await waitForGo({ service, transports, dispose }, j2.id, 1);
    completeSearch(t2);
    expect((await j2.outcome).kind).toBe('completed');
    expect(service.getStatus().lifecycle).toBe('ready');
    await dispose();
  });

  it('reports engine startup failure', async () => {
    const rig = createFakeEngineFactory((t) => {
      t.autoSearch = false;
    });
    const service = createEngineService({
      transportFactory: () => {
        const transport = rig.factory();
        const originalStart = transport.start.bind(transport);
        transport.start = () => originalStart().then(() => Promise.reject(new Error('no wasm')));
        return transport;
      },
      capabilities: CAPS,
      assets: ASSETS,
    });
    const job = service.analyze(START_FEN, { profile: 'fast' });
    const outcome = await job.outcome;
    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') expect(outcome.error.reason).toBe('engine-startup-failed');
    expect(service.getStatus().lifecycle).toBe('failed');
    await service.dispose();
  });

  it('fails with malformed-response when no evaluation lines arrive', async () => {
    const { service, transports, dispose } = createService({
      configureTransport: (t) => {
        t.autoSearch = false;
      },
    });
    const job = service.analyze(START_FEN, { profile: 'fast' });
    const transport = await waitForGo({ service, transports, dispose }, job.id, 0);
    transport.emit('bestmove e2e4');
    const outcome = await job.outcome;
    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') expect(outcome.error.reason).toBe('malformed-response');
    await dispose();
  });
});

describe('engine service — lifecycle', () => {
  it('starts uninitialized and becomes ready after first analysis', async () => {
    const { service, dispose } = createService();
    expect(service.getStatus().lifecycle).toBe('uninitialized');
    expect(service.getStatus().engine).toBeNull();
    await service.analyze(START_FEN, { profile: 'fast' }).outcome;
    expect(service.getStatus().lifecycle).toBe('ready');
    expect(service.getStatus().engine?.engineVersion).toBe('18.0.8');
    await dispose();
  });

  it('dispose cancels queued jobs and fails the active job', async () => {
    const { service, transports, dispose } = createService({
      configureTransport: (t) => {
        t.autoSearch = false;
      },
    });
    const j1 = service.analyze(START_FEN, { profile: 'fast' });
    const j2 = service.analyze(START_FEN, { profile: 'fast' });
    await waitForGo({ service, transports, dispose }, j1.id, 0);
    await service.dispose();
    expect((await j1.outcome).kind).toBe('failed');
    expect((await j2.outcome).kind).toBe('cancelled');
    expect(service.getStatus().lifecycle).toBe('disposed');
    await dispose();
  });

  it('does not start analysis after dispose', async () => {
    const { service, dispose } = createService();
    await service.dispose();
    const job = service.analyze(START_FEN, { profile: 'fast' });
    const outcome = await job.outcome;
    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') expect(outcome.error.reason).toBe('disposed');
    await dispose();
  });

  it('notifies lifecycle changes', async () => {
    const { service, dispose } = createService();
    const states: string[] = [];
    service.onStatusChange((s) => states.push(s.lifecycle));
    await service.analyze(START_FEN, { profile: 'fast' }).outcome;
    expect(states).toContain('initializing');
    expect(states).toContain('ready');
    await dispose();
  });
});
