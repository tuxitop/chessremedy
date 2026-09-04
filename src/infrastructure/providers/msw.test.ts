// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { fixtureGame } from '@/domain/chess/fixtures';
import { LichessAdapter } from './lichess';
import { lichessGameJson } from './fixtures';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const USERNAME = 'chessremedy';

describe('LichessAdapter over MSW (ADR-009)', () => {
  it('fetches NDJSON through a real fetch stack intercepted by MSW', async () => {
    const rapid = fixtureGame('li-rapid-clean');
    const bullet = fixtureGame('li-bullet-missed-mate');
    const body = [lichessGameJson(bullet), lichessGameJson(rapid)]
      .map((l) => JSON.stringify(l))
      .join('\n');

    server.use(
      http.get(`https://lichess.org/api/games/user/${USERNAME}`, () =>
        HttpResponse.text(body, { status: 200 }),
      ),
    );

    const adapter = new LichessAdapter({
      fetchImpl: globalThis.fetch.bind(globalThis),
      maxGamesPerPage: 1000,
    });
    const page = await adapter.fetchPage(
      USERNAME,
      null,
      { fromMs: null, toMs: null },
      new AbortController().signal,
    );
    expect(page.records).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
    const ids = page.records.map((r) => r.externalId).sort();
    expect(ids).toEqual([rapid.externalId, bullet.externalId].sort());
  });

  it('surfaces a 404 through MSW as player-not-found', async () => {
    server.use(
      http.get('https://lichess.org/api/user/ghost', () => new HttpResponse(null, { status: 404 })),
    );
    const adapter = new LichessAdapter({ fetchImpl: globalThis.fetch.bind(globalThis) });
    await expect(
      adapter.validateUsername('ghost', new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'player-not-found',
    });
  });
});
