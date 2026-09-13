/**
 * Feature 019 — timed-training session timer (wall-clock).
 *
 * A small, ephemeral countdown over an existing cycle session. It owns only the
 * session's wall-clock window: when a `SessionConfig` is supplied it captures the
 * start instant once per config identity, derives the remaining time / warning /
 * expiry state with the pure `sessionTimerState`, and fires `onExpire` exactly
 * once at zero. Nothing is persisted and the hook never touches the cycle or an
 * attempt row (Feature 019 §2/§3).
 *
 * The window is captured with the render-time "adjust state when a prop changes"
 * pattern (no effect cascade), the interval is the only timer the hook owns, and
 * `end()` stops it. The clock is injectable so the countdown is deterministic
 * under `vi.useFakeTimers()` in tests.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { sessionTimerState, type SessionConfig, type SessionTimerState } from '@/domain/training';

/** Wall-clock tick for the session countdown (millis). */
export const SESSION_TIMER_TICK_MS = 250;

/** The timer state for a session with no wall-clock limit. */
const UNTIMED_STATE: SessionTimerState = { remainingMs: null, expired: false, warning: false };

/** The captured wall-clock window of one session config. */
interface CapturedSession {
  readonly config: SessionConfig;
  readonly startedAt: number;
  readonly endsAt: number | null;
}

/** Options for `useTrainingSession` (one mounted timed session). */
export interface UseTrainingSessionOptions {
  /** The active session config, or `null` while no session is running. */
  readonly config: SessionConfig | null;
  /** Wall clock (Unix epoch millis), injectable for deterministic tests. */
  readonly now?: () => number;
  /** Called exactly once when the session reaches zero. */
  readonly onExpire: () => void;
}

/** The session timer state the session chrome consumes. */
export interface TrainingSessionTimer {
  /** Time until the session ends, clamped at `0`; `null` when untimed. */
  readonly remainingMs: number | null;
  /** True when remaining time is at or below the warning threshold. */
  readonly warning: boolean;
  /** True once the session has reached zero (never for an untimed session). */
  readonly expired: boolean;
  /** The captured session start instant, or `null` when no session is running. */
  readonly startedAt: number | null;
  /** The captured session end instant, or `null` when untimed/inactive. */
  readonly endsAt: number | null;
  /** Stop the countdown (End session); the captured window is kept. */
  end(): void;
}

/** Read the wall clock; a module-level default keeps the hook's `now` stable. */
function defaultNow(): number {
  return Date.now();
}

/**
 * Drive one timed training session. See the module header for the contract.
 */
export function useTrainingSession(options: UseTrainingSessionOptions): TrainingSessionTimer {
  const { config, onExpire } = options;
  const now = options.now ?? defaultNow;

  // Capture the window when the config identity changes (render-time state
  // adjustment, so no effect cascade and the first committed render is ready).
  const [captured, setCaptured] = useState<CapturedSession | null>(null);
  if (config === null) {
    if (captured !== null) {
      setCaptured(null);
    }
  } else if (captured === null || captured.config !== config) {
    const startedAt = now();
    setCaptured({
      config,
      startedAt,
      endsAt: config.durationMs === null ? null : startedAt + config.durationMs,
    });
  }

  // Reset the derived timer state to the freshly captured window.
  const [timer, setTimer] = useState<SessionTimerState>(UNTIMED_STATE);
  const [ended, setEnded] = useState(false);
  const [timerSource, setTimerSource] = useState<CapturedSession | null>(null);
  if (captured !== timerSource) {
    setTimerSource(captured);
    setEnded(false);
    setTimer(
      captured === null
        ? UNTIMED_STATE
        : sessionTimerState({
            now: captured.startedAt,
            endsAt: captured.endsAt,
            warningMs: captured.config.warningMs,
          }),
    );
  }

  // Latest injected clock / callback without re-running the interval effect.
  const nowRef = useRef(now);
  const onExpireRef = useRef(onExpire);
  const notifiedForRef = useRef<CapturedSession | null>(null);
  useEffect(() => {
    nowRef.current = now;
  }, [now]);
  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  // Tick only while a timed, un-ended window is active; the callback is where
  // the state update belongs (never synchronously in the effect body).
  useEffect(() => {
    if (ended || captured === null || captured.endsAt === null) {
      return undefined;
    }
    const id = window.setInterval(() => {
      setTimer(
        sessionTimerState({
          now: nowRef.current(),
          endsAt: captured.endsAt,
          warningMs: captured.config.warningMs,
        }),
      );
    }, SESSION_TIMER_TICK_MS);
    return () => window.clearInterval(id);
  }, [ended, captured]);

  // Fire `onExpire` once per captured window when it reaches zero.
  useEffect(() => {
    if (captured === null || !timer.expired || notifiedForRef.current === captured) {
      return;
    }
    notifiedForRef.current = captured;
    onExpireRef.current();
  }, [captured, timer.expired]);

  const end = useCallback((): void => {
    setEnded(true);
  }, []);

  return {
    remainingMs: timer.remainingMs,
    warning: timer.warning,
    expired: timer.expired,
    startedAt: captured?.startedAt ?? null,
    endsAt: captured?.endsAt ?? null,
    end,
  };
}
