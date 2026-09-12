# Plan — W5: Platform-specific time controls + schema v11 re-normalization

Plan-only. No code, tests or commits are produced by authoring this
document. Scope is fixed by ADR-013 (revised) and
`specs/domain/time-control.md`; nothing here redesigns an unrelated
area. The specs are already amended at HEAD (`ARCHITECTURE.md` §7,
`PRODUCT.md` §6, `domain/game-model.md`, `domain/statistics.md`,
features 003/007/014/015/016), so no spec edits are part of this
workstream.

## 1. Objective

Make the canonical time-control category **platform-specific** and
re-normalize every stored game once through a versioned Dexie upgrade:

- classify each game with the published boundaries of the platform that
  produced it — `chesscom` → Chess.com thresholds, `lichess` → Lichess
  thresholds, `local`/`fixture`/future/unknown → `generic` (= Lichess);
- keep the exact time control platform-independent
  (`base + 40 × increment`);
- add a `TimeControlProfile` and record `profile` +
  `categoryVersion` on the persisted structured value;
- bump `TIME_CONTROL_CATEGORY_VERSION` 1 → 2,
  `PERSISTENCE_SCHEMA_VERSION` 10 → 11, `STATISTICS_VERSION` 1 → 2;
- ship schema `v11` as a data-only, idempotent `.upgrade()` that
  recomputes every game's `normalizedTimeControl` and `timeControlModel`
  from the verbatim `timeControl` and the game's `source` profile.

User-visible outcomes (ADR-013 Consequences):

- a Chess.com `5|5` (estimate 500 s) moves **Rapid → Blitz**;
- a Chess.com long game (`30|0`, estimate 1800 s) moves
  **Classical → Rapid**;
- there is **no `(Chess.com, classical)` partition**;
- Lichess, `local` and `fixture` games keep their pre-change category.

## 2. Scope

### In scope

- Profile-aware classification in `src/domain/chess/timeControl.ts`
  (`TimeControlProfile`, `timeControlProfileForSource`, `profile` on
  `TimeControl`/`NormalizedTimeControl`, `categoryVersion = 2`).
- Every production call site of `parseTimeControl`/`normalizeTimeControl`
  updated to pass a profile.
- Schema v11 module + applier registration + version guard + app-config
  bump; idempotent re-normalization of all `games` rows.
- `STATISTICS_VERSION` bump (category mapping is an
  aggregation-semantics change) and the platform-correct partition
  tests.
- Deterministic fixtures for the new boundaries, and the provider
  fixture builders that emit provider labels.
- Migration, domain, statistics and fixture tests.

### Out of scope (explicitly not changed)

- The six-value `TimeControlCategory` set and `TIME_CONTROL_PARSE_VERSION`
  (parsing dialects are unchanged).
- The `M`/`I` display formatter and `TimeControl.display`
  (profile-independent).
- Any UI redesign; the Library/Review/statistics/Dashboard only read the
  stored category and the formatted control.
- Sync implementation (Feature 016): only its documented contract
  (derived fields recomputed from raw on import/merge) is honoured.
- W3's missed-tactic exclusivity (`DETECTION_VERSION`,
  `CLASSIFICATION_VERSION`, `MOVE_ACCURACY_VERSION`,
  `PUZZLE_GENERATOR_VERSION`); only `STATISTICS_VERSION` ordering is
  coordinated (§10).
- No new dependency, no new table/index, no worker.

## 3. Existing code to reuse (anchors)

Domain:

- `src/domain/chess/timeControl.ts:26-42` — category set, parse/category
  version constants and the `TIME_CONTROL_NORMALIZATION_VERSION` alias.
- `src/domain/chess/timeControl.ts:44-69` — `NormalizedTimeControl` and
  `TimeControl` value objects.
- `src/domain/chess/timeControl.ts:108-121` — `classifyClock` (the single
  platform-agnostic mapping to make profile-aware).
- `src/domain/chess/timeControl.ts:128-230` — `parseTimeControl` (all
  dialects; `display` is profile-independent).
- `src/domain/chess/timeControl.ts:236-240` — `normalizeTimeControl`
  (legacy wrapper; becomes the profile-aware normalizer).
- `src/domain/chess/gameSource.ts:9-11` — closed `GameSource` union
  (`chesscom`/`lichess`/`local`/`fixture`) the profile is selected from.
- `src/domain/chess/parseGame.ts:117-118` — PGN → `Game` normalization
  (has `ctx.source`).
- `src/domain/import/providerGame.ts:119-132` — enrichment re-normalizes
  the record-only control (has `record.source`).

Persistence:

- `src/infrastructure/db/games-repository.ts:30-56` — `GameRow`
  (`timeControl`, `normalizedTimeControl`, optional `timeControlModel`).
- `src/infrastructure/db/games-repository.ts:325-343` —
  `contentFieldsOf` writes `timeControlModel: parseTimeControl(...)`.
- `src/infrastructure/db/schema/v5.ts:15-34` — the backfill-from-raw
  migration shape to mirror (and update for the new signature).
- `src/infrastructure/db/schema/v6.ts:15-45` — the **unchanged-store +
  `.upgrade()`** pattern to copy for a data-only version.
- `src/infrastructure/db/schema/v10.ts:27-31` — current top version.
- `src/infrastructure/db/schema/index.ts:1-19` — applier registry.
- `src/infrastructure/db/database.ts:56-79` — apply chain + the
  `PERSISTENCE_SCHEMA_VERSION !== 10` guard.
- `src/config/app-config.ts:3-10` — version constant + history comment.

Consumers (no logic change expected):

- `src/domain/import/filters.ts:139-148` — `timeControlsMatch` reads a
  category (the import filter stays category-based; the category is now
  provider-correct because `providerGameToGame` computed it).
- `src/infrastructure/import/importService.ts:249` — uses
  `game.normalizedTimeControl`; no change.
- `src/domain/gameLibrary/predicates.ts:83` and
  `src/infrastructure/db/game-library-query.ts:22` — filter on the stored
  `normalizedTimeControl`; no change.
- `src/domain/statistics/query.ts:163-223` — `partitionGames` groups by
  stored `(source, normalizedTimeControl)`; no logic change (the
  platform-correct partition falls out of the re-normalized rows).
- `src/domain/statistics/types.ts:66` — `STATISTICS_VERSION`.
- `src/infrastructure/training/training-sets-service.ts:558-559` and
  `src/pages/SetEditorPage.tsx:219` — read `summary.normalizedTimeControl`;
  no change.

Display-only call sites that must still pass a profile:

- `src/components/games/library/GameLibrary.tsx:944` — `row.source`
  available.
- `src/pages/GameReviewPage.tsx:598` — only `timeControl` is in scope;
  display is profile-independent.

Fixtures / tests:

- `src/infrastructure/providers/fixtures/chessCom.ts:44-45` and
  `src/infrastructure/providers/fixtures/lichess.ts:26-30` — provider
  payload fixtures currently derive `time_class`/`speed`/`perf` from
  `game.normalizedTimeControl`.
- `src/domain/chess/fixtures/defs.ts` / `games.ts` /
  `scenarios.ts` — deterministic fixture games.
- `src/domain/statistics/fixtures/builders.ts:26-37` — `game()` builder
  (hardcodes `normalizedTimeControl`).
- `src/infrastructure/db/schema/v10-migration.test.ts:87-111` — the
  hand-built pre-versioned DB harness to mirror for v11.
- `src/infrastructure/db/schema/v5-migration.test.ts:19-52` — the
  pre-v5 harness whose `verno`/profile assertions change.

## 4. Files/modules to create or modify

### Create

- `src/infrastructure/db/schema/v11.ts` — the re-normalization upgrade.
- `src/infrastructure/db/schema/v11-migration.test.ts` — v10 → v11
  migration + idempotency test.

### Modify — domain API

- `src/domain/chess/timeControl.ts`
  - `export type TimeControlProfile = 'lichess' | 'chesscom' | 'generic';`
  - `export function timeControlProfileForSource(source: GameSource): TimeControlProfile;`
  - `classifyClock(baseSeconds, incrementSeconds, profile)`.
  - `parseTimeControl(raw: string, profile: TimeControlProfile): TimeControl`
    — `TimeControl` gains `readonly profile: TimeControlProfile`.
  - `normalizeTimeControl(raw: string, profile: TimeControlProfile): NormalizedTimeControl`
    — `NormalizedTimeControl` gains `readonly profile: TimeControlProfile`.
  - `TIME_CONTROL_CATEGORY_VERSION = 2` (alias
    `TIME_CONTROL_NORMALIZATION_VERSION` follows); `TIME_CONTROL_PARSE_VERSION`
    stays `1`.
  - Update the module header comment (remove "platform-agnostic").
- `src/domain/chess/index.ts:3-16` — export `timeControlProfileForSource`
  and `TimeControlProfile`.

### Modify — call sites that must pass a profile

| File:line | New call |
|---|---|
| `src/domain/chess/parseGame.ts:118` | `normalizeTimeControl(raw, timeControlProfileForSource(ctx.source))` |
| `src/domain/import/providerGame.ts:122` | `normalizeTimeControl(timeControl, timeControlProfileForSource(record.source))` |
| `src/infrastructure/db/games-repository.ts:337` | `parseTimeControl(game.timeControl, timeControlProfileForSource(game.source))` |
| `src/infrastructure/db/schema/v5.ts:27` | `parseTimeControl(row.timeControl, timeControlProfileForSource(row.source))` |
| `src/components/games/library/GameLibrary.tsx:944` | `parseTimeControl(row.timeControl, timeControlProfileForSource(row.source))` |
| `src/pages/GameReviewPage.tsx:598` | `parseTimeControl(gameMeta.timeControl, 'generic')` (display-only; `display` is profile-independent) |

### Modify — persistence / infrastructure

- `src/config/app-config.ts:3-10` — `PERSISTENCE_SCHEMA_VERSION = 11`
  and extend the history comment (`v11 re-normalizes the platform-specific
  time control`).
- `src/infrastructure/db/schema/index.ts` — export `applyV11Schema`.
- `src/infrastructure/db/database.ts:56-79` — call `applyV11Schema(this)`
  after v10 and change the guard to `!== 11` / message to `Dexie v11`.

### Modify — statistics

- `src/domain/statistics/types.ts:66` — `STATISTICS_VERSION = 2`
  (coordinate with W3, §10).

### Modify — fixtures

- `src/domain/chess/fixtures/defs.ts` — add the boundary fixtures:
  - a Chess.com `300+5` (5|5, estimate 500 s) game → `blitz`;
  - a Lichess `300+5` game (same clock) → `rapid`;
  - keep `cc-classical-endgame` (`1800`) as the Chess.com long →
    `rapid` case (relabel its `label`/`note` so it no longer claims
    "classical");
  - ensure a Lichess/`fixture` `classical` game stays in the set.
- `src/domain/chess/fixtures/scenarios.ts:26-32` — `mixedTimeControls`
  must include a game that remains `classical` (e.g.
  `li-classical-clean-win`) because `cc-classical-endgame` now maps to
  `rapid`; otherwise the scenario drops below the ≥ 5 distinct-category
  assertion.
- `src/infrastructure/providers/fixtures/chessCom.ts:44-45` — emit the
  provider label from the provider profile, e.g.
  `time_class: parseTimeControl(game.timeControl, 'chesscom').category`
  (do not depend on `game.normalizedTimeControl`, which is canonical),
  and `time_control` stays the verbatim raw string.
- `src/infrastructure/providers/fixtures/lichess.ts:26-30` — derive
  `speed`/`perf` with the `lichess` profile, preserving the
  `correspondence` mapping.
- `src/domain/statistics/fixtures/builders.ts` — add a
  `gameFromClock(source, raw, overrides)` builder that derives
  `normalizedTimeControl` via
  `parseTimeControl(raw, timeControlProfileForSource(source)).category`,
  so per-platform fixtures cannot drift from the domain rule.
- `src/domain/statistics/fixtures/scenarios.ts` — add a per-platform
  partition scenario (Chess.com `5|5` → blitz, Lichess `5|5` → rapid,
  Chess.com `30|0` → rapid, Chess.com daily → correspondence,
  `local`/`fixture` → generic) built through the new builder.

### Modify — tests

- `src/domain/chess/timeControl.test.ts` — pass profiles; add the
  per-profile threshold table and the category-version assertion.
- `src/domain/chess/parseGame.test.ts` — profile-aware expectations.
- `src/domain/import/providerGame.test.ts` — profile-aware expectations.
- `src/domain/chess/fixtures/fixtures.test.ts` — updated category-set /
  scenario assertions and new boundary cases.
- `src/infrastructure/db/schema/v5-migration.test.ts` — profile +
  `categoryVersion` assertions; `verno` 10 → 11.
- `src/infrastructure/db/schema/v2..v10-migration.test.ts` and
  `src/infrastructure/db/database.test.ts` — every `expect(...verno).toBe(10)`
  → `11`; `database.test.ts:14` title "schema version 10" → 11.
- `src/domain/statistics/fixtures/version.test.ts:19` and
  `src/infrastructure/statistics/worker-protocol.test.ts:67` —
  `statisticsVersion` 1 → 2.
- `src/domain/statistics/fixtures/query.test.ts` (and/or the new
  scenario) — the platform-correct partition assertions.

## 5. Domain/data changes

### Profile selection

```ts
export type TimeControlProfile = 'lichess' | 'chesscom' | 'generic';

export function timeControlProfileForSource(source: GameSource): TimeControlProfile {
  return source === 'chesscom' ? 'chesscom' : source === 'lichess' ? 'lichess' : 'generic';
}
```

`GameSource` is closed today; the `else` branch is the documented neutral
default for `local`, `fixture` and any future source.

### Estimation and thresholds

Both profiles estimate game length as `baseSeconds + 40 × incrementSeconds`.

| Category | `lichess` / `generic` | `chesscom` |
|---|---|---|
| `bullet` | estimate ≤ 179 | estimate ≤ 179 |
| `blitz` | 180 ≤ estimate ≤ 479 | 180 ≤ estimate ≤ 599 |
| `rapid` | 480 ≤ estimate ≤ 1499 | estimate ≥ 600 |
| `classical` | estimate ≥ 1500 | never produced |
| `correspondence` | days-per-move / `moves/seconds` | same |
| `unknown` | unparseable | unparseable |

Lichess UltraBullet (≤ 29 s) folds into `bullet`; the provider label is a
hint only.

### Structured value

`TimeControl` and `NormalizedTimeControl` gain `profile`; `categoryVersion`
(the `NormalizedTimeControl.version` field keeps its name) records `2`.
The persisted row stores `timeControlModel` with `profile` and
`categoryVersion: 2`, plus the indexed `normalizedTimeControl` category.

### Version constants

| Constant | Before | After W5 | After W3 lands too |
|---|---|---|---|
| `TIME_CONTROL_PARSE_VERSION` | 1 | 1 | 1 |
| `TIME_CONTROL_CATEGORY_VERSION` | 1 | **2** | 2 |
| `TIME_CONTROL_NORMALIZATION_VERSION` | 1 | 2 (alias) | 2 |
| `PERSISTENCE_SCHEMA_VERSION` | 10 | **11** | 11 |
| `STATISTICS_VERSION` | 1 | **2** | **3** |

## 6. UI changes

No new UI. Two display-only call sites must pass a profile because the
signature is required:

- `GameLibrary.tsx:944` — the row shows `parseTimeControl(row.timeControl).display`
  and `row.normalizedTimeControl`; `display` is profile-independent, so
  only the call signature changes.
- `GameReviewPage.tsx:598` — uses the parsed `baseSeconds` for the
  initial clock; pass `'generic'`.

After the migration the stored category shown in the Library, Dashboard
and statistics is already platform-correct, so the only visible change is
the corrected Chess.com category label. The import filter's `classical`
option yields no Chess.com matches by design (Chess.com has no classical
group).

## 7. Infrastructure changes

### Schema v11

`src/infrastructure/db/schema/v11.ts` follows the v6 pattern (repeat the
unchanged `games` store definition to force the version, then
`.upgrade()`):

```ts
export function applyV11Schema(db: Dexie): void {
  db.version(11)
    .stores({ games: '&id, source, playedAt, normalizedTimeControl, timeControl' })
    .upgrade(async (tx) => {
      const rows = await tx.table('games').toArray();
      const upgraded = rows.map((row) => {
        const model = parseTimeControl(
          row.timeControl,
          timeControlProfileForSource(row.source),
        );
        row.normalizedTimeControl = model.category;
        row.timeControlModel = model;
        return row;
      });
      await tx.table('games').bulkPut(upgraded);
    });
}
```

- No table or index is added; the version exists solely to guarantee the
  one-time transactional upgrade.
- The transform is a pure function of `(timeControl, source)` and never
  reads the existing `normalizedTimeControl`/`timeControlModel`, so
  re-running it yields byte-identical rows. Skipping rows already at
  `categoryVersion: 2` is an allowed optimization only, never a
  correctness requirement.

### Applier / guard

- `schema/index.ts` exports `applyV11Schema`.
- `database.ts` applies it after v10 and the guard becomes
  `PERSISTENCE_SCHEMA_VERSION !== 11`.
- `app-config.ts` sets `PERSISTENCE_SCHEMA_VERSION = 11`.

### Import / sync

- Import: `providerGameToGame` normalizes with the record's provider
  profile, so `normalizedTimeControl` is provider-correct at write time
  and the import filter (which matches the stored category) is
  automatically platform-correct.
- `contentFieldsOf` computes `timeControlModel` with
  `timeControlProfileForSource(game.source)`, keeping the stored
  structured value consistent on every save/update.
- Feature 016 (when implemented) must recompute the derived fields from
  the verbatim `timeControl` + `source` on merge; it never trusts a
  remote `normalizedTimeControl`/`timeControlModel`. W5 implements no
  sync code.

## 8. Tests

### Domain (`timeControl.test.ts`)

- Per-profile threshold table (asserting both the `profile` and the
  `category`):
  - `lichess`/`generic`: `179`→bullet, `180`→blitz, `479`→blitz,
    `480`→rapid, `1499`→rapid, `1500`→classical, `1800`→classical.
  - `chesscom`: `179`→bullet, `180`→blitz, `599`→blitz, `600`→rapid,
    `1499`→rapid, `1500`→rapid, `1800`→rapid.
  - The same raw clock (`300+5` = 500 s) is `rapid` for `lichess` and
    `blitz` for `chesscom`.
  - Correspondence/unknown are profile-independent.
- `parseTimeControl(raw, profile).profile` / `.categoryVersion === 2`.
- `normalizeTimeControl(raw, profile).version === 2` and determinism.
- `timeControlProfileForSource` maps the four sources
  (`chesscom`→`chesscom`, `lichess`→`lichess`, `local`/`fixture`→`generic`).
- `display` is unchanged and still `M|I`.

### PGN / provider

- `parseGame.test.ts`: a Chess.com `300+5` header yields `blitz`; a
  Lichess `300+5` yields `rapid`; a Chess.com `1800` yields `rapid`.
- `providerGame.test.ts`: record-only controls are classified with the
  record's provider profile (Chess.com `300+5` → blitz, `1800` → rapid,
  `1/259200` → correspondence; Lichess `300+5` → rapid).

### Schema migration (`v11-migration.test.ts`)

Build a hand-rolled pre-v11 Dexie at v10 (mirror
`v10-migration.test.ts:87-111`, adding the v10 stores) with `games` rows
carrying v1-shaped derived fields (`categoryVersion: 1` or no
`timeControlModel`):

- Chess.com `300+5` (500 s): stored `rapid` → migrated `blitz`,
  `timeControlModel.profile === 'chesscom'`, `categoryVersion === 2`.
- Chess.com `1800`: stored `classical` → migrated `rapid`.
- Lichess `1800`: stays `classical`, `profile === 'lichess'`.
- Lichess `300+5`: stays `rapid`, `profile === 'lichess'`.
- `local`/`fixture` `300+5`: stays `rapid`, `profile === 'generic'`.
- Correspondence and unknown rows keep their category.
- The full table list is unchanged and `verno === 11`.
- **Idempotency**: apply the same `(timeControl, source)` transform to an
  already-migrated row and assert byte-identical
  `normalizedTimeControl`/`timeControlModel`; assert the migration never
  consults the stored category (e.g. a row whose stale stored category
  contradicts the raw is corrected, not preserved).

### Statistics

- `STATISTICS_VERSION === 2` in `version.test.ts` and
  `worker-protocol.test.ts`.
- Platform-correct partitions: rows derived through the new
  `gameFromClock` builder produce `(chesscom, blitz)` for `300+5`,
  `(lichess, rapid)` for the same clock, `(chesscom, rapid)` for `1800`,
  and **no `(chesscom, classical)`** partition.
- Existing six-category separation and anti-combination tests stay green
  (they use explicit categories and do not depend on the mapping).

### Fixtures

- `fixtures.test.ts`: all six categories are still covered; the Chess.com
  `5|5` fixture is `blitz` and the Lichess `5|5` fixture is `rapid`; the
  `mixedTimeControls` scenario still has ≥ 5 distinct categories after
  the `cc-classical-endgame` remap.
- Provider payload fixtures emit provider-correct labels and are
  deterministic.

## 9. Migration considerations

- **Data-only version.** v11 adds no table/index; the version bump is the
  only guaranteed once-per-install hook. An unversioned maintenance pass
  could be skipped and would leave `categoryVersion: 1` rows behind.
- **Fresh installs.** Dexie does not run `.upgrade()` callbacks when a
  database is created directly at the latest version; import-time
  normalization is already profile-aware, so fresh databases are correct.
- **Idempotency.** The category is a pure function of
  `(timeControl, source)`. Re-running yields byte-identical rows; rows
  already at `categoryVersion: 2` may be skipped as an optimization only.
- **Affected rows.** Only `chesscom` games with an estimate of 480–599 s
  (`rapid` → `blitz`) or ≥ 1500 s (`classical` → `rapid`) change.
  `lichess`, `local` and `fixture` games keep their category.
- **Historical v5 migration.** `v5.ts` must pass a profile to compile;
  it uses the row's `source`. This changes v5's intermediate result for
  old Chess.com rows (v11 immediately re-normalizes them anyway). Passing
  the source profile is preferred over `'generic'` because it keeps the
  two migrations consistent.
- **Existing migration tests.** Every `ChessRemedyDatabase` opened in
  tests now reports `verno === 11`; all hardcoded `10` assertions and the
  `database.test.ts` title move to `11`. The `tables.map` lists are
  unchanged.
- **Sync.** Derived fields are never trusted from a remote payload; they
  are recomputed from the verbatim `timeControl` + `source`. A device on
  an older mapping cannot reintroduce a stale category (Feature 016
  contract, `domain/time-control.md`).
- **No statistics data migration.** V1 statistics are computed on demand
  and never persisted; the `STATISTICS_VERSION` bump only labels results.

## 10. Risks and ambiguities

- **`STATISTICS_VERSION` ordering with W3.** W3
  (`009-w3-missed-tactic-exclusivity.md` §5) documents the convergence to
  `3` once both land. W5 sets `1 → 2`; if W3 lands first (setting
  `1 → 2`), W5 must set `2 → 3` instead. Either ordering ends at `3`.
  Record both the ADR-013 mapping change and the exclusivity change in
  the version provenance/comment regardless of order. **Confirm the
  landing order before committing the constant.**
- **Fixture coverage regression.** `cc-classical-endgame` becomes
  `rapid`, so `mixedTimeControls` loses its only `classical` entry;
  `fixtures.test.ts` asserts ≥ 5 distinct categories. The plan adds a
  Lichess/`fixture` classical game to the scenario. If the owner prefers
  renaming the fixture instead, keep the scenario assertion satisfied.
- **Historical v5 semantics.** Updating `v5.ts` to pass the source
  profile slightly changes the intermediate v4 → v5 result for old
  Chess.com rows. This is invisible after v11 and is the type-safe
  option; the alternative (a temporary `'generic'` default) would keep
  the old intermediate behavior but contradicts "profile is required for
  canonical classification".
- **Display-only profile.** `GameReviewPage` has no `source` in scope;
  it passes `'generic'`. `TimeControl.display` is profile-independent, so
  this cannot change rendering. If a future UI needs the profile for
  anything other than display, thread `source` then.
- **Provider label fixtures.** `chessCom.ts`/`lichess.ts` currently emit
  `time_class`/`speed` from the canonical category. After W5 the canonical
  Chess.com category equals the provider label, so the payload becomes
  correct; deriving the label explicitly with the provider profile makes
  the intent durable. These labels are payload fidelity only — the
  adapters read `time_control`/`clock`, not `time_class`.
- **Dexie version with no store change.** v11 repeats the unchanged
  `games` store (the v6 precedent) to force the version; if Dexie were to
  elide it, the upgrade would not run. The migration test asserts the
  upgrade actually re-normalized rows, which catches that.
- **`bulkPut` under fake-indexeddb.** The existing harness note
  (`v10-migration.test.ts:84-86`) applies: write pre-version rows with
  `put`/`bulkAdd`; the in-upgrade `bulkPut` is the production path and is
  exercised by the migration test.
- **Performance.** v11 iterates all `games` rows once inside one
  transaction. Fine for the thousands-of-games target; no batching needed
  in V1.

## 11. Acceptance criteria

- [ ] `timeControlProfileForSource` maps `chesscom`/`lichess`/`local`/
      `fixture` to `chesscom`/`lichess`/`generic`/`generic`.
- [ ] `parseTimeControl`/`normalizeTimeControl` take a required profile
      and record it; `categoryVersion`/`version` is `2`.
- [ ] Thresholds match ADR-013 exactly for both profiles; `300+5` (500 s)
      is Lichess `rapid` and Chess.com `blitz`; Chess.com `1800` is
      `rapid`; Chess.com never produces `classical`.
- [ ] Every production call site passes a profile; `npx tsc --noEmit`
      passes.
- [ ] `PERSISTENCE_SCHEMA_VERSION === 11`; schema v11 has no store-shape
      change and re-normalizes every game from `timeControl` + `source`.
- [ ] The v11 upgrade is idempotent; re-running yields byte-identical
      rows.
- [ ] After migration only Chess.com 480–599 s and ≥ 1500 s rows change
      category; Lichess/`local`/`fixture` are untouched.
- [ ] `STATISTICS_VERSION === 2` (converging to `3` with W3) and
      statistics return a platform-correct `(platform, category)`
      partition with no `(chesscom, classical)`.
- [ ] Deterministic fixtures cover the new boundaries and provider
      labels; fixture integrity tests pass.
- [ ] The full gate passes with no warnings or errors.

## 12. Verification commands

Narrow (in stage order; run the stage's focused tests before the next):

```
# Stage 1 — domain + call sites
npx vitest run src/domain/chess/timeControl.test.ts src/domain/chess/parseGame.test.ts src/domain/import/providerGame.test.ts
npx tsc --noEmit

# Stage 2 — schema v11
npx vitest run src/infrastructure/db/schema/v11-migration.test.ts src/infrastructure/db/schema/v5-migration.test.ts src/infrastructure/db/database.test.ts
npx tsc --noEmit

# Stage 3 — fixtures + statistics
npx vitest run src/domain/chess/fixtures/fixtures.test.ts src/domain/statistics/fixtures/version.test.ts src/domain/statistics/fixtures/query.test.ts src/infrastructure/statistics
npx tsc --noEmit
```

Full gate (load the `verify-gate` skill for the runbook):

```
npm run lint
npm run typecheck
npm run format:check
npm run test
npm run build
npm run dev
npm run test:browser
npm run audit
```

Note: `.opencode/` is in `.prettierignore`, so this plan is not checked by
`format:check`; every touched source/test file must be prettier-clean
(`npm run format`).

## 13. Staged sequence (summary)

| Stage | Files | Gate |
|---|---|---|
| 1. Profile-aware domain + all call sites | `timeControl.ts`, `chess/index.ts`, `parseGame.ts`, `providerGame.ts`, `games-repository.ts`, `schema/v5.ts`, `GameLibrary.tsx`, `GameReviewPage.tsx`, domain tests | focused vitest + `tsc --noEmit` |
| 2. Schema v11 re-normalization | `v11.ts` (new), `schema/index.ts`, `database.ts`, `app-config.ts`, `v11-migration.test.ts` (new), `v5-migration.test.ts`, `database.test.ts`, v2–v10 migration tests (`verno` 10 → 11) | focused vitest + `tsc --noEmit` |
| 3. Fixtures + statistics | `fixtures/defs.ts`, `fixtures/scenarios.ts`, provider fixtures, statistics `builders.ts`/`scenarios.ts`, `statistics/types.ts`, statistics tests | focused vitest + `tsc --noEmit` |
| 4. Full gate | all of the above | `verify-gate` runbook |

## 14. Report

- Plan path: `.opencode/plans/013-w5-platform-time-controls.md`.
- Stages: (1) profile-aware domain + every call site; (2) schema v11 +
  migration/idempotency; (3) fixtures + statistics version/partition;
  (4) full gate.
- Expected versions after W5: `TIME_CONTROL_CATEGORY_VERSION = 2`,
  `PERSISTENCE_SCHEMA_VERSION = 11`, `STATISTICS_VERSION = 2`
  (converging to `3` once W3 lands); `TIME_CONTROL_PARSE_VERSION = 1`.
- No code, tests or commits were produced by authoring this plan.
