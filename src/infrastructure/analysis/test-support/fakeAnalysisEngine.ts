/**
 * Scriptable fake Stockfish engine service for Feature-008 service tests.
 *
 * Completes/fails engine jobs from per-FEN tables (no Worker, no IndexedDB).
 * Jobs settle on a microtask so tests can `await` an entire batch run.
 */

import { AnalysisJobHandle } from '@/infrastructure/engine/engineService';
import type {
  AnalysisJob,
  AnalysisOptions,
  EngineAnalysisResult,
  EngineService,
  EngineServiceStatus,
} from '@/infrastructure/engine/types';
import type { EngineMetadata } from '@/domain/chess';

export const FAKE_ENGINE_META: EngineMetadata = {
  engineName: 'stockfish',
  engineVersion: '18.0.8',
  engineBuild: 'stockfish-18-lite-single',
  profile: 'normal',
};

export interface FakeEngineConfig {
  /** Per-FEN results; fens without an entry fall back to `defaultResult`. */
  readonly results?: ReadonlyMap<string, EngineAnalysisResult>;
  /** Per-FEN failures (`reason → message`); wins over `results`. */
  readonly failures?: ReadonlyMap<string, string>;
  /** Default result for unknown FENs. */
  readonly defaultResult?: EngineAnalysisResult;
  /**
   * When `true`, submitted jobs stay pending (never settle on a microtask)
   * until `releaseAll` is called — lets tests interleave and assert queue /
   * cancellation ordering across batches.
   */
  readonly hold?: boolean;
}

export interface FakeEngineRig {
  readonly service: EngineService;
  /** Every FEN submitted to `analyze`, in order. */
  readonly requests: string[];
  readonly activeJobs: AnalysisJobHandle[];
  /** Jobs held pending while the rig runs in `hold` mode (FIFO). */
  readonly held: AnalysisJobHandle[];
  /** Settle up to `count` held jobs (default: all) in submission order. */
  releaseAll(count?: number): number;
  /** Configure (or, with `null`, clear) a per-FEN failure. */
  setFailure(fen: string, message: string | null): void;
  /** Remove every configured failure. */
  clearFailures(): void;
}

function evalResult(fen: string): EngineAnalysisResult {
  return {
    jobId: 'job-fake',
    position: fen,
    profile: 'normal',
    lines: [{ multipv: 1, evaluation: { cp: 0 }, principalVariation: [], wdl: null }],
    engine: FAKE_ENGINE_META,
    timeMs: 1,
  };
}

export function createFakeEngine(config: FakeEngineConfig = {}): FakeEngineRig {
  const requests: string[] = [];
  const activeJobs: AnalysisJobHandle[] = [];
  const held: AnalysisJobHandle[] = [];
  const failures = new Map(config.failures ?? []);
  const hold = config.hold === true;

  const settle = (handle: AnalysisJobHandle): void => {
    if (handle.cancelRequested || handle.status !== 'queued') {
      return;
    }
    handle.setStatus('running');
    const failure = failures.get(handle.fen);
    if (failure !== undefined) {
      handle.fail({ reason: 'malformed-response', message: failure });
      return;
    }
    handle.complete(
      config.results?.get(handle.fen) ?? config.defaultResult ?? evalResult(handle.fen),
    );
  };

  const status: EngineServiceStatus = {
    lifecycle: 'ready',
    engine: FAKE_ENGINE_META,
    build: 'lite-single',
    activeJobId: null,
    queued: 0,
  };

  const service: EngineService = {
    analyze(fen: string, options?: Partial<AnalysisOptions>): AnalysisJob {
      const handle = new AnalysisJobHandle(
        fen,
        { profile: options?.profile ?? 'normal', ...options },
        () => handle.cancelFinish(),
      );
      requests.push(fen);
      activeJobs.push(handle);
      if (hold) {
        held.push(handle);
      } else {
        queueMicrotask(() => settle(handle));
      }
      return handle;
    },
    cancel(jobId: string) {
      const job = activeJobs.find((j) => j.id === jobId);
      job?.cancelFinish();
    },
    cancelAll() {
      for (const job of activeJobs.splice(0)) {
        job.cancelFinish();
      }
    },
    getStatus() {
      return status;
    },
    onStatusChange() {
      return () => undefined;
    },
    dispose() {
      return Promise.resolve();
    },
  };

  const releaseAll = (count = held.length): number => {
    let released = 0;
    while (count > 0 && held.length > 0) {
      const handle = held.shift()!;
      settle(handle);
      released += 1;
      count -= 1;
    }
    return released;
  };

  return {
    service,
    requests,
    activeJobs,
    held,
    releaseAll,
    setFailure(fen, message) {
      if (message === null) {
        failures.delete(fen);
      } else {
        failures.set(fen, message);
      }
    },
    clearFailures() {
      failures.clear();
    },
  };
}
