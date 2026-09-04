/**
 * Provider adapter contract (Feature 007).
 *
 * Chess.com and Lichess HTTP shapes stay isolated behind a provider-agnostic
 * adapter so the orchestration service never imports provider modules. An
 * adapter is stateless — the import job's opaque `cursor` carries all resume
 * state between `fetchPage` calls.
 */

import type { ProviderGameRecord, ImportProvider } from '@/domain/import/providerGame';
import type { TimeWindow } from '@/domain/import/filters';

/** A game the provider returned but the importer will not store (variant …). */
export interface ProviderSkip {
  readonly externalId: string | null;
  readonly reason: string;
}

/** One page of a provider walk plus where to resume. */
export interface ProviderPageResult {
  readonly records: readonly ProviderGameRecord[];
  readonly skipped: readonly ProviderSkip[];
  /** `null` when the provider is exhausted (run complete). */
  readonly nextCursor: unknown;
  /** Deterministic position for progress (e.g. Chess.com archive i of n). */
  readonly position: { readonly current: number; readonly total: number } | null;
}

export interface ProviderAdapter {
  readonly provider: ImportProvider;
  /** Verify the account exists; throws a typed `ProviderHttpError`. */
  validateUsername(username: string, signal: AbortSignal): Promise<void>;
  fetchPage(
    username: string,
    cursor: unknown,
    window: TimeWindow,
    signal: AbortSignal,
  ): Promise<ProviderPageResult>;
}
