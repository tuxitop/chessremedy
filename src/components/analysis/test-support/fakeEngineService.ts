import { AnalysisJobHandle } from '@/infrastructure/engine/engineService';
import type {
  AnalysisJob,
  AnalysisOptions,
  EngineAnalysisResult,
  EngineService,
  EngineServiceStatus,
} from '@/infrastructure/engine/types';
import type { LiveEngineService } from '../useLiveAnalysis';

export const TEST_ENGINE_META = {
  engineName: 'stockfish',
  engineVersion: '18.0.8',
  engineBuild: 'stockfish-18-lite-single',
};

export function testResultFor(
  handle: AnalysisJobHandle,
  fen: string,
  overrides?: Partial<EngineAnalysisResult>,
): EngineAnalysisResult {
  return {
    jobId: handle.id,
    position: fen,
    profile: handle.profile,
    lines: [
      {
        multipv: 1,
        evaluation: { cp: 21 },
        principalVariation: [{ uci: 'e2e4' }, { uci: 'e7e5' }],
        wdl: null,
      },
    ],
    engine: { ...TEST_ENGINE_META, profile: handle.profile },
    timeMs: 12,
    ...overrides,
  };
}

export interface FakeEngineRig {
  readonly service: LiveEngineService & EngineService;
  readonly jobs: AnalysisJobHandle[];
  /** Resolve the i-th analysis with the given result. */
  complete(index: number, result?: Partial<EngineAnalysisResult>): void;
  /** Cancel the i-th analysis. */
  cancel(index: number): void;
}

/**
 * Scriptable fake engine service used by analysis component tests: analyses are
 * recorded but never auto-complete, so tests drive completion/cancellation
 * deterministically (no Worker, no IndexedDB).
 */
export function createFakeAnalysisService(): FakeEngineRig {
  const jobs: AnalysisJobHandle[] = [];
  const status: EngineServiceStatus = {
    lifecycle: 'ready',
    engine: TEST_ENGINE_META,
    build: 'lite-single',
    activeJobId: null,
    queued: 0,
  };
  const service: LiveEngineService & EngineService = {
    analyze(fen: string, options?: Partial<AnalysisOptions>): AnalysisJob {
      const handle = new AnalysisJobHandle(
        fen,
        { profile: options?.profile ?? 'normal', ...options },
        (job) => service.cancel(job.id),
      );
      jobs.push(handle);
      // Mirror the real engine service: a queued job starts (emits `running`)
      // asynchronously but does not auto-complete in the fake.
      queueMicrotask(() => {
        if (handle.status === 'queued') {
          handle.setStatus('running');
        }
      });
      return handle;
    },
    cancel(jobId: string) {
      const job = jobs.find((j) => j.id === jobId);
      job?.cancelFinish();
    },
    cancelAll() {
      for (const job of jobs.splice(0)) job.cancelFinish();
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
  return {
    service,
    jobs,
    complete(index: number, overrides?: Partial<EngineAnalysisResult>) {
      const handle = jobs[index];
      if (handle) handle.complete(testResultFor(handle, handle.fen, overrides));
    },
    cancel(index: number) {
      const handle = jobs[index];
      if (handle) handle.cancel();
    },
  };
}
