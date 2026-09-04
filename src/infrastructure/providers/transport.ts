/**
 * HTTP transport for provider adapters (Feature 007).
 *
 * A thin, retrying wrapper over an injected fetch-compatible transport
 * (ADR-009: network adapters must accept an injected transport so MSW or a
 * stub can intercept calls in Node tests). Retry/backoff policy is provider
 * specific: Chess.com uses a short exponential backoff plus a polite
 * inter-request delay (applied by the adapter), Lichess waits 60 s on 429.
 * Every request is abortable via an `AbortSignal`.
 */

export type ProviderHttpErrorCode =
  | 'player-not-found'
  | 'rate-limited'
  | 'forbidden'
  | 'network'
  | 'http'
  | 'invalid-response'
  | 'aborted';

export class ProviderHttpError extends Error {
  readonly code: ProviderHttpErrorCode;

  constructor(code: ProviderHttpErrorCode, message: string) {
    super(message);
    this.name = 'ProviderHttpError';
    this.code = code;
  }
}

export interface RetryPolicy {
  /** Total attempts (initial request + retries). */
  readonly maxAttempts: number;
  /** Delay in ms before the given retry attempt (1-based) after `status`. */
  readonly delayMs: (attempt: number, status: number | null) => number;
}

/** Chess.com: exponential 1s→2s→4s, capped. */
export const CHESS_COM_POLICY: RetryPolicy = {
  maxAttempts: 4,
  delayMs: (attempt) => Math.min(1000 * 2 ** (attempt - 1), 8000),
};

/** Lichess: 60 s wait on 429, short backoff otherwise. */
export const LICHESS_POLICY: RetryPolicy = {
  maxAttempts: 4,
  delayMs: (attempt, status) =>
    status === 429 ? 60_000 : Math.min(1000 * 2 ** (attempt - 1), 8000),
};

export interface FetchOptions {
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
  readonly signal?: AbortSignal;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw new ProviderHttpError('aborted', 'The request was aborted.');
  }
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function throwForStatus(status: number, statusText: string): never {
  if (status === 404) {
    throw new ProviderHttpError('player-not-found', 'Player not found (404).');
  }
  if (status === 429) {
    throw new ProviderHttpError('rate-limited', 'Rate limited by the provider (429).');
  }
  if (status === 403) {
    throw new ProviderHttpError('forbidden', 'The provider refused the request (403).');
  }
  throw new ProviderHttpError(
    'http',
    `The provider returned HTTP ${status}${statusText ? ` (${statusText})` : ''}.`,
  );
}

/**
 * Perform one request with retries. Resolves with the response when it is
 * successful (2xx); otherwise retries per `policy` and finally throws a typed
 * `ProviderHttpError`.
 */
export async function fetchWithRetry(
  fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  url: string,
  options: FetchOptions,
  policy: RetryPolicy,
): Promise<Response> {
  const init: RequestInit = {
    method: options.method ?? 'GET',
    ...(options.headers ? { headers: options.headers } : {}),
    ...(options.body !== undefined ? { body: options.body } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  };

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, init);
      if (response.ok) {
        return response;
      }
      if (attempt < policy.maxAttempts && isRetryableStatus(response.status)) {
        await sleep(policy.delayMs(attempt, response.status), options.signal);
        continue;
      }
      throwForStatus(response.status, response.statusText);
    } catch (err) {
      if (err instanceof ProviderHttpError) {
        if (
          err.code === 'rate-limited' &&
          attempt < policy.maxAttempts &&
          options.signal?.aborted !== true
        ) {
          await sleep(policy.delayMs(attempt, 429), options.signal);
          continue;
        }
        throw err;
      }
      if (options.signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
        throw new ProviderHttpError('aborted', 'The request was aborted.');
      }
      if (attempt < policy.maxAttempts) {
        await sleep(policy.delayMs(attempt, null), options.signal);
        continue;
      }
      throw new ProviderHttpError(
        'network',
        err instanceof Error ? err.message : 'Network request failed.',
      );
    }
  }
  throw new ProviderHttpError('network', 'Network request failed after retries.');
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500 || status === 408;
}
