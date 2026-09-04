import { describe, expect, it } from 'vitest';
import { fixtureGame } from '@/domain/chess/fixtures';
import { providerGameToGame } from '@/domain/import/providerGame';
import { ChessComAdapter } from './chessCom';
import {
  chessComArchivesJson,
  chessComGameJson,
  chessComMonthJson,
  chessComMonthUrl,
  chessComProfileJson,
  createRoutingFetch,
} from './fixtures';

const USERNAME = 'chessremedy';
const WINDOW = { fromMs: null, toMs: null };
const signal = (): AbortSignal => new AbortController().signal;

function archiveUrls(username: string, months: readonly string[]): string[] {
  return months.map((month) => chessComMonthUrl(username, month));
}

describe('ChessComAdapter', () => {
  it('walks archives then a month page, mapping games deterministically', async () => {
    const bullet = fixtureGame('cc-bullet-blunder');
    const blitz = fixtureGame('cc-blitz-clean');
    const month = '2026/05';
    const months = [month];
    const routes = createRoutingFetch([
      [`https://api.chess.com/pub/player/${USERNAME}`, chessComProfileJson(USERNAME)],
      [
        `https://api.chess.com/pub/player/${USERNAME}/games/archives`,
        chessComArchivesJson(archiveUrls(USERNAME, months)),
      ],
      [chessComMonthUrl(USERNAME, month), chessComMonthJson(USERNAME, [bullet, blitz])],
    ]);
    const adapter = new ChessComAdapter({ fetchImpl: routes.fetch, politeDelayMs: 0 });

    const start = await adapter.fetchPage(USERNAME, null, WINDOW, signal());
    expect(start.records).toEqual([]);
    expect(start.position).toEqual({ current: 0, total: 1 });
    expect(start.nextCursor).toEqual({ months: [chessComMonthUrl(USERNAME, month)], index: 0 });

    const page = await adapter.fetchPage(USERNAME, start.nextCursor, WINDOW, signal());
    expect(page.position).toBeNull();
    expect(page.nextCursor).toEqual({ months: [chessComMonthUrl(USERNAME, month)], index: 1 });
    expect(page.skipped).toEqual([]);
    expect(page.records.map((r) => r.externalId).sort()).toEqual(
      [bullet.externalId, blitz.externalId].sort(),
    );
    // Enrichment is consistent, so records map onto the exact fixture Games.
    const mapped = page.records.map((r) => providerGameToGame(r));
    const gamesById = new Map(
      mapped
        .filter((o) => o.kind === 'game')
        .map((o) => (o.kind === 'game' ? [o.game.externalId, o.game] : null))
        .filter((entry): entry is [string | null, typeof bullet] => entry !== null),
    );
    for (const fixture of [bullet, blitz]) {
      const game = gamesById.get(fixture.externalId);
      expect(game).toBeDefined();
      expect(game).toMatchObject({
        id: fixture.id,
        source: 'chesscom',
        externalId: fixture.externalId,
        userColor: fixture.userColor,
        // Provider timestamps round-trip through `toISOString` (`.000Z` suffix).
        playedAt: new Date(Date.parse(fixture.playedAt!)).toISOString(),
        timeControl: fixture.timeControl,
        normalizedTimeControl: fixture.normalizedTimeControl,
        result: fixture.result,
        whitePlayer: fixture.whitePlayer,
        blackPlayer: fixture.blackPlayer,
      });
      expect(game!.moves.root.children.length).toBeGreaterThan(0);
    }

    // Terminal cursor with unchanged archives → exhausted.
    const done = await adapter.fetchPage(USERNAME, page.nextCursor, WINDOW, signal());
    expect(done.nextCursor).toBeNull();
    expect(done.records).toEqual([]);
  });

  it('skips non-standard rules with a reason', async () => {
    const bullet = fixtureGame('cc-bullet-blunder');
    const blitz = fixtureGame('cc-blitz-clean');
    const month = '2026/05';
    const monthUrl = chessComMonthUrl(USERNAME, month);
    const games = [
      chessComGameJson(USERNAME, blitz),
      { ...chessComGameJson(USERNAME, bullet), rules: 'chess960' },
    ];
    const routes = createRoutingFetch([
      [
        `https://api.chess.com/pub/player/${USERNAME}/games/archives`,
        chessComArchivesJson([monthUrl]),
      ],
      [monthUrl, JSON.stringify({ games })],
    ]);
    const adapter = new ChessComAdapter({ fetchImpl: routes.fetch, politeDelayMs: 0 });

    const start = await adapter.fetchPage(USERNAME, null, WINDOW, signal());
    const page = await adapter.fetchPage(USERNAME, start.nextCursor, WINDOW, signal());
    expect(page.records).toHaveLength(1);
    expect(page.skipped).toHaveLength(1);
    expect(page.skipped[0]!.externalId).toBe(bullet.externalId);
    expect(page.skipped[0]!.reason).toContain('chess960');
  });

  it('prunes archive months outside the date window', async () => {
    const june = fixtureGame('cc-rapid-missed-tactic'); // 2026-06
    const juneUrl = chessComMonthUrl(USERNAME, '2026/06');
    const mayUrl = chessComMonthUrl(USERNAME, '2026/05');
    const routes = createRoutingFetch([
      [
        `https://api.chess.com/pub/player/${USERNAME}/games/archives`,
        chessComArchivesJson([mayUrl, juneUrl]),
      ],
      [juneUrl, chessComMonthJson(USERNAME, [june])],
    ]);
    const adapter = new ChessComAdapter({ fetchImpl: routes.fetch, politeDelayMs: 0 });

    const window = { fromMs: Date.UTC(2026, 5, 1), toMs: Date.UTC(2026, 5, 30) + 86_400_000 - 1 };
    const start = await adapter.fetchPage(USERNAME, null, window, signal());
    expect(start.nextCursor).toEqual({ months: [juneUrl], index: 0 });
    expect(routes.requestedUrls).not.toContain(mayUrl);

    const page = await adapter.fetchPage(USERNAME, start.nextCursor, window, signal());
    expect(page.records.map((r) => r.externalId)).toContain(june.externalId);
  });

  it('picks up newly appended months on an incremental re-sweep of a terminal cursor', async () => {
    const mayGame = fixtureGame('cc-blitz-clean');
    const months = ['2026/05'];
    const mayUrl = chessComMonthUrl(USERNAME, months[0]!);
    const juneUrl = chessComMonthUrl(USERNAME, '2026/06');
    const terminalCursor = { months: [mayUrl], index: 1 };
    const juneGame = fixtureGame('cc-rapid-missed-tactic');

    const routes = createRoutingFetch([
      [
        `https://api.chess.com/pub/player/${USERNAME}/games/archives`,
        chessComArchivesJson([mayUrl, juneUrl]),
      ],
      [mayUrl, chessComMonthJson(USERNAME, [mayGame])],
      [juneUrl, chessComMonthJson(USERNAME, [juneGame])],
    ]);
    const adapter = new ChessComAdapter({ fetchImpl: routes.fetch, politeDelayMs: 0 });

    const page = await adapter.fetchPage(USERNAME, terminalCursor, WINDOW, signal());
    // Re-processes the (possibly grown) previous last month first, then June.
    expect(page.nextCursor).toEqual({ months: [mayUrl, juneUrl], index: 1 });
    expect(page.records.map((r) => r.externalId)).toContain(mayGame.externalId);
  });

  it('rejects an unknown player during validation', async () => {
    const routes = createRoutingFetch([]);
    const adapter = new ChessComAdapter({ fetchImpl: routes.fetch });
    await expect(adapter.validateUsername('ghost', signal())).rejects.toMatchObject({
      code: 'player-not-found',
    });
  });
});
