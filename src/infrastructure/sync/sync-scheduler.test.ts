/**
 * Feature 016 — sync scheduler tests (plan §11).
 *
 * Deterministic: fake timers, an injected clock and fake event targets. The
 * cases cover the four triggers, debounce coalescing, the connection gate, the
 * best-effort (never-throw) contract and listener/timer teardown.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSyncScheduler,
  type SyncSchedulerDocument,
  type SyncSchedulerEventSource,
  type SyncSchedulerService,
} from './sync-scheduler';

const INTERVAL_MS = 60_000;
const DEBOUNCE_MS = 250;
const FIXED_NOW = 1_700_000_000_000;

/** A minimal `window`/`document` event source that records its listeners. */
class FakeEventSource implements SyncSchedulerEventSource {
  private readonly listeners = new Map<string, Set<() => void>>();

  readonly addEventListener = vi.fn((type: string, listener: () => void) => {
    const set = this.listeners.get(type) ?? new Set<() => void>();
    set.add(listener);
    this.listeners.set(type, set);
  });

  readonly removeEventListener = vi.fn((type: string, listener: () => void) => {
    this.listeners.get(type)?.delete(listener);
  });

  dispatch(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener();
    }
  }

  count(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

class FakeDocument extends FakeEventSource implements SyncSchedulerDocument {
  visibilityState = 'visible';
}

function createService(connected = true): {
  isConnected: ReturnType<typeof vi.fn>;
  syncNow: ReturnType<typeof vi.fn>;
} {
  return {
    isConnected: vi.fn(async () => connected),
    syncNow: vi.fn(async () => ({ outcome: 'up-to-date' as const })),
  };
}

function setup(options: { connected?: boolean } = {}): {
  service: ReturnType<typeof createService>;
  doc: FakeDocument;
  win: FakeEventSource;
  scheduler: ReturnType<typeof createSyncScheduler>;
} {
  const service = createService(options.connected ?? true);
  const doc = new FakeDocument();
  const win = new FakeEventSource();
  const scheduler = createSyncScheduler({
    service: service as SyncSchedulerService,
    now: () => FIXED_NOW,
    intervalMs: INTERVAL_MS,
    debounceMs: DEBOUNCE_MS,
    document: doc,
    window: win,
  });
  return { service, doc, win, scheduler };
}

describe('createSyncScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('attaches listeners and runs an initial round when connected', async () => {
    const { service, doc, win, scheduler } = setup();

    await scheduler.start();

    expect(service.isConnected).toHaveBeenCalledTimes(1);
    expect(win.addEventListener).toHaveBeenCalledWith('online', expect.any(Function));
    expect(doc.addEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(service.syncNow).toHaveBeenCalledTimes(1);
    expect(scheduler.getLastTriggeredAt()).toBe(FIXED_NOW);

    scheduler.stop();
  });

  it('is idempotent: a second start does not double-attach', async () => {
    const { win, scheduler } = setup();

    await scheduler.start();
    await scheduler.start();

    expect(win.addEventListener).toHaveBeenCalledTimes(1);

    scheduler.stop();
  });

  it('skips listeners and sync when the provider is not connected', async () => {
    const { service, doc, win, scheduler } = setup({ connected: false });

    await scheduler.start();

    expect(service.isConnected).toHaveBeenCalledTimes(1);
    expect(service.syncNow).not.toHaveBeenCalled();
    expect(win.addEventListener).not.toHaveBeenCalled();
    expect(doc.addEventListener).not.toHaveBeenCalled();
  });

  it('skips when the connection probe rejects, without throwing', async () => {
    const { service, scheduler } = setup();
    service.isConnected.mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(scheduler.start()).resolves.toBeUndefined();

    expect(service.syncNow).not.toHaveBeenCalled();
  });

  it('debounces the online trigger', async () => {
    const { service, win, scheduler } = setup();
    await scheduler.start();
    service.syncNow.mockClear();

    win.dispatch('online');
    expect(service.syncNow).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(service.syncNow).toHaveBeenCalledTimes(1);

    scheduler.stop();
  });

  it('triggers only when visibilitychange reports visible', async () => {
    const { service, doc, scheduler } = setup();
    await scheduler.start();
    service.syncNow.mockClear();

    doc.visibilityState = 'hidden';
    doc.dispatch('visibilitychange');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(service.syncNow).not.toHaveBeenCalled();

    doc.visibilityState = 'visible';
    doc.dispatch('visibilitychange');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(service.syncNow).toHaveBeenCalledTimes(1);

    scheduler.stop();
  });

  it('triggers on the interval poll', async () => {
    const { service, scheduler } = setup();
    await scheduler.start();
    service.syncNow.mockClear();

    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(service.syncNow).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(service.syncNow).toHaveBeenCalledTimes(1);

    scheduler.stop();
  });

  it('coalesces rapid triggers into a single round', async () => {
    const { service, win, scheduler } = setup();
    await scheduler.start();
    service.syncNow.mockClear();

    win.dispatch('online');
    win.dispatch('online');
    win.dispatch('online');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(service.syncNow).toHaveBeenCalledTimes(1);

    scheduler.stop();
  });

  it('coalesces concurrent triggerNow calls', async () => {
    const { service, scheduler } = setup();
    await scheduler.start();
    service.syncNow.mockClear();

    scheduler.triggerNow();
    scheduler.triggerNow();
    scheduler.triggerNow();

    expect(service.syncNow).toHaveBeenCalledTimes(1);

    scheduler.stop();
  });

  it('never throws when syncNow rejects', async () => {
    const { service, scheduler } = setup();
    service.syncNow.mockRejectedValue(new Error('network down'));

    await expect(scheduler.start()).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await vi.advanceTimersByTimeAsync(0);

    expect(service.syncNow).toHaveBeenCalledTimes(1);
    expect(() => scheduler.triggerNow()).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);

    scheduler.stop();
  });

  it('stop detaches listeners, clears the interval and cancels pending work', async () => {
    const { service, doc, win, scheduler } = setup();
    await scheduler.start();

    win.dispatch('online');
    scheduler.stop();

    expect(win.removeEventListener).toHaveBeenCalledWith('online', expect.any(Function));
    expect(doc.removeEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(win.count('online')).toBe(0);
    expect(doc.count('visibilitychange')).toBe(0);

    service.syncNow.mockClear();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS + DEBOUNCE_MS);
    expect(service.syncNow).not.toHaveBeenCalled();

    win.dispatch('online');
    scheduler.triggerNow();
    expect(service.syncNow).not.toHaveBeenCalled();
  });

  it('stop during the connection probe aborts the pending start', async () => {
    const { service, win, scheduler } = setup();
    let resolveConnection: (value: boolean) => void = () => {};
    service.isConnected.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        resolveConnection = resolve;
      }),
    );

    const starting = scheduler.start();
    scheduler.stop();
    resolveConnection(true);
    await starting;

    expect(service.syncNow).not.toHaveBeenCalled();
    expect(win.addEventListener).not.toHaveBeenCalled();
  });
});
