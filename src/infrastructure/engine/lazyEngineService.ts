/**
 * Lazy, idle-disposing wrapper around a dedicated `EngineService` (ADR-034).
 *
 * The Feature-010 verification engine must not cost a second WASM instance
 * until tactical detection actually runs, and must release it once idle. This
 * wrapper creates the inner service on the first `analyze`, reuses it across
 * candidates and passes, and disposes it after `VERIFICATION_ENGINE_IDLE_MS`
 * with no active or queued job. An explicit `dispose()` is permanent teardown.
 *
 * The inner service keeps its own Worker, FIFO and watchdogs; nothing is
 * shared with the analysis engine (ADR-034). Unit tests drive a fake inner
 * service with fake timers, so no Worker/WASM is involved (ADR-009).
 */

import { AnalysisJobHandle, type JobOptions } from './engineService';
import type { AnalysisJob, AnalysisOptions, EngineService, EngineServiceStatus } from './types';

/** Idle window after which the verification engine releases its Worker. */
export const VERIFICATION_ENGINE_IDLE_MS = 5 * 60_000;

export interface LazyEngineServiceOptions {
  /** Synchronous factory for the inner service; called on the first `analyze`. */
  readonly create: () => EngineService;
  /** Idle window before disposal (defaults to `VERIFICATION_ENGINE_IDLE_MS`). */
  readonly idleMs?: number;
  /** Invoked after the inner service is disposed (idle or explicit teardown). */
  readonly onDispose?: () => void;
}

export function createLazyEngineService(options: LazyEngineServiceOptions): EngineService {
  const idleMs = options.idleMs ?? VERIFICATION_ENGINE_IDLE_MS;
  const statusListeners = new Set<(status: EngineServiceStatus) => void>();

  let inner: EngineService | null = null;
  let unsubscribeInner: (() => void) | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const emitStatus = (status: EngineServiceStatus): void => {
    for (const listener of statusListeners) {
      listener(status);
    }
  };

  const getStatus = (): EngineServiceStatus => {
    if (inner) return inner.getStatus();
    return {
      lifecycle: disposed ? 'disposed' : 'uninitialized',
      engine: null,
      build: null,
      activeJobId: null,
      queued: 0,
    };
  };

  const clearIdleTimer = (): void => {
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };

  const syncIdleTimer = (): void => {
    clearIdleTimer();
    if (disposed || !inner) return;
    const status = inner.getStatus();
    if (status.activeJobId === null && status.queued === 0) {
      idleTimer = setTimeout(() => {
        idleTimer = null;
        void idleDispose();
      }, idleMs);
      idleTimer.unref?.();
    }
  };

  const teardownInner = async (): Promise<void> => {
    clearIdleTimer();
    const current = inner;
    const unsubscribe = unsubscribeInner;
    inner = null;
    unsubscribeInner = null;
    if (!current) return;
    unsubscribe?.();
    await current.dispose();
    options.onDispose?.();
  };

  const idleDispose = async (): Promise<void> => {
    if (disposed || !inner) return;
    const status = inner.getStatus();
    if (status.activeJobId !== null || status.queued > 0) {
      syncIdleTimer();
      return;
    }
    await teardownInner();
    emitStatus(getStatus());
  };

  const ensureInner = (): EngineService => {
    if (inner) return inner;
    const service = options.create();
    inner = service;
    unsubscribeInner = service.onStatusChange((status) => {
      emitStatus(status);
      syncIdleTimer();
    });
    return service;
  };

  const failedDisposedJob = (fen: string, profile: JobOptions['profile']): AnalysisJob => {
    const job = new AnalysisJobHandle(fen, { profile }, () => {});
    job.fail({ reason: 'disposed', message: 'Verification engine service was disposed.' });
    return job;
  };

  return {
    analyze(fen: string, analyzeOptions?: Partial<AnalysisOptions>): AnalysisJob {
      if (disposed) {
        return failedDisposedJob(fen, analyzeOptions?.profile ?? 'normal');
      }
      const service = ensureInner();
      const job = service.analyze(fen, analyzeOptions);
      syncIdleTimer();
      return job;
    },
    cancel(jobId: string): void {
      inner?.cancel(jobId);
    },
    cancelAll(): void {
      inner?.cancelAll();
    },
    getStatus,
    onStatusChange(listener: (status: EngineServiceStatus) => void): () => void {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      await teardownInner();
      emitStatus(getStatus());
    },
  };
}
