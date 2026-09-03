/**
 * Browser capability detection and build selection (Feature 005, ADR-012).
 *
 * ADR-012 consequence: default to the single-threaded lite build (no
 * SharedArrayBuffer, works on iOS Safari 16+ without COOP/COEP), and upgrade
 * to the multi-threaded lite build when cross-origin isolation is available.
 *
 * Hash is capped at 64 MB on mobile and 256 MB on desktop (ADR-012); the
 * engine never blindly allocates all CPU or memory (spec §13).
 */

import type { EngineBuildId } from './types';

export interface EngineCapabilities {
  readonly sharedArrayBuffer: boolean;
  readonly crossOriginIsolated: boolean;
  readonly hardwareConcurrency: number;
  readonly isMobile: boolean;
  /** Selected WASM build. */
  readonly build: EngineBuildId;
  /** Threads to request (1 for the single-threaded build). */
  readonly threads: number;
  /** Hash cap in MB (mobile vs desktop). */
  readonly hashCapMb: number;
}

export interface CapabilityEnvironment {
  readonly sharedArrayBuffer: boolean;
  readonly crossOriginIsolated: boolean;
  readonly hardwareConcurrency: number;
  readonly touchPoints: number;
  readonly coarsePointer: boolean;
}

const MOBILE_HASH_CAP_MB = 64;
const DESKTOP_HASH_CAP_MB = 256;
const MAX_THREADS = 2;

export function isMobileEnvironment(env: CapabilityEnvironment): boolean {
  return env.touchPoints > 0 || env.coarsePointer;
}

export function resolveEngineCapabilities(env: CapabilityEnvironment): EngineCapabilities {
  const canMultiThread =
    env.crossOriginIsolated && env.sharedArrayBuffer && env.hardwareConcurrency > 1;
  const isMobile = isMobileEnvironment(env);
  return {
    sharedArrayBuffer: env.sharedArrayBuffer,
    crossOriginIsolated: env.crossOriginIsolated,
    hardwareConcurrency: env.hardwareConcurrency,
    isMobile,
    build: canMultiThread ? 'lite' : 'lite-single',
    threads: canMultiThread ? Math.min(MAX_THREADS, env.hardwareConcurrency) : 1,
    hashCapMb: isMobile ? MOBILE_HASH_CAP_MB : DESKTOP_HASH_CAP_MB,
  };
}

/** Read capabilities from the browser environment. */
export function readBrowserCapabilities(): EngineCapabilities {
  const crossOriginIsolated =
    typeof globalThis.crossOriginIsolated === 'boolean' && globalThis.crossOriginIsolated;
  const sharedArrayBuffer = typeof globalThis.SharedArrayBuffer === 'function';
  const hardwareConcurrency =
    typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 1 : 1;
  const touchPoints = typeof navigator !== 'undefined' ? navigator.maxTouchPoints || 0 : 0;
  const coarsePointer =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches;

  return resolveEngineCapabilities({
    crossOriginIsolated,
    sharedArrayBuffer,
    hardwareConcurrency,
    touchPoints,
    coarsePointer,
  });
}
