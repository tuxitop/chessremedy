import { describe, expect, it, vi } from 'vitest';
import { CHESS_COM_POLICY, LICHESS_POLICY, fetchWithRetry } from './transport';

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function jsonResponse(body: string, status = 200): Response {
  return new Response(body, { status });
}

describe('fetchWithRetry', () => {
  it('resolves the response on the first attempt', async () => {
    const fetchImpl: FetchLike = async () => jsonResponse('{"ok":true}');
    const response = await fetchWithRetry(fetchImpl, 'https://x.test/a', {}, CHESS_COM_POLICY);
    expect(await response.text()).toBe('{"ok":true}');
  });

  it('retries transient statuses with backoff then succeeds', async () => {
    const sleeps: number[] = [];
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((handler: () => void, ms?: number) => {
      if (ms !== undefined) sleeps.push(ms);
      handler();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout);

    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return calls === 1 ? jsonResponse('oops', 429) : jsonResponse('ok', 200);
    };
    const policy = { maxAttempts: 3, delayMs: (attempt: number) => attempt * 10 };
    const response = await fetchWithRetry(fetchImpl, 'https://x.test/a', {}, policy);
    expect(await response.text()).toBe('ok');
    expect(calls).toBe(2);
    expect(sleeps).toEqual([10]);

    vi.restoreAllMocks();
  });

  it('classifies 404 as player-not-found after retries are skipped', async () => {
    const fetchImpl: FetchLike = async () => jsonResponse('nope', 404);
    await expect(
      fetchWithRetry(fetchImpl, 'https://x.test/a', {}, CHESS_COM_POLICY),
    ).rejects.toMatchObject({
      code: 'player-not-found',
    });
  });

  it('classifies a final 429 as rate-limited', async () => {
    const fetchImpl: FetchLike = async () => jsonResponse('slow down', 429);
    const policy = { maxAttempts: 2, delayMs: () => 0 };
    await expect(fetchWithRetry(fetchImpl, 'https://x.test/a', {}, policy)).rejects.toMatchObject({
      code: 'rate-limited',
    });
  });

  it('surfaces abort as aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl: FetchLike = async () => {
      throw new DOMException('Aborted', 'AbortError');
    };
    await expect(
      fetchWithRetry(
        fetchImpl,
        'https://x.test/a',
        { signal: controller.signal },
        CHESS_COM_POLICY,
      ),
    ).rejects.toMatchObject({ code: 'aborted' });
  });

  it('classifies a network failure as network after retries', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error('socket hang up');
    };
    const policy = { maxAttempts: 2, delayMs: () => 0 };
    await expect(fetchWithRetry(fetchImpl, 'https://x.test/a', {}, policy)).rejects.toMatchObject({
      code: 'network',
    });
  });

  it('lichess policy waits 60s on 429', () => {
    expect(LICHESS_POLICY.delayMs(1, 429)).toBe(60_000);
    expect(LICHESS_POLICY.delayMs(1, 500)).toBe(1000);
    expect(CHESS_COM_POLICY.delayMs(1, 429)).toBe(1000);
    expect(CHESS_COM_POLICY.delayMs(2, 429)).toBe(2000);
    expect(CHESS_COM_POLICY.delayMs(3, 429)).toBe(4000);
  });
});
