# Plan 034 — W2: Dedicated verification engine + thread budget + detection depth

Status: **ready to implement** (plan-only; no code/tests/commit yet).
Owner ruling encoded: a changed verification depth is applied by an
**explicit user-triggered re-scan** and is **not** part of the automatic
freshness gate.

Source of truth (read in full for this plan):

- `specs/decisions/ADR-034-dedicated-verification-engine.md` (primary)
- `specs/decisions/ADR-012-stockfish-wasm.md` (thread cap / profile table)
- `specs/decisions/ADR-018-engine-analysis-cache.md` (detection cache scope)
- `specs/decisions/ADR-026-tactical-verification-pipeline.md` (depth setting)
- `specs/features/005-stockfish.md` §1/§1a/§13/§15/§20
- `specs/features/008-game-analysis.md` §3 (threads override scope)
- `specs/features/010-tactical-detection.md` (engine/depth acceptance criteria)
- `specs/domain/tactics.md` §"Verification depth (W2)"
- `specs/ARCHITECTURE.md` §5
- `AGENTS.md`, `.opencode/DECISIONS.md`, `.opencode/CONTEXT-MAP.md`

Conventions: follow `AGENTS.md` context/output discipline; load the
`verify-gate` skill before running the full gate. Current HEAD: `67d1438`.
Note: `git status` currently shows three untracked plan files
(`009-w3-*`, `013-w4-*`, `017-w1-*`) in addition to `.vscode/`; this plan
does not touch them.

---

## 1. Objective

Make Feature-010 Stage-2 tactical verification run on its **own Stockfish
Web Worker and FIFO**, partitioned from the shared analysis engine by a
**global thread budget**, and make the **verification depth** a persisted,
user-facing setting that scopes the ADR-018 detection cache. The result:

- detection overlaps game/live analysis instead of head-of-line blocking it;
- the two engines never oversubscribe the CPU (`tA + tV <= B`);
- a verification result is never served to a search at a different depth;
- a completed detection stays **current** by `detectionVersion` alone —
  changing the depth never marks it outdated and never auto-runs a scan;
  applying a new depth is the explicit user-triggered re-scan path.

This is an assembly/lifecycle change plus one new setting. It does not
change the detection algorithm, the candidate rules or the Stage-2 guards.

## 2. Scope

### In scope

- `MAX_THREADS_CAP = 8`, `VERIFICATION_THREADS = 1`, and the budget
  formulas in `capabilities.ts`; verification capabilities derived from the
  same build selection with `threads = 1`.
- A lazy, idle-disposing verification `EngineService` wrapper and its
  browser wiring (second Worker, own queue/watchdogs, shared ADR-018 cache).
- `analysis.tacticalDetection` settings key + `{ verificationDepth }` value,
  default `22`, bounds `10..40`, clamped on read/write; Settings UI + hook.
- Detection service consumes the effective depth for the engine request, the
  ADR-018 cache key (`maxDepth` + `threads` + `movetimeMs`) and the
  persisted `verificationDepth` provenance (candidate + per-analysis summary).
- Removing the inherited Game-analysis `threads` override from the scan.
- An explicit `force` re-scan path (service + existing scan affordance) so a
  changed depth can be applied on user request.

### Out of scope / non-goals

- No change to Stage-1 candidate rules, Stage-2 guards, thresholds or
  `DETECTION_VERSION` (leave whatever value is current at HEAD: `10`).
- No Dexie schema bump (`PERSISTENCE_SCHEMA_VERSION` stays `10`);
  `verificationDepth` on the summary is additive/non-indexed.
- No per-puzzle scheduler, no new dependency.
- No redesign of the detection pass, the Library filter model, or the
  analysis pipeline.
- No change to the `tactical` profile's MultiPV (5), hash (128 MB) or WDL.
- No change to the `VERIFY_MOVETIME_MS = 45_000` backstop value.

## 3. Encoding (the rules to implement exactly)

```
canMultiThread = crossOriginIsolated && sharedArrayBuffer && hardwareConcurrency > 1
B  = canMultiThread ? max(1, min(hardwareConcurrency, MAX_THREADS_CAP)) : 1
MAX_THREADS_CAP = 8
tV = VERIFICATION_THREADS = 1                       (fixed, not user-facing)
tA = max(1, B - tV)                                 (analysis user-selectable cap)
invariant: tA + tV <= B
Threads UCI option: only on the multi-threaded `lite` build (unchanged gate)
verificationDepth: default 22, min 10, max 40, clamp(Math.round(v))
detection cache scope:
  (positionKey, profile='tactical', engineName, engineVersion, engineBuild,
   maxDepth=verificationDepth, movetimeMs=VERIFY_MOVETIME_MS, threads=tV)
freshness: detectionVersion only; verificationDepth is provenance, never a
  freshness input and never auto-triggers a scan
```

## 4. Existing code to reuse (anchors)

- Thread cap / capabilities: `src/infrastructure/engine/capabilities.ts:14`
  (`EngineCapabilities`), `:35` (`MOBILE/DESKTOP_HASH_CAP_MB`), `:37`
  (`MAX_THREADS = 2`), `:43-56` (`resolveEngineCapabilities`), `:59-78`
  (`readBrowserCapabilities`).
- Profile option resolution / Threads gate:
  `src/infrastructure/engine/engineProfiles.ts:31-43` (table; tactical depth
  22), `:74-90` (`resolveProfileConfig`, Threads only when `build === 'lite'
  && threads > 1`).
- Engine service seam and per-job clamping:
  `src/infrastructure/engine/engineService.ts:90-98` (`clampHashMb`,
  `clampThreads`), `:139-156` (`applyProfileOverrides`), `:288-329`
  (`analyze`), `:389-407` (`dispose`), `:881-883` (`createEngineService`).
- Transport: `src/infrastructure/engine/workerTransport.ts:23-84`.
- Cache key: `src/infrastructure/engine/cache.ts:61-68`
  (`CacheEntryScope`), `:76-96` (`analysisCacheKey`); persistent store
  `src/infrastructure/db/engine-cache-repository.ts:36-67`.
- Analysis engine browser assembly:
  `src/infrastructure/engine/browser.ts:22-53`
  (`createBrowserEngineService`, `getBrowserEngineService`,
  `getCachedBrowserEngineService`).
- Detection service seam:
  `src/infrastructure/tactics/tacticalDetectionService.ts:117`
  (`VERIFY_MOVETIME_MS`), `:128-140` (options), `:159-180` (constructor,
  `tacticalDepth = profileConfig('tactical').depth`), `:197-472`
  (`runPassForCompletedJob`), `:212-217` (idempotency), `:230-256` (stale
  wipe), `:291-296` (verified-row reuse), `:317-322` (`job.config.threads`
  inheritance — remove), `:360-365` / `:685-755`
  (`verifyCandidateWithEngine`), `:691-696` (cache scope), `:709-718`
  (`analyze` options), `:738-753` (cache put), `:757-781` (`toVerdict`).
- Analysis service:
  `src/infrastructure/analysis/analysisService.ts:126-144` (options),
  `:386-425` (`scanGame`), `:989-1050` (`startScan`), `:959-977`
  (`writeQueuedSummary`), `:1217-1263` (`resolvePosition`).
- Assemblies: `src/infrastructure/analysis/browser.ts:36-61`,
  `src/infrastructure/tactics/browser.ts:21-32`.
- Settings seam: `src/config/app-config.ts:13-24` (`SETTINGS_KEYS`);
  `src/hooks/useGameAnalysisSettings.ts:31-53` and
  `src/hooks/usePuzzleTimerSetting.ts:18-42` (hook pattern);
  `src/pages/SettingsPage.tsx:105-167` (`GameAnalysisDefaults`), `:316-335`
  (row), `:468-577` (`EngineDefaults`).
- Summary provenance: `src/domain/analysis/summaryDerivation.ts:104-154`
  (`PerAnalysisSummary`), `:194-224` (`buildAnalysisSummary`);
  `src/infrastructure/db/summaries-repository.ts:30-81`
  (`AnalysisSummaryRow`).
- Candidate row depth: `src/domain/tactics/types.ts:113-127`
  (`VerificationMetadata.verificationDepth`);
  `src/infrastructure/db/candidates-repository.ts:38-63`
  (`PuzzleCandidateRow`); `src/domain/tactics/verify.ts:497-649`
  (`verifyCandidate` writes `verificationMetadata`).
- Library/Review scan affordances:
  `src/domain/gameLibrary/rowView.ts:53-134` (`GameRowInsights`),
  `src/infrastructure/db/analysis-result-query.ts:106-154`
  (`analysisInsightsForGame`),
  `src/components/games/library/GameLibrary.tsx:1272-1324`
  (`DetectionScanAction`), `src/pages/GameReviewPage.tsx:274-305`,
  `:920-965`, `src/hooks/useGameReview.ts:40,77-106`.

## 5. Files/modules to create or modify

| Area | File | Change |
| ---- | ---- | ------ |
| Thread budget | `src/infrastructure/engine/capabilities.ts` | `MAX_THREADS_CAP=8`, `VERIFICATION_THREADS=1`, `canMultiThread`, `globalThreadBudget`, `analysisThreadCap`, `verificationThreadCap`, `verificationCapabilities`; `resolveEngineCapabilities` uses `tA` |
| Thread budget | `src/infrastructure/engine/index.ts` | export the new constants/helpers |
| Lifecycle | `src/infrastructure/engine/lazyEngineService.ts` | **new**: `VERIFICATION_ENGINE_IDLE_MS`, `createLazyEngineService` |
| Lifecycle | `src/infrastructure/engine/index.ts` | export the lazy factory/constant |
| Browser wiring | `src/infrastructure/engine/browser.ts` | memoized env; `create/getBrowserVerificationEngineService` |
| Browser wiring | `src/infrastructure/analysis/browser.ts` | shared analysis engine + verification engine + depth resolver |
| Browser wiring | `src/infrastructure/tactics/browser.ts` | verification engine + exported depth resolver |
| Settings | `src/config/app-config.ts` | `analysisTacticalDetection: 'analysis.tacticalDetection'` |
| Settings | `src/infrastructure/tactics/verificationDepth.ts` | **new**: bounds/default/clamp + `TacticalDetectionSettings` |
| Settings | `src/infrastructure/tactics/index.ts` | export the depth helpers |
| Settings UI | `src/hooks/useTacticalDetectionSettings.ts` | **new** hook (read/write/clamp) |
| Settings UI | `src/pages/SettingsPage.tsx` | "Tactical detection" row + depth control |
| Detection | `src/infrastructure/tactics/tacticalDetectionService.ts` | depth provider, cache scope, reuse/wipe by depth, `force`, summary provenance, `dispose` |
| Domain | `src/domain/analysis/summaryDerivation.ts` | `verificationDepth` in summary + options |
| DB | `src/infrastructure/db/summaries-repository.ts` | additive `verificationDepth?` |
| Service | `src/infrastructure/analysis/analysisService.ts` | `scanGame(gameId, { force })`, `startScan(..., { force })`, `dispose()` |
| Library row | `src/domain/gameLibrary/rowView.ts` | additive `verificationDepth?` insight |
| Library query | `src/infrastructure/db/analysis-result-query.ts` | carry `verificationDepth` |
| Library UI | `src/components/games/library/GameLibrary.tsx` | depth-stale "Re-scan tactics" affordance |
| Review UI | `src/pages/GameReviewPage.tsx`, `src/hooks/useGameReview.ts` | depth-stale re-scan affordance |
| Tests | see §8 | new/extended |

## 6. Domain/data changes

- **No schema bump.** `AnalysisSummaryRow.verificationDepth?: number | null`
  is additive and non-indexed; older rows read `undefined`/`null`.
- `PerAnalysisSummary.verificationDepth: number | null` and
  `BuildAnalysisSummaryOptions.verificationDepth?: number | null` are added;
  `buildAnalysisSummary` writes `options.verificationDepth ?? null`.
- No `DETECTION_VERSION` change: W2 changes no candidate rule, guard or
  threshold, so existing completed results stay current.
- `GameRowInsights.verificationDepth?: number | null` is provenance for the
  row; it is never consulted by the freshness gate or the filter predicates.
- The candidate `verificationMetadata.verificationDepth` continues to carry
  the effective depth (now user-tunable), written by `verifyCandidate` from
  the depth passed by the detection service.

## 7. UI changes

- **Settings → "Tactical detection"** row (next to "Game analysis"): a
  labelled number input for `verificationDepth`, `min=10`, `max=40`,
  immediate save, accessible description ("default 22, applies to new
  scans and explicit re-scans; existing results stay current"), test id
  `setting-tactical-verification-depth`. Stacks on tablet/mobile.
- **Library/Review re-scan trigger** (explicit depth application): when a
  detection pass is `completed` at the current `detectionVersion` but its
  recorded `verificationDepth` differs from the current setting, surface
  the existing refresh affordance as **"Re-scan tactics"** and call the
  scan entry point with `force: true`. The result stays current (no
  "out of date" note); this is only the user-triggered path.
- No other visual change: detection state notes, progress bars and
  missed-tactic rendering are unchanged.

## 8. Staged sequence with narrow gates

Each stage must end with its narrow gate green and `npx prettier --write`
over the files it touched.

### W2.1 — Global thread budget (pure)

**Goal.** `B`, `tA`, `tV`, `verificationCapabilities` as pure functions.

**Files.** `src/infrastructure/engine/capabilities.ts`,
`src/infrastructure/engine/index.ts`,
`src/infrastructure/engine/capabilities.test.ts` (new),
`src/infrastructure/engine/engineProfiles.test.ts` (update expectations).

**Changes.**

- Replace `MAX_THREADS = 2` with `MAX_THREADS_CAP = 8` and
  `VERIFICATION_THREADS = 1`.
- Add `canMultiThread(env)`, `globalThreadBudget(canMT, hc)`,
  `analysisThreadCap(B)`, `verificationThreadCap()`,
  `verificationCapabilities(caps)` (`{ ...caps, threads: 1 }`).
- `resolveEngineCapabilities` sets `threads = analysisThreadCap(B)`
  (`1` on the single-threaded build) and keeps the `build` selection.
- Update the `EngineCapabilities.threads` doc to "effective analysis-engine
  thread cap for this instance"; `resolveProfileConfig` is unchanged.
- `engineProfiles.test.ts`: the 8-core isolated case expects `threads: 7`
  (was `2`); add a 2-core case (`threads: 1`) and a 16-core case
  (`threads: 7`).

**Narrow gate.**

```
npx vitest run src/infrastructure/engine/capabilities.test.ts src/infrastructure/engine/engineProfiles.test.ts
```

### W2.2 — Lazy verification engine lifecycle

**Goal.** A dedicated `EngineService` created on first use, reused, and
idle-disposed, with its own worker/queue.

**Files.** `src/infrastructure/engine/lazyEngineService.ts` (new),
`src/infrastructure/engine/index.ts`,
`src/infrastructure/engine/lazyEngineService.test.ts` (new).

**Changes.**

- `export const VERIFICATION_ENGINE_IDLE_MS = 5 * 60_000;`
- `createLazyEngineService({ create, idleMs?, disposed? })` implementing
  `EngineService`:
  - synchronous `create` factory; inner service built on the first
    `analyze` (so no worker is created until detection actually runs);
  - delegate `analyze`/`cancel`/`cancelAll`/`getStatus`;
  - buffer `onStatusChange` listeners registered before creation and
    forward them once the inner service exists;
  - arm an idle timer whenever the inner status is idle
    (`activeJobId === null && queued === 0`); clear it on activity; on fire
    `await inner.dispose()` and drop the reference;
  - explicit `dispose()` is permanent (teardown): dispose the inner and
    make subsequent `analyze` return a failed `disposed` handle.
- Re-export the constant/factory from the engine barrel.

**Narrow gate.**

```
npx vitest run src/infrastructure/engine/lazyEngineService.test.ts
```

### W2.3 — Verification depth setting (constants + hook + UI)

**Goal.** A persisted, clamped depth setting with a Settings control.

**Files.** `src/infrastructure/tactics/verificationDepth.ts` (new),
`src/infrastructure/tactics/index.ts`, `src/config/app-config.ts`,
`src/hooks/useTacticalDetectionSettings.ts` (new),
`src/pages/SettingsPage.tsx`,
`src/infrastructure/tactics/verificationDepth.test.ts` (new),
`src/hooks/useTacticalDetectionSettings.test.tsx` (new),
`src/pages/SettingsPage.test.tsx` (extend).

**Changes.**

- `TACTICAL_VERIFICATION_DEPTH_MIN = 10`,
  `TACTICAL_VERIFICATION_DEPTH_MAX = 40`,
  `TACTICAL_VERIFICATION_DEPTH_DEFAULT = 22`,
  `clampVerificationDepth(v)`, `TacticalDetectionSettings`,
  `defaultTacticalDetectionSettings()`, `clampTacticalDetectionSettings()`.
- `SETTINGS_KEYS.analysisTacticalDetection = 'analysis.tacticalDetection'`.
- Hook mirrors `useGameAnalysisSettings`: read → clamp/fallback, `save`
  clamps before persisting.
- Settings row renders the control with `min`/`max`, a description of the
  default/bounds and immediate save.

**Narrow gate.**

```
npx vitest run src/infrastructure/tactics/verificationDepth.test.ts src/hooks/useTacticalDetectionSettings.test.tsx src/pages/SettingsPage.test.tsx
```

### W2.4 — Detection service depth + cache key + provenance + force re-scan

**Goal.** The pass uses the effective depth everywhere and an explicit
re-scan can apply a changed depth without touching freshness.

**Files.** `src/infrastructure/tactics/tacticalDetectionService.ts`,
`src/domain/analysis/summaryDerivation.ts`,
`src/infrastructure/db/summaries-repository.ts`,
`src/infrastructure/analysis/analysisService.ts`,
`src/infrastructure/tactics/tacticalDetectionService.test.ts`,
`src/domain/analysis/summaryDerivation.test.ts`,
`src/infrastructure/db/analysis-repositories.test.ts`.

**Changes.**

- Options: `verificationDepth?: number` (fixed, tests/back-compat) and
  `resolveVerificationDepth?: () => number | Promise<number>` (live).
  Resolve + clamp **once per pass**; default `22`.
- `verifyCandidateWithEngine(candidate, engineIdentity, verificationDepth,
  signal)`: cache scope and engine options both use
  `{ profile: 'tactical', maxDepth: verificationDepth,
  movetimeMs: VERIFY_MOVETIME_MS, threads: VERIFICATION_THREADS }`; remove
  the `job.config.threads` inheritance (`:317-322`). Pass the depth to
  `toVerdict` so `verifyCandidate` records it.
- `runPassForCompletedJob(..., signal?, options?: { force?: boolean })`:
  - the completed/current early-return (`:212-217`) is skipped when
    `force` is true; depth is never consulted for the **non-forced**
    early-return;
  - the stale wipe (`:230-256`) also fires when the summary's recorded
    `verificationDepth` differs from the effective depth, or when any
    stored verified row's `verificationMetadata.verificationDepth`
    differs;
  - the verified-row reuse filter (`:291-296`) only reuses rows whose
    `detectionVersion === DETECTION_VERSION` **and**
    `verificationMetadata.verificationDepth === effectiveDepth`.
- `writeSummary`/`buildAnalysisSummary` record `verificationDepth` on
  every write of a pass (provenance only; freshness still reads
  `detectionVersion` alone).
- `TacticalDetectionService.dispose()` delegates to the injected engine;
  `AnalysisService.scanGame(gameId, { force })` and `startScan(..., {
  force })` thread the flag; `AnalysisService.dispose()` disposes the
  analysis engine and the detection service.

**Narrow gate.**

```
npx vitest run src/infrastructure/tactics/tacticalDetectionService.test.ts src/domain/analysis/summaryDerivation.test.ts src/infrastructure/db/analysis-repositories.test.ts
```

### W2.5 — Browser assembly: two engines + depth provider

**Goal.** The app constructs the shared analysis engine and a lazy
verification engine, and the detection service reads the stored depth.

**Files.** `src/infrastructure/engine/browser.ts`,
`src/infrastructure/analysis/browser.ts`,
`src/infrastructure/tactics/browser.ts`.

**Changes.**

- `engine/browser.ts`: memoize the resolved browser environment
  (`capabilities`, `assets`, `baseUrl`, `scriptUrl`) so both engines share
  one manifest fetch; add `createBrowserVerificationEngineService()` /
  `getBrowserVerificationEngineService()` returning
  `createLazyEngineService({ create: () => createEngineService({
  transportFactory, capabilities: verificationCapabilities(capabilities),
  assets }) })`.
- `analysis/browser.ts`: use the shared `getBrowserEngineService()` for
  the analysis engine (so Live Analysis and full-game analysis share one
  worker/queue per ADR-034), build the verification engine, and pass
  `resolveVerificationDepth` to `TacticalDetectionService`.
- `tactics/browser.ts`: use the verification engine; export a
  `resolveStoredVerificationDepth()` helper that reads
  `SETTINGS_KEYS.analysisTacticalDetection` and clamps (shared with
  `analysis/browser.ts`).

**Narrow gate.**

```
npm run typecheck
npx vitest run src/infrastructure/engine/lazyEngineService.test.ts
```

### W2.6 — Explicit depth re-scan affordance (Library + Review)

**Goal.** Make the user-triggered path reachable.

**Files.** `src/domain/gameLibrary/rowView.ts`,
`src/infrastructure/db/analysis-result-query.ts`,
`src/components/games/library/GameLibrary.tsx`,
`src/pages/GameReviewPage.tsx`, `src/hooks/useGameReview.ts`,
plus the matching test files.

**Changes.**

- Carry `verificationDepth` into `GameRowInsights` (provenance) and into
  the Review data model.
- Read the current setting via `useTacticalDetectionSettings` on the
  Library/Review pages; when a completed/current pass's recorded depth
  differs, surface the existing refresh affordance as "Re-scan tactics"
  and call `scanGame(id, { force: true })`. Do **not** change the
  "out of date" (version) note or the freshness gate.

**Narrow gate.**

```
npx vitest run src/infrastructure/db/analysis-result-query.test.ts src/components/games/library/GameLibrary.test.tsx src/pages/GameReviewPage.test.tsx
```

(Adjust the exact component-test filenames to the ones that exist.)

### W2.7 — Full gate

- `npm run format` over touched files (prettier `printWidth: 100`).
- Run the full `verify-gate` order: `lint`, `typecheck`, `format:check`,
  `test`, `build`, `dev` smoke, `test:browser` (if Chromium), `audit`.
- Re-read `ADR-034`/`ADR-018`/`ADR-026` against the diff and confirm the
  encoding in §3; confirm no `DETECTION_VERSION`/schema bump.

## 9. Tests

Thread budget (unit):

- `resolveEngineCapabilities`: isolated 8-core → `lite`/7; 2-core → 1;
  16-core → 7 (cap); non-isolated 8-core → `lite-single`/1; isolated
  1-core → `lite-single`/1.
- `verificationCapabilities`: `threads` 1, `build`/`hashCapMb` preserved.
- Invariant `analysisThreadCap(B) + VERIFICATION_THREADS <= B` for
  `hc ∈ {1,2,4,8,16}`.

Lazy engine (unit, fake inner + fake timers):

- not created before first `analyze`; created once and reused.
- idle disposal after `VERIFICATION_ENGINE_IDLE_MS` with no active/queued
  job; re-created on the next `analyze`.
- no disposal while a job is active/queued; idle timer resets on activity.
- explicit `dispose()` disposes the inner and rejects later work.

Cache key / depth (unit):

- `analysisCacheKey` changes when `maxDepth` changes and when `threads`
  changes; stable otherwise.
- a depth-30 pass does not hit a cache entry seeded at depth 22 (and vice
  versa) for the same FEN/engine.
- `tacticalDetectionService.test.ts:705-743` is updated to seed the cache
  with the new scope (`maxDepth` + `threads`).
- a job whose `config.threads = 4` still searches with the verification
  engine's own count (1), not 4.

Freshness / provenance (unit):

- a completed summary is still returned early by a non-forced pass when
  `detectionVersion` matches, even with a different recorded
  `verificationDepth`.
- a forced re-scan at a changed depth re-derives and does not reuse
  old-depth verified rows.
- `buildAnalysisSummary` defaults `verificationDepth` to `null` and
  records an explicit value.

Settings (unit/component):

- `clampVerificationDepth` default/bounds/rounding.
- hook read/write round-trip with absent and out-of-bounds stored values.
- `SettingsPage` renders the control with `min=10`/`max=40`/default `22`
  and saves.

Wiring (unit/component):

- `analysis-result-query` carries `verificationDepth`.
- Library/Review surface "Re-scan tactics" only for a completed/current
  pass whose recorded depth differs, and the action forces the scan.
- no real engine where avoidable; use the existing fake transports /
  fake engine rigs (`src/infrastructure/engine/test-support/`,
  `src/infrastructure/analysis/test-support/fakeAnalysisEngine.ts`).

Browser (optional, when Chromium is available): verification worker is
created on demand and released after the idle window.

## 10. Migration considerations

- **None required.** `verificationDepth` is an additive, non-indexed
  summary field; absent reads as `null`. No Dexie version bump, no
  backfill, no prune.
- The detection cache key changes (adds `maxDepth`/`threads`). Existing
  rows become unreachable but are not deleted; ADR-018 treats the cache as
  derived and permits orphaned rows. No migration.
- `DETECTION_VERSION` is untouched: existing completed results stay
  current and are not re-scanned.
- Settings stored before this change are absent → default `22`, so a pass
  under default settings is byte-for-byte the same cache scope as before
  **only if** the old key omitted depth; the new key deliberately differs,
  so the first post-change detection at depth 22 re-searches positions not
  already cached under the new key. This is bounded by the cache and by
  `MAX_CANDIDATES_PER_GAME`; it is the intended "settings changed → scope
  changed" behavior.

## 11. Risks and ambiguities

1. **Re-scan reachability (main ambiguity).** `scanGame` currently returns
   `already-completed` for a current pass, so a changed depth alone has no
   trigger. W2.6 adds the explicit "Re-scan tactics" affordance. If the
   owner prefers no new UI, the service `force` path + tests still satisfy
   the encoding, but the user-triggered path would be unreachable until a
   follow-up. Recommend keeping W2.6.
2. **Shared analysis engine.** `analysis/browser.ts` currently calls
   `createBrowserEngineService()` (a fresh instance) while the live board
   uses the memoized `getBrowserEngineService()`. ADR-034 assumes one
   shared analysis engine. W2.5 aligns them; this is a small behavior
   change for the live board (it now shares the worker with game
   analysis). Flag for review; if rejected, keep the separate instance but
   still give verification its own worker.
3. **Depth-aware reuse.** Adding depth to the reuse/wipe decision is
   necessary so a resume at a changed depth cannot mix verdicts. It must
   **not** be confused with the freshness gate: only the completed/current
   early-return and the Library/Review trust logic define freshness, and
   neither consults depth.
4. **Two WASM instances.** Bounded by lazy/idle lifecycle and the ADR-012
   hash caps; on desktop a concurrent pair can be ~192 MB of hash plus WASM
   overhead. No new mitigation beyond what ADR-034 specifies.
5. **Idle timer test flakiness.** Use fake timers and an injectable
   `idleMs`; never wait the real 5 minutes.
6. **Spec/code version drift.** `domain/tactics.md` and ADR-026 describe
   `DETECTION_VERSION` 11 (W3 exclusivity), while HEAD code is `10` and the
   W3 plan is untracked. W2 must not bump the constant; the value is
   whatever W3 left. Verify before editing.
7. **Cache invalidation volume.** The new detection scope re-searches
   previously cached positions once; acceptable and bounded, but worth
   noting in the commit message.
8. **Prettier.** `.opencode` is prettier-ignored, so the plan file is not
   gated; all touched TS/TSX must be `npm run format`-clean.

## 12. Acceptance criteria

- The analysis and verification engines run in separate Workers with
  independent FIFO queues; detection no longer head-of-line blocks
  analysis.
- `MAX_THREADS_CAP = 8`; `B = canMultiThread ? max(1, min(hc, 8)) : 1`;
  verification uses 1 thread; analysis cap is `max(1, B - 1)`; `tA + tV <= B`.
- `Threads` is sent only on the multi-threaded `lite` build.
- The verification engine is created lazily on the first Stage-2 job,
  reused, disposed after `VERIFICATION_ENGINE_IDLE_MS` idle, and disposed
  on explicit teardown; it shares the ADR-018 cache and never the analysis
  worker/queue.
- `analysis.tacticalDetection` defaults to 22, clamps to 10..40, and is
  applied to fresh Stage-2 searches and to explicit re-scans; the
  stored-analysis fast path is unaffected.
- The ADR-018 detection cache key includes the effective depth, the
  verification thread count and `VERIFY_MOVETIME_MS`, so results from
  different depths are never mixed.
- A completed detection stays current while its `detectionVersion`
  matches, regardless of recorded depth; changing the depth never marks a
  result outdated and never auto-runs a scan.
- `VERIFY_MOVETIME_MS = 45_000` still bounds every verification.
- No `DETECTION_VERSION` bump; no Dexie schema bump.

## 13. Verification commands

Narrow (per stage) are listed in §8. Full gate:

```
npx prettier --write <touched files>
npm run lint
npm run typecheck
npm run format:check
npm run test
npm run build
npm run dev            # smoke: no browser-console errors
npm run test:browser   # when Chromium is available
npm audit
```

## 14. Confirmations

- Plan-only: **no code, tests, or commits** were produced; only this plan
  file was written.
- Not yet verified against a working tree beyond reading at HEAD `67d1438`.
