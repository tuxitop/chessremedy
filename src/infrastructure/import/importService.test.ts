import { describe, expect, it, beforeEach } from 'vitest';
import { db } from '@/infrastructure/db/database';
import { gamesRepository } from '@/infrastructure/db/games-repository';
import { importJobsRepository } from '@/infrastructure/db/import-jobs-repository';
import { ChessComAdapter } from '@/infrastructure/providers/chessCom';
import { LichessAdapter } from '@/infrastructure/providers/lichess';
import { fixtureGame } from '@/domain/chess/fixtures';
import type { FetchLike } from '@/infrastructure/providers/transport';
import {
  chessComArchivesJson,
  chessComMonthJson,
  chessComMonthUrl,
  chessComProfileJson,
  createRoutingFetch,
  lichessGameJson,
} from '@/infrastructure/providers/fixtures';
import { ImportService } from './importService';
import { DEFAULT_IMPORT_FILTERS, type ImportFilters } from '@/domain/import';
import type { Game } from '@/domain/chess/game';

const USERNAME = 'chessremedy';
const NO_RETRY = { maxAttempts: 2, delayMs: () => 0 };
const JSON_OK = { headers: { 'content-type': 'application/json' } };

const chessGames: readonly Game[] = [
  fixtureGame('cc-bullet-blunder'), // 2026-05 bullet
  fixtureGame('cc-blitz-clean'), // 2026-05 blitz
  fixtureGame('cc-rapid-missed-tactic'), // 2026-06 rapid
  fixtureGame('cc-classical-endgame'), // 2026-06 classical
];

const lichessGames: readonly Game[] = [
  fixtureGame('li-bullet-missed-mate'),
  fixtureGame('li-blitz-blunder'),
  fixtureGame('li-rapid-clean'),
  fixtureGame('li-correspondence'),
];

function json(body: string): Response {
  return new Response(body, JSON_OK);
}

function monthOf(dateIso: string): string {
  const d = dateIso.slice(0, 10);
  return `${d.slice(0, 4)}/${d.slice(5, 7)}`;
}

function chessFetch(): FetchLike {
  const months = [...new Set(chessGames.map((g) => monthOf(g.playedAt!)))].sort();
  const monthUrls = months.map((m) => chessComMonthUrl(USERNAME, m));
  const byMonth = new Map(monthUrls.map((url, i) => [url, months[i]!] as const));
  const routes: Array<readonly [string, string]> = [
    [`https://api.chess.com/pub/player/${USERNAME}`, chessComProfileJson(USERNAME)],
    [
      `https://api.chess.com/pub/player/${USERNAME}/games/archives`,
      chessComArchivesJson(monthUrls),
    ],
    ...monthUrls.map(
      (url) =>
        [
          url,
          chessComMonthJson(
            USERNAME,
            chessGames.filter((g) => monthOf(g.playedAt!) === byMonth.get(url)),
          ),
        ] as const,
    ),
  ];
  return createRoutingFetch(routes).fetch;
}

function lichessFetch(): FetchLike {
  const lines = [
    { ...lichessGameJson(lichessGames[2]!), id: 'variant100', variant: 'chess960' },
    lichessGameJson(lichessGames[0]!), // bullet
    lichessGameJson(lichessGames[1]!), // blitz
    lichessGameJson(lichessGames[2]!), // rapid
    lichessGameJson(lichessGames[3]!), // correspondence
  ].map((l) => JSON.stringify(l));
  const body = lines.join('\n');
  const routes = createRoutingFetch([
    [`https://lichess.org/api/user/${USERNAME}`, JSON.stringify({ id: USERNAME })],
    [`https://lichess.org/api/games/user/${USERNAME}*`, body],
  ]);
  return routes.fetch;
}

function makeService(fetchImpl: FetchLike): ImportService {
  return new ImportService({
    games: gamesRepository,
    jobs: importJobsRepository,
    adapters: {
      chesscom: new ChessComAdapter({ fetchImpl, policy: NO_RETRY, politeDelayMs: 0 }),
      lichess: new LichessAdapter({ fetchImpl, policy: NO_RETRY }),
    },
    now: () => Date.now(),
  });
}

const signal = (): AbortSignal => new AbortController().signal;

describe('ImportService (chess.com)', () => {
  beforeEach(async () => {
    await db.games.clear();
    await db.importJobs.clear();
  });

  it('imports the whole archive end-to-end with duplicate-aware counters', async () => {
    const service = makeService(chessFetch());
    const job = await service.start(
      { provider: 'chesscom', username: USERNAME, filters: DEFAULT_IMPORT_FILTERS },
      { signal: signal() },
    );
    expect(job.status).toBe('completed');
    expect(job.counters).toMatchObject({
      seen: 4,
      inserted: 4,
      updated: 0,
      duplicates: 0,
      failed: 0,
      filtered: 0,
    });
    expect(await db.games.count()).toBe(4);

    const stored = await service.getJob('chesscom', USERNAME);
    expect(stored).toBeDefined();
    expect(stored!.status).toBe('completed');

    // Re-importing with the same filters stays incremental and stores nothing.
    const again = await service.start(
      { provider: 'chesscom', username: USERNAME, filters: DEFAULT_IMPORT_FILTERS },
      { signal: signal() },
    );
    expect(again.status).toBe('completed');
    expect(await db.games.count()).toBe(4);
  });

  it('applies a time-control selection and counts the rest as filtered', async () => {
    const service = makeService(chessFetch());
    const filters: ImportFilters = {
      timeFrame: { preset: 'all' },
      timeControls: { kind: 'categories', categories: ['rapid', 'classical'] },
    };
    const job = await service.start(
      { provider: 'chesscom', username: USERNAME, filters },
      { signal: signal() },
    );
    expect(job.status).toBe('completed');
    expect(job.counters).toMatchObject({ inserted: 2, filtered: 2, duplicates: 0 });
    expect(await db.games.count()).toBe(2);
  });

  it('re-sweeps from scratch when the selection changes and never double-stores', async () => {
    const service = makeService(chessFetch());
    await service.start(
      { provider: 'chesscom', username: USERNAME, filters: DEFAULT_IMPORT_FILTERS },
      { signal: signal() },
    );
    const rapidOnly: ImportFilters = {
      timeFrame: { preset: 'all' },
      timeControls: { kind: 'categories', categories: ['rapid'] },
    };
    const reswept = await service.start(
      { provider: 'chesscom', username: USERNAME, filters: rapidOnly },
      { signal: signal() },
    );
    expect(reswept.status).toBe('completed');
    expect(reswept.counters.inserted).toBe(0);
    expect(reswept.counters.duplicates).toBe(1);
    expect(reswept.counters.filtered).toBe(3);
    expect(await db.games.count()).toBe(4);
  });

  it('pauses on abort and resumes without re-inserting finished months', async () => {
    const controller = new AbortController();
    const juneUrl = chessComMonthUrl(USERNAME, '2026/06');
    const mayUrl = chessComMonthUrl(USERNAME, '2026/05');
    const months = [mayUrl, juneUrl];
    const mayGames = chessGames.filter((g) => monthOf(g.playedAt!) === '2026/05');
    const juneGames = chessGames.filter((g) => monthOf(g.playedAt!) === '2026/06');
    const fetchImpl: FetchLike = async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.startsWith(juneUrl)) {
        if (init?.signal === controller.signal && !controller.signal.aborted) {
          controller.abort();
          throw new DOMException('Aborted', 'AbortError');
        }
        return json(chessComMonthJson(USERNAME, juneGames));
      }
      if (url === `https://api.chess.com/pub/player/${USERNAME}`) {
        return json(chessComProfileJson(USERNAME));
      }
      if (url === `https://api.chess.com/pub/player/${USERNAME}/games/archives`) {
        return json(chessComArchivesJson(months));
      }
      if (url === mayUrl) {
        return json(chessComMonthJson(USERNAME, mayGames));
      }
      return new Response('Not found', { status: 404 });
    };
    const service = makeService(fetchImpl);

    const paused = await service.start(
      { provider: 'chesscom', username: USERNAME, filters: DEFAULT_IMPORT_FILTERS },
      { signal: controller.signal },
    );
    expect(paused.status).toBe('paused');
    expect(await db.games.count()).toBe(2); // May only

    const completed = await service.resume('chesscom', USERNAME, { signal: signal() });
    expect(completed.status).toBe('completed');
    expect(await db.games.count()).toBe(4);
    const stored = await service.getJob('chesscom', USERNAME);
    expect(stored!.counters.inserted).toBe(4);
    expect(stored!.counters.duplicates).toBe(0);
  });

  it('marks a run failed on a provider error and retries from the stored cursor', async () => {
    let broken = true;
    const mayUrl = chessComMonthUrl(USERNAME, '2026/05');
    const juneUrl = chessComMonthUrl(USERNAME, '2026/06');
    const months = [mayUrl, juneUrl];
    const healthyRoutes = createRoutingFetch([
      [`https://api.chess.com/pub/player/${USERNAME}`, chessComProfileJson(USERNAME)],
      [`https://api.chess.com/pub/player/${USERNAME}/games/archives`, chessComArchivesJson(months)],
      [
        mayUrl,
        chessComMonthJson(
          USERNAME,
          chessGames.filter((g) => monthOf(g.playedAt!) === '2026/05'),
        ),
      ],
      [
        juneUrl,
        chessComMonthJson(
          USERNAME,
          chessGames.filter((g) => monthOf(g.playedAt!) === '2026/06'),
        ),
      ],
    ]);
    const fetchImpl: FetchLike = async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (broken && url.startsWith(mayUrl)) {
        return json('Internal boom');
      }
      return healthyRoutes.fetch(url);
    };
    const service = makeService(fetchImpl);

    const failed = await service.start(
      { provider: 'chesscom', username: USERNAME, filters: DEFAULT_IMPORT_FILTERS },
      { signal: signal() },
    );
    expect(failed.status).toBe('failed');
    expect(failed.lastError).toContain('provider');

    broken = false;
    const retried = await service.retry('chesscom', USERNAME, { signal: signal() });
    expect(retried.status).toBe('completed');
    expect(await db.games.count()).toBe(4);
  });

  it('rejects an empty username', async () => {
    const service = makeService(chessFetch());
    await expect(
      service.start(
        { provider: 'chesscom', username: '   ', filters: DEFAULT_IMPORT_FILTERS },
        { signal: signal() },
      ),
    ).rejects.toMatchObject({ code: 'empty-username' });
  });

  it('returns a failed job for an unknown player', async () => {
    const routes = createRoutingFetch([]);
    const service = makeService(routes.fetch);
    const job = await service.start(
      { provider: 'chesscom', username: 'ghost', filters: DEFAULT_IMPORT_FILTERS },
      { signal: signal() },
    );
    expect(job.status).toBe('failed');
    expect(job.lastError).toContain('Player not found');
  });
});

describe('ImportService (lichess)', () => {
  beforeEach(async () => {
    await db.games.clear();
    await db.importJobs.clear();
  });

  it('imports NDJSON records, skipping variants and counting filtered games', async () => {
    const service = makeService(lichessFetch());
    const job = await service.start(
      { provider: 'lichess', username: USERNAME, filters: DEFAULT_IMPORT_FILTERS },
      { signal: signal() },
    );
    expect(job.status).toBe('completed');
    // variant100 skipped; four standard games inserted.
    expect(job.counters).toMatchObject({ inserted: 4, skipped: 1 });
    expect(await db.games.count()).toBe(4);

    const bulletOnly: ImportFilters = {
      timeFrame: { preset: 'all' },
      timeControls: { kind: 'categories', categories: ['bullet'] },
    };
    const reswept = await service.start(
      { provider: 'lichess', username: USERNAME, filters: bulletOnly },
      { signal: signal() },
    );
    expect(reswept.counters.inserted).toBe(0);
    expect(reswept.counters.duplicates).toBe(1); // li-bullet-missed-mate
    expect(reswept.counters.filtered).toBe(3); // blitz + rapid + correspondence
    expect(await db.games.count()).toBe(4);
  });
});
