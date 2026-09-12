/**
 * Feature 016 — sync scheduler (infrastructure).
 *
 * Drives periodic/opportunistic `SyncService.syncNow()` rounds from the
 * composition root and from browser lifecycle events (plan §8.4). Triggers:
 *
 * - `start()` — bootstrap, only when a provider reports connected.
 * - `online` — the device came back online.
 * - `visibilitychange` → `visible` — the tab/app returned to the foreground.
 * - a debounced interval poll (default 5 minutes, research §8).
 *
 * There is deliberately **no per-record queue**: the persisted `pending` flag
 * and the `syncTombstones` table are the durable offline queue (G3), and the
 * engine re-derives the local payload on every round. The scheduler only
 * decides *when* to run.
 *
 * Safety contract: every trigger is best-effort. `syncNow()` rejections are
 * swallowed, `isConnected()` failures abort the start, listeners are attached
 * only after a successful connection check, and no public method ever throws.
 */

/** Default interval poll (5 minutes, per research §8). */
export const SYNC_SCHEDULER_DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

/** Default coalescing window for rapid automatic triggers. */
export const SYNC_SCHEDULER_DEFAULT_DEBOUNCE_MS = 1000;

/**
 * The minimal slice of `SyncService` the scheduler drives. Kept structural so
 * tests can pass a fake and the scheduler stays independent of the engine.
 */
export interface SyncSchedulerService {
  /** Whether a usable credential is currently stored. */
  isConnected(): Promise<boolean>;
  /** Run one best-effort synchronization round. */
  syncNow(): Promise<unknown>;
}

/** A listener source (`window`/`document`) the scheduler can attach to. */
export interface SyncSchedulerEventSource {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

/** The `document` surface the scheduler reads (visibility trigger). */
export interface SyncSchedulerDocument extends SyncSchedulerEventSource {
  readonly visibilityState: string;
}

/** Injected dependencies of `createSyncScheduler`. */
export interface SyncSchedulerOptions {
  readonly service: SyncSchedulerService;
  /** Clock injection for deterministic trigger stamps. Defaults to `Date.now`. */
  readonly now?: () => number;
  /** Interval poll in millis. Defaults to `SYNC_SCHEDULER_DEFAULT_INTERVAL_MS`. */
  readonly intervalMs?: number;
  /** Coalescing window for automatic triggers. Defaults to `SYNC_SCHEDULER_DEFAULT_DEBOUNCE_MS`. */
  readonly debounceMs?: number;
  /** Visibility source; defaults to the global `document` when present. */
  readonly document?: SyncSchedulerDocument;
  /** Online-event source; defaults to the global `window` when present. */
  readonly window?: SyncSchedulerEventSource;
}

/** The scheduler surface returned by `createSyncScheduler`. */
export interface SyncScheduler {
  /** Attach listeners and start polling, but only when connected. Idempotent. */
  start(): Promise<void>;
  /** Detach listeners and clear every timer. Safe to call repeatedly. */
  stop(): void;
  /** Request an immediate round, coalescing with any in-flight round. */
  triggerNow(): void;
  /** Epoch millis of the last requested trigger, or `null` before the first. */
  getLastTriggeredAt(): number | null;
}

/**
 * Build a best-effort sync scheduler. It never throws: `start()` returns
 * quietly when the provider is disconnected or the connection probe fails, and
 * every `syncNow()` rejection is swallowed.
 */
export function createSyncScheduler(options: SyncSchedulerOptions): SyncScheduler {
  const service = options.service;
  const now = options.now ?? Date.now;
  const intervalMs = options.intervalMs ?? SYNC_SCHEDULER_DEFAULT_INTERVAL_MS;
  const debounceMs = options.debounceMs ?? SYNC_SCHEDULER_DEFAULT_DEBOUNCE_MS;
  const doc = options.document ?? (typeof document !== 'undefined' ? document : undefined);
  const win = options.window ?? (typeof window !== 'undefined' ? window : undefined);

  let started = false;
  let running = false;
  let generation = 0;
  let lastTriggeredAt: number | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let intervalTimer: ReturnType<typeof setInterval> | null = null;

  /** One best-effort round; concurrent requests coalesce on `running`. */
  async function runOnce(): Promise<void> {
    if (running) {
      return;
    }
    running = true;
    try {
      await service.syncNow();
    } catch {
      // Best-effort: a failed sync must never break the trigger or the caller.
    } finally {
      running = false;
    }
  }

  function clearDebounce(): void {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  }

  /** Debounced request used by the automatic triggers (online/visibility/interval). */
  function scheduleSync(): void {
    if (!started) {
      return;
    }
    lastTriggeredAt = now();
    clearDebounce();
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void runOnce();
    }, debounceMs);
  }

  function triggerNow(): void {
    if (!started) {
      return;
    }
    lastTriggeredAt = now();
    clearDebounce();
    void runOnce();
  }

  function onOnline(): void {
    scheduleSync();
  }

  function onVisibility(): void {
    if (doc?.visibilityState === 'visible') {
      scheduleSync();
    }
  }

  function attach(): void {
    win?.addEventListener('online', onOnline);
    doc?.addEventListener('visibilitychange', onVisibility);
    intervalTimer = setInterval(() => scheduleSync(), intervalMs);
  }

  function detach(): void {
    win?.removeEventListener('online', onOnline);
    doc?.removeEventListener('visibilitychange', onVisibility);
    if (intervalTimer !== null) {
      clearInterval(intervalTimer);
      intervalTimer = null;
    }
    clearDebounce();
  }

  async function start(): Promise<void> {
    if (started) {
      return;
    }
    const token = generation;
    try {
      if (!(await service.isConnected())) {
        return;
      }
    } catch {
      return;
    }
    // `stop()` may have raced the connection probe; honour it.
    if (token !== generation || started) {
      return;
    }
    started = true;
    attach();
    triggerNow();
  }

  function stop(): void {
    generation += 1;
    started = false;
    detach();
  }

  return {
    start,
    stop,
    triggerNow,
    getLastTriggeredAt: () => lastTriggeredAt,
  };
}
