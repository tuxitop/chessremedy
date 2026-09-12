/**
 * Verification-depth setting (Feature 010 W2, ADR-026/ADR-034).
 *
 * The Stage-2 tactical verification depth is a user-facing quality/cost lever.
 * It is tuned independently of the ADR-012 `tactical` profile depth (22) and
 * defaults to 18 — deep enough to resolve the 8-ply objectives the pipeline
 * checks while keeping scans faster. It is clamped to `[10, 40]` on every read
 * and write, so an absent or invalid stored value can never produce an
 * out-of-bounds engine search. The setting is persisted under
 * `analysis.tacticalDetection` as `{ verificationDepth }`.
 *
 * Pure and framework-free: no React, Dexie or Worker imports. The effective
 * depth is part of the ADR-018 detection cache scope (with the verification
 * thread count and `VERIFY_MOVETIME_MS`), so a result produced at one depth is
 * never served to a search at another; it is **not** a freshness input.
 */

/** Default verification depth (owner decision: 18). */
export const DEFAULT_VERIFICATION_DEPTH = 18;

/** Minimum accepted verification depth. */
export const MIN_VERIFICATION_DEPTH = 10;

/** Maximum accepted verification depth. */
export const MAX_VERIFICATION_DEPTH = 40;

/** Persisted shape of the `analysis.tacticalDetection` setting. */
export interface TacticalDetectionSettings {
  readonly verificationDepth: number;
}

/**
 * Normalise a stored/requested verification depth: an absent, non-numeric or
 * non-finite value falls back to {@link DEFAULT_VERIFICATION_DEPTH}, otherwise
 * the value is rounded and clamped into `[MIN, MAX]`.
 */
export function clampVerificationDepth(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_VERIFICATION_DEPTH;
  }
  return Math.min(MAX_VERIFICATION_DEPTH, Math.max(MIN_VERIFICATION_DEPTH, Math.round(value)));
}

export function defaultTacticalDetectionSettings(): TacticalDetectionSettings {
  return { verificationDepth: DEFAULT_VERIFICATION_DEPTH };
}

/** Clamp an arbitrary stored value into a valid `TacticalDetectionSettings`. */
export function clampTacticalDetectionSettings(value: unknown): TacticalDetectionSettings {
  const raw =
    value !== null && typeof value === 'object'
      ? (value as { readonly verificationDepth?: unknown }).verificationDepth
      : undefined;
  return { verificationDepth: clampVerificationDepth(raw) };
}
