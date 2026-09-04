import { describe, expect, it } from 'vitest';
import { fixtureGame } from '@/domain/chess/fixtures';
import { providerGameToGame } from '@/domain/import/providerGame';
import { LichessAdapter } from './lichess';
import { createRoutingFetch, lichessGameJson } from './fixtures';

const USERNAME = 'chessremedy';
const WINDOW = { fromMs: null, toMs: null };
const signal = (): AbortSignal => new AbortController().signal;

function exportUrl(username = USERNAME): string {
  return `https://lichess.org/api/games/user/${username}`;
}

function ndjson(lines: readonly string[]): string {
  return lines.join('\n');
}

function expectRecordMatches(
  game: ReturnType<typeof fixtureGame>,
  mapped: ReturnType<typeof providerGameToGame>,
): void {
  expect(mapped.kind).toBe('game');
  if (mapped.kind !== 'game') return;
  expect(mapped.game).toMatchObject({
    id: game.id,
    source: game.source,
    externalId: game.externalId,
    userColor: game.userColor,
    // Provider timestamps round-trip through `toISOString` (`.000Z` suffix).
    playedAt: new Date(Date.parse(game.playedAt!)).toISOString(),
    timeControl: game.timeControl,
    normalizedTimeControl: game.normalizedTimeControl,
    result: game.result,
    whitePlayer: game.whitePlayer,
    blackPlayer: game.blackPlayer,
  });
}

describe('LichessAdapter', () => {
  it('maps NDJSON lines to records, skipping variants', async () => {
    const rapid = fixtureGame('li-rapid-clean');
    const bullet = fixtureGame('li-bullet-missed-mate');
    const variant = { ...lichessGameJson(rapid), id: 'variant99', variant: 'chess960' };
    const body = ndjson([
      JSON.stringify(lichessGameJson(bullet)),
      JSON.stringify(variant),
      JSON.stringify(lichessGameJson(rapid)),
    ]);

    const routes = createRoutingFetch([[exportUrl() + '*', body]]);
    const adapter = new LichessAdapter({ fetchImpl: routes.fetch, maxGamesPerPage: 1000 });

    const page = await adapter.fetchPage(USERNAME, null, WINDOW, signal());
    expect(page.skipped).toEqual([
      { externalId: 'variant99', reason: expect.stringContaining('chess960') },
    ]);
    expect(page.records).toHaveLength(2);
    for (const record of page.records) {
      const mapped = providerGameToGame(record);
      if (record.externalId === rapid.externalId) {
        expectRecordMatches(rapid, mapped);
      } else if (record.externalId === bullet.externalId) {
        expectRecordMatches(bullet, mapped);
      }
    }
    expect(page.nextCursor).toBeNull();
  });

  it('pages with the since cursor and fences since/until by the window', async () => {
    const g1 = fixtureGame('cc-bullet-blunder');
    const g2 = fixtureGame('cc-blitz-clean');
    const g3 = fixtureGame('cc-rapid-missed-tactic');
    const line1 = JSON.stringify(lichessGameJson(g1, { createdAtMs: 1000 }));
    const line2 = JSON.stringify(lichessGameJson(g2, { createdAtMs: 2000 }));
    const line3 = JSON.stringify(lichessGameJson(g3, { createdAtMs: 3000 }));

    const requested: string[] = [];
    const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      requested.push(url);
      const body = url.includes('since=2000') ? [line3] : [line1, line2];
      return new Response(ndjson(body), { status: 200 });
    };
    const adapter = new LichessAdapter({ fetchImpl, maxGamesPerPage: 2 });

    const first = await adapter.fetchPage(USERNAME, null, WINDOW, signal());
    expect(first.records).toHaveLength(2);
    expect(first.nextCursor).toBe(2000);
    expect(requested[0]).not.toContain('since=');

    const window = { fromMs: 1500, toMs: 4000 };
    const second = await adapter.fetchPage(USERNAME, first.nextCursor, window, signal());
    expect(second.records).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    const url = requested.at(-1)!;
    expect(url).toContain('since=2000');
    expect(url).toContain('until=4000');
    expect(url).toContain('max=2');
    expect(url).toContain('pgnInJson=true');
  });

  it('nudges the cursor when consecutive pages stall on one timestamp', async () => {
    const g = fixtureGame('li-rapid-clean');
    const line = (variant: string) =>
      JSON.stringify(lichessGameJson(g, { createdAtMs: 5000, variant }));
    const lines = [line('chess960'), line('standard'), line('chess960')];

    const requested: string[] = [];
    const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      requested.push(url);
      return new Response(ndjson(lines), { status: 200 });
    };
    const adapter = new LichessAdapter({ fetchImpl, maxGamesPerPage: 3 });

    const first = await adapter.fetchPage(USERNAME, null, WINDOW, signal());
    expect(first.records).toHaveLength(1);
    expect(first.nextCursor).toBe(5000);

    // The second page (since=5000) returns the same full group → cursor nudges.
    const second = await adapter.fetchPage(USERNAME, first.nextCursor, WINDOW, signal());
    expect(second.records).toHaveLength(1);
    expect(second.nextCursor).toBe(5001);
  });

  it('skips malformed lines', async () => {
    const rapid = fixtureGame('li-rapid-clean');
    const body = ndjson(['not json', JSON.stringify(lichessGameJson(rapid))]);
    const routes = createRoutingFetch([[exportUrl() + '*', body]]);
    const adapter = new LichessAdapter({ fetchImpl: routes.fetch, maxGamesPerPage: 1000 });

    const page = await adapter.fetchPage(USERNAME, null, WINDOW, signal());
    expect(page.skipped).toHaveLength(1);
    expect(page.skipped[0]!.externalId).toBeNull();
    expect(page.records).toHaveLength(1);
  });

  it('rejects an unknown player during validation', async () => {
    const routes = createRoutingFetch([]);
    const adapter = new LichessAdapter({ fetchImpl: routes.fetch });
    await expect(adapter.validateUsername('ghost', signal())).rejects.toMatchObject({
      code: 'player-not-found',
    });
  });
});
