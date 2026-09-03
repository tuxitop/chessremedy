/**
 * Session engine-analysis cache (Feature 006).
 *
 * Feature 005 deliberately left the ADR-018 position-keyed IndexedDB cache to
 * the feature that persists analyses (Feature 008). Feature 006 still needs a
 * cache so repeated positions on the live board are not re-analysed: this
 * module layers a transparent, in-memory cache over an `EngineService`
 * (decorator), keyed by the ADR-018 tuple plus the live-analysis overrides.
 *
 * When Feature 008 lands, the IndexedDB table plugs into the same seam: the
 * decorator depends on an `EngineAnalysisCache` interface and the browser
 * assembly picks the store. The cache is never exposed in the UI and never
 * synced (ADR-018).
 */

import { fenOf, parsePositionFen, type AnalysisProfile, type EngineMetadata } from '@/domain/chess';
import { AnalysisJobHandle, clampMultipv, type JobOptions } from './engineService';
import type {
  AnalysisJob,
  AnalysisJobEvent,
  AnalysisOptions,
  EngineAnalysisResult,
  EngineService,
  EngineServiceStatus,
} from './types';

export interface EngineAnalysisCache {
  get(key: string): Promise<EngineAnalysisResult | undefined>;
  put(key: string, result: EngineAnalysisResult): Promise<void>;
}

/** Simple in-memory implementation of `EngineAnalysisCache`. */
export class SessionAnalysisCache implements EngineAnalysisCache {
  private readonly map = new Map<string, EngineAnalysisResult>();

  async get(key: string): Promise<EngineAnalysisResult | undefined> {
    return this.map.get(key);
  }

  async put(key: string, result: EngineAnalysisResult): Promise<void> {
    this.map.set(key, result);
  }

  /** Synchronous peek — the live board checks the in-memory store inline. */
  peek(key: string): EngineAnalysisResult | undefined {
    return this.map.get(key);
  }

  /** Test helper: number of live entries. */
  get size(): number {
    return this.map.size;
  }
}

/** Canonical FEN for keying (falls back to the raw string when unparsable). */
export function canonicalFen(fen: string): string {
  const parsed = parsePositionFen(fen);
  return parsed.ok ? fenOf(parsed.position) : fen;
}

interface CacheEntryScope {
  readonly profile: AnalysisProfile;
  readonly maxDepth?: number;
  readonly movetimeMs?: number;
  readonly multipv?: number;
  readonly hashMb?: number;
  readonly threads?: number;
}

/**
 * Session cache key for one request: the canonical FEN, the ADR-018
 * (profile, engineName, engineVersion, engineBuild) tuple and the effective
 * depth / time / MultiPV / hash / threads overrides. When no overrides are in
 * effect this is exactly the ADR-018 tuple scope.
 */
export function analysisCacheKey(
  fen: string,
  entry: CacheEntryScope,
  engine: Pick<EngineMetadata, 'engineName' | 'engineVersion' | 'engineBuild'>,
): string {
  const parts = [
    canonicalFen(fen),
    entry.profile,
    engine.engineName,
    engine.engineVersion,
    engine.engineBuild,
  ];
  parts.push(
    entry.maxDepth !== undefined ? `d:${entry.maxDepth}` : 'd:',
    entry.movetimeMs !== undefined ? `t:${entry.movetimeMs}` : 't:',
    entry.multipv !== undefined ? `m:${entry.multipv}` : 'm:',
    entry.hashMb !== undefined ? `h:${entry.hashMb}` : 'h:',
    entry.threads !== undefined ? `r:${entry.threads}` : 'r:',
  );
  return parts.join('|');
}

function jobOptionsFor(options?: Partial<AnalysisOptions>): JobOptions {
  return {
    profile: options?.profile ?? 'normal',
    ...(options?.maxDepth !== undefined ? { maxDepth: options.maxDepth } : {}),
    ...(options?.movetimeMs !== undefined ? { movetimeMs: options.movetimeMs } : {}),
    ...(options?.multipv !== undefined ? { multipv: clampMultipv(options.multipv) } : {}),
    ...(options?.hashMb !== undefined ? { hashMb: options.hashMb } : {}),
    ...(options?.threads !== undefined ? { threads: options.threads } : {}),
  };
}

function scopeFor(options?: Partial<AnalysisOptions>): CacheEntryScope {
  return {
    profile: options?.profile ?? 'normal',
    ...(options?.maxDepth !== undefined ? { maxDepth: options.maxDepth } : {}),
    ...(options?.movetimeMs !== undefined ? { movetimeMs: options.movetimeMs } : {}),
    ...(options?.multipv !== undefined ? { multipv: options.multipv } : {}),
    ...(options?.hashMb !== undefined ? { hashMb: options.hashMb } : {}),
    ...(options?.threads !== undefined ? { threads: options.threads } : {}),
  };
}

function engineOf(
  status: EngineServiceStatus,
): Pick<EngineMetadata, 'engineName' | 'engineVersion' | 'engineBuild'> | null {
  return status.engine;
}

/**
 * Wrap an `EngineService` with a position-keyed cache. A cache hit returns a
 * handle that completes immediately with the stored result (no Worker
 * traffic); a miss delegates to the wrapped service and is stored on
 * completion. All other methods pass straight through.
 */
export function createCachedEngineService(
  inner: EngineService,
  cache: EngineAnalysisCache = new SessionAnalysisCache(),
): EngineService {
  // Remember the resolved engine identity so subsequent requests can be
  // served from cache before the worker is even started again.
  let knownEngine = engineOf(inner.getStatus());
  inner.onStatusChange((status) => {
    const engine = engineOf(status);
    if (engine) {
      knownEngine = engine;
    }
  });

  const analyze = (fen: string, options?: Partial<AnalysisOptions>): AnalysisJob => {
    const identity = knownEngine ?? engineOf(inner.getStatus());
    const scope = scopeFor(options);
    if (identity) {
      const key = analysisCacheKey(fen, scope, identity);
      const cached = cache instanceof SessionAnalysisCache ? cache.peek(key) : undefined;
      if (cached !== undefined) {
        const handle = new AnalysisJobHandle(fen, jobOptionsFor(options), () => {
          handle.cancelFinish();
        });
        queueMicrotask(() => handle.complete(cached));
        return handle;
      }
    }

    const job = inner.analyze(fen, options);
    job.subscribe((event: AnalysisJobEvent) => {
      if (event.type === 'result' && event.result.position === fen) {
        void cache.put(
          analysisCacheKey(fen, scope, event.result.engine as EngineMetadata),
          event.result,
        );
      }
    });
    return job;
  };

  return {
    analyze,
    cancel: (jobId) => inner.cancel(jobId),
    cancelAll: () => inner.cancelAll(),
    getStatus: () => inner.getStatus(),
    onStatusChange: (listener) => inner.onStatusChange(listener),
    dispose: () => inner.dispose(),
  };
}
