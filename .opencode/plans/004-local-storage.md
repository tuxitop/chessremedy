# Implementation Plan — Feature 004 (Local Game Storage)

Status: Approved with revisions (reviewer verdict; revisions applied in §17)
Target feature: `.opencode/specs/features/004-local-storage.md`
Author: planner (no implementation work performed)

---

## 1. Objective

Introduce local persistence for imported chess games: an IndexedDB-backed
`games` table (via Dexie), added through a **v2 schema upgrade**, plus a
typed `gamesRepository` that supports **insert, retrieve, update, delete,
duplicate detection and schema versioning** — the six verbs required by
`004-local-storage.md`.

The deliverable satisfies the two acceptance criteria of Feature 004:

- imported games survive a browser restart;
- duplicate external games are not stored twice.

Key architectural constraints this plan must satisfy:

- IndexedDB is the primary persistent store and Dexie is the access
  layer (`ARCHITECTURE.md` §2, §7; `ADR-001`).
- Storage lives in the **infrastructure** layer; domain logic must not
  depend on React or on the DB (`ARCHITECTURE.md` §3).
- The Dexie schema is **versioned**; each schema addition goes through
  `db.version(N).stores(...)` chained in the `ChessRemedyDatabase`
  constructor, and `PERSISTENCE_SCHEMA_VERSION` is bumped in lockstep
  (`001-foundation` §11.2, `ARCHITECTURE.md` §7).
- `Game` identity must stay stable across repeated imports
  (`specs/domain/game-model.md`); Feature 003 already provides
  `makeGameId` (`'chesscom:<id>'` / `'lichess:<id>'` / `'local:<pgn-hash>'`),
  and its plan explicitly hands "the definitive dedupe policy" to
  Feature 004/007.
- Stored games **retain the time-control category they were normalized
  with** when the normalization mapping later changes (ADR-013
  consequence, recorded in `003-chess-domain` §11.3).
- The chessops `PgnNode` tree (`MoveList`) is **not directly
  serializable** (nodes carry prototype methods from `chessops/pgn`), so
  the persisted representation must keep the verbatim PGN text — already
  a `Game` field — and rebuild the tree on read.

This feature owns no UI. It provides the storage contract that Feature
007 (import) and Feature 008 (analysis/review) consume.

---

## 2. Scope

### In scope (from `004-local-storage.md` + architecture)

- A Dexie **v2 schema** adding the `games` table, applied after the
  existing `v1` (`settings`) schema. `PERSISTENCE_SCHEMA_VERSION` bumped
  to `2`.
- A `games` **row model** (`GameRow`) and the mapping between the domain
  `Game` aggregate and that row.
- A `gamesRepository` (infrastructure layer) providing:
  - insert / update (`saveGame`, `saveGames` batch),
  - retrieve (`getGame` returning a full domain `Game`;
    `listGameSummaries` returning lightweight records for listings),
  - delete (`deleteGame`),
  - duplicate detection (`hasGame`, explicit result codes from
    `saveGame`/`saveGames`, content-aware dedupe policy),
  - schema versioning (v2 upgrade; migration test).
- Unit tests using `fake-indexeddb`, including a **migration test**
  (v1 → v2 preserves `settings`) and a **restart test** (close + reopen
  the database connection on the same store).
- Updates to the existing DB tests that assert the schema surface.

### Out of scope (owned by later features)

- **No** `moves`, `analyses`, `positionAnalysisCache`, `importJobs`,
  `analysisJobs`, puzzle, SRS, or sync tables. The `Analysis`/`MoveAnalysis`
  domain models exist but are persisted by Feature 008; job state by
  Features 007/008; puzzles/reviews/SRS by Features 011–013; sync
  metadata by Feature 016. Each owning feature adds its own version bump.
- Chess.com / Lichess import adapters, pagination, import jobs, import
  progress/retry UI — Feature 007.
- Stockfish engine, analysis queue, resumable analysis — Features
  005/008.
- Game review / analysis UI, per-game routes — Feature 008.
- A games library page — Feature 007/008 (GamesPage stays a
  placeholder).
- Any change to `src/domain/chess/**`, hooks, components, routes,
  themes, PWA, or `package.json`.

---

## 3. Specification Notes & Open Decisions for Reviewer

`004-local-storage.md` is terse and is **not contradictory**, but it
pins down none of the storage design: which tables Feature 004 owns,
the row shape, the repository API, the duplicate-detection semantics, or
how "survives browser restart" is demonstrated before an importer exists
(Feature 007). The following decisions are **not** dictated by any spec
or ADR. They are proposed here so the reviewer can confirm or override
them before implementation starts. **The plan should not be approved
without explicit acknowledgement of D1–D7.**

| # | Open question | Proposed choice | Rationale |
|---|---------------|-----------------|-----------|
| D1 | Which tables does Feature 004 introduce? | **Only `games`, in a v2 upgrade.** No `moves`/`analyses`/job/puzzle/sync tables. The game's own content is stored as its verbatim PGN text (the `Game.moves` chessops tree is rebuilt on read). | `ARCHITECTURE.md` §7 lists the full persistent-entity set, but each later feature owns its tables and adds its own version bump (the `001-foundation` plan's §11.2 speculation that 004 adds `moves`/`import_jobs`/`analysis_jobs` is not a spec and is superseded here). **Reviewer L1:** D1 also supersedes `003-chess-domain.md` §11.1 ("004 will introduce the `games`/`moves`/`analyses` tables via `v2`") — both are non-normative forward notes; ARCHITECTURE.md §7 requires only that the schema be versioned, not that empty stores be pre-created. 004's spec scope is "chess games and related metadata", i.e. the game row and its columns. Keeping v2 to `games` keeps the migration small, additive, and reviewable; analyses/jobs arrive with 008/007. |
| D2 | Stored row shape & read-back strategy | `GameRow` = all scalar `Game` metadata (`id`, `source`, `externalId`, `playedAt`, `whitePlayer`, `blackPlayer`, `result`, `timeControl`, `normalizedTimeControl`, `userColor`) + verbatim `pgn` + local timestamps (`importedAt`, `updatedAt`). The row's **scalar columns are authoritative** (they capture import-time normalization, ADR-013 consequence). Reading a full `Game` re-parses only to rebuild the **moves tree**: `gameFromPgn(row.pgn, { source, externalId?, userColor })` → take `moves`, and integrity-check `makeGameId(row.source, row.externalId, row.pgn) === row.id`; re-derived scalar drift (e.g. after a normalizer-version bump) is ignored in favour of stored columns. `listGameSummaries` never parses. | The chessops `Node<PgnNodeData>` tree cannot be structured-cloned safely (prototype methods), so PGN text is the serializable game content. Reparse-only-for-moves keeps `getGame` cheap and deterministic and honours "stored games retain the category they were normalized with". The recomputed-id check gives cheap corruption detection without re-deriving metadata. |
| D3 | Repository API surface | `GamesRepository` with `saveGame`, `saveGames`, `getGame`, `listGameSummaries`, `hasGame`, `deleteGame` (exact signatures in §6.2). Located at `src/infrastructure/db/games-repository.ts`; singleton `gamesRepository` following the `settingsRepository` pattern. **Reviewer H1:** the `DexieGamesRepository` class takes an injectable Dexie instance (`constructor(db: Dexie = db)`) so migration/restart tests can bind it to isolated named `ChessRemedyDatabase` instances; the module singleton stays the default binding. | Matches the spec verbs (insert/retrieve/update/delete/duplicate detection) with one function each; `listGameSummaries` returns records without PGN/parse so a game list or statistics filter (Feature 014) never re-parses every PGN. Feature 007/008 consume exactly this contract. The injectable-DB constructor keeps the repository testable with isolated stores (AGENTS dependency isolation) without touching `settings-repository.ts`. |
| D4 | Duplicate-detection semantics | `saveGame`/`saveGames` return per-game result codes: **`inserted`** (new id), **`updated`** (id exists, content differs — allowed for provider games, row replaced, `importedAt` preserved, `updatedAt` refreshed), **`duplicate`** (id exists, content identical — no write, timestamps untouched), **`idCollision`** (id exists for a non-provider game whose PGN differs — i.e. an FNV-1a 32-bit hash collision, Feature-003 caveat L3; **no write**). `hasGame(id)` is the cheap existence check. **Reviewer L3:** "identical content" is defined over the row's serializable comparison set — `pgn`, all scalar metadata fields (`source`, `externalId`, `playedAt`, `whitePlayer`, `blackPlayer`, `result`, `timeControl`, `normalizedTimeControl`, `userColor`) — **excluding** `importedAt`/`updatedAt`. | Provider games are uniquely identified by `id = source:externalId`, so the primary key alone prevents "stored twice"; the result codes give Feature 007 the semantic it needs (skip/overwrite) without storing duplicates. The `idCollision` guard addresses the documented FNV-1a weakness for local/fixture content. |
| D5 | `games` table indexes | `'&id, source, playedAt, normalizedTimeControl'`. No index on `externalId` (it is encoded in the primary key `source:externalId`); no compound indexes; `result`/`userColor`/`timeControl` stored unindexed. | `id` is the PK (duplicate prevention). `source`, `playedAt`, `normalizedTimeControl` are the known Feature-014 filter dimensions. IndexedDB skips rows whose index key is invalid/null (e.g. `playedAt: null`, `externalId: null`), so ordering/filtering must not rely on an index including nulls — handled in D6. |
| D6 | List ordering & filtering | `listGameSummaries(query?)` fetches via a Dexie `where` clause when the query targets indexed fields, then filters/sorts in memory: **`playedAt` descending (ISO-8601 UTC string order), games with `playedAt: null` last**, tie-break `id` ascending. Filter fields: `source`, `normalizedTimeControl`, `result`, `userColor`, `playedBefore`/`playedAfter` (exclusive ISO bounds). **Reviewer M4 (pinned):** when a query combines several indexed fields, Dexie cannot chain `where` clauses without a compound index (D5 chose none) — the implementation picks **one leading indexed field** (`source` if present, else `normalizedTimeControl`, else a full table scan) and applies the remaining filters in memory. A row with `playedAt: null` satisfies **neither** `playedBefore` nor `playedAfter` (it is excluded whenever bounds are present), independent of how the rows were fetched. | Dexie cannot index `null`, so a pure index-ordered read would silently drop dateless games. Personal game libraries are small enough (hundreds–thousands) that an in-memory sort after a filtered fetch is correct and fast; Feature 014 reuses the same summaries. Deterministic ordering is asserted in tests. |
| D7 | How "survives browser restart" is demonstrated | Automated at the repository level (reviewer H1): a test constructs an isolated named `ChessRemedyDatabase('<unique-name>')`, binds a `DexieGamesRepository` to it via the injectable constructor, inserts fixture games, **closes** the connection, opens a **fresh** instance on the same name, and reads the games back (asserting `db.verno === 2` and identical data); the v1→v2 migration test does the same across the schema upgrade. No UI change and no Playwright restart test in this feature, because no user-facing save path exists before Feature 007. | IndexedDB durability across page reloads is a browser guarantee; the close/reopen test exercises a genuine new connection + version check on the same persistent store. A real-browser restart demonstration becomes possible in Feature 007 once import writes real data; a Playwright round-trip can be added there. |

If the reviewer disagrees with any of D1–D7, the affected sections
(§5, §6, §10, §12) must be revised before implementation begins.

---

## 4. Existing Code to Reuse

### Libraries already installed (no new runtime dependencies)

- `dexie@^4.0.0` (installed; currently 4.4.5) — DB access; already used
  by `database.ts`.
- `fake-indexeddb@^6.0.0` — IndexedDB in Node tests (already in
  `src/test/setup.ts`).
- No other package is required. Nothing is added to `package.json`.

### Existing code to reuse

| Artifact | What to take |
|---|---|
| `src/infrastructure/db/database.ts` | The `ChessRemedyDatabase` class + singleton `db` + the `PERSISTENCE_SCHEMA_VERSION` guard. Modified (not replaced): add a `games` table accessor and chain `applyV2Schema(this)` after `applyV1Schema(this)`; bump the guard to `2`. |
| `src/infrastructure/db/schema/v1.ts` | The established per-version schema-module pattern (`db.version(1).stores({...})`). v2 follows it exactly. |
| `src/infrastructure/db/schema/index.ts` | Barrel for schema appliers; add `applyV2Schema`. |
| `src/infrastructure/db/settings-repository.ts` | The repository pattern (interface + Dexie-backed singleton) that `games-repository.ts` mirrors. |
| `src/infrastructure/db/database.test.ts` | Test pattern for DB access under `fake-indexeddb`; must be updated for the new table list. |
| `src/domain/chess/game.ts` (`Game`, `Player`, `GameId`, `GameResult`, `makeGameId`) | The domain aggregate being persisted; `makeGameId` is used for the integrity check and by construction is the storage key. |
| `src/domain/chess/parseGame.ts` (`gameFromPgn`, `ImportContext`) | Reparse path used by `getGame` to rebuild the moves tree from stored PGN + stored context. |
| `src/domain/chess/gameSource.ts`, `timeControl.ts` | Types referenced by `GameRow` (`GameSource`, `TimeControlCategory`). |
| `src/domain/chess/index.ts` | Public barrel that already exports every domain type the repository needs. |
| `src/domain/chess/fixtures/games.ts` (`fixtureGame`) | Deterministic, pre-validated `Game` objects used to seed repository tests (test-only writes; fixtures are never stored as production user data). |
| `.opencode/plans/003-chess-domain.md` | Plan structure, decision-table and acceptance-mapping precedent. |

### Existing code explicitly NOT reused / NOT touched

- `src/domain/chess/**` — no domain source change (only reads/imports of
  existing exports).
- `src/hooks/useTheme.ts`, `ThemeToggle*`, `SettingsPage*`, the router,
  all pages — no UI change.
- The v1 `settings` table definition is unchanged.
- `package.json`, `package-lock.json`, `vitest.config.ts`,
  `playwright.config.ts`, PWA config — unchanged.

---

## 5. Files / Modules to Create or Modify

All paths are relative to the repository root.

### 5.1 New files

```
src/infrastructure/db/
├── schema/
│   └── v2.ts                     # applyV2Schema(db): db.version(2).stores({ games: '&id, source, playedAt, normalizedTimeControl' })
├── games-repository.ts           # GameRow, GameSummary, GamesRepository interface,
│                                 #   DexieGamesRepository, gameToRow/rowToSummary/reconstructGame
│                                 #   helpers, singleton `gamesRepository`
└── games-repository.test.ts      # CRUD + duplicate detection + ordering/filtering + corruption tests
```

```
src/infrastructure/db/schema/
└── v2-migration.test.ts          # v1→v2 migration, settings preservation, restart (close/reopen) test
```

### 5.2 Modified files

| Path | Change |
|---|---|
| `src/config/app-config.ts` | `PERSISTENCE_SCHEMA_VERSION` `1` → `2` (comment updated to reflect that v2 adds the `games` table). |
| `src/infrastructure/db/database.ts` | `import type { GameRow } from './games-repository'` (type-only, erased at runtime — no runtime cycle); add `games!: Table<GameRow, string>` accessor; call `applyV2Schema(this)` after `applyV1Schema(this)`; change the version guard from `!== 1` to `!== 2` and update the error text. |
| `src/infrastructure/db/schema/index.ts` | Add `export { applyV2Schema } from './v2';`. |
| `src/infrastructure/db/database.test.ts` | Update the table-surface assertions: `db.tables` now contains `['settings', 'games']`; assert `db.verno === 2`. Existing settings tests are unchanged. |

No `src/domain/**`, `src/pages/**`, `src/components/**`, `src/hooks/**`,
or config-file changes beyond the two above.

---

## 6. Domain / Data Changes

### 6.1 Domain

**No changes to `src/domain/chess/**`.** The repository consumes the
existing Feature-003 exports. The persisted row shape is a new
infrastructure type, not a domain type — consistent with
`ARCHITECTURE.md` §3 (infrastructure owns DB access; the domain `Game`
aggregate stays storage-agnostic).

### 6.2 Data model (Dexie v2) and repository contract

Proposed shapes (implementation-level; the reviewer is confirming the
contract, not the code):

```ts
// schema/v2.ts
export function applyV2Schema(db: Dexie): void {
  // Games are stored verbatim-PGN-first: the row keeps the scalar metadata
  // (authoritative for import-time normalization, ADR-013 consequence) and
  // the moves tree is rebuilt from `pgn` on full reads.
  db.version(2).stores({
    games: '&id, source, playedAt, normalizedTimeControl',
  });
}
```

```ts
// games-repository.ts
import type { Color } from 'chessops/types';
import type { Game, GameId, GameResult, Player } from '@/domain/chess';
import type { GameSource } from '@/domain/chess';
import type { TimeControlCategory } from '@/domain/chess';

/** Persisted row — scalar Game metadata (authoritative) + verbatim PGN. */
export interface GameRow {
  readonly id: GameId;
  readonly source: GameSource;
  readonly externalId: string | null;
  readonly playedAt: string | null;          // ISO-8601 UTC; null when unknown
  readonly whitePlayer: Player;
  readonly blackPlayer: Player;
  readonly result: GameResult;
  readonly timeControl: string;              // raw provider string, verbatim
  readonly normalizedTimeControl: TimeControlCategory; // as normalized at import time
  readonly userColor: Color;
  readonly pgn: string;                      // verbatim PGN (single game)
  readonly importedAt: number;               // epoch millis of first local insert
  readonly updatedAt: number;                // epoch millis of last change
}

/** Lightweight read model for listings/filters — no PGN, no parse. */
export interface GameSummary {
  readonly id: GameId;
  readonly source: GameSource;
  readonly externalId: string | null;
  readonly playedAt: string | null;
  readonly whitePlayer: Player;
  readonly blackPlayer: Player;
  readonly result: GameResult;
  readonly timeControl: string;
  readonly normalizedTimeControl: TimeControlCategory;
  readonly userColor: Color;
  readonly importedAt: number;
  readonly updatedAt: number;
}

export type GameSaveStatus = 'inserted' | 'updated' | 'duplicate' | 'idCollision';

export interface GameSaveResult {
  readonly status: GameSaveStatus;
  readonly id: GameId;
}

export interface GameQuery {
  readonly source?: GameSource;
  readonly normalizedTimeControl?: TimeControlCategory;
  readonly result?: GameResult;
  readonly userColor?: Color;
  /** Exclusive ISO upper bound on playedAt. */
  readonly playedBefore?: string;
  /** Exclusive ISO lower bound on playedAt. */
  readonly playedAfter?: string;
}

export interface GamesRepository {
  /** Insert or update one game; content-aware duplicate detection (D4). */
  saveGame(game: Game): Promise<GameSaveResult>;
  /** Batch variant inside a single Dexie transaction; results aligned to input. */
  saveGames(games: readonly Game[]): Promise<readonly GameSaveResult[]>;
  /** Full domain Game (moves tree rebuilt from stored PGN). Undefined when absent. */
  getGame(id: GameId): Promise<Game | undefined>;
  /** Lightweight records for listings/stats; never parses PGN. Ordered per D6. */
  listGameSummaries(query?: GameQuery): Promise<readonly GameSummary[]>;
  /** Cheap duplicate existence check. */
  hasGame(id: GameId): Promise<boolean>;
  /** Idempotent delete; resolves when absent. */
  deleteGame(id: GameId): Promise<void>;
}

// Injectable Dexie instance (default: the module singleton) so migration /
// restart tests can bind the repository to an isolated named database (H1).
export const gamesRepository: GamesRepository = new DexieGamesRepository();
export class DexieGamesRepository implements GamesRepository {
  constructor(private readonly database: Dexie = db) {}
}
```

Semantics pinned for the implementer:

- **`saveGame(game)`** reads the existing row for `game.id`, then returns
  the D4 result code and writes accordingly:
  - absent → `inserted` (`importedAt = updatedAt = Date.now()`);
  - present + identical content (same `pgn` and same scalar metadata) →
    `duplicate`, no write;
  - present + different content and provider source (`chesscom`/`lichess`;
    id encodes the external id) → `updated`, write, keep `importedAt`,
    refresh `updatedAt`;
  - present + different content and non-provider source (`local`/`fixture`),
    i.e. an FNV-1a hash collision on the id → `idCollision`, **no write**.
  Content equality is defined over the row's comparison set (D4/L3): `pgn`
  plus all scalar metadata fields, excluding `importedAt`/`updatedAt`.
- **`saveGames(games)`** runs all classifications and writes inside
  `db.transaction('rw', db.games, ...)` so a mid-batch failure rolls the
  batch back; the returned codes align by index with the input.
- **`getGame(id)`**:
  1. `row = await db.games.get(id)`; `undefined` when absent.
  2. Integrity check: recompute `makeGameId(row.source, row.externalId,
     row.pgn)`; a mismatch throws a dedicated `GameCorruptionError`
     (exported from the repository module).
  3. Rebuild the moves tree: `gameFromPgn(row.pgn, { source: row.source,
     ...(row.externalId ? { externalId: row.externalId } : {}),
     userColor: row.userColor })` (conditional spread — required under
     `exactOptionalPropertyTypes`, M1). A parse failure throws
     `GameCorruptionError`; otherwise return the domain `Game` assembled
     from the **row's** scalar fields (authoritative) and the parsed
     `moves`. Re-derived scalars (e.g. `normalizedTimeControl` under a
     future normalizer bump) are discarded in favour of the stored columns.
- **`listGameSummaries(query?)`** maps rows to `GameSummary` (no PGN, no
  parse) ordered per D6. When multiple indexed filters combine, pick one
  leading indexed field (`source` if present, else `normalizedTimeControl`,
  else table scan) and apply the rest in memory; rows with `playedAt: null`
  never satisfy `playedBefore`/`playedAfter` (M4).
- Timestamps use `Date.now()` (matching `settings-repository.ts`); tests
  assert invariants, not exact values.

---

## 7. UI Changes

**None.**

- No component, page, route, CSS module, hook, or route change.
- `GamesPage` remains a Feature-007 placeholder; there is no save path in
  the UI before Feature 007, so this feature is verified entirely through
  repository/migration tests (D7).
- The `PERSISTENCE_SCHEMA_VERSION` bump has no visible UI effect.

---

## 8. Infrastructure Changes

### 8.1 Database (the only infrastructure change)

- New `schema/v2.ts` applying `db.version(2).stores({ games: '&id, source, playedAt, normalizedTimeControl' })`.
- `ChessRemedyDatabase` chains `applyV1Schema(this)` then
  `applyV2Schema(this)` in the constructor and exposes
  `games!: Table<GameRow, string>`.
- `PERSISTENCE_SCHEMA_VERSION` → `2` and the database.ts guard updated
  to match.
- `GameRow` type imported type-only into `database.ts` (no runtime
  cycle: `games-repository.ts` imports the `db` value, `database.ts`
  imports only the erased type).

### 8.2 No other infrastructure changes

No Vite/TS/ESLint/Prettier/Playwright config changes; no worker, PWA,
manifest, or network changes; no new dev-server behaviour.

---

## 9. Dependencies

**No new dependencies** (runtime, dev, peer, or optional).

- `dexie@^4.0.0` (installed: 4.4.5) covers storage.
- `fake-indexeddb@^6.0.0` (installed: 6.2.5) covers tests.
- Domain types come from the existing Feature-003 modules; the chessops
  PgnNode tree is not serialized, so no chessops changes are needed.
- No hashing library: `makeGameId` (Feature 003) is reused.

---

## 10. Tests

All new tests are Vitest tests under `src/infrastructure/db/` running
against `fake-indexeddb` via the existing `src/test/setup.ts`.

### 10.1 Modified — `database.test.ts`

- Table surface assertion becomes `['settings', 'games']`.
- Add `db.verno === 2`.
- Existing settings round-trip tests stay as-is (regression gate that the
  v2 upgrade does not disturb `settings`).

### 10.2 New — `schema/v2-migration.test.ts`

| Test | Asserts |
|---|---|
| v1 → v2 migration preserves settings | Build a raw `new Dexie(uniqueName)` with only `db.version(1).stores({ settings: '&key' })`, write a `theme`/arbitrary setting, close; open `new ChessRemedyDatabase(sameUniqueName)`; assert `db.verno === 2`, `db.tables` contains `settings` + `games`, the v1 setting survived, and `games` is empty and usable (put + get round-trip). Use a unique database name per test and close every connection explicitly so no upgrade runs while another connection to the same name is open (H1/D7). |
| Restart survival (close/reopen) | Insert fixture games through a `DexieGamesRepository` **bound to a named `ChessRemedyDatabase` instance** (injected DB — H1), `close()` the connection, construct a **fresh** `ChessRemedyDatabase` on the same name, bind a new repository to it, and assert `db.verno === 2` on the reopened connection plus `getGame`/`listGameSummaries` return the same data. |
| Second open does not re-run destructive work | After reopen, `games` still contains exactly the inserted rows (no duplication from the upgrade path). |

### 10.3 New — `games-repository.test.ts`

| Spec requirement | What is asserted |
|---|---|
| insert | `saveGame(fixtureGame('cc-blitz-clean'))` → `inserted`; `getGame` returns a full domain `Game` with matching id/source/externalId/userColor/players/result/time-control fields, verbatim `pgn`, and a usable `moves` tree (`validateReplay` empty; `mainlineMoves` length > 0). |
| retrieve | `getGame` of a missing id → `undefined`; `getGame` of a stored FEN-start fixture (`local-fen-endgame`) preserves `moves.startFen`; a zero-move forfeit game (real result header, no movetext) round-trips. |
| update | Re-`saveGame` of the same provider id with a **different** PGN → `updated`, row count stays 1, `importedAt` preserved, content replaced, and `updatedAt` refreshed (missing-test item). |
| duplicate detection | Re-`saveGame` of the same provider id with **identical** content → `duplicate`, row count stays 1, row bytes/timestamps untouched. `hasGame(id)` true after insert, false after delete. Two different external games with different ids coexist. |
| delete | `deleteGame(id)` removes the row; second `deleteGame` resolves silently. |
| batch | `saveGames` of mixed new/existing games returns aligned `inserted`/`duplicate`/`updated` codes and persists all rows. **Rollback (M2):** a batch that fails mid-way (e.g. one game that cannot be serialized/written) leaves **zero** rows persisted (transaction rollback). |
| id collision guard (D4) | Forge a `local` game whose `id` is reused with different `pgn` — spread-override the `id` of a `gameFromPgn`-parsed `Game` (do not hand-build a `MoveList`; L4), simulating the FNV-1a 32-bit collision caveat from Feature-003 L3: `saveGame` → `idCollision`, no write, original row intact. |
| listing order (D6) | `listGameSummaries` with an **empty query** returns all rows ordered by `playedAt` descending (ISO string order), `null`-`playedAt` games last, ties broken by `id` ascending. Author a **dateless PGN inline** in the test via `gameFromPgn` (no fixture has `playedAt: null`; fixtures are Feature-003-owned and must not be modified — M3). |
| filtering (D6) | `source: 'lichess'`, `normalizedTimeControl: 'blitz'`, `result: '0-1'`, `userColor`, and `playedBefore`/`playedAfter` bounds each return the expected subset; `playedBefore`/`playedAfter` exclude `playedAt: null` rows. A **combined** query (`source` + `normalizedTimeControl` + a bound) returns the correct intersection via the one-leading-index + in-memory-filter path (M4). |
| corruption detection | Directly `db.games.put` a row whose `pgn` does not parse (or whose recomputed `makeGameId` mismatches its `id`); `getGame` throws the repository's `GameCorruptionError`. |
| fixtures not required | Save a `local` fixture (`local-short-unknown-tc`, `normalizedTimeControl: 'unknown'`) round-trips with the stored category preserved. |

### 10.4 Not covered here

- No Playwright/e2e test (D7 — no UI save path before Feature 007).
- No UI/component tests.
- No analysis/persistence tests (Feature 008 owns the `analyses` table).

---

## 11. Migration Considerations

### 11.1 v1 → v2 (this feature)

- Pure additive upgrade: a new `games` store; the `settings` table and
  its data are untouched. Dexie runs the upgrade automatically on first
  open of the new code against an existing v1 database; no data
  transformation is required (no `upgrade(tx)` body beyond an empty or
  no-op callback).
- `PERSISTENCE_SCHEMA_VERSION` and the `database.ts` guard move to `2`
  in the same commit as `schema/v2.ts`.
- Fresh installs get both versions applied in order from the constructor.

### 11.2 Forward contracts

- **Feature 007/008** add their tables (`analysis`, `positionAnalysisCache`,
  job state, …) through `db.version(3)`, chained after `applyV2Schema`.
  The `games` table accessor/row type is the stable contract they import.
- **Reviewer L2:** `gameFromPgn` stores the entire raw text in `Game.pgn`
  and always rebuilds the *first* game on re-parse. Feature 007 must
  therefore **split multi-game PGN documents into exactly one game per row**
  before calling `saveGame`/`saveGames`.
- The `id` primary key is the dedupe invariant Feature 007 relies on;
  `GameRow.pgn` is authoritative content, enabling an exact-content
  comparison rather than trusting the 32-bit hash alone (Feature-003 L3).
- If the time-control normalization mapping ever bumps (ADR-013),
  already-stored `normalizedTimeControl` values are **not** recomputed on
  read (D2); only newly imported games use the new mapping.

---

## 12. Implementation Phases (incremental order)

Each phase ends green (`lint`, `typecheck`, `test`).

1. **Phase 1 — Schema v2 wiring.** `schema/v2.ts`; update
   `schema/index.ts`, `config/app-config.ts`
   (`PERSISTENCE_SCHEMA_VERSION = 2`), `database.ts` (table accessor +
   chain + guard); update `database.test.ts` table-surface assertions.
   `npm run test -- src/infrastructure/db` green.

2. **Phase 2 — Repository.** `games-repository.ts`: `GameRow`,
   `GameSummary`, result/query types, `DexieGamesRepository` (injectable
   Dexie instance defaulting to the singleton, H1) with the D4
   classification logic, row↔game mapping, reconstruction + integrity
   check, `GameCorruptionError`; singleton export.

3. **Phase 3 — Tests.** `games-repository.test.ts` and
   `schema/v2-migration.test.ts` per §10.

4. **Phase 4 — Full gate.** Run the complete Execution-policy gate
   (§15) and record output as acceptance evidence.

---

## 13. Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|------------|--------|------------|
| R1 | Reviewer rejects one of D1–D7 | Medium | Medium | §3 lists every decision explicitly so each can be approved or replaced before code is written. |
| R2 | The chessops `PgnNode` tree is not directly serializable (prototype methods) — temptation to store it anyway | High | Medium | D2: store verbatim PGN (already a `Game` field) and rebuild the tree on read via `gameFromPgn`; documented and asserted in tests. |
| R3 | Re-parsing PGN on `getGame` could drift scalar metadata after a future normalizer-version bump (ADR-013) | Low | Medium | Row scalar columns are authoritative; only the `moves` tree comes from the re-parse; D2 + a round-trip test pin this. |
| R4 | IndexedDB skips rows whose indexed key is `null` (`playedAt: null`, `externalId: null`), silently dropping dateless/local games from index-ordered reads | Medium | High | D5/D6: no ordering through the `playedAt` index alone; list path filters then sorts in memory with explicit nulls-last ordering; tests cover `playedAt: null` and `source: local` rows. |
| R5 | Dexie version upgrade blocked in a real browser while another tab holds an open connection | Low | Low | Single-tab local-first app; upgrade runs on open; existing v1 users get an automatic additive upgrade. Confirmed by the dev smoke run and the migration test. |
| R6 | Full `getGame` re-parse cost | Low | Low | Only the full-read path parses; listings use `GameSummary` and never parse. Personal library sizes make even full reads negligible. |
| R7 | `fake-indexeddb` behaviour (index null-skipping, transactions, version upgrades) differs subtly from real IndexedDB | Low | Medium | Tests exercise the risky semantics (null keys, migration, reopen); a Playwright round-trip is deferred to Feature 007 (D7), when a UI save path exists for a real-browser restart check. |
| R8 | The `idCollision` guard is nearly unreachable in practice, adding code for a theoretical case | Low | Low | It directly addresses the documented FNV-1a 32-bit caveat (Feature-003 L3) and is ~10 lines; without it a collision would silently overwrite a different local game. |
| R9 | Updating `database.test.ts` table list breaks CI if Dexie returns tables in an unexpected order | Low | Low | Assert `['settings', 'games']` (creation order of the chained versions); if Dexie's ordering differs, switch to a set/`sort()` assertion during implementation. |

---

## 14. Acceptance Criteria

| Spec requirement (`004-local-storage.md`) | Concrete, runnable check |
|---|---|
| Use IndexedDB through Dexie | `games` store declared via `db.version(2).stores(...)` in `schema/v2.ts`; all repository reads/writes go through `db.games`; no direct `indexedDB` API usage in application code. |
| insert | `saveGame` → `inserted`; row count 1; `getGame` round-trips a full domain `Game`. |
| retrieve | `getGame(id)` returns a full `Game` (with moves tree) or `undefined`; `listGameSummaries` returns ordered, parse-free records. |
| update | Same-id re-save with changed content → `updated`; row count stays 1; `importedAt` preserved. |
| delete | `deleteGame` removes the row; idempotent on absence. |
| duplicate detection | Identical same-id re-save → `duplicate`, never a second row (asserted for provider and local games); `hasGame` reflects existence; `idCollision` guard tested. |
| schema versioning | `PERSISTENCE_SCHEMA_VERSION === 2`; `db.verno === 2`; v1→v2 migration test passes with `settings` preserved; `database.ts` guard enforces the constant/schema lockstep. |
| Imported games survive browser restart | Restart test (§10.2) closes and reopens a fresh DB connection on the same store and reads the games back. (Real-browser restart proof lands with Feature 007, D7.) |
| Duplicate external games are not stored twice | Provider games keyed by `id = source:externalId`; repeated `saveGame`/`saveGames` with the same external id never yield two rows (duplicate/updated tests). |
| Existing features unaffected | Full `npm run test` passes with all Feature-001/002/003 suites unchanged; dev smoke shows no console errors. |

---

## 15. Verification Commands

Run from the repository root after implementation completes (Execution
policy in `AGENTS.md`):

```bash
# 1. Static checks
npm run lint
npm run typecheck
npm run format:check

# 2. Unit / component tests (full suite — Feature 001–003 regressions)
npm run test

# 3. Persistence feature tests only (quick focus)
npm run test -- src/infrastructure/db

# 4. Production build
npm run build

# 5. Browser integration tests (regression — existing e2e unchanged)
npm run preview &        # vite preview serves the built app
npm run test:browser
# stop the preview server after tests complete

# 6. Dev-server smoke test (manual)
npm run dev
# open http://localhost:5173 — app boots, theme persists, no console errors,
# no IndexedDB upgrade errors on the Settings page

# 7. Dependency audit
npm audit
```

If every command exits 0, the browser run passes, and the dev smoke
shows no console errors, Feature 004 is complete.

---

## 16. Notes for the Reviewer

- **No application source code was modified while producing this plan.**
  Only this plan file is new.
- The single most consequential decisions are **D1** (games table only —
  later features own their tables through further version bumps) and
  **D2** (verbatim-PGN storage with row-authoritative scalars and a
  parse-only-for-moves read path). If the reviewer reads
  `ARCHITECTURE.md` §7 ("persistent entities include games, moves,
  analyses…") as requiring Feature 004 to pre-create those tables, D1
  must be rejected and a broader v2 schema added — this would couple 004
  to storage shapes that Features 005–016 have not yet designed.
- **D7** resolves a genuine gap: "imported games survive browser
  restart" cannot be exercised through the UI before Feature 007
  creates a save path. The close/reopen connection test is the honest
  automated proxy; a Playwright restart test is deferred to 007.
- The existing `database.test.ts` table assertion is the only existing
  test that must change (settings tests otherwise stay intact), which
  is the regression gate for the v1→v2 additive upgrade.

---

## 17. Review Outcome & Revision Log

Reviewer verdict (reviewer agent, task `ses_f998e5614ffeT02r88TjMj5x2H`):
**Approve with revisions.** No CRITICAL findings. All of **D1–D7
confirmed**; D3 and D7 require the H1 revision before Phase 2/3. No
spec deviations, no scope creep, no dependency/execution-policy
deviations.

Revisions applied to this plan after review:

| # | Severity | Change |
|---|----------|--------|
| H1 | HIGH | §6.2/§3 D3 + D7: `DexieGamesRepository` gains an injectable Dexie instance (default: the module singleton). Restart/migration tests bind repositories to isolated named `ChessRemedyDatabase` instances; §10.2 updated accordingly. |
| M1 | MEDIUM | §6.2: `getGame` re-parse context uses conditional spread for `externalId` (verbatim `undefined` fails `exactOptionalPropertyTypes`). |
| M2 | MEDIUM | §10.3: added a `saveGames` mid-batch rollback test (zero rows persisted on partial failure). |
| M3 | MEDIUM | §10.3: ordering/bounds tests author a dateless PGN inline via `gameFromPgn`; fixtures are Feature-003-owned and untouched. |
| M4 | MEDIUM | §3 D6 + §6.2: pinned one-leading-index + in-memory filter for combined queries and that `playedAt: null` never satisfies `playedBefore`/`playedAfter`. |
| L1 | LOW | §3 D1: recorded that D1 supersedes the forward notes in `001-foundation` §11.2 and `003-chess-domain` §11.1. |
| L2 | LOW | §11.2: forward contract — Feature 007 must split multi-game PGN documents one-per-row before `saveGame`. |
| L3 | LOW | §3 D4 + §6.2: pinned the `duplicate` comparison field set (excludes `importedAt`/`updatedAt`). |
| L4 | LOW | §10.3: idCollision test forges ids by spread-overriding a parsed `Game`, not by hand-building a `MoveList`. |

Additional test rows added per the reviewer's missing-tests list:
`updatedAt` refresh on the `updated` path, empty-query listing, a
combined-filter case, and `db.verno === 2` asserted on the reopened
connection in the restart test. R9's `db.tables` ordering concern was
confirmed benign (Dexie reports tables in declaration order).
