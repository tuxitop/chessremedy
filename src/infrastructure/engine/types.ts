/**
 * Engine-layer shared types (Feature 005).
 *
 * These are the public contracts of the engine infrastructure. They reuse
 * the domain analysis tokens (`AnalysisProfile`, `EngineMetadata`, `Wdl`)
 * so every engine result can flow into later `MoveAnalysis` records without
 * mapping (ADR-018/019/020, ARCHITECTURE.md §9).
 *
 * Nothing in this file imports React, the database, or Worker globals.
 */

import type { AnalysisProfile, EngineMetadata, Wdl } from '@/domain/chess';

/** Engine WASM builds shipped by Feature 005 (ADR-012). */
export type EngineBuildId = 'lite-single' | 'lite';

export type EngineLifecycleState =
  'uninitialized' | 'initializing' | 'ready' | 'busy' | 'failed' | 'disposed';

export type AnalysisJobStatus = 'queued' | 'running' | 'completed' | 'cancelled' | 'failed';

/** Centipawn or mate evaluation, never conflated (spec §10). */
export type EngineEvaluation = { readonly cp: number } | { readonly mate: number };

/** A UCI move token (`e2e4`, `e7e8q`). */
export interface EngineMove {
  readonly uci: string;
}

export interface EngineLine {
  /** MultiPV rank, 1..N. */
  readonly multipv: number;
  readonly evaluation: EngineEvaluation;
  readonly principalVariation: readonly EngineMove[];
  /** WDL triplet; `null` when the profile did not enable `UCI_ShowWDL`. */
  readonly wdl: Wdl | null;
  readonly depth?: number;
  readonly seldepth?: number;
  readonly nodes?: number;
  readonly nps?: number;
  readonly hashfull?: number;
  readonly timeMs?: number;
}

export interface EngineAnalysisResult {
  readonly jobId: string;
  /** FEN that was analyzed. */
  readonly position: string;
  readonly profile: AnalysisProfile;
  /** MultiPV lines ordered by rank. */
  readonly lines: readonly EngineLine[];
  readonly engine: EngineMetadata;
  /** Total search time in ms (engine-reported when available). */
  readonly timeMs: number;
}

export interface EngineProgress {
  readonly jobId: string;
  readonly depth?: number;
  readonly seldepth?: number;
  readonly nodes?: number;
  readonly nps?: number;
  readonly hashfull?: number;
  readonly timeMs?: number;
  readonly multipv?: number;
  readonly evaluation?: EngineEvaluation;
  readonly principalVariation?: readonly EngineMove[];
  readonly wdl?: Wdl | null;
}

export type EngineFailureReason =
  | 'invalid-position'
  | 'engine-startup-failed'
  | 'worker-crashed'
  | 'timeout'
  | 'malformed-response'
  | 'cancelled'
  | 'disposed';

export interface EngineJobError {
  readonly reason: EngineFailureReason;
  readonly message: string;
}

export interface AnalysisOptions {
  readonly profile: AnalysisProfile;
  /** Override the profile depth limit (default: the profile's depth). */
  readonly maxDepth?: number;
  /** Time-limited search instead of depth-limited (`go movetime`). */
  readonly movetimeMs?: number;
  /**
   * Override the number of principal-variation lines (default: the
   * profile's MultiPV). Clamped to the Feature 006 cap of 1..5.
   */
  readonly multipv?: number;
  /**
   * Override the hash size in MB (default: the profile's hash). Clamped to
   * the capability cap (ADR-012: 64 MB mobile / 256 MB desktop).
   */
  readonly hashMb?: number;
  /**
   * Override the engine thread count (default: capability-derived). Ignored
   * for the single-threaded build, which has no `Threads` option.
   */
  readonly threads?: number;
}

export interface AnalysisRequest {
  readonly fen: string;
  readonly options: AnalysisOptions;
}

export type AnalysisJobEvent =
  | { readonly type: 'status'; readonly status: AnalysisJobStatus }
  | { readonly type: 'progress'; readonly progress: EngineProgress }
  | { readonly type: 'result'; readonly result: EngineAnalysisResult }
  | { readonly type: 'error'; readonly error: EngineJobError };

export type AnalysisJobOutcome =
  | { readonly kind: 'completed'; readonly result: EngineAnalysisResult }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed'; readonly error: EngineJobError };

/** A handle on one analysis request (spec §5/§6). */
export interface AnalysisJob {
  readonly id: string;
  readonly fen: string;
  readonly profile: AnalysisProfile;
  readonly status: AnalysisJobStatus;
  /** Subscribe to job events; returns an unsubscribe function. */
  subscribe(listener: (event: AnalysisJobEvent) => void): () => void;
  /** Resolves once the job reaches a terminal state. */
  readonly outcome: Promise<AnalysisJobOutcome>;
  cancel(): void;
}

export interface EngineServiceStatus {
  readonly lifecycle: EngineLifecycleState;
  readonly engine: {
    readonly engineName: string;
    readonly engineVersion: string;
    readonly engineBuild: string;
  } | null;
  readonly build: EngineBuildId | null;
  readonly activeJobId: string | null;
  readonly queued: number;
}

export interface EngineService {
  /** Analyze a FEN. Validates before any Worker traffic. */
  analyze(fen: string, options?: Partial<AnalysisOptions>): AnalysisJob;
  cancel(jobId: string): void;
  cancelAll(): void;
  getStatus(): EngineServiceStatus;
  /** Notified whenever the lifecycle changes; returns an unsubscribe. */
  onStatusChange(listener: (status: EngineServiceStatus) => void): () => void;
  dispose(): Promise<void>;
}

/** Thin transport over a single engine Worker (spec §15). */
export interface EngineTransport {
  /** Create the underlying worker. Resolves once created. */
  start(): Promise<void>;
  /** Send one UCI command line. */
  send(command: string): void;
  /** Receive raw engine output lines; returns an unsubscribe. */
  onOutput(listener: (line: string) => void): () => void;
  /** Receive worker-level errors (e.g. crash); returns an unsubscribe. */
  onError(listener: (error: unknown) => void): () => void;
  /** Terminate the worker and release resources. */
  terminate(): Promise<void>;
}

export type EngineTransportFactory = () => EngineTransport;
