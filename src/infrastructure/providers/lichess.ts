/**
 * Lichess games-export adapter (Feature 007).
 *
 * Streams NDJSON (`Accept: application/x-ndjson`, `pgnInJson=true`) over
 * `/api/games/user/{username}`, paged with the `since`/`until`/`max` query
 * params. The job cursor is the `since` timestamp (ms) of the last fetched
 * game; resumption re-streams from that cursor and id-level dedupe absorbs
 * overlaps. Lichess perf-type boundaries do not align with the normalized
 * clock categories (ADR-013), so no `perfType` server hint is sent — the
 * shared record-level category filter is authoritative.
 */

import type { ProviderAdapter, ProviderPageResult, ProviderSkip } from './types';
import type { ProviderGameRecord } from '@/domain/import/providerGame';
import type { TimeWindow } from '@/domain/import/filters';
import {
  LICHESS_POLICY,
  fetchWithRetry,
  type FetchLike,
  type RetryPolicy,
  ProviderHttpError,
} from './transport';

const LICHESS_BASE = 'https://lichess.org';
const MAX_GAMES_PER_PAGE = 1000;

interface LichessLine {
  readonly id?: string;
  readonly variant?: string;
  readonly createdAt?: number;
  readonly pgn?: string;
  readonly clock?: { readonly initial?: number; readonly increment?: number };
  readonly players?: {
    readonly white?: { readonly user?: { readonly name?: string }; readonly rating?: number };
    readonly black?: { readonly user?: { readonly name?: string }; readonly rating?: number };
  };
}

export interface LichessAdapterOptions {
  readonly fetchImpl: FetchLike;
  readonly policy?: RetryPolicy;
  readonly maxGamesPerPage?: number;
}

export class LichessAdapter implements ProviderAdapter {
  readonly provider = 'lichess' as const;

  private readonly fetchImpl: FetchLike;
  private readonly policy: RetryPolicy;
  private readonly maxGamesPerPage: number;

  constructor(options: LichessAdapterOptions) {
    this.fetchImpl = options.fetchImpl;
    this.policy = options.policy ?? LICHESS_POLICY;
    this.maxGamesPerPage = options.maxGamesPerPage ?? MAX_GAMES_PER_PAGE;
  }

  async validateUsername(username: string, signal: AbortSignal): Promise<void> {
    await fetchWithRetry(
      this.fetchImpl,
      `${LICHESS_BASE}/api/user/${encodeURIComponent(username)}`,
      { signal },
      this.policy,
    );
  }

  async fetchPage(
    username: string,
    cursor: unknown,
    window: TimeWindow,
    signal: AbortSignal,
  ): Promise<ProviderPageResult> {
    const cursorSince = typeof cursor === 'number' ? cursor : null;
    const since = Math.max(cursorSince ?? 0, window.fromMs ?? 0);

    const params = new URLSearchParams({
      pgnInJson: 'true',
      max: String(this.maxGamesPerPage),
    });
    if (since > 0) {
      params.set('since', String(since));
    }
    if (window.toMs !== null) {
      params.set('until', String(window.toMs));
    }

    const url = `${LICHESS_BASE}/api/games/user/${encodeURIComponent(username)}?${params.toString()}`;
    const response = await fetchWithRetry(
      this.fetchImpl,
      url,
      {
        headers: { Accept: 'application/x-ndjson' },
        signal,
      },
      this.policy,
    );

    let text: string;
    try {
      text = await response.text();
    } catch {
      throw new ProviderHttpError('invalid-response', 'Could not read the NDJSON stream.');
    }

    const lines = text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');

    const records: ProviderGameRecord[] = [];
    const skipped: ProviderSkip[] = [];
    let lastCreatedAt = -1;

    for (const line of lines) {
      let parsed: LichessLine;
      try {
        parsed = JSON.parse(line) as LichessLine;
      } catch {
        skipped.push({ externalId: null, reason: 'Malformed NDJSON line skipped.' });
        continue;
      }
      const externalId = parsed.id?.trim() ?? '';
      if (typeof parsed.createdAt === 'number') {
        lastCreatedAt = Math.max(lastCreatedAt, parsed.createdAt);
      }
      if (externalId === '') {
        skipped.push({ externalId: null, reason: 'Game record has no id.' });
        continue;
      }
      const variant = parsed.variant ?? 'standard';
      if (variant !== 'standard') {
        skipped.push({
          externalId,
          reason: `Unsupported variant (${variant}).`,
        });
        continue;
      }
      records.push(recordOf(username, parsed, externalId));
    }

    if (lines.length < this.maxGamesPerPage || lastCreatedAt < 0) {
      return { records, skipped, nextCursor: null, position: null };
    }
    // Advance past the last seen instant; guard against a page whose cursor
    // would not move (all games sharing a timestamp) by nudging forward.
    const nextSince = lastCreatedAt > (cursorSince ?? -1) ? lastCreatedAt : (cursorSince ?? -1) + 1;
    return { records, skipped, nextCursor: nextSince, position: null };
  }
}

function recordOf(username: string, game: LichessLine, externalId: string): ProviderGameRecord {
  const white = game.players?.white;
  const black = game.players?.black;
  return {
    source: 'lichess',
    externalId,
    username,
    pgn: game.pgn ?? '',
    playedAtIso: typeof game.createdAt === 'number' ? new Date(game.createdAt).toISOString() : null,
    timeControlRaw: clockRaw(game.clock),
    whiteName: white?.user?.name ?? '',
    blackName: black?.user?.name ?? '',
    whiteElo: numberOrNull(white?.rating),
    blackElo: numberOrNull(black?.rating),
  };
}

function clockRaw(
  clock: { readonly initial?: number; readonly increment?: number } | undefined,
): string | null {
  if (!clock || typeof clock.initial !== 'number') {
    return null;
  }
  const increment = typeof clock.increment === 'number' ? clock.increment : 0;
  return increment > 0 ? `${clock.initial}+${increment}` : String(clock.initial);
}

function numberOrNull(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
