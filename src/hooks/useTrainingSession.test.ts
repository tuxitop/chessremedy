/**
 * useTrainingSession tests (Feature 019 §2/§3).
 *
 * Deterministic fake timers plus an injected clock: the countdown, the warning
 * state, the once-only expiry callback and the `end()` stop are all driven by a
 * mutable clock the test controls. No engine, no network, no IndexedDB.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTrainingSession } from './useTrainingSession';

const START = 1_700_000_000_000;

interface Clock {
  now(): number;
  advance(ms: number): void;
}

function makeClock(start = START): Clock {
  let current = start;
  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
    },
  };
}

describe('useTrainingSession (Feature 019)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('captures the session window once and counts down with a warning state', () => {
    const clock = makeClock();
    const onExpire = vi.fn();
    const config = { durationMs: 10_000, warningMs: 3_000 };
    const { result } = renderHook(() => useTrainingSession({ config, now: clock.now, onExpire }));

    expect(result.current.startedAt).toBe(START);
    expect(result.current.endsAt).toBe(START + 10_000);
    expect(result.current.remainingMs).toBe(10_000);
    expect(result.current.warning).toBe(false);
    expect(result.current.expired).toBe(false);

    act(() => {
      clock.advance(8_000);
      vi.advanceTimersByTime(250);
    });
    expect(result.current.remainingMs).toBe(2_000);
    expect(result.current.warning).toBe(true);
    expect(result.current.expired).toBe(false);
    expect(onExpire).not.toHaveBeenCalled();

    act(() => {
      clock.advance(2_000);
      vi.advanceTimersByTime(250);
    });
    expect(result.current.remainingMs).toBe(0);
    expect(result.current.expired).toBe(true);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('fires onExpire exactly once and clamps a backwards/overdue clock to zero', () => {
    const clock = makeClock();
    const onExpire = vi.fn();
    const config = { durationMs: 5_000, warningMs: 1_000 };
    const { result } = renderHook(() => useTrainingSession({ config, now: clock.now, onExpire }));

    act(() => {
      clock.advance(9_000);
      vi.advanceTimersByTime(250);
    });
    expect(result.current.remainingMs).toBe(0);
    expect(onExpire).toHaveBeenCalledTimes(1);

    // Later ticks never re-fire; remaining never goes negative.
    act(() => {
      clock.advance(9_000);
      vi.advanceTimersByTime(500);
    });
    expect(result.current.remainingMs).toBe(0);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('never expires an untimed session and reports a null remaining time', () => {
    const clock = makeClock();
    const onExpire = vi.fn();
    const config = { durationMs: null, warningMs: 1_000 };
    const { result } = renderHook(() => useTrainingSession({ config, now: clock.now, onExpire }));

    expect(result.current.remainingMs).toBeNull();
    expect(result.current.warning).toBe(false);
    expect(result.current.expired).toBe(false);

    act(() => {
      clock.advance(60_000);
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current.remainingMs).toBeNull();
    expect(result.current.expired).toBe(false);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('stops the countdown on end()', () => {
    const clock = makeClock();
    const onExpire = vi.fn();
    const config = { durationMs: 10_000, warningMs: 1_000 };
    const { result } = renderHook(() => useTrainingSession({ config, now: clock.now, onExpire }));

    act(() => {
      result.current.end();
    });
    act(() => {
      clock.advance(20_000);
      vi.advanceTimersByTime(1_000);
    });

    expect(result.current.remainingMs).toBe(10_000);
    expect(result.current.expired).toBe(false);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('resets to the untimed state when the config is cleared', () => {
    const clock = makeClock();
    const onExpire = vi.fn();
    const initialProps: { config: { durationMs: number | null; warningMs: number } | null } = {
      config: { durationMs: 10_000, warningMs: 1_000 },
    };
    const { result, rerender } = renderHook(
      ({ config }: typeof initialProps) => useTrainingSession({ config, now: clock.now, onExpire }),
      { initialProps },
    );
    expect(result.current.startedAt).toBe(START);

    rerender({ config: null });
    expect(result.current.startedAt).toBeNull();
    expect(result.current.endsAt).toBeNull();
    expect(result.current.remainingMs).toBeNull();
    expect(result.current.expired).toBe(false);
  });
});
