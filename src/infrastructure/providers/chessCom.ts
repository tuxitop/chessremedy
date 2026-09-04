/**
 * Chess.com PubAPI adapter (Feature 007).
 *
 * Walks the published-data archives: `archives` (list of monthly archive
 * URLs) → each monthly archive JSON whose games embed a PGN. Requests are
 * strictly serial with a polite inter-month delay; the adapter is stateless
 * and encodes its walk position (months + index) into the job cursor so an
 * interrupted import resumes without re-fetching earlier months.
 */

import type { ProviderAdapter, ProviderPageResult, ProviderSkip } from './types';
import type { ProviderGameRecord } from '@/domain/import/providerGame';
import type { TimeWindow } from '@/domain/import/filters';
import {
  CHESS_COM_POLICY,
  fetchWithRetry,
  sleep,
  type FetchLike,
  type RetryPolicy,
  ProviderHttpError,
} from './transport';

const CHESS_COM_BASE = 'https://api.chess.com/pub/player';

interface ChessCursor {
  readonly months: readonly string[];
  readonly index: number;
}

interface ChessGamePayload {
  readonly url: string;
  readonly pgn?: string;
  readonly rules?: string;
  readonly time_control?: string;
  readonly end_time?: number;
  readonly white?: { readonly username?: string; readonly rating?: number };
  readonly black?: { readonly username?: string; readonly rating?: number };
}

export interface ChessComAdapterOptions {
  readonly fetchImpl: FetchLike;
  readonly policy?: RetryPolicy;
  /** Polite delay between monthly archive requests (research: 100 ms). */
  readonly politeDelayMs?: number;
}

const MONTH_PATTERN = /\/games\/(\d{4})\/(\d{2})$/;

export class ChessComAdapter implements ProviderAdapter {
  readonly provider = 'chesscom' as const;

  private readonly fetchImpl: FetchLike;
  private readonly policy: RetryPolicy;
  private readonly politeDelayMs: number;

  constructor(options: ChessComAdapterOptions) {
    this.fetchImpl = options.fetchImpl;
    this.policy = options.policy ?? CHESS_COM_POLICY;
    this.politeDelayMs = options.politeDelayMs ?? 100;
  }

  async validateUsername(username: string, signal: AbortSignal): Promise<void> {
    await fetchWithRetry(
      this.fetchImpl,
      `${CHESS_COM_BASE}/${encodeURIComponent(username)}`,
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
    if (cursor === null || cursor === undefined) {
      const months = await this.loadMonths(username, window, signal);
      if (months.length === 0) {
        return { records: [], skipped: [], nextCursor: null, position: null };
      }
      return {
        records: [],
        skipped: [],
        nextCursor: { months, index: 0 } satisfies ChessCursor,
        position: { current: 0, total: months.length },
      };
    }

    const state = cursor as ChessCursor;
    if (!Array.isArray(state.months) || !Number.isInteger(state.index)) {
      throw new ProviderHttpError('invalid-response', 'Chess.com cursor is malformed.');
    }

    if (state.index < state.months.length) {
      return this.monthPage(
        username,
        state.months[state.index]!,
        { months: state.months, index: state.index + 1 },
        signal,
      );
    }

    // Terminal cursor: refresh the archive list so incremental imports pick up
    // new months (and a still-growing latest month). When nothing changed the
    // run is exhausted.
    const fresh = await this.loadMonths(username, window, signal);
    if (sameMonthList(fresh, state.months)) {
      return { records: [], skipped: [], nextCursor: null, position: null };
    }
    const startIndex = Math.max(0, state.months.length - 1);
    const month = fresh[startIndex];
    if (month === undefined) {
      return { records: [], skipped: [], nextCursor: null, position: null };
    }
    return this.monthPage(username, month, { months: fresh, index: startIndex + 1 }, signal);
  }

  private async loadMonths(
    username: string,
    window: TimeWindow,
    signal: AbortSignal,
  ): Promise<readonly string[]> {
    const response = await fetchWithRetry(
      this.fetchImpl,
      `${CHESS_COM_BASE}/${encodeURIComponent(username)}/games/archives`,
      { signal },
      this.policy,
    );
    const payload = (await readJson(response)) as { archives?: unknown };
    const archives = payload.archives;
    if (!Array.isArray(archives)) {
      throw new ProviderHttpError('invalid-response', 'Chess.com archives payload is malformed.');
    }
    return archives
      .filter((url): url is string => typeof url === 'string')
      .filter((url) => monthInWindow(url, window));
  }

  private async monthPage(
    username: string,
    monthUrl: string,
    next: ChessCursor,
    signal: AbortSignal,
  ): Promise<ProviderPageResult> {
    const response = await fetchWithRetry(this.fetchImpl, monthUrl, { signal }, this.policy);
    const payload = (await readJson(response)) as { games?: unknown };
    const games = payload.games;
    if (!Array.isArray(games)) {
      throw new ProviderHttpError('invalid-response', 'Chess.com monthly archive is malformed.');
    }

    const records: ProviderGameRecord[] = [];
    const skipped: ProviderSkip[] = [];
    for (const game of games as ChessGamePayload[]) {
      const externalId = externalIdOf(game.url);
      if (!game.rules || game.rules !== 'chess') {
        skipped.push({
          externalId,
          reason: `Unsupported game rules${game.rules ? ` (${game.rules})` : ''}`,
        });
        continue;
      }
      records.push({
        source: 'chesscom',
        externalId: externalId ?? '',
        username,
        pgn: game.pgn ?? '',
        playedAtIso: isoFromEpochSeconds(game.end_time),
        timeControlRaw: typeof game.time_control === 'string' ? game.time_control : null,
        whiteName: game.white?.username ?? '',
        blackName: game.black?.username ?? '',
        whiteElo: numberOrNull(game.white?.rating),
        blackElo: numberOrNull(game.black?.rating),
      });
    }

    const total = next.months.length;
    const position = next.index >= total ? null : { current: next.index, total };
    if (next.index < total) {
      await sleep(this.politeDelayMs, signal);
    }
    return { records, skipped, nextCursor: next, position };
  }
}

function externalIdOf(url: string | undefined): string | null {
  if (!url) return null;
  const segments = url.split('/').filter((s) => s !== '');
  const last = segments.at(-1);
  return last && last !== '' ? last : null;
}

function numberOrNull(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isoFromEpochSeconds(value: number | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return new Date(value * 1000).toISOString();
}

function monthInWindow(url: string, window: TimeWindow): boolean {
  if (window.fromMs === null && window.toMs === null) {
    return true;
  }
  const match = MONTH_PATTERN.exec(url);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) {
    return false;
  }
  const start = Date.UTC(year, month - 1, 1);
  const endExclusive = Date.UTC(year, month, 1);
  if (window.fromMs !== null && endExclusive <= window.fromMs) {
    return false;
  }
  if (window.toMs !== null && start > window.toMs) {
    return false;
  }
  return true;
}

function sameMonthList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((month, i) => month === b[i]);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new ProviderHttpError('invalid-response', 'The provider returned malformed JSON.');
  }
}
