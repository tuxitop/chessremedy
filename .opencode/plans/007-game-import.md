# Plan — Feature 007: Game Import

> **Status:** Import milestone delivered. The Feature 007 Games-page list
> described here (imported-games summary list + display filters) is
> superseded by the **Game Library** milestone, planned in
> `.opencode/plans/007-game-library.md` and specified in
> `.opencode/specs/features/007-game-import.md` /
> `.opencode/specs/domain/game-library.md`.

## 1. Objective

Let the user import batches of their own games from **Chess.com** and
**Lichess** directly from the browser (both APIs are CORS-enabled and
keyless for public data — `research/game-import.md`). Imported games are
parsed into the Feature-003 `Game` domain model with normalized metadata
(`domain/game-model.md`, ADR-013) and persisted through the Feature-004
Dexie `games` table with content-aware duplicate detection. **No engine
analysis runs during import** (spec acceptance criterion). Imports are
batch jobs with progress, per-game error reporting, retry and
resumability across sessions. Before a run the user can narrow the
selection by **time frame** (all time, a recent window, or a custom
range) and by **time-control category** (e.g. blitz and rapid only).

The feature replaces the `GamesPage` placeholder with an import UI plus a
minimal imported-games summary list.

## 2. Scope

**In scope**

- Chess.com adapter over the PubAPI: player archives list → sequential
  monthly-archive fetch (pagination), JSON records with embedded PGN.
- Lichess adapter over `/api/games/user/{username}` NDJSON export
  (streaming), cursor (since) pagination via the `since`/`max` params.
- A shared import orchestration service that: walks pages, skips
  unsupported games, maps each provider record onto a domain `Game`,
  persists in batches via `gamesRepository.saveGames`, and maintains a
  persistent **import job** (ARCHITECTURE §7 entity) with counters,
  cursor, status and error samples so interrupted imports can be resumed
  and failed imports can be retried.
- Public games only. Chess.com PubAPI has no private-game access anyway;
  Lichess import is the **unauthenticated** public export (`Accept:
  application/x-ndjson`, `pgnInJson=true`). See "Scope decisions" below.
- User-configurable import **filters** per run: a **time frame** (all
  time, a recent preset window, or a custom from–to range) and a
  **time-control category** selection (e.g. blitz + rapid only). Filters
  are applied deterministically and identically by both providers
  (§5); defaults are all time / all categories.
- Progress/error UI, duplicate-aware counters, resume/retry/cancel
  controls, and an imported-games summary list on `/games`.
- A **display-filter toolbar** above the imported-games list — platform
  (Chess.com/Lichess), time-control category, your side, opponent search,
  result and played-date range — independent from the import filters
  (§5/§8).
- New DB schema v3 (`importJobs` table), additive over v2.

**Out of scope (V1 deferrals)**

- Lichess OAuth2-PKCE / private games (research "Open Questions" 1, 4, 6).
- Game *viewing/analysis* on imported games (Features 008+); the summary
  list is metadata-only.
- Rated-only / color / opponent / analysis-status filters — a later
  refinement; V1 imports both rated and casual standard-rule games that
  match the user's time-frame and time-control selection.
- Background/worker-based import; V1 imports on the UI thread in small
  awaited batches (ARCHITECTURE §10 allows incremental/batched/resumable
  jobs without mandating a Worker).
- Archive-list caching with ETag/`If-None-Match` (research "Key
  Decisions") — optimization deferral; duplicate detection makes
  re-sweeps safe.

**Scope decisions the plan assumes (flag for confirmation, spec is a
stub)**

1. **Public-only import by username** for both providers. Rationale:
   spec AC ("import a batch of games from each supported platform") is
   met; Chess.com has no private API; Lichess OAuth would introduce
   token storage/expiry policies that need their own ADR. Lichess users
   whose games are not public will import only their public games.
2. **One active import job per account** (`{provider}:{username}`
   row id) so start/resume/retry always continue the same job.
3. **Repeated "Import" runs are incremental when the filters are
   unchanged**: they continue from the last stored cursor (new games
   only); a brand-new account imports the full archive. Overlap is safe
   because `saveGame` dedupes.
4. **GamesPage gains a metadata-only listing** of imported games so the
   user can see import results and the duplicate guarantee; navigation to
   an individual game stays out of scope until Feature 008.
5. **Import is filterable by time frame and time-control category**
   (defaults: all time, all categories). Rated and casual games are both
   imported; non-standard variants are skipped and counted.
6. **Filter change ⇒ re-sweep; filter equality ⇒ incremental.** The job
   stores the filters of its last run; starting an import whose filters
   differ resets the cursor to the beginning and re-scans the archive
   under the new selection. Already-imported games that match the new
   filters are reported as `duplicates`, never stored twice. Filtered-out
   games are counted separately from failures (see the `filtered`
   counter, §5).
7. **Games-page display filters are a read-side UI concern, not an
   import filter.** They operate on the stored `GameSummary` read model
   (never on PGN), are applied client-side by a pure helper over a single
   full `listGameSummaries()` fetch (already ordered newest-first), and
   require no new DB indexes. "Opponent" means the stored player on the
   side opposite `userColor`, matched case-insensitively as a substring.
   Reusing the repository's exact-match `GameQuery` as a fetch-pruning
   hint is a possible optimization, never the correctness path.

## 3. Existing code to reuse

- `src/domain/chess/parseGame.ts` — `gameFromPgn(rawPgn, ImportContext)`
  with source/externalId/username/userColor handling, header extraction
  (result, Elo, date, time control), legality validation, `ambiguousColor`
  /`illegalMove` error codes. **Do not write a second PGN parser.**
- `src/domain/chess/game.ts` — `Game`, `Player`, `makeGameId`
  (`source:externalId` stable identity).
- `src/domain/chess/gameSource.ts` — `GameSource` already includes
  `'chesscom'`/`'lichess'` and `GAME_SOURCE_LABELS` for UI copy.
- `src/domain/chess/timeControl.ts` — `normalizeTimeControl` (ADR-013,
  v1 mapping incl. `n/n` correspondence strings).
- `src/domain/chess/fixtures/` — deterministic fixture PGNs whose
  provider header shapes mirror real Chess.com/Lichess exports; reuse
  their PGN bodies in raw provider payload fixtures so expected domain
  output is known in advance.
- `src/infrastructure/db/database.ts`, `schema/v1.ts`, `schema/v2.ts`,
  `schema/index.ts` — versioning pattern to extend (v3) and the
  `PERSISTENCE_SCHEMA_VERSION` guard in `database.ts`.
- `src/infrastructure/db/games-repository.ts` — `saveGames` (single
  transaction), `saveGame` returning `inserted/updated/duplicate/
  idCollision`, and `listGameSummaries` + `GameQuery` (already supports
  exact-match filtering by `source`, `normalizedTimeControl`, `result`,
  `userColor`, `playedBefore`/`playedAfter` — the building blocks for the
  list's display filters). Import counters
  derive directly from these statuses — no new dedupe logic needed
  (Feature 004 already provides duplicate detection).
- `src/infrastructure/db/settings-repository.ts` — remember last-used
  usernames.
- `src/infrastructure/db/schema/v2-migration.test.ts` — pattern for a
  v3 migration test (fresh `Dexie` v2 store with data → open
  `ChessRemedyDatabase`).
- `src/infrastructure/engine/` — the `engineService`/transport layering
  and `test-support/fake*` precedent; the import service mirrors this
  shape (adapter behind injected transport).
- UI conventions: `PlaceholderPanel`-style pages, CSS Modules, Button,
  `data-testid` naming, `renderWithProviders` test utils, settings page
  forms for form patterns.
- `tests/e2e/app-shell.spec.ts` — the Games navigation assertion that
  must be updated when the placeholder is replaced.

## 4. Files/modules to create or modify

### Modify

| File | Change |
|---|---|
| `package.json` | add `msw` devDependency (latest stable; see §7) |
| `src/config/app-config.ts` | `PERSISTENCE_SCHEMA_VERSION = 3`; extend `SETTINGS_KEYS` with `import.chesscom.username` / `import.lichess.username` and last-selected filter keys per provider |
| `src/infrastructure/db/schema/index.ts` | export `applyV3Schema` |
| `src/infrastructure/db/database.ts` | apply v3 in constructor; update guard to 3 |
| `src/pages/GamesPage.tsx` | replace placeholder with import + summary page |
| `src/pages/GamesPage.module.css` | (new) page styles |
| `tests/e2e/app-shell.spec.ts` | Games nav test: assert import page, not placeholder |

### Create — domain (pure, no React/DB/Worker deps)

| File | Purpose |
|---|---|
| `src/domain/import/providerGame.ts` | `ProviderGameRecord` type; deterministic **v1 import-normalization mapping** from a provider record (PGN + structured enrichment) to a domain `Game`; skip reasons (`unsupportedVariant`, `noExternalId`, `userNotInGame`, parse errors). Versioned `IMPORT_NORMALIZATION_VERSION = 1`. |
| `src/domain/import/job.ts` | Import-job model: statuses (`running`/`paused`/`failed`/`completed`), counter aggregates, pure transitions (`start`, `applyBatchResults`, `fail`, `pause`, `complete`), opaque serializable cursor per provider. |
| `src/domain/import/filters.ts` | Pure, deterministic import-filter model: `TimeFrame` (`all`/recent presets/custom from–to), `TimeControlSelection` (`all` or a non-empty category subset excluding `unknown`), `resolveTimeFrame(timeFrame, nowMs)` → ms window, category/date predicates, equality + validation (`filtersEqual` drives incremental vs re-sweep). |
| `src/domain/import/index.ts` | barrel |
| `src/domain/import/providerGame.test.ts`, `job.test.ts`, `filters.test.ts` | unit tests |

### Create — infrastructure (DB)

| File | Purpose |
|---|---|
| `src/infrastructure/db/schema/v3.ts` | `importJobs: '&id, provider, username, status, updatedAt'` |
| `src/infrastructure/db/import-jobs-repository.ts` | `ImportJobsRepository`: `getJob(id)`, `putJob(job)`, `deleteJob`, `listJobs({status?, provider?})`. Rows hold the full job (counters, cursor, error samples) as JSON. |
| `src/infrastructure/db/import-jobs-repository.test.ts` | CRUD + query tests (fake-indexeddb) |
| `src/infrastructure/db/schema/v3-migration.test.ts` | v2 store with settings+games → opens at v3 preserving data, `importJobs` usable |

### Create — infrastructure (providers)

| File | Purpose |
|---|---|
| `src/infrastructure/providers/types.ts` | `ProviderAdapter` contract: `fetchProfile` (validate username), `fetchPage(cursor)` → `{ records, nextCursor }`; `ProviderPageResult`; `ImportRequest { provider, username, filters }` (resolved ms window + category selection). Provider-agnostic so the orchestrator never imports provider modules. |
| `src/infrastructure/providers/transport.ts` | `fetchWithRetry` wrapper over an injected fetch: serial requests, provider backoff policy (Chess.com exponential 1s→2s→4s + 100 ms polite delay between pages; Lichess waits 60 s on 429), `AbortSignal` support, HTTP-error mapping (404 → `playerNotFound`, 429 → retryable). |
| `src/infrastructure/providers/chessCom.ts` | Chess.com adapter: archives list → iterate monthly URLs (pruned to the date window) → map archive JSON `games[]` records → `ProviderGameRecord`; externalId = trailing segment of `url`; skip `rules !== 'chess'`; enrichment from `end_time` (epoch s), `time_control`; color from `white/black` username match. |
| `src/infrastructure/providers/lichess.ts` | Lichess adapter: NDJSON streaming read from `Response.body` (line decoder); each line (with `pgnInJson=true`) → record; externalId = `id`; skip `variant !== 'standard'`; cursor = `since` (ms) advanced to last committed game `createdAt`, fenced by the filter window (`since = max(cursor, window.fromMs)`, `until = window.toMs`); enrichment from `createdAt`. |
| `src/infrastructure/providers/fixtures/chessCom.ts`, `lichess.ts`, `index.ts` | Deterministic **raw provider payloads** (archive lists spanning several months, monthly JSON pages, NDJSON text) built around the Feature-003 fixture PGN bodies and **covering multiple time-control categories and dates** so filter/pruning paths are exercisable; shared by Vitest MSW handlers and Playwright route stubs. |
| `src/infrastructure/providers/transport.test.ts`, `chessCom.test.ts`, `lichess.test.ts` | adapter + transport tests with stubbed/injected fetch |

### Create — infrastructure (import service)

| File | Purpose |
|---|---|
| `src/infrastructure/import/importService.ts` | `ImportService`: owns job lifecycle. `start({provider, username, filters})` → validates user, loads-or-creates job (resetting the cursor when filters differ from the stored job), walks pages via adapter, maps records (`providerGameToGame`), saves in batches of ~25 through `gamesRepository.saveGames`, aggregates statuses into job counters, persists the job after every page/batch (resume point), aborts on cancel/unmount, converts terminal failures to `failed` + error sample. Never touches the engine. `resume(jobId)`, `cancel(jobId)`, `retry(jobId)`, `jobFor(provider, username)`, progress subscription. |
| `src/infrastructure/import/importService.test.ts` | integration tests using MSW handlers + real repositories over fake-indexeddb |

### Create — UI

| File | Purpose |
|---|---|
| `src/components/games/ImportPanel.tsx` + `.module.css` | Per-provider form (username, prefilled from settings), Import/Resume/Retry/Cancel actions, progress (Chess.com: page i/n + counts; Lichess: indeterminate bar + counts), status text, expandable last-error samples. Provider-agnostic via injected service interface. |
| `src/components/games/ImportedGamesList.tsx` + `.module.css` | metadata-only summary table (playedAt, White/Black + ratings, result, time control, source) via `listGameSummaries`, newest first, rendered from the already-filtered subset passed in; empty state distinguishes "no games yet, import" from "no games match the filters". |
| `src/components/games/GameListFiltersBar.tsx` + `.module.css` | toolbar with the display filters (see §8): platform, time-control category, your side, opponent search input (with clear), result, played-date range; Reset; matched/total count. |
| `src/components/games/gameListFilters.ts` | Pure, React-free display-filter model: `GameListFilters` type (each dimension with an "all/any" default), `matchesGameListFilters(summary, filters)`, opponent resolution (opposite side of `userColor`), and `filtersActive`/`emptyGameListFilters`. |
| `src/components/games/gameListFilters.test.ts` | unit tests for the pure filter logic |
| `src/components/games/test-support/fakeImportService.ts` | deterministic fake (mirrors `fakeEngineService.ts` precedent) |
| `src/components/games/ImportPanel.test.tsx`, `GamesPage.test.tsx`, `GameListFiltersBar.test.tsx` | component tests |
| `src/hooks/useGameImport.ts` | page-level hook binding `ImportService` to component state, subscription cleanup → pauses running job on unmount |

### Create — e2e

| File | Purpose |
|---|---|
| `tests/e2e/game-import.spec.ts` | route-intercepted full import flow (Chromium only; `page.route` serves provider fixtures): import → rows listed, a display filter narrows the list, second import adds 0 rows, reload persists, engine worker count stays 0 |

## 5. Domain/data changes

- **No change to the Feature-003 `Game` model.** Import adapters reuse
  `gameFromPgn`; provider formats stay isolated behind adapters.
- **Import normalization v1** (`PROVIDER_IMPORT_NORMALIZATION_VERSION
  = 1`, deterministic, applied in `domain/import/providerGame.ts`):

  | Domain field | Source of truth |
  |---|---|
  | `source`, `externalId` | adapter (never guessed from PGN); `id = makeGameId` |
  | `userColor` | adapter compares record `white`/`black` (Chess.com) or `players.white/black` (Lichess) username with the import username, case-insensitive; passed explicitly to `gameFromPgn` |
  | `playedAt` | PGN `UTCDate`/`UTCTime` when parseable; otherwise adapter `playedAtIso` enrichment (Chess.com `end_time`, Lichess `createdAt`) — Chess.com PGNs are date-only, so enrichment supplies the exact instant |
  | `timeControl` (verbatim) + `normalizedTimeControl` | PGN `[TimeControl]` header when present; adapter `timeControlRaw` enrichment when the header is missing (`normalizeTimeControl` still derives the category — ADR-013) |
  | `whitePlayer`/`blackPlayer` | PGN `White/Black` names + `WhiteElo`/`BlackElo`; adapter rating enrichment only when the header Elo is absent |
  | `result`, `pgn` | PGN, verbatim |

  Rationale: stored scalar metadata is authoritative (import-time
  normalization retention, ADR-013 consequence), and each provider
  record is stable per `externalId`, so repeated imports produce
  byte-identical rows → `duplicate`, never churn.
- **New domain concept: import job** — `domain/import/job.ts` pure state
  machine and counters (`seen`, `inserted`, `updated`, `duplicates`,
  `failed`, `skipped`, `filtered`). Not part of the chess aggregate.
- Non-standard games (Chess.com `rules !== 'chess'`, Lichess `variant
  !== 'standard'`) are **skipped** with a stored reason, import continues.
- **Import filters (new, `domain/import/filters.ts`)** — pure selection
  applied identically by both providers:
  - `TimeFrame`: `all | last30d | last3m | last6m | last12m | custom
    { from: 'yyyy-mm-dd', to: 'yyyy-mm-dd' }`. `resolveTimeFrame`
    converts it to an inclusive `[fromMs, toMs]` window against a passed
    `now` (custom dates resolved as UTC day bounds for determinism).
    Provider queries prune network traffic to this window; a per-record
    date check on the same window is authoritative.
  - `TimeControlSelection`: `all`, or a non-empty subset of
    `{bullet, blitz, rapid, classical, correspondence}`; empty selections
    and `unknown` are rejected at validation time.
  - The **authoritative category filter** evaluates each record's
    verbatim time-control string through `normalizeTimeControl`
    (ADR-013), so semantics are identical on Chess.com and Lichess.
    Lichess's `perfType` query is deliberately **not** used as a server
    hint: Lichess perf boundaries (e.g. `ultraBullet` as a separate perf)
    do not align with clock-derived normalized categories.
  - Records excluded by either filter increment the new **`filtered`**
    counter (no per-game reason rows — far too noisy) and are otherwise
    ignored. `filtered` is shown separately from `skipped` (unsupported
    games) and `failed`.
  - Filtering runs on **enrichment-only fields first** (`time_control`/
    `end_time` on Chess.com records, `createdAt`/`perf` on Lichess
    NDJSON): a record can be classified `filtered` without paying for a
    full PGN parse. Survivors then flow through `gameFromPgn` as before.
  - **Incremental-vs-resweep**: the job's stored filters are compared
    with the next run's via `filtersEqual`; a mismatch resets the cursor
    (re-sweep), equality resumes from the cursor (scope decision 6).

## 6. Data-model changes (IndexedDB schema v3)

Additive Dexie version upgrade (ADR-001; no rewrite of existing data):

```
importJobs: '&id, provider, username, status, updatedAt'
```

Row shape:

```ts
interface ImportJobRow {
  id: string;                  // `${provider}:${username.toLowerCase()}`
  provider: 'chesscom' | 'lichess';
  username: string;
  filters: ImportFilters;      // selection of the last run (time frame + time-control categories)
  status: 'running' | 'paused' | 'failed' | 'completed';
  cursor: unknown;             // serializable, provider-specific resume point
  counters: ImportCounters;    // seen/inserted/updated/duplicates/failed/skipped/filtered
  errorSamples: readonly { externalId: string | null; reason: string }[]; // capped ~20
  lastError: string | null;
  createdAt: number;           // epoch ms
  updatedAt: number;           // epoch ms
  startedAt: number | null;
  completedAt: number | null;
}
```

`filters` is part of incremental-correctness: a run whose resolved
filters differ from the stored job's triggers a re-sweep (cursor reset,
scope decision 6); identical filters resume from the cursor.

Cursor semantics: Chess.com = index/URL of the last fully-imported
monthly archive (incremental runs start after it, within the filter
window); Lichess = `since` ms
timestamp of the last committed game (resume re-streams from
`cursor` with id-level dedupe absorbing overlaps). `PERSISTENCE_SCHEMA_VERSION`
bumps 2 → 3 (guard in `database.ts`).

Usernames and last-selected filters are remembered in `settings`
(`import.<provider>.username`, `import.<provider>.timeFrame`,
`import.<provider>.timeControls`) — no secrets; no tokens are ever
stored (public APIs only).

## 7. Infrastructure changes

- **No new runtime dependencies.** Fetch, `ReadableStream` line decoding,
  backoff/retry and abort are implemented locally (`transport.ts`).
- **New devDependency `msw`** (latest stable — 2.15.0 as of writing,
  MIT license, compatible with ADR-027 posture). ADR-009 designates MSW
  (Node) as installed by its first consumer, **Feature 007**, for
  adapter/importer integration tests. All adapters accept an injected
  fetch-compatible transport so MSW intercepts calls in Vitest
  (ADR-009 consequence).
- Importer runs on the UI thread in awaited page/batch steps (each batch
  is a `gamesRepository.saveGames` transaction); job state is persisted
  after each page so a tab close loses at most one page. No Web Worker
  in V1 (see Scope). No Stockfish/engine code path is reachable from the
  importer.
- Chess.com serial, polite requests (100 ms delay + exponential backoff);
  Lichess one stream at a time, 60 s wait on 429. Abortable everywhere.
- **Filter application**: both adapters prune network traffic to the
  resolved date window first — Chess.com iterates only monthly archives
  intersecting `[fromMs, toMs]`; Lichess sends `since = max(cursor,
  fromMs)` and `until = toMs` (ms) query params. The shared record-level
  filter in `domain/import/filters.ts` (§5) then applies the
  authoritative date + normalized-category checks. No Lichess `perfType`
  hint is sent — its perf boundaries differ from the normalized
  categories.

## 8. UI changes

`/games` (`GamesPage`) — replaces the `PlaceholderPanel`:

1. **Imported games summary list** (`ImportedGamesList`): read-only
   metadata table from `listGameSummaries` (date, White, Black, result,
   time control category + verbatim string, source label, user color
   chip), newest first. An empty state distinguishes "no games yet —
   import above" from "no games match the filters".
2. **Display-filter toolbar** (`GameListFiltersBar`) above the list,
   applied client-side to the loaded summaries (scope decision 7):
   - platform: All / Chess.com / Lichess (`GAME_SOURCE_LABELS`),
   - time control: All, or any subset of Bullet / Blitz / Rapid /
     Classical / Correspondence / Unknown chips (ADR-013 categories,
     stored `normalizedTimeControl`),
   - your side: All / White / Black (stored `userColor`),
   - opponent: text input, case-insensitive substring over the stored
     player on the side opposite `userColor`; empty input matches all,
   - result: All / White won / Black won / Draw (stored `result`),
   - played date: optional from/to (`yyyy-mm-dd`) applying inclusively to
     the UTC date portion of the stored `playedAt`; dateless games are
     excluded while a range is set,
   - Reset restores all defaults; a live "N of M games" counter reflects
     the active filters; every control is label/aria-accessible, and the
     toolbar collapses gracefully on narrow screens.
   Filters are independent of the import filters: changing them never
   touches the stored job, only the on-screen list.
3. **Import panel** (`ImportPanel`) per platform, using
   `GAME_SOURCE_LABELS` copy ("Chess.com"/"Lichess"):
   - username input (prefilled from settings; validated non-empty),
   - **filter form** (same for both providers, prefilled from the
     last-used settings):
     - time frame: preset select (**All time** default, Last 30 days,
       Last 3 / 6 / 12 months) or **Custom range** (from/to date
       inputs, `yyyy-mm-dd`),
     - time control: **All time controls** (default) or a checkbox chip
       group over Bullet / Blitz / Rapid / Classical / Correspondence
       (validation requires ≥ 1 category once narrowed; `unknown` games
       are only included under "All"),
     - changing the selection relative to a stored job shows an inline
       note that the next import **re-scans the archive** — already
       imported games are detected as duplicates and never stored twice
       (scope decision 6),
   - primary action label depends on job state: **Import games**
     (no job or completed job → incremental, or re-sweep when filters
     changed), **Resume** (paused), **Try again** (failed — resumes
     from the stored cursor),
   - Cancel/Stop while running,
   - progress: Chess.com deterministic (`archive i of n` + live
     counters), Lichess indeterminate bar + live counters
     (`inserted/duplicates/failed/filtered/skipped`), where `filtered`
     reflects games excluded by the user's time-frame/category selection
     and `skipped` reflects unsupported (non-standard) games,
   - status line and a capped, expandable list of per-game error/skip
     reasons (`filtered` games are not listed individually),
   - offline / player-not-found / rate-limited messages derived from
     typed failures,
   - on unmount the running job is paused (hook cleanup), and revisiting
     the page shows the Resume banner.
4. Accessibility/responsiveness: forms and actions are operable by
   mouse, touch and keyboard; status changes are announced
   (`aria-live="polite"`); no action is keyboard-only. Existing
   light/dark tokens apply via CSS Modules.

## 9. Tests

Domain (`vitest`, Node, no DOM/DB):
- `providerGame` normalization: Chess.com + Lichess fixture records →
  expected `Game` (id, externalId, userColor from JSON not headers,
  playedAt precision, verbatim timeControl + category, Elo fallback);
  skip reasons (variant, missing id, username not in game, illegal/parse
  errors forwarded from `gameFromPgn`); determinism (same input twice).
- `job`: transitions, counter aggregation from `saveGame` statuses,
  cursor persistence.
- `filters`: preset/custom time-frame resolution against a fixed `now`
  (boundary inclusivity); category-set validation (reject empty,
  reject `unknown`); date + category predicates; `filtersEqual`
  (order-insensitive category sets, custom-range equality).

DB:
- v3 migration test (v2 with data → v3, settings/games preserved,
  `importJobs` usable) mirroring `v2-migration.test.ts`.
- `importJobs` repository CRUD/queries against fake-indexeddb.

Providers (`transport` injected; MSW where HTTP shape matters):
- Chess.com: archives list → page iteration order; **date-window pruning
  of monthly archives** (only intersecting months fetched, out-of-window
  month left unfetched); URL→externalId;
  month JSON→records; 404 username; 429 backoff then success (fake
  timers); abort.
- Lichess: NDJSON line decoding; `since` cursor advance; **`since`/`until`
  query fenced by the filter window (`since = max(cursor, fromMs)`);
  record-level date/category filtering returns `filtered`**; malformed-line
  skip; 404/429 handling; abort mid-stream.
- transport: retry policy, backoff caps, error classification.

Import service (MSW handlers + real repositories over fake-indexeddb):
- end-to-end batch import of both providers from payload fixtures;
- **duplicates**: second run inserts 0, counters show `duplicates`;
- **filtered import**: with a time frame + category selection, only
  matching games are inserted and the rest increment `filtered` (and are
  pruned server-side per provider);
- **filter-change re-sweep**: import all-time/all → re-import with
  rapid-only resets the cursor, inserts only new matching games, reports
  previously-imported matches as `duplicates`, never double-stores;
- **same-filter incremental**: unchanged filters resume from the stored
  cursor and only fetch new pages;
- partial-failure resume: interrupt after page 1 → job `paused` →
  resume completes without re-inserting page-1 games;
- failure → `failed` + `lastError` → retry succeeds;
- cancel persists cursor; started-while-running is rejected;
- **no engine analysis**: assert the importer never invokes engine
  modules/workers.

UI (component, fake import service + fake-indexeddb):
- ImportPanel renders both providers; progress updates; resume/retry/
  cancel flows; error samples expandable; empty/error states.
- ImportPanel filter form: preset/custom time-frame inputs, category chip
  selection, validation (≥ 1 category when narrowed), prefilled from
  settings, inline re-sweep note when selection differs from the stored
  job.
- `gameListFilters` (pure): each dimension — platform set, time-control
  set, side, opponent substring (case-insensitive, trimmed; opponent is
  the side opposite `userColor`), result, inclusive UTC-date range
  (dateless games excluded while a range is active); all-defaults matches
  everything; `filtersActive`.
- GamesPage: empty states (no games vs no matches), summary rows render
  from a filtered subset, matched/total counter updates, Reset restores
  the full list, mock service wiring.
- GameListFiltersBar: controls render/label correctly, filter changes
  propagate to the list, opponent input clears, date inputs validate.

E2E (Playwright, Chromium only — skipped when unavailable):
- `game-import.spec.ts` (route-intercepted fixtures): import → rows
  listed → a display filter (platform/time control/opponent) narrows the
  list → reload persists → re-import adds none → no engine worker
  spawned. Update `app-shell.spec.ts` Games assertion.

## 10. Migration considerations

- **Schema v2 → v3** is purely additive (`importJobs`); existing
  `settings` and `games` rows are untouched. Dexie applies upgrades in
  order (`v1 → v2 → v3`) on first open; covered by the v3-migration
  test. `PERSISTENCE_SCHEMA_VERSION` guard forces the app-config bump to
  land with the schema module.
- No migration of game rows is needed; previously imported games (if
  any) keep their metadata.
- No sync impact: Feature 016 will define how (or whether) `importJobs`
  syncs; today the table is local-only like the analysis cache
  (ADR-018 precedent). Sync providers are unaffected.

## 11. Risks

- **Provider API drift**: field shapes in payload fixtures are based on
  the research doc and public API docs; if live responses differ
  (e.g. Chess.com `time_control`/`end_time` formats, Lichess NDJSON
  ordering/`createdAt` granularity) the mapping version + isolated
  adapters contain the fix — verify once against live endpoints during
  development.
- **Lichess stream resumption**: a failed NDJSON stream cannot resume
  mid-request; resumption re-streams from the stored `since` cursor with
  id-level dedupe. Games sharing a `createdAt` across a `max` page
  boundary could repeat in one run (dedupe absorbs) or, in a pathological
  all-same-timestamp archive, stall a cursor-based pager — the importer
  must guard against cursor non-advance (fall back to a single unbounded
  stream). Research "Open Question" 5.
- **Rate limiting**: research documents serial-request etiquette but not
  hard caps; backoff must be conservative (Lichess 60 s on 429). Browser
  cannot set a custom User-Agent (research recommends one) — acceptable
  for low-volume personal imports.
- **Large archives / UI responsiveness**: PGN parsing is synchronous;
  keep batches small and yield between pages. Full first import of a
  large account is intentionally sequential.
- **Public-only scope**: users with non-public Lichess games will not see
  those games. Explicitly communicated in the UI copy.
- **Time-control corner cases** (untimed/`-`, odd correspondence
  strings) fall to `unknown` per ADR-013 — already the domain contract.
  Filter semantics follow from this: `unknown` games are imported only
  under the "All time controls" default, never when a category subset is
  chosen.
- **Filter-change re-sweep cost**: any filter change re-scans the whole
  archive sequentially (worst case for large accounts). This is
  intentional — cursor-based resumes are only valid for identical
  filters — and safe: matches are `duplicates`, nothing is stored twice.
  The UI states the re-scan before starting.
- **Perf-label vs clock boundary mismatches**: the category filter keys
  off the normalized clock string, not provider perf labels (Lichess
  `ultraBullet` is its own perf but normalizes to `bullet`; Chess.com
  `daily` normalizes to `correspondence`). Users may be surprised that
  e.g. a "bullet" selection includes ultra-bullet-style clocks; the
  shared normalized semantics keep both platforms consistent (ADR-013).
- **Date-window determinism**: custom ranges resolve to UTC day bounds;
  preset windows are computed against the run start. Provider month
  pruning is coarse (whole-month granularity) so the per-record date
  check is authoritative for boundary months. Local-time labelling could
  be revisited after user feedback, but stays deterministic in V1.
- **Large imported libraries / list performance**: the games list loads
  all `GameSummary` rows (no PGN parsing) into memory and filters
  client-side, including the opponent substring scan. Acceptable for V1
  personal archives; virtualization or paging plus index-based opponent
  queries are a later refinement (no new indexes in V1).
- Existing e2e asserting the placeholder must be updated in the same
  change.

## 12. Acceptance criteria

1. From `/games`, a user can start a batch import by username for
   **Chess.com** and for **Lichess**; both import without any engine
   analysis being triggered (verified by tests/spies and e2e worker
   count).
2. Imported games persist across a browser restart (IndexedDB) with
   **normalized metadata**: stable id `source:externalId`, verbatim
   `timeControl` plus a canonical `normalizedTimeControl` (ADR-013),
   ISO `playedAt` when derivable, `result`, `Player` names/ratings,
   and the importing user's `userColor`.
3. Pagination works per provider: Chess.com walks every monthly archive
   intersecting the chosen date window; Lichess streams pages within the
   window until the cursor is exhausted.
4. **Duplicates are not stored twice**: re-importing the same account
   reports `duplicates` and inserts 0 new rows (Feature-004 detection
   reused).
5. Import reports **progress** (page position or indeterminate + live
   inserted/duplicate/failed/filtered/skipped counters), surfaces
   per-game errors/skips, handles `playerNotFound`, offline and
   rate-limit failures with user-friendly messages, and offers
   **retry**.
6. **Resumability**: an interrupted import is persisted as `paused` and
   can be resumed later without re-inserting already-saved games; cancel
   works.
7. Unsupported (non-standard) games are skipped with a reason while the
   batch continues.
8. **Filters work on both providers**: the user can restrict an import by
   time frame (all time / a recent preset / a custom from–to range) and
   by time-control category (default all; one or more of
   bullet/blitz/rapid/classical/correspondence). Only matching games are
   imported; excluded games are counted under `filtered` and shown
   separately from failures/skips. The selection is remembered for next
   time.
9. **Filter semantics are consistent and safe**: a category selection
   behaves identically on Chess.com and Lichess (normalized ADR-013
   categories, not provider perf labels). Changing the selection
   re-scans the archive from the start and reports previously imported
   matches as `duplicates` with no row stored twice; re-importing with an
   unchanged selection stays incremental from the stored cursor.
10. **Games-page display filters work**: the imported-games list can be
    narrowed by platform, time-control category, your side, opponent name
    search (case-insensitive substring of the stored opponent), result,
    and played-date range; the matched count updates, Reset restores the
    full list, and an active filter that matches nothing shows a clear
    empty state rather than implying no games exist.
11. The Games page shows the imported-games summary list and updates after
    an import; empty state is clear.
12. All `## Execution policy` commands pass clean (see below).

## 13. Verification commands

Narrowest-first, then the full gate:

```bash
npm run lint
npm run typecheck
npm run format:check
npx vitest run src/domain/import src/infrastructure/providers \
  src/infrastructure/import src/infrastructure/db \
  src/components/games src/pages/GamesPage.test.tsx
npm run test
npm run build
npm run dev          # manual smoke: import via both providers in devtools/mock? — see note
npm run test:browser # when Chromium is available
npm audit
```

Smoke note: real Chess.com/Lichess calls are possible in `npm run dev`
with a throwaway username and need network; the e2e suite covers the
offline/mocked path deterministically. No new console errors during the
smoke run.
