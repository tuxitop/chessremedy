/**
 * Engine service (Feature 005).
 *
 * Owns the Worker lifecycle, UCI handshake, FIFO job queue, cancellation,
 * progress, failure recovery and disposal (spec §3–§15). This module never
 * touches the `Worker` global directly — it talks to an injectable
 * `EngineTransport` (ADR-009), so queue semantics, cancellation and recovery
 * are unit-tested in Node against a fake transport. The real Worker/WASM
 * path is created by `workerTransport.ts` and exercised by Playwright.
 *
 * Results carry the full `(FEN, profile, engineName, engineVersion,
 * engineBuild)` tuple so a later position-keyed cache (ADR-018) can wrap this
 * service without re-deriving identity.
 */

import { parsePositionFen, type EngineMetadata } from '@/domain/chess';
import { engineBuildToken, engineMetadataFor, type EngineAssets } from './engineBuild';
import type { EngineCapabilities } from './capabilities';
import { resolveProfileConfig } from './engineProfiles';
import type { UciOptionSetting } from './engineProfiles';
import type { EngineBuildId } from './types';
import {
  goCombinedCommand,
  goDepthCommand,
  goMovetimeCommand,
  isMeaningfulInfo,
  parseUciLine,
  positionFenCommand,
  setoptionCommand,
  type ParsedInfo,
  type ParsedUciLine,
} from './uciProtocol';
import type {
  AnalysisJob,
  AnalysisJobEvent,
  AnalysisJobOutcome,
  AnalysisJobStatus,
  AnalysisOptions,
  EngineAnalysisResult,
  EngineEvaluation,
  EngineJobError,
  EngineLine,
  EngineLifecycleState,
  EngineProgress,
  EngineService,
  EngineServiceStatus,
  EngineTransport,
  EngineTransportFactory,
} from './types';

export interface EngineServiceOptions {
  readonly transportFactory: EngineTransportFactory;
  readonly capabilities: EngineCapabilities;
  readonly assets: EngineAssets;
  /** Time to wait for the UCI handshake (`uci`→`uciok`, `isready`→`readyok`). */
  readonly initTimeoutMs?: number;
  /**
   * Time without any engine output while a search is running before the job
   * is failed as a timeout and the Worker is restarted.
   */
  readonly stallTimeoutMs?: number;
  /** How long an active `stop` may take before the Worker is recreated. */
  readonly cancelTimeoutMs?: number;
  /**
   * Max lifetime of a *queued* engine job (WP-D watchdog). A job that sits in
   * the FIFO this long — e.g. because the pump stalled or a ghost pass holds
   * the queue — is failed as a timeout so its caller can resume/fail rather
   * than leaving "queued" permanent.
   */
  readonly queuedTimeoutMs?: number;
}

const DEFAULT_INIT_TIMEOUT_MS = 30_000;
const DEFAULT_STALL_TIMEOUT_MS = 60_000;
const DEFAULT_CANCEL_TIMEOUT_MS = 5_000;
const DEFAULT_QUEUED_TIMEOUT_MS = 15 * 60_000;
const MAX_QUEUED_SWEEP_MS = 5_000;
const DEFAULT_PROFILE = 'normal' as const;

/** Feature 006 MultiPV cap (spec: default 3, max 5). */
export const MAX_MULTIPV = 5;

/** Clamp a requested MultiPV into `[1, MAX_MULTIPV]`. */
export function clampMultipv(multipv: number): number {
  return Math.min(MAX_MULTIPV, Math.max(1, Math.round(multipv)));
}

/** Clamp a requested hash (MB) into `[1, hashCapMb]` (ADR-012 caps). */
export function clampHashMb(hashMb: number, hashCapMb: number): number {
  return Math.min(Math.max(1, Math.round(hashMb)), hashCapMb);
}

/** Clamp a requested thread count into `[1, threadCap]`. */
export function clampThreads(threads: number, threadCap: number): number {
  return Math.min(Math.max(1, Math.round(threads)), threadCap);
}

export interface JobOptions {
  readonly profile: 'fast' | 'normal' | 'tactical' | 'deep';
  readonly maxDepth?: number;
  readonly movetimeMs?: number;
  readonly multipv?: number;
  readonly hashMb?: number;
  readonly threads?: number;
}

interface SearchLine {
  readonly move: string;
  readonly ponder?: string;
}

interface InitExpectation {
  readonly kind: 'uciok' | 'readyok';
  readonly resolve: () => void;
}

function evalFromScore(score: { type: 'cp' | 'mate'; value: number }): EngineEvaluation {
  return score.type === 'mate' ? { mate: score.value } : { cp: score.value };
}

function toEngineJobError(err: unknown, fallbackReason: EngineJobError['reason']): EngineJobError {
  if (err && typeof err === 'object' && 'reason' in err) {
    return err as EngineJobError;
  }
  return {
    reason: fallbackReason,
    message: err instanceof Error ? err.message : String(err),
  };
}

/**
 * Apply per-job overrides (Feature 006 live analysis) on top of the resolved
 * profile options. The single-threaded build has no `Threads` option (the
 * profile omits it), so a threads override is only applied when the resolved
 * option set already carries `Threads`.
 */
function applyProfileOverrides(
  options: readonly UciOptionSetting[],
  job: Pick<JobOptions, 'multipv' | 'hashMb' | 'threads'>,
  build: EngineBuildId,
): readonly UciOptionSetting[] {
  return options.map((option) => {
    if (option.name === 'MultiPV' && job.multipv !== undefined) {
      return { ...option, value: String(clampMultipv(job.multipv)) };
    }
    if (option.name === 'Hash' && job.hashMb !== undefined) {
      return { ...option, value: String(job.hashMb) };
    }
    if (option.name === 'Threads' && job.threads !== undefined && build === 'lite') {
      return { ...option, value: String(job.threads) };
    }
    return option;
  });
}

let jobSequence = 0;

export class AnalysisJobHandle implements AnalysisJob {
  readonly id: string;
  readonly fen: string;
  readonly profile: AnalysisJob['profile'];
  readonly options: JobOptions;
  status: AnalysisJobStatus = 'queued';
  /** Unix epoch millis the job entered the engine queue (queue watchdog). */
  readonly enqueuedAt: number = Date.now();

  private readonly listeners = new Set<(event: AnalysisJobEvent) => void>();
  private outcomeResolve!: (outcome: AnalysisJobOutcome) => void;
  readonly outcome: Promise<AnalysisJobOutcome>;
  private settled = false;
  cancelRequested = false;

  constructor(fen: string, options: JobOptions, onCancel: (job: AnalysisJobHandle) => void) {
    jobSequence += 1;
    this.id = `job-${jobSequence}`;
    this.fen = fen;
    this.profile = options.profile;
    this.options = options;
    this.outcome = new Promise<AnalysisJobOutcome>((resolve) => {
      this.outcomeResolve = resolve;
    });
    this.cancel = () => onCancel(this);
  }

  subscribe(listener: (event: AnalysisJobEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  cancel: () => void;

  private emit(event: AnalysisJobEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  setStatus(status: AnalysisJobStatus): void {
    this.status = status;
    this.emit({ type: 'status', status });
  }

  emitProgress(progress: EngineProgress): void {
    this.emit({ type: 'progress', progress });
  }

  complete(result: EngineAnalysisResult): void {
    if (this.settled) return;
    this.settled = true;
    this.setStatus('completed');
    this.emit({ type: 'result', result });
    this.outcomeResolve({ kind: 'completed', result });
  }

  cancelFinish(): void {
    if (this.settled) return;
    this.settled = true;
    this.setStatus('cancelled');
    this.outcomeResolve({ kind: 'cancelled' });
  }

  fail(error: EngineJobError): void {
    if (this.settled) return;
    this.settled = true;
    this.setStatus('failed');
    this.emit({ type: 'error', error });
    this.outcomeResolve({ kind: 'failed', error });
  }
}

type SearchSettle = {
  readonly resolve: (line: SearchLine | null) => void;
  readonly reject: (error: EngineJobError) => void;
};

export class EngineServiceImpl implements EngineService {
  lifecycle: EngineLifecycleState = 'uninitialized';
  readonly engineIdentity: { engineName: string; engineVersion: string; engineBuild: string };

  private readonly transportFactory: EngineTransportFactory;
  private readonly capabilities: EngineCapabilities;
  private readonly assets: EngineAssets;
  private readonly initTimeoutMs: number;
  private readonly stallTimeoutMs: number;
  private readonly cancelTimeoutMs: number;
  private readonly queuedTimeoutMs: number;

  private transport: EngineTransport | null = null;
  private readonly queue: AnalysisJobHandle[] = [];
  private active: AnalysisJobHandle | null = null;

  private readonly statusListeners = new Set<(status: EngineServiceStatus) => void>();
  private initializing = false;
  private initPromise: Promise<void> | null = null;
  private initExpectations: InitExpectation[] = [];
  private searchSettle: SearchSettle | null = null;
  private latestInfoByMultiPv = new Map<number, ParsedInfo>();
  private searchStartTime = 0;
  private lastEngineActivityAt = 0;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private queueWatchdogTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private drainRunning = false;

  constructor(options: EngineServiceOptions) {
    this.transportFactory = options.transportFactory;
    this.capabilities = options.capabilities;
    this.assets = options.assets;
    this.initTimeoutMs = options.initTimeoutMs ?? DEFAULT_INIT_TIMEOUT_MS;
    this.stallTimeoutMs = options.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS;
    this.cancelTimeoutMs = options.cancelTimeoutMs ?? DEFAULT_CANCEL_TIMEOUT_MS;
    this.queuedTimeoutMs = options.queuedTimeoutMs ?? DEFAULT_QUEUED_TIMEOUT_MS;
    this.engineIdentity = {
      engineName: this.assets.engineName,
      engineVersion: this.assets.npmVersion,
      engineBuild: engineBuildToken(this.assets.engineRelease, this.capabilities.build),
    };
  }

  analyze(fen: string, options?: Partial<AnalysisOptions>): AnalysisJob {
    const profile = options?.profile ?? DEFAULT_PROFILE;
    const jobOptions: JobOptions = {
      profile,
      ...(options?.maxDepth !== undefined ? { maxDepth: options.maxDepth } : {}),
      ...(options?.movetimeMs !== undefined ? { movetimeMs: options.movetimeMs } : {}),
      ...(options?.multipv !== undefined ? { multipv: clampMultipv(options.multipv) } : {}),
      ...(options?.hashMb !== undefined
        ? { hashMb: clampHashMb(options.hashMb, this.capabilities.hashCapMb) }
        : {}),
      ...(options?.threads !== undefined
        ? { threads: clampThreads(options.threads, this.capabilities.threads) }
        : {}),
    };
    const onCancel = (job: AnalysisJobHandle): void => this.cancel(job.id);

    const parsed = parsePositionFen(fen);
    if (!parsed.ok) {
      const job = new AnalysisJobHandle(fen, jobOptions, onCancel);
      job.fail({ reason: 'invalid-position', message: parsed.message });
      return job;
    }
    if (parsed.position.isEnd()) {
      const job = new AnalysisJobHandle(fen, jobOptions, onCancel);
      job.fail({
        reason: 'invalid-position',
        message: 'The position has no legal moves to analyze.',
      });
      return job;
    }

    const job = new AnalysisJobHandle(fen, jobOptions, onCancel);
    if (this.disposed) {
      job.fail({ reason: 'disposed', message: 'Engine service was disposed.' });
      return job;
    }
    this.queue.push(job);
    this.notifyStatus();
    this.startQueueWatchdog();
    this.drain();
    return job;
  }

  cancel(jobId: string): void {
    const queuedIndex = this.queue.findIndex((j) => j.id === jobId);
    if (queuedIndex >= 0) {
      const [job] = this.queue.splice(queuedIndex, 1);
      job?.cancelFinish();
      this.notifyStatus();
      return;
    }
    const active = this.active;
    if (active && active.id === jobId) {
      active.cancelRequested = true;
      this.send('stop');
      const timer = setTimeout(() => {
        if (this.active === active && active.cancelRequested) {
          this.searchSettle?.reject({
            reason: 'cancelled',
            message: 'Engine did not stop in time.',
          });
        }
      }, this.cancelTimeoutMs);
      timer.unref?.();
    }
  }

  cancelAll(): void {
    for (const job of this.queue.splice(0)) {
      job.cancelFinish();
    }
    const active = this.active;
    if (active) {
      active.cancelRequested = true;
      this.send('stop');
    }
    this.notifyStatus();
  }

  getStatus(): EngineServiceStatus {
    const initialized = this.lifecycle !== 'uninitialized';
    return {
      lifecycle: this.lifecycle,
      engine: initialized
        ? {
            engineName: this.engineIdentity.engineName,
            engineVersion: this.engineIdentity.engineVersion,
            engineBuild: this.engineIdentity.engineBuild,
          }
        : null,
      build: initialized ? this.capabilities.build : null,
      activeJobId: this.active?.id ?? null,
      queued: this.queue.length,
    };
  }

  onStatusChange(listener: (status: EngineServiceStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.lifecycle = 'disposed';
    for (const job of this.queue.splice(0)) {
      job.cancelFinish();
    }
    const active = this.active;
    this.active = null;
    active?.fail({ reason: 'disposed', message: 'Engine service was disposed.' });
    this.clearWatchdog();
    this.clearQueueWatchdog();
    this.initExpectations = [];
    const search = this.searchSettle;
    this.searchSettle = null;
    search?.reject({ reason: 'disposed', message: 'Engine service was disposed.' });
    await this.teardownTransport();
    this.notifyStatus();
  }

  // --- internal -----------------------------------------------------------------

  /**
   * Queue watchdog (WP-D): fail a *queued* engine job that has waited longer
   * than `queuedTimeoutMs` so its caller can fail/resume instead of leaving
   * "queued" permanent (e.g. a stalled pump or a ghost pass holding the FIFO).
   * Only the oldest queued job can age out; the active job is governed by the
   * stall watchdog. The sweep restarts the drain in case it went idle.
   */
  private startQueueWatchdog(): void {
    if (this.disposed || this.queueWatchdogTimer !== null) {
      return;
    }
    const sweepMs = Math.min(
      MAX_QUEUED_SWEEP_MS,
      Math.max(50, Math.floor(this.queuedTimeoutMs / 4)),
    );
    this.queueWatchdogTimer = setInterval(() => {
      if (this.disposed) {
        this.clearQueueWatchdog();
        return;
      }
      const now = Date.now();
      let failedAny = false;
      while (this.queue.length > 0 && now - this.queue[0]!.enqueuedAt >= this.queuedTimeoutMs) {
        const job = this.queue.shift()!;
        const waitedSeconds = Math.round((now - job.enqueuedAt) / 1000);
        job.fail({
          reason: 'timeout',
          message: `Job ${job.id} waited ${waitedSeconds}s in the engine queue; failing it so it can be resumed.`,
        });
        failedAny = true;
      }
      if (failedAny) {
        this.notifyStatus();
      }
      if (this.queue.length === 0) {
        this.clearQueueWatchdog();
      } else {
        this.drain();
      }
    }, sweepMs);
    this.queueWatchdogTimer.unref?.();
  }

  private clearQueueWatchdog(): void {
    if (this.queueWatchdogTimer !== null) {
      clearInterval(this.queueWatchdogTimer);
      this.queueWatchdogTimer = null;
    }
  }

  private notifyStatus(): void {
    const status = this.getStatus();
    for (const listener of this.statusListeners) {
      listener(status);
    }
  }

  private send(command: string): void {
    if (!this.transport) {
      throw new Error('Engine transport is not started.');
    }
    this.transport.send(command);
  }

  private drain(): void {
    if (this.disposed || this.drainRunning) return;
    this.drainRunning = true;
    void (async () => {
      try {
        while (!this.disposed && this.queue.length > 0) {
          const job = this.queue[0]!;
          try {
            await this.ensureEngine();
          } catch (err) {
            const error = err as EngineJobError;
            if (this.queue[0] === job) {
              this.queue.shift();
              job.fail(error);
              this.notifyStatus();
            }
            continue;
          }
          if (this.queue[0] !== job) {
            // Cancelled while initializing.
            continue;
          }
          this.queue.shift();
          await this.runSearch(job);
        }
      } finally {
        this.drainRunning = false;
        if (!this.disposed && this.queue.length > 0) {
          this.drain();
        }
      }
    })();
  }

  private ensureEngine(): Promise<void> {
    if (this.disposed) {
      return Promise.reject<never>({
        reason: 'disposed',
        message: 'Engine service was disposed.',
      });
    }
    if ((this.lifecycle === 'ready' || this.lifecycle === 'busy') && this.transport) {
      return Promise.resolve();
    }
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.init().finally(() => {
      this.initPromise = null;
    });
    return this.initPromise;
  }

  private async init(): Promise<void> {
    this.initializing = true;
    this.lifecycle = 'initializing';
    this.notifyStatus();
    const transport = this.transportFactory();
    this.transport = transport;
    const unsubscribeOutput = transport.onOutput((line) => this.handleEngineLine(line));
    const unsubscribeError = transport.onError((err) => this.handleTransportError(err));

    try {
      await transport.start();
      await this.withTimeout(this.handshake(), this.initTimeoutMs, {
        reason: 'engine-startup-failed',
        message: 'Engine did not finish its UCI handshake in time.',
      });
      this.lifecycle = 'ready';
      this.notifyStatus();
    } catch (err) {
      unsubscribeOutput();
      unsubscribeError();
      this.initExpectations = [];
      await this.teardownTransport();
      this.lifecycle = 'failed';
      this.notifyStatus();
      throw toEngineJobError(err, 'engine-startup-failed');
    } finally {
      this.initializing = false;
    }
  }

  private async handshake(): Promise<void> {
    this.send('uci');
    await this.expectInitLine('uciok');
    this.send('isready');
    await this.expectInitLine('readyok');
  }

  private expectInitLine(kind: 'uciok' | 'readyok'): Promise<void> {
    return new Promise<void>((resolve) => {
      this.initExpectations.push({ kind, resolve });
    });
  }

  private handleEngineLine(line: string): void {
    this.lastEngineActivityAt = Date.now();
    const parsed = parseUciLine(line);
    if (this.initializing) {
      this.handleInitLine(parsed);
      return;
    }
    if (this.searchSettle) {
      this.handleSearchLine(parsed);
    }
  }

  private handleInitLine(parsed: ParsedUciLine): void {
    if (parsed.kind !== 'uciok' && parsed.kind !== 'readyok') {
      return;
    }
    const index = this.initExpectations.findIndex((e) => e.kind === parsed.kind);
    if (index < 0) return;
    const [expectation] = this.initExpectations.splice(index, 1);
    expectation?.resolve();
  }

  private handleSearchLine(parsed: ParsedUciLine): void {
    if (parsed.kind === 'info') {
      if (isMeaningfulInfo(parsed.info)) {
        this.applySearchInfo(parsed.info);
      }
      return;
    }
    if (parsed.kind !== 'bestmove') {
      return;
    }
    const settle = this.searchSettle;
    this.searchSettle = null;
    if (!settle) return;
    if (parsed.move === '(none)') {
      settle.resolve(null);
      return;
    }
    if (parsed.ponder !== undefined) {
      settle.resolve({ move: parsed.move, ponder: parsed.ponder });
    } else {
      settle.resolve({ move: parsed.move });
    }
  }

  private applySearchInfo(info: ParsedInfo): void {
    const multipv = info.multipv ?? 1;
    const previous = this.latestInfoByMultiPv.get(multipv);
    const hasResultFields =
      info.score !== undefined || info.pv !== undefined || info.depth !== undefined;
    if (hasResultFields) {
      // Prefer the most complete line: a later line carrying score + PV wins
      // over an earlier fragment.
      if (!previous || (info.score !== undefined && info.pv !== undefined)) {
        this.latestInfoByMultiPv.set(multipv, info);
      }
    }
    const job = this.active;
    if (!job) return;
    const progress = this.toProgress(job.id, info);
    if (progress) {
      job.emitProgress(progress);
    }
  }

  private toProgress(jobId: string, info: ParsedInfo): EngineProgress | null {
    if (
      info.depth === undefined &&
      info.seldepth === undefined &&
      info.nodes === undefined &&
      info.nps === undefined &&
      info.hashfull === undefined &&
      info.score === undefined &&
      info.pv === undefined &&
      info.wdl === undefined
    ) {
      return null;
    }
    return {
      jobId,
      ...(info.depth !== undefined ? { depth: info.depth } : {}),
      ...(info.seldepth !== undefined ? { seldepth: info.seldepth } : {}),
      ...(info.nodes !== undefined ? { nodes: info.nodes } : {}),
      ...(info.nps !== undefined ? { nps: info.nps } : {}),
      ...(info.hashfull !== undefined ? { hashfull: info.hashfull } : {}),
      ...(info.timeMs !== undefined ? { timeMs: info.timeMs } : {}),
      ...(info.multipv !== undefined ? { multipv: info.multipv } : {}),
      ...(info.score !== undefined ? { evaluation: evalFromScore(info.score) } : {}),
      ...(info.pv !== undefined ? { principalVariation: info.pv.map((uci) => ({ uci })) } : {}),
      ...(info.wdl !== undefined ? { wdl: info.wdl } : {}),
    };
  }

  private async runSearch(job: AnalysisJobHandle): Promise<void> {
    this.active = job;
    job.setStatus('running');
    this.latestInfoByMultiPv = new Map();
    this.notifyStatus();

    const resolved = resolveProfileConfig(job.profile, this.capabilities);
    const depth = job.options.maxDepth ?? resolved.depth;

    try {
      const options = applyProfileOverrides(resolved.options, job.options, this.capabilities.build);
      for (const option of options) {
        this.send(setoptionCommand(option.name, option.value));
      }
      this.send(positionFenCommand(job.fen));
      // Live analysis (Feature 006) may bound the search by time and depth
      // simultaneously; Stockfish stops at whichever it reaches first.
      // Other callers keep their existing single-limit behaviour.
      this.send(
        job.options.movetimeMs !== undefined && job.options.maxDepth !== undefined
          ? goCombinedCommand(depth, job.options.movetimeMs)
          : job.options.movetimeMs !== undefined
            ? goMovetimeCommand(job.options.movetimeMs)
            : goDepthCommand(depth),
      );

      const searchLine = await this.waitForBestmove();
      if (job.cancelRequested) {
        job.cancelFinish();
        return;
      }
      const result = this.buildResult(job, searchLine);
      job.complete(result);
    } catch (err) {
      const error = err as EngineJobError;
      if (job.cancelRequested) {
        job.cancelFinish();
      } else {
        job.fail(error);
      }
      const needsRecreate =
        error.reason === 'timeout' ||
        error.reason === 'worker-crashed' ||
        (job.cancelRequested && error.reason === 'cancelled');
      if (needsRecreate) {
        await this.recreateTransport();
      }
    } finally {
      this.clearWatchdog();
      this.searchSettle = null;
      this.active = null;
      this.notifyStatus();
    }
  }

  private waitForBestmove(): Promise<SearchLine | null> {
    return new Promise<SearchLine | null>((resolve, reject) => {
      this.searchStartTime = Date.now();
      this.lastEngineActivityAt = Date.now();
      this.searchSettle = { resolve, reject };
      this.watchdogTimer = setInterval(() => {
        if (!this.searchSettle) return;
        const idle = Date.now() - this.lastEngineActivityAt;
        if (idle <= this.stallTimeoutMs) return;
        const settle = this.searchSettle;
        this.searchSettle = null;
        this.clearWatchdog();
        settle.reject({ reason: 'timeout', message: 'Engine produced no output for too long.' });
      }, 1000);
      this.watchdogTimer.unref?.();
    });
  }

  private clearWatchdog(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  private buildResult(job: AnalysisJobHandle, searchLine: SearchLine | null): EngineAnalysisResult {
    if (searchLine === null) {
      throw {
        reason: 'malformed-response',
        message: 'Engine returned no best move.',
      } as EngineJobError;
    }
    const byMultiPv = new Map(this.latestInfoByMultiPv);
    if (byMultiPv.size === 0) {
      throw {
        reason: 'malformed-response',
        message: 'Engine produced no evaluation lines.',
      } as EngineJobError;
    }
    const ranks = Array.from(byMultiPv.keys()).sort((a, b) => a - b);
    const lines: EngineLine[] = [];
    for (const rank of ranks) {
      const info = byMultiPv.get(rank)!;
      if (info.score === undefined) continue;
      let pv = info.pv ?? [];
      if (rank === 1 && pv.length === 0) {
        pv = [searchLine.move];
      }
      lines.push({
        multipv: rank,
        evaluation: evalFromScore(info.score),
        principalVariation: pv.map((uci) => ({ uci })),
        wdl: info.wdl ?? null,
        ...(info.depth !== undefined ? { depth: info.depth } : {}),
        ...(info.seldepth !== undefined ? { seldepth: info.seldepth } : {}),
        ...(info.nodes !== undefined ? { nodes: info.nodes } : {}),
        ...(info.nps !== undefined ? { nps: info.nps } : {}),
        ...(info.hashfull !== undefined ? { hashfull: info.hashfull } : {}),
        ...(info.timeMs !== undefined ? { timeMs: info.timeMs } : {}),
      });
    }
    if (lines.length === 0) {
      throw {
        reason: 'malformed-response',
        message: 'No scored engine lines were produced.',
      } as EngineJobError;
    }
    const maxTimeMs = ranks.reduce((max, rank) => {
      const info = byMultiPv.get(rank);
      return Math.max(max, info?.timeMs ?? 0);
    }, 0);
    const timeMs = maxTimeMs > 0 ? maxTimeMs : Date.now() - this.searchStartTime;
    const engine: EngineMetadata = engineMetadataFor(
      this.assets,
      this.capabilities.build,
      job.profile,
    );
    return {
      jobId: job.id,
      position: job.fen,
      profile: job.profile,
      lines,
      engine,
      timeMs,
    };
  }

  private handleTransportError(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    const settle = this.searchSettle;
    if (settle) {
      this.searchSettle = null;
      settle.reject({ reason: 'worker-crashed', message: `Engine worker failed: ${message}` });
      return;
    }
    const active = this.active;
    if (active) {
      active.fail({ reason: 'worker-crashed', message: `Engine worker failed: ${message}` });
    }
    void this.recreateTransport();
  }

  private async teardownTransport(): Promise<void> {
    const transport = this.transport;
    this.transport = null;
    if (!transport) return;
    try {
      transport.send('quit');
    } catch {
      // Transport may already be gone.
    }
    try {
      await transport.terminate();
    } catch {
      // Ignore teardown errors.
    }
  }

  private async recreateTransport(): Promise<void> {
    this.clearWatchdog();
    this.initExpectations = [];
    await this.teardownTransport();
    this.lifecycle = 'uninitialized';
    this.notifyStatus();
  }

  private withTimeout<T>(promise: Promise<T>, ms: number, error: EngineJobError): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(error), ms);
      timer.unref?.();
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  }
}

export function createEngineService(options: EngineServiceOptions): EngineService {
  return new EngineServiceImpl(options);
}
