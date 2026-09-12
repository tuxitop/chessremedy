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
  /**
   * Effective analysis-engine thread cap for this instance: the global thread
   * budget minus the threads reserved for the dedicated verification engine
   * (ADR-034). Always 1 on the single-threaded build.
   */
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

/** Hard per-engine thread ceiling (ADR-012). */
export const MAX_THREADS_CAP = 8;

/** Threads reserved for the dedicated verification engine (ADR-034). */
export const VERIFICATION_THREADS = 1;

/** Whether the environment can run the multi-threaded `lite` build. */
export function canMultiThread(env: CapabilityEnvironment): boolean {
  return env.crossOriginIsolated && env.sharedArrayBuffer && env.hardwareConcurrency > 1;
}

/**
 * Global engine thread budget `B` shared by the analysis and verification
 * engines (ADR-034). Always 1 on the single-threaded build.
 */
export function globalThreadBudget(canMT: boolean, hardwareConcurrency: number): number {
  return canMT ? Math.max(1, Math.min(hardwareConcurrency, MAX_THREADS_CAP)) : 1;
}

/**
 * Analysis-engine thread cap: the global budget minus the reserved
 * verification threads, never below 1. User requests are clamped to this cap
 * by the engine service (`clampThreads`), giving
 * `tA = clamp(userRequested, 1, max(1, B - VERIFICATION_THREADS))`.
 */
export function analysisThreadCap(budget: number): number {
  return Math.max(1, budget - VERIFICATION_THREADS);
}

/** Verification-engine thread count (fixed, not user-facing in V1). */
export function verificationThreadCap(): number {
  return VERIFICATION_THREADS;
}

/**
 * Capabilities for the dedicated verification engine: the same build and hash
 * cap as the analysis engine, but exactly 1 search thread (ADR-034).
 */
export function verificationCapabilities(capabilities: EngineCapabilities): EngineCapabilities {
  return { ...capabilities, threads: verificationThreadCap() };
}

export function isMobileEnvironment(env: CapabilityEnvironment): boolean {
  return env.touchPoints > 0 || env.coarsePointer;
}

export function resolveEngineCapabilities(env: CapabilityEnvironment): EngineCapabilities {
  const canMT = canMultiThread(env);
  const isMobile = isMobileEnvironment(env);
  const budget = globalThreadBudget(canMT, env.hardwareConcurrency);
  return {
    sharedArrayBuffer: env.sharedArrayBuffer,
    crossOriginIsolated: env.crossOriginIsolated,
    hardwareConcurrency: env.hardwareConcurrency,
    isMobile,
    build: canMT ? 'lite' : 'lite-single',
    threads: analysisThreadCap(budget),
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
