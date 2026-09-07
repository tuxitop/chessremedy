# Plan — Analysis & scan lifecycle: resumable scans, persistent engine UI, fast-path verification

Extends the Feature-010/008 milestone (`.opencode/plans/011-…`). Addresses the
reported UX: a game shows **`Tactics scan interrupted`** after a fresh start;
**Re-analyze can appear stuck `queued`**; there is **no way to run or resume a
scan alone**; engine activity is **not visible across navigation**; a long game
**re-searches positions it already analysed** during verification. No build in
this session — this document scopes the follow-up work and the decisions to
confirm.

Depends on shipped Features 001–010 and the 011 milestone. Nothing here adds a
runtime dependency.

---

## 0. Findings that drive this plan (from code + browser repro)

- **"Interrupted" on a fresh start is a stale DB row.** A scan has no live
  process after the tab/session that scheduled it is gone; the persisted
  per-analysis summary is left `queued`/`inProgress` with no owner. Today the
  only remedy is a full Re-analyze (the pass itself is resumable/idempotent and
  ADR-018-cache aware — nothing re-runs it).
- **Orphaned work is never reconciled.** `queued`/`inProgress` *analysis* jobs
  and detection summaries with no live owner are neither finished nor removed.
  Nothing auto-resumes them and nothing clearly offers a resume.
- **Analysis and verification share one engine FIFO** and a scan starts as soon
  as its game's analysis completes (detached), interleaving with the rest of a
  batch and with later Re-analyze requests. Long scans can therefore make a new
  Re-analyze appear "queued forever" with nothing visibly running.
- **Verification re-searches already-analysed positions.** Every candidate's
  `startingFen` is a game position that was already searched (`MoveAnalysis`
  stores `bestMove`/`bestPv`/eval for it). The `tactical`-profile re-search
  exists to get deeper MultiPV + WDL for the forcing/alternative-move guards.
- **Navigation does not cancel a running scan in code** (no engine `cancelAll`
  / dispose on route change; detection has no abort signal). The scan is killed
  by the session ending (close/reload/throttle). UI does not show engine
  activity, so users can't tell a scan is still finishing after they navigate.

## 1. Objective

1. **Interrupted scans are resumable** — an explicit, cheap **Resume / Run
   tactics scan** action (Library row + Review) that runs only the detection
   pass for the latest completed analysis, reusing ADR-018 cache + already
   verified candidates. No full re-analysis.
2. **Orphaned work is reconciled**: on load, owner-less `queued`/`inProgress`
   analysis jobs are resumed once; owner-less detection summaries read
   **"paused"** and are resumable. Re-analyze cancels/drops the ghost pass of
   the same game instead of leaving it ahead in the FIFO, and a queued engine
   job cannot sit silently forever (watchdog/max-lifetime).
3. **Engine activity is visible and persistent across navigation** — the
   Library progress bar/progress info survive a page change and return, and
   **Game Review shows an in-progress indicator (with Cancel)** when the viewed
   game is being analysed or scanned. A run state indicator + engine-queue
   depth explain a "queued" row.
4. **Fast-path verification**: confirm many missed tactics from the game's own
   stored analysis (decisive stored best-line) with no engine run; search only
   ambiguous/forced-material cases. Drastically shrinks long-game scan time.
5. Interruption handling: before an action/session-end that would abandon a
   scan, warn and offer **pause & resume later** (already supported by the
   resumable model) vs **keep scanning**.

## 2. Scope

### In scope
- Domain/service: resumable scan API (`runDetectionForAnalysis(id)` /
  equivalent) + orphan reconciliation on the shared `AnalysisService`; ghost
  pass cancellation on forced re-analysis; engine queue watchdog.
- UI: standalone scan action + "paused" state wording; persistent engine-activity
  indicator (Library) and Review analysing/scanning banner with Cancel.
- Verification fast path: reuse stored decisive analysis before the tactical
  search (thresholds/depth floor), engine fallback for ambiguous cases.
- Spec/plan updates (ADR-026 verification fast path, Feature-008 §5/§12/§21,
  Feature-010 detection-state/affordances), tests, commits.
- This document.

### Out of scope
- Feature 011/014 work; per-puzzle scheduling (ADR-031); adding a second engine
  provider; parallel/multi-worker engines (ADR-012 default stays single-worker).
- "Analyze only the user's side" (Q1, rejected — search set is identical).

## 3. Work packages (dependency order)

### WP-A — Resumable scans + orphan reconciliation
- `AnalysisService`/`TacticalDetectionService`: expose a **run-a-scan-only**
  entry point for the latest completed job of a game (loads job/game/records,
  runs the pass detached; idempotent + resumable like today). Library row and
  Review offer **Resume tactics scan** when detection state is
  `queued`/`inProgress`/`failed`/`absent` (label "paused/interrupted/failed/
  not scanned" respectively). Replaces "re-analyze to retry".
- On shared-service creation / Library mount: reconcile owner-less persisted
  analysis jobs (`queued`/`inProgress`) by resuming them once (they are
  resumable); reconcile owner-less detection summaries by relabelling them
  resumable-paused (never silently "in progress").
- Forced re-analysis of a game whose old pass is live/queued: cancel the old
  pass's engine jobs + drop its summary/candidates cleanly (no ghost work ahead
  in the FIFO).

### WP-B — Persistent engine activity UI
- Library: a persistent engine-activity strip/banner (not just "row queued"):
  whole-queue view incl. **detection work**, per-row position progress, engine
  queue depth, "waiting for engine" explanation; survives navigation (derived
  from persisted jobs + live registry) and reappears when you return.
- Review: when the viewed game's analysis **or scan** is running, show an
  in-progress banner (progress + current profile + detection note) **with
  Cancel**; Review already reloads on activity.
- Cancel semantics consistent everywhere; queued requests clear.

### WP-C — Fast-path verification (efficiency)
- Before the `tactical` engine search for a candidate, consult the game's own
  stored analysis for `candidate.startingFen` (same engine, depth ≥ floor,
  decisive verdict): if the stored best-line reaches a **forcing mate** within
  `MAX_TACTIC_PLIES` (walk checkmate, forcing plies), verify without an engine
  run (mate is deterministic; WDL/alternative guard not needed). Engine fallback
  for material/`decisive_advantage`/ambiguous objectives (they need MultiPV +
  WDL). Config via documented constants; bump `DETECTION_VERSION`/ADR-026 only
  through the documented process.
- Evidence to capture: candidate counts and engine-time saved on long games.

### WP-D — Interruption warnings & lifecycle guards
- When a scan is live: warn on close/reload (`beforeunload`/`pagehide`) and on
  actions that would abandon it; offer **pause & resume later** (state is
  resumable) vs keep scanning.
- Engine-queue watchdog: max lifetime for a queued engine job + fail/resume
  path so "queued" is never permanent.

## 4. Existing code to reuse
- `infrastructure/tactics/tacticalDetectionService.ts` (`runPassForCompletedJob`,
  resumable + cache-aware, `ensureSummariesForRows`), `infrastructure/analysis/
  analysisService.ts` (run serialization, `activeDetections` live registry,
  `runDetection`), `hooks/useGameReview.ts` + `useGameAnalysis.ts`,
  `useLibraryAnalysis.ts` queue, GameLibrary row states, ADR-018 cache,
  `MoveAnalysis.bestMove/bestPv`, `domain/tactics/verify.ts`
  (`verifyCandidate`, `MAX_TACTIC_PLIES`, walk helpers), engine FIFO.

## 5. Decisions to confirm before implementation
1. Resume trigger model: **on-demand only** (row/Review button) vs also
   **auto-resume one interrupted analysis job at Library load** (recommended for
   analysis jobs; detection stays on-demand to avoid surprise engine time).
2. Where the scan-only entry point lives and its abort model (share the engine
   FIFO at low priority? see WP-A ghost-cancel).
3. Fast-path thresholds (stored-depth floor, decisive-eval definition) and
   whether it changes ADR-026 semantics (only additive fast path is preferred).
4. Review in-progress banner scope: analysis jobs only, or also the detached
   scan (recommended: both, so a scanning game is never silent).

## 6. Tests
- Service: orphaned `inProgress` analysis job resumed once on reconcile;
  orphaned detection summary resumable via scan-only call; re-analyze drops a
  live/queued ghost pass (no FIFO residue); queued engine job watchdog.
- Component/e2e: Library Resume-scan action flips interrupted→scanning→count;
  persistent progress across navigation; Review analysing banner + Cancel;
  Review scan banner; fast-path verifies a decisive stored mate with no engine
  call (fake engine asserts zero tactical searches) while fallback still runs.
- Reproduce the reported stuck case (seeded stale state + real engine, dev
  server) as a regression.

## 7. Verification commands
Per `AGENTS.md` Execution policy (`npm run lint/typecheck/format:check/test/
build`, `npm run dev` smoke, `npm run test:browser`, `npm audit`).

## 8. Commit plan (when built)
One commit per WP in dependency order (WP-A → WP-B → WP-C → WP-D), conventional
style; spec/ADR updates folded into the WP that changes the contract.

## 9. Engine performance research (threads / cross-origin isolation)

Investigated: why engine threads cap at 2, and what affects analysis speed.

- **Builds shipped** (ADR-012, `scripts/copy-stockfish-assets.mjs`,
  `public/stockfish/meta.json`): `lite-single` (~7 MB, single-threaded, no
  SharedArrayBuffer — default) and `lite` (~7 MB, pthreads). The full ~113 MB
  multi build (`stockfish-18.wasm`) exists in the npm package but is
  deliberately not shipped.
- **Why 2 is the ceiling**: `capabilities.ts` selects `lite` (multi-threaded)
  only when `crossOriginIsolated && SharedArrayBuffer && hardwareConcurrency >
  1`, then requests `threads = min(MAX_THREADS=2, hardwareConcurrency)`. Both
  `vite server` and `preview` already send `COOP/COEP` headers
  (`vite.config.ts`), so on localhost the multi build is used and the app-side
  cap of **2** is what you observe. Without COI you would get `lite-single`
  (1 thread).
- **Can we use more CPU threads?** Yes — it is an app-side decision, not an
  engine limit: raise `MAX_THREADS` (e.g. `min(4, hardwareConcurrency)`) under
  cross-origin isolation. Caveats: WASM pthread scaling on this build has
  diminishing returns past ~2–4 and higher thread counts cost memory; requires
  an ADR-012 revision; the threads override is currently plumbed only for the
  **live** engine (engine settings / per-job override on `lite`), while
  game-analysis + detection jobs carry no threads override yet (only
  profile/depth/movetime).
- **Other speed levers** (existing, user-adjustable): game-analysis profile
  (fast/normal/deep = ADR-012 depth), depth override and per-position
  `searchSeconds` (biggest controllable cap); live board depth / search time /
  MultiPV lines (fewer lines = faster) / hash / threads. Implicit costs:
  MultiPV (detection `tactical` uses 5 lines) and hash allocation. The dominant
  cost is positions × per-search time, so WP-C (fast-path verification) and
  adaptive/contextual depth are the main efficiency wins; thread count is
  secondary in WASM.

Open decision: whether to raise the thread cap (needs ADR-012) and whether
game-analysis/detection should expose a threads override.
