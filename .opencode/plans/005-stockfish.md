# Implementation Plan — Feature 005 (Stockfish Engine Integration)

Status: Approved & implemented — D1–D8 confirmed by the reviewer (D1 defer
ADR-018 cache; D2 MultiPV `lines[]`; D3 service/transport seam; D4 ship
`lite-single` + `lite` with COOP/COEP; D5 postinstall assets + PWA precache
of the default build; D6 reuse `/playground`; D7 add domain `uciPvToSan`;
D8 leave the SettingsPage placeholder untouched).
Target feature: `.opencode/specs/features/005-stockfish.md`
Author: planner (no implementation work performed)

---

## 1. Objective

Run Stockfish locally in a Web Worker and provide a reliable, cancellable,
typed engine-analysis service that Features 006 (live analysis), 008 (game
analysis), 010 (tactical detection) and 011 (puzzle generation) consume.

Concretely, Feature 005 delivers:

- Stockfish WASM running inside a dedicated Web Worker (never on the UI
  thread — ADR-004).
- A typed `EngineService` (application-facing) with an internal FIFO job
  queue, unique job IDs, cancellation (queued + active), progress events,
  structured failure/timeout handling, lifecycle management and disposal.
- Deterministic, tested analysis profiles `fast` / `normal` / `tactical` /
  `deep` (ADR-012) implemented as configuration data, with UCI option
  mapping and resource caps.
- Engine/version/build metadata on every result (ARCHITECTURE.md §9,
  ADR-018/020) so later features can identify the producing engine and
  support lazy opt-in re-analysis.
- Deterministic engine-verification chess positions (independent of user
  games and of any DB), plus a Stockfish playground inside the existing
  `/playground` Chessground page.
- No move classification, no game analysis, no puzzle generation, and no
  persistence (all owned by later features).

This feature is an **execution layer only**.

Key constraints this plan honours:

- Stockfish MUST run in a Web Worker; the UI thread must never execute the
  search synchronously (`DECISIONS.md` Critical Constraints; ADR-004).
- Engine analysis must remain responsive; queueing, cancellation,
  progress, completion, failure and resumability are required
  (`ARCHITECTURE.md` §5, `005-stockfish.md` §5–§9).
- Stockfish concerns stay isolated from the chess domain and UI
  (`005-stockfish.md` §1); domain logic must not depend on React/DB/Workers
  (`ARCHITECTURE.md` §3).
- The engine service must be a separate module from the worker bootstrap so
  UCI parsing is unit-testable in Node, and real-Worker/WASM behaviour is
  covered by Playwright (ADR-009 consequences).
- The engine Worker must not require network access during analysis after
  WASM assets are installed; analysis is fully local (`005-stockfish.md`
  §21). Offline "local analysis" must keep working (`ARCHITECTURE.md` §11).
- New dependency `stockfish` is GPLv3 — compatible with the project posture
  (ADR-027, AGENTS.md Dependency policy); version follows latest stable, no
  pin in this plan (lockfile + `public/stockfish/meta.json` are the source
  of truth).

---

## 2. Scope

### In scope (from `005-stockfish.md` + architecture)

- `stockfish` npm dependency (latest stable; nmrugg/stockfish.js per
  ADR-012) and an **install-time asset step** that copies the WASM/JS
  engine files into `public/stockfish/` (ADR-012 consequence) and records
  resolved version metadata.
- Engine **Web Worker** created by the browser factory from the static
  asset; a single active search per worker (spec §5).
- **EngineService** (new, in the infrastructure layer) with:
  - typed `analyze(position, options)` API over FEN,
  - unique job IDs + FIFO job queue (spec §5/§6),
  - cancellation for queued and running jobs, with `stop` and a
    terminate-and-recreate fallback (spec §7),
  - progress events (depth/selective depth/nodes/nps/hash%/elapsed/PV/eval)
    never reported as a fake percentage (spec §8),
  - structured result carrying position, evaluation (cp **or** mate,
    never conflated), PV, depth limits, elapsed time, engine metadata and
    profile (spec §9/§10),
  - MultiPV support with rank-preserved lines (spec §11),
  - config data profiles `fast`/`normal`/`tactical`/`deep` with UCI option
    mapping and deterministic tests (ADR-012 table; spec §12),
  - resource configuration: threads/hash/MultiPV/depth, browser caps
    applied (spec §13),
  - failure handling: WASM/Worker/init failures, malformed output, Worker
    termination, timeouts, invalid positions, unsupported options — all as
    structured errors; single-job failure must not break the service and
    queued jobs are preserved across a worker restart per a documented
    policy (spec §14),
  - lifecycle `uninitialized → initializing → ready ⇄ busy` + failure and
    disposed states, lazy worker creation, explicit `dispose()` (spec §15).
- Deterministic engine-verification positions (spec §16).
- Stockfish **playground** integrated into the existing Chessground
  playground at `/playground` (spec §17/§18), with profile selection,
  start/stop, status, progress, evaluation, depth, PV, engine metadata and
  errors, while the board stays interactive.
- Unit/component tests (Vitest, Node/happy-dom — no real engine) and
  browser tests (Playwright — real WASM + Worker).
- PWA/offline support so the installed engine assets remain available
  offline after first install (ARCHITECTURE.md §11).

### Out of scope (owned by later features)

- The **position-keyed IndexedDB analysis cache** (ADR-018) — see D1.
  Feature 005 touches no Dexie table and no schema version.
- Game analysis, move classification, tactical detection, puzzle
  generation, WDL-based classification, accuracy — Features 008/009/010.
- User-facing engine profile settings UI — spec §13 explicitly defers it;
  the `SettingsPage` placeholder stays (see D8).
- A separate engine page/route — the Stockfish playground reuses the
  existing `/playground` page (D6).
- Any change to `src/domain/chess/analysis.ts`, `game.ts`, `position.ts`
  semantics, existing repositories, or existing Chessboard behaviour.
- Multi-worker pools, priority scheduling, ponder, full-strength ~100 MB
  build (ADR-012 research), and the enhanced multi-threaded build's
  offline caching nuances beyond what §8 (Infrastructure) states.

---

## 3. Specification Notes & Open Decisions for Reviewer

`005-stockfish.md` is detailed and internally consistent on behaviour but
leaves design decisions open ("The exact API may differ during
implementation", §3; "The exact model may be expanded", §9). The following
decisions are **not dictated by any spec or ADR**. They are proposed here
so the reviewer can confirm or override before implementation starts.

| # | Open question | Proposed choice | Rationale |
|---|---------------|-----------------|-----------|
| D1 | Does Feature 005 implement the ADR-018 position-keyed IndexedDB analysis cache? | **No.** The cache is deferred to the feature that persists analyses and depends on Feature 004 (the game-analysis era — Feature 008, with Feature 006 possibly exercising it interactively). Feature 005 requires only Features 001–003 and its spec lists "Game persistence" as not required; its scope/outputs never mention the cache. Feature 005 still makes the cache possible later: every result carries the FEN plus the exact `(profile, engineName, engineVersion, engineBuild)` tuple ADR-018 keys on, reusing the existing domain `EngineMetadata`. | ADR-018 is required reading because it constrains the **result model**, not because 005 owns a DB table. The Feature 004 plan (§2 out-of-scope) already classed `positionAnalysisCache` as a later-feature table ("Each owning feature adds its own version bump"). Implementing a Dexie cache here would silently add a Feature-004 dependency the spec does not list. The job-based service API keeps a later transparent cache wrapper/extension possible. **Reviewer L1:** confirm the cache stays out and that ADR-018's "engine service does the lookup" wording will be honoured when the cache lands (wrap/extend `EngineService` in the owning feature). |
| D2 | Result shape for MultiPV | One `EngineAnalysisResult` per job with `lines: EngineLine[]` (rank `1..N`), because the `tactical` (MultiPV 5) and `deep` (MultiPV 3) profiles produce several scored lines that must preserve order (spec §11). The spec's single-PV example shape is preserved as `lines[0]` semantics. WDL (ADR-019) parsed when `UCI_ShowWDL` is on, `null` otherwise (fast). | ADR-012 profile table has MultiPV > 1 for two profiles; a one-line result would throw data away. Spec explicitly permits model expansion. |
| D3 | Service location and test seam | New module tree `src/infrastructure/engine/`. `EngineService` (queue/lifecycle) is a separate module from the Worker transport (ADR-009) and takes an injectable transport factory, so queue semantics, cancellation and recovery are unit-tested in Node against a fake transport; the real Worker/WASM path is created only by the browser factory and exercised by Playwright. | Matches repo layering (`src/infrastructure/db` precedent) and ARCHITECTURE §3 (Infrastructure owns the Stockfish worker). No real Worker exists under happy-dom, so a fake-transport seam is required for Node tests (ADR-009 consequence). |
| D4 | Which engine builds ship and when multi-threaded builds are used | Copy **`lite-single`** (default, no SharedArrayBuffer) **and** `lite` (multi-threaded, needs cross-origin isolation) at install time. Runtime capability detection picks `lite-single` unless `crossOriginIsolated === true && hardwareConcurrency > 1`, then uses `lite` with `Threads = min(2, hw)` — honouring ADR-012's progressive-enhancement consequence. Add COOP/COEP headers to Vite `server` **and** `preview` so the enhanced path is exercised in dev/browser tests; production static-hosting header configuration is documented but out of scope. The ~100 MB full build is **not** shipped. | ADR-012 consequence: "Detect SharedArrayBuffer at runtime and upgrade to the multi-threaded build when available." `PreviewOptions extends CommonServerOptions` in Vite so `preview.headers` is supported. E2E must not depend on which build wins (assert engine metadata generically). |
| D5 | Engine asset install strategy and PWA caching | `scripts/copy-stockfish-assets.mjs` (postinstall, alongside `fetch-piece-assets.mjs`) copies the chosen `.js`/`.wasm` files from `node_modules/stockfish/src/` into `public/stockfish/` and writes `public/stockfish/meta.json` (`{ npmVersion, engineRelease, builds: [...] }`) derived from the installed package. `public/stockfish/` is added to `.gitignore` (generated assets, like `dist/`). Vite PWA workbox globs gain `wasm`, `maximumFileSizeToCacheInBytes` is raised above the largest shipped file (~8 MiB), and the non-default multi-threaded build is excluded from precache (runtime-cached by the browser); offline analysis works via the precached default build. | ADR-012: "WASM and JS files are placed in `public/stockfish/` at install time… the engine service reads the version from the package and constructs the URL." Workbox's default 2 MiB precache ceiling would reject a ~7 MB `.wasm`. Runtime construction of the worker URL needs the resolved asset prefix, which is what `meta.json` supplies. |
| D6 | Where the Stockfish playground lives | Extend the existing **`/playground` Chessground playground** (Feature 002's `PlaygroundPage`) with an engine panel in the existing "Engine" side-panel slot (currently a placeholder hint: "Engine lines and evaluations appear here after Stockfish is wired in (Feature 005)"). New engine-verification positions are appended to the playground fixture list so they render on the Chessground and can be analyzed. No new route, no nav change. | Spec §17: "using the existing Chessground playground"; the Feature 002 dependency note and the in-page placeholder both point here. |
| D7 | PV display format | Engine layer returns PV as UCI moves only (it must not become a second chess-rules implementation). For human-readable SAN in the playground and later consumers, add one small deterministic pure helper in the domain (`src/domain/chess/san.ts`, `uciPvToSan(fen, uci[])` over chessops `parseUci`/`makeSan`), with tests. | A PV like `g1f3 d7d5` is unreadable in the spec §8 UI example. SAN derivation is a chess-domain transform and belongs in the domain, not the engine module. If the reviewer prefers minimal scope, the playground can render UCI and D7 is dropped. |
| D8 | `SettingsPage` "Engine strength — Coming in Feature 005" placeholder | Leave the `SettingsPage` row untouched **or** soften the badge to "Profile mechanism arrives with Feature 005; user-facing control later". Recommend leaving it: Feature 005 spec §13 states user-facing engine customization is a future surface, so implementing a settings control would exceed scope; the placeholder is not binding. | Prevents accidental scope creep into a settings UI while acknowledging the row's text now slightly over-promises. Reviewer picks. |

If the reviewer disagrees with any of D1–D8 the affected sections (§5–§11,
§13) must be revised before implementation begins.

---

## 4. Existing Code to Reuse

### Domain (`src/domain/chess/`)

- `analysis.ts` — **reuse unchanged**: `ANALYSIS_PROFILES` and type
  `AnalysisProfile` (`'fast' | 'normal' | 'tactical' | 'deep'`), `Wdl`,
  `EngineMetadata` (`engineName`, `engineVersion`, `engineBuild`,
  `profile`). The engine service reports these exact tokens so future
  `MoveAnalysis` records line up with ADR-018/019/020 without mapping.
- `position.ts` — `parsePositionFen(fen)` for **request validation** at the
  service boundary (rejects malformed/illegal setups before any UCI traffic;
  spec §4). The engine layer adds no second chess-rules implementation.
- `move.ts` / `chessops` imports as the base for D7's SAN helper.
- `fixtures/` module layout (`defs.ts`, `games.ts`, `index.ts`) as the
  structural pattern for the engine-verification fixture module (which is
  **not** user data and never stored).

### Chess/UI (`src/components/`, `src/pages/`)

- `PlaygroundPage.tsx` — the existing Chessground playground: fixture
  select, `Chessboard` (controlled via chessops `Position`), `MoveList`,
  `Navigation`, `SettingsPopover`, and the side-panel "Engine" placeholder
  section that this feature activates.
- `components/chessboard/chessopsAdapter.ts` — `positionToFen` /
  `positionFromFen` to obtain the FEN handed to the engine from the
  domain/application position (spec §18: never read internal Chessground
  state).
- `components/chessboard/playgroundFixtures.ts` — fixture list the new
  engine positions are appended to.
- `pages/PlaygroundPage.module.css` — design tokens/layout to extend for the
  engine panel.
- `components/ui/Button.tsx`, theme CSS variables — consistent controls in
  dark/light themes.

### Infrastructure / config / tooling

- `src/infrastructure/db/settings-repository.ts` — the **module-singleton
  pattern** (`export const … = new …`) reused for `engineService`.
- `scripts/fetch-piece-assets.mjs` + `package.json` `postinstall` — the
  precedent for the Stockfish asset-copy step.
- `vite.config.ts` — PWA/workbox config to extend (`globPatterns`,
  `maximumFileSizeToCacheInBytes`), plus `server`/`preview` header hooks.
- `vitest.config.ts` + `src/test/setup.ts` (happy-dom default, cleanup
  after each) and `playwright.config.ts` (Chromium project, preview server)
  — no changes needed to either config for unit tests; e2e additions live
  under `tests/e2e/`.
- `tests/e2e/playground.spec.ts` — patterns for playground e2e and the one
  assertion that must be updated when fixtures are added (`option` count).

---

## 5. Files / Modules to Create or Modify

### New — engine infrastructure (`src/infrastructure/engine/`)

| File | Purpose |
|------|---------|
| `types.ts` | Shared public types: `EngineServiceStatus`, `EngineLifecycleState`, `AnalysisJobStatus`, `AnalysisJobEvent`, `EngineEvaluation` (`{ cp } \| { mate }`, side-to-move perspective), `EngineMove` (`{ uci }`), `EngineLine` (`{ multipv, evaluation, principalVariation, wdl, depth, seldepth, nodes, nps, hashfull, timeMs }`), `EngineAnalysisResult`, `EngineProgress`, `AnalysisRequest`/`AnalysisOptions`, `EngineJobError` (`{ reason: EngineFailureReason; message }`, `EngineFailureReason` union incl. `'invalid-position' \| 'engine-startup-failed' \| 'worker-crashed' \| 'timeout' \| 'malformed-response' \| 'cancelled' \| 'unsupported-option' \| 'disposed'`), `EngineCapabilities`, transport interfaces (`EngineTransport`, `EngineTransportFactory`). Re-uses `AnalysisProfile`, `EngineMetadata`, `Wdl` from `@/domain/chess`. |
| `engineBuild.ts` | Build metadata resolution: `EngineAssetInfo` (`engineName: 'stockfish'`, `engineRelease` (e.g. `18`), `npmVersion`, `build` (`lite-single`/`lite`), asset file base, wasm path); loads `public/stockfish/meta.json` (BASE_URL-aware) with a documented fallback constant; `engineMetadataFor(build)` composes the domain `EngineMetadata`. |
| `capabilities.ts` | Pure, injectable capability resolution `resolveEngineCapabilities(env)` → `{ sharedArrayBuffer, hardwareConcurrency, threads, hashCapMb, selectedBuild }` + a thin browser reader. Hash caps 64 MB mobile / 256 MB desktop (ADR-012), hash never exceeds the selected build's allocation. |
| `engineProfiles.ts` | Profile configuration **data** for `fast`/`normal`/`tactical`/`deep` (label, `depth`, `hashMb`, `multipv`, `showWdl`) from the ADR-012 table + `resolveUciProfileConfig(profile, caps)` applying caps and producing ordered UCI options. No engine-control logic duplicated. |
| `uciProtocol.ts` | Pure UCI serialisation/parsing (Node-testable, ADR-009): `formatUciCommand`, `parseUciOutput` (lines → typed results: `id`, `uciok`, `readyok`, `info`, `bestmove`, unknown tolerated), `parseInfoLine` (depth, seldepth, multipv, nodes, nps, hashfull, time, `score cp \| mate`, `wdl`, `pv` as UCI tokens), `parseScore`, `parseBestmove`. Malformed lines → `null`, never throw. |
| `workerTransport.ts` | Browser-only **worker bootstrap**: creates `new Worker(new URL(…, import.meta.url))` from the asset URL resolved by `engineBuild`, normalizes the stockfish.js message protocol (string lines, tolerating structured `{…}` payloads per the installed package), maps `onmessage`/`onerror`/termination to the `EngineTransport` interface. The only module that touches the `Worker` global. |
| `engineService.ts` | `EngineService` class: lazy init state machine, UCI handshake (`uci` → `uciok`, options → `isready`/`readyok`), FIFO queue, single active search, job handles, progress throttling, cancellation (`stop`, escalate to terminate+recreate), per-job watchdog timeout, worker-failure recovery that preserves queued jobs, `dispose()` (`quit` + terminate). `createEngineService({ transportFactory, capabilities, meta })` and a module singleton `engineService` (settings-repository pattern). |
| `index.ts` | Barrel exports for consumers and tests. |
| `fixtures/enginePositions.ts` | Deterministic engine-verification positions (`EnginePositionFixture`: id, label, FEN, expectation) — mate-in-1, forced-mate/winning-material tactic, clearly advantageous move, quiet deep position, en-passant/castling FEN coverage (spec §16). Never stored. |
| `*.test.ts` | Colocated unit tests (§10). |
| `test-support/fakeEngineTransport.ts` | Scriptable fake transport used by service tests (in the test tree, not shipped). |

### New — domain (if D7 accepted)

| File | Purpose |
|------|---------|
| `src/domain/chess/san.ts` | `uciPvToSan(fen, uci[]): { ok: true; sans: string[] } \| { ok: false; message: string }` — deterministic UCI→SAN PV rendering via chessops (`parseUci`, `makeSan`), surfaced through `src/domain/chess/index.ts`. |

### New — scripts / config

| File | Purpose |
|------|---------|
| `scripts/copy-stockfish-assets.mjs` | postinstall: resolve installed `stockfish` package version + asset files (`stockfish-{release}-lite-single.js/.wasm`, `stockfish-{release}-lite.js/.wasm`), copy to `public/stockfish/`, write `meta.json`. Idempotent. |
| `tests/e2e/stockfish.spec.ts` | Real-engine browser tests (§10). |

### New — UI components

| File | Purpose |
|------|---------|
| `src/components/engine/EnginePanel.tsx` + `EnginePanel.module.css` | Engine panel component: status, profile select, Start/Stop, progress, results, metadata, errors (§7). |
| `src/components/engine/useEnginePanel.ts` | Small React hook binding `EngineService` events to panel state; accepts an injected service/factory so component tests use a fake. |

### Modified

| File | Change |
|------|--------|
| `package.json` | Add `stockfish` dependency; add `copy-stockfish-assets` script; extend `postinstall`. |
| `.gitignore` | Add `public/stockfish/`. |
| `vite.config.ts` | COOP/COEP `server.headers` + `preview.headers` (D4); workbox `globPatterns` += `wasm`; `maximumFileSizeToCacheInBytes` raised; precache excludes the non-default build (D5). |
| `src/components/chessboard/playgroundFixtures.ts` | Append engine-position fixtures (mapped to FEN-kind entries). |
| `src/pages/PlaygroundPage.tsx` | Replace the engine placeholder with the live `EnginePanel` wired to the current board FEN. |
| `src/pages/PlaygroundPage.module.css` | Styles for the engine panel section (or reuse a dedicated panel module). |
| `src/domain/chess/index.ts` | Export `uciPvToSan` (D7). |
| `tests/e2e/playground.spec.ts` | Update the fixture `option` count assertion for the appended engine positions. |
| `src/components/chessboard/playgroundFixtures.test.ts` | Update the hard-coded `PLAYGROUND_FIXTURES.length === 17` assertion and shape coverage for the appended fixtures. |

---

## 6. Domain / Data Changes

- **No persistent data model change.** No Dexie table, no schema bump,
  `PERSISTENCE_SCHEMA_VERSION` stays `2`, no IndexedDB access anywhere in
  this feature (D1).
- `EngineMetadata` / `AnalysisProfile` / `Wdl` in `src/domain/chess/analysis.ts`
  are reused unchanged; the engine service composes results from them.
- Domain additions are **deterministic pure code and data only**:
  - D7: `uciPvToSan` helper in `src/domain/chess/san.ts` (if accepted).
  - No domain rule changes.
- Engine fixtures (`src/infrastructure/engine/fixtures/enginePositions.ts`)
  are engine-layer test/verification data, independent of imported user
  games and never persisted — mirroring Feature 003's fixture discipline.

---

## 7. UI Changes

### Engine panel (`/playground` side panel)

Replace the "Engine lines and evaluations appear here after Stockfish is
wired in (Feature 005)" placeholder with an `EnginePanel` that shows:

- engine status (idle / initializing / ready / analyzing / failed /
  disposed) and engine metadata once known (name/version/build from
  `EngineMetadata`);
- profile selector (`fast`/`normal`/`tactical`/`deep` with human labels);
- **Start** / **Stop** actions. Start lazily ensures the worker exists
  (first click downloads/initialises ~7 MB WASM; the page must not fetch it
  on mere mount), captures the **current board FEN** from the domain
  position (via `positionToFen`), and runs analysis without blocking the
  board;
- progress readout in the spec §8 style — never a percentage:
  `Depth: 12 · Nodes: 1.4M · Time: 2.1s · Eval: +0.72 · PV: Nf3 d5 g3 …`
  (SAN via D7; UCI otherwise);
- result lines (MultiPV ordered), evaluation with explicit mate handling
  (`M3`, `-M5`, never rendered as a centipawn number);
- structured error messages (`role="alert"`) for the failure reasons in
  §5/`types.ts`.

### Playground behaviour

- New engine-verification fixtures appear in the existing fixture
  `<select>` and render on the Chessground (spec §18 flow: Chess domain →
  FEN → Engine Service → Stockfish → result → UI).
- Board stays fully interactive during analysis (moving pieces must not
  stall; ongoing analysis continues on the captured FEN).
- Keyboard-accessible controls (buttons/select), visible labels, dark and
  light theme via existing CSS variables; works at mobile/tablet/desktop
  widths in the existing responsive layout.

The `AnalysisPage`, `SettingsPage` and all other pages stay untouched
(except the optional D8 badge wording).

---

## 8. Infrastructure Changes

- **New runtime dependency**: `stockfish` (GPLv3, ADR-027-compatible),
  latest stable per AGENTS.md Dependency policy; the lockfile records the
  exact version. ADR-012's research (June 2026) shows `18.0.8` as current
  stable; install may resolve to a newer 18.x/19.x — the copy script and
  `meta.json` derive all asset/version strings from the installed package,
  so nothing hard-codes `18` into runtime code paths beyond a documented
  fallback.
- **Install-time asset step** (`copy-stockfish-assets.mjs`): copies
  `stockfish-{release}-lite-single.{js,wasm}` and
  `stockfish-{release}-lite.{js,wasm}` from `node_modules/stockfish/src/`
  into `public/stockfish/`, writes `meta.json`. `public/stockfish/` is
  git-ignored; dev, preview and build all serve it from `public/`.
- **Worker creation**: `new Worker(new URL(`${BASE_URL}stockfish/…`,
  import.meta.url))` per ADR-012; worker is created lazily once and reused
  across jobs (spec §15). Single worker, single active search.
- **Capability-based build selection** (D4): default `lite-single`;
  `lite` when cross-origin-isolated with >1 core. COOP/COEP headers added
  for Vite `server` and `preview`; production hosting headers documented as
  a deployment note.
- **PWA/offline** (D5): precache the default engine `.js` + `.wasm` so
  local analysis works offline after first install (ARCHITECTURE §11);
  workbox size ceiling raised; non-default multi-threaded build left to the
  browser HTTP cache.
- **Engine service singleton** `engineService` in `src/infrastructure/engine/`
  (settings-repository pattern); constructors accept injected
  transport/capabilities/meta for tests. Service is framework-agnostic (no
  React import). `dispose()` exists and is used in tests and Playwright;
  app-level teardown is optional at this stage.

---

## 9. Dependencies

| Dependency | Kind | License | Version policy |
|-----------|------|---------|----------------|
| `stockfish` (nmrugg/stockfish.js) | runtime | GPLv3 (compatible with GPL-3.0-or-later per ADR-027 + AGENTS.md policy) | **Latest stable** at install time; no pin in this plan (lockfile + `meta.json` are authoritative). |

No other new dependencies. No version pins are introduced (AGENTS.md
Dependency policy). DevDependencies already present cover everything
(Vitest, Testing Library, happy-dom, Playwright, Vite PWA).

---

## 10. Tests

All tests are deterministic and never touch user games, network chess APIs,
or IndexedDB (spec §19/§21; AGENTS.md).

### Unit — `uciProtocol` (Node, no Worker)

- UCI command formatting (`uci`, `isready`, `setoption name Hash value N`,
  `position fen …`, `go depth N`, `stop`, `quit`).
- `info` line parsing: depth/seldepth/nodes/nps/hashfull/time, `score cp`,
  `score mate` (positive/negative, never conflated — spec §10), `wdl`
  triplets, MultiPV rank, PV token lists; partial info lines.
- `bestmove` parsing (with and without `ponder`); `uciok`/`readyok`/`id`
  lines; malformed/unknown lines yield `null`/tolerant results, never throw.

### Unit — profiles & capabilities

- All four profiles resolve to valid deterministic UCI configurations
  matching the ADR-012 table (depth/hash/MultiPV/`UCI_ShowWDL`); `fast`
  leaves WDL off (ADR-019), others on.
- Caps applied: hash clamped to 64 MB (mobile) / 256 MB (desktop);
  single-thread config when no SharedArrayBuffer, multi-thread config only
  when cross-origin-isolated.
- Build selection (D4) given capability snapshots.

### Unit — engine service (fake transport)

- Initialization: lazy; handshake sequence; startup failure surfaces as
  `engine-startup-failed`; status transitions.
- Analysis request → job with unique IDs; FIFO ordering of concurrent
  requests; only one active search at a time (spec §5).
- Result delivery: completed job reports evaluation + PV + metadata;
  `EngineMetadata` + profile + input FEN preserved (spec §9); MultiPV
  ordering preserved (D2); WDL present/absent per profile.
- Cancellation: queued job cancelled without Worker traffic; active job
  sends `stop` and is reported `cancelled`, **never** completed; engine
  reusable afterwards; subsequent queued jobs proceed (spec §7).
- Failure recovery: simulated worker error mid-job → active job fails with
  `worker-crashed`, worker is recreated, remaining queued jobs still
  complete (documented recovery policy).
- Timeout: silent transport → job fails with `timeout`; service recovers.
- Invalid position FEN → job fails with `invalid-position` before any UCI
  command is sent.
- Malformed engine output tolerated; disposal terminates the transport.

### Domain (D7)

- `uciPvToSan`: SAN round-trips for ordinary moves, captures, castling,
  en-passant, promotions; illegal/malformed input returns an error.

### Fixtures

- All engine-position FENs parse as legal chessops positions; fixture
  expectations are internally consistent (validation of expectations
  against the real engine happens in e2e).

### Component (happy-dom)

- `EnginePanel` with an injected fake service: profile select shows the
  four profiles; Start issues `analyze` with the current FEN; progress
  fields (depth/nodes/time/eval) render and **no `%` text appears**;
  Stop cancels; engine failure renders an alert; metadata line appears;
  idle → analyzing → done transitions.

### Browser e2e — `tests/e2e/stockfish.spec.ts` (Playwright, real WASM)

- Engine loads and initializes in a dedicated Worker; metadata visible.
- `engine-mate-in-1` fixture analyzed with `fast`: result reports a mate
  evaluation and the mating move; progress was observable.
- Starting position analyzed: completes with a numeric evaluation (no mate)
  — assertions stay strength/version-agnostic (spec §16/§19: verify
  characteristics, not exact numbers).
- Cancellation mid-analysis returns to idle and a second analysis succeeds.
- Board remains interactive while analyzing (play a move during analysis).
- Playground works with no imported games (existing fixtures + engine
  positions only).
- Deterministic fixture expectations pass (browser tests pin the shipped
  engine + config via `meta.json`).
- The engine spec runs its tests serially (`test.describe.configure({ mode:
  'serial' })`) so the WASM worker tests do not contend for CPU on the
  shared preview server.

`tests/e2e/playground.spec.ts`: update the fixture-`option` count assertion
(17 + N appended engine fixtures) and any count/shape assertions in
`playgroundFixtures.test.ts`.

---

## 11. Migration Considerations

- **No database migration**: schema stays at v2; nothing to back up or
  re-version.
- **Static assets**: `public/stockfish/` is generated by `postinstall`.
  Anyone checking out the repo must run `npm install` (which runs
  `postinstall`) before `npm run dev`/`build`; `dist/` builds then include
  the engine assets. This mirrors the existing piece-asset flow.
- **Engine version upgrades (ADR-020)**: because every result carries
  `engineName`/`engineVersion`/`engineBuild` and `meta.json` is regenerated
  on install, upgrading `stockfish` re-runs the copy step and all new
  analyses are stamped with the new identity; no stored records exist yet
  in this feature, so there is nothing to invalidate. The ADR-018 cache
  (when it lands) keys on this identity.
- **PWA**: first post-change build produces a new precache manifest
  including the engine assets; existing clients update via `autoUpdate`.
- Nothing in this feature changes stored user data, sync, or analysis
  version numbers.

---

## 12. Implementation Phases (incremental order)

1. **Dependency + assets**: add `stockfish`, write
   `scripts/copy-stockfish-assets.mjs`, wire `postinstall`, add
   `.gitignore` entry; manually verify dev server serves
   `public/stockfish/*` and `meta.json`.
2. **Pure engine modules**: `types.ts`, `uciProtocol.ts`, `engineProfiles.ts`,
   `capabilities.ts`, `engineBuild.ts` + unit tests (no Worker anywhere).
3. **Worker transport + service**: `workerTransport.ts`, `engineService.ts`,
   `index.ts`, fake-transport test support, full service unit suite.
4. **Fixtures + (D7) SAN helper**: `fixtures/enginePositions.ts` +
   validation tests; `src/domain/chess/san.ts` + exports + tests.
5. **UI**: engine fixtures appended to `playgroundFixtures.ts`; `EnginePanel`
   (+ hook, CSS); wire into `PlaygroundPage` replacing the placeholder;
   component tests; update e2e fixture-count assertions.
6. **Infra polish**: `vite.config.ts` headers (D4) + PWA/workbox wasm
   handling (D5); optional D8 settings badge text.
7. **Browser tests**: `tests/e2e/stockfish.spec.ts`; run full gate (§15)
   and a `npm run dev` smoke run checking the worker initialises without
   console errors.

---

## 13. Risks

- **Package/file-name drift**: exact `stockfish` worker file names and the
  JS↔Worker message shape differ across releases/builds. Mitigation: the
  copy script + `meta.json` derive names from the installed package; all
  message handling is normalized in `workerTransport.ts`; implementation
  must verify the message protocol against the installed package README in
  phase 1.
- **Real-engine e2e flakiness**: WASM load time and search time vary by
  machine; Chromium may be missing. Mitigation: lazy init, `fast` profile
  for e2e, behaviour-based assertions (mate vs numeric, metadata presence)
  instead of exact evals, generous timeouts, and the project already gates
  `test:browser` on Chromium availability.
- **Mobile memory**: WASM memory is fixed at load; hash caps (64/256 MB)
  and `lite-single` default keep allocation safe on phones (ADR-012). A
  failure to allocate must surface as `engine-startup-failed`, not a crash.
- **Cross-origin-isolation ambiguity**: which build runs depends on
  browser headers; e2e asserts engine metadata generically, never the
  specific build.
- **PWA precache ceiling**: workbox's 2 MiB default would silently drop the
  ~7 MB WASM; must raise the limit and extend globs in the same change as
  the assets are added (§8/D5).
- **Worker lifecycle leaks**: StrictMode remounts and HMR can double-create
  workers. Mitigation: lazy singleton + explicit `dispose()` in tests; dev
  HMR worker churn is acceptable but must not spawn on page mount alone.
- **Scope creep into settings/cache**: D1/D8 explicitly fence the ADR-018
  cache and user-facing profile settings out of this feature.
- **License**: `stockfish` is GPLv3; serving its WASM from `public/` makes
  it part of the distributed app. Compatible with ChessRemedy's
  GPL-3.0-or-later (ADR-027) — no action needed, but the distribution note
  belongs in the implementation commit message.

---

## 14. Acceptance Criteria

Cross-referenced to `005-stockfish.md` §22.

### Core

- [ ] Stockfish runs locally in a Web Worker (ADR-004); no engine search on
      the UI thread.
- [ ] A valid FEN position can be analyzed through the typed service API.
- [ ] Analysis does not block the UI; the playground board stays responsive.
- [ ] A completed result contains evaluation and principal variation.
- [ ] A completed result contains engine name/version/build metadata.
- [ ] A completed result identifies the analysis profile.

### Jobs

- [ ] Multiple analysis jobs can be queued (FIFO).
- [ ] Jobs have unique IDs.
- [ ] Queued jobs can be cancelled.
- [ ] Active analysis can be cancelled (`stop`; recreate fallback).
- [ ] A cancelled job is never reported as completed.
- [ ] The engine remains usable after cancellation.

### Progress

- [ ] Analysis progress is observable (depth/time/nodes/PV/eval when
      available).
- [ ] The UI never displays misleading percentage completion.

### Profiles

- [ ] `fast`, `normal`, `tactical`, `deep` profiles exist and produce
      deterministic engine configurations (ADR-012 table), with `normal`
      as the ADR default and resource caps applied.

### Failure handling

- [ ] Invalid positions are rejected before reaching the Worker.
- [ ] Worker/engine failures are detected and reported as structured errors.
- [ ] Engine/WASM initialization failures are reported.
- [ ] Malformed engine responses do not crash the application.
- [ ] Analysis recovers from a recoverable Worker/engine failure (queued
      jobs preserved per documented policy).
- [ ] Per-job timeout handling works.

### Playground

- [ ] A Stockfish playground exists on `/playground` (extending the
      Chessground playground).
- [ ] Predefined engine-verification positions can be displayed and analyzed.
- [ ] Analysis can be started and stopped; profile is selectable.
- [ ] Engine progress, result, evaluation (mate vs cp), depth and PV are
      visible.
- [ ] Engine/version metadata is visible.
- [ ] The board remains responsive during analysis.
- [ ] The playground works without imported games, a database, or any
      external chess API.

### Verification

- [ ] Unit/integration tests pass (service, queue, cancellation, UCI,
      profiles, fixtures, UI components).
- [ ] Real-engine Stockfish Worker tests pass (Playwright).
- [ ] Production build passes; `npm run dev` smoke run has no
      browser-console errors.
- [ ] No external chess API and no real user games are required.

---

## 15. Verification Commands

Narrowest relevant verification first, then the full gate (AGENTS.md
Execution policy). Run from the repo root after `npm install`:

```bash
# Targeted unit/component tests while implementing
npm run test -- src/infrastructure/engine          # engine unit tests
npm run test -- src/components/engine               # engine panel component tests

# Real-engine browser integration (Chromium + built assets)
npm run build
npm run test:browser -- tests/e2e/stockfish.spec.ts

# Full project gate — must all pass without warnings or errors
npm run lint
npm run typecheck
npm run format:check
npm run test
npm run build
npm run dev          # manual smoke: /playground engine panel, no console errors
npm run test:browser # full e2e suite (Chromium available)
npm audit
```

---

## 16. Notes for the Reviewer

- Decisions D1–D8 must be confirmed before implementation; D1 (cache
  deferral) and D8 (settings badge) are the two most likely to be
  contested, and both are explicitly scoped by the spec.
- The plan introduces no version pins; `stockfish` version + asset names
  are resolved from the lockfile and the installed package at install time.
- Feature 005 intentionally adds no IndexedDB surface; the ADR-018 cache
  remains available as a transparent later extension of `EngineService`.
- No application source code was modified while writing this plan.
