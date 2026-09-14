# Feature 020 — Individual Review Scheduling

> **Status: post-V1, specification complete; implementation is gated.**
> Not implementable until the ADR it needs is accepted. This feature
> reintroduces a **per-puzzle spaced-repetition scheduler** (the
> `Individual Scheduler` branch sketched in `ARCHITECTURE.md` §12 and
> explicitly anticipated by ADR-031 / `domain/tactical-training.md`
> §"Future scheduling"). That requires:
>
> 1. a new ADR that introduces the individual-scheduler strategy,
>    amends ADR-031's **V1-only** prohibition for the post-V1 era, and
>    adopts the scheduler library (see "Conflicts, ambiguities & ADR
>    assessment"); and
> 2. the scheduler dependency, accepted under the `AGENTS.md` Dependency
>    policy (license + latest-stable).
>
> ADR-031 remains fully in force for V1: cycle training is unchanged, and
> this feature adds a **second** strategy beside it. See "Conflicts,
> ambiguities & ADR assessment" for the required ADR content.

## Purpose

Cycle training (Features 012/013) deliberately does **not** schedule
puzzles individually (ADR-031): the user trains a fixed set repeatedly and
mastery is derived from cycle history. That model is excellent for
pattern-recognition drilling but has no notion of "this specific puzzle is
about to be forgotten".

This feature adds the second training strategy the architecture already
reserves: **individual review scheduling**. A per-puzzle spaced-repetition
scheduler turns the user's immutable attempt history into a due queue, so
puzzles resurface shortly before they are forgotten. It gives the user:

- a **Review** entry with a due count, new-puzzle count, retention and
  next-due summary;
- a **Review session** that reuses the existing solving experience and
  session host; and
- a per-puzzle **schedule** that is a **derived, rebuildable projection**
  of attempt history — never authoritative, never written onto the
  immutable `Puzzle`, and never synced.

The design keeps ADR-031's V1 guarantees intact: `Puzzle` stays immutable
and scheduling-free, `PuzzleAttemptRow` stays the immutable event log, and
dropping the derived schedule table loses no user data (attempts remain and
the projection is rebuilt).

## Scope

### In scope

1. A pure domain **`Scheduler` interface** and an adapter over the chosen
   FSRS-style scheduler library (the ADR selects the library; research
   recommends `ts-fsrs`).
2. A deterministic, versioned **grade mapping** from
   `TrainingResult` (+ presentation counters and solving latency) to the
   scheduler's rating vocabulary (`again` / `hard` / `good` / `easy`).
3. Pure schedule derivation: `scheduleFromHistory(attempts)` (full rebuild)
   and `applyGrade(state, grade, at)` (incremental).
4. A derived **`puzzleSchedules` projection table** (additive Dexie schema
   **v13**), keyed by `puzzleId`, indexed by `dueAt`, stamped with a
   `scheduleVersion` for lazy rebuild. It is a cache (ADR-018 pattern):
   droppable and rebuildable.
5. A deterministic **due-queue builder**: due reviews plus new-puzzle
   intake, bounded by per-local-day caps, reusing the canonical pool
   derivation for intake.
6. A **Review training mode** that reuses the Feature-013 cycle-session
   host (`useCycleSession`), the Feature-012 `SolveScreen`, and the
   Feature-019 session timer/summary. No second solving implementation.
7. A review-session **summary** and a review **entry card** surfacing
   retention, next due, due/new counts and graduated/mature counts.
8. **Settings** for the daily new/review caps, stored in the existing
   settings table (no schema change to `settings`).
9. Deletion-cascade, sync-exclusion and lazy-rebuild rules for the derived
   projection.
10. Deterministic domain/component tests and fixtures; the full gate.

### Out of scope

- Opening repertoires and opening training (Features 021–028).
- **Per-user FSRS parameter optimization** (the WASM optimizer); defaults
  are used, and the projection stores the parameter-set version.
- Any change to **cycle training, cycle metrics, mastery, hints, retry or
  completion semantics** (ADR-031 stays untouched for cycle training).
- Syncing the derived `puzzleSchedules` rows (excluded exactly like the
  ADR-018 engine cache).
- Any new **event** table: review presentations write ordinary
  `puzzleAttempts` rows.
- Writing scheduling state onto the immutable `Puzzle` (forbidden by
  ADR-031/`domain/puzzle-model.md`).
- Automatic set/block creation, and any change to the Woodpecker block or
  pool semantics.
- Review history/statistics beyond the session summary and entry card
  (a future feature may extend Feature 014 to review analytics).

## User-facing behavior

### 1. Review entry & due summary

- The Training home exposes a **Review** card (and the Home page may
  surface the same summary as a continue action) showing:
  - **Due now** — the number of scheduled puzzles with `dueAt <= now`
    (capped for display by the daily review cap, with the true backlog
    count shown as text);
  - **New** — the number of unscheduled intake puzzles available today
    under the daily new cap;
  - **Retention** — the average current retrievability over the scheduled
    puzzles loaded for the card (see Performance), or an explicit
    **insufficient data / empty** state — never a fabricated `0`;
  - **Next due** — the earliest future `dueAt`, as a relative time, or an
    explicit "new puzzles available" / "nothing scheduled" state.
- When there is nothing due and no new intake, the card shows an explicit
  **"All caught up"** empty state, not a zero.
- **Start review** is a real labelled control, reachable by keyboard and
  touch; it is disabled with an explanatory text when the queue is empty.

### 2. Review session setup

- Before the first puzzle the review session shows a compact setup panel:
  - the due-review and new-puzzle counts that will be presented this
    session (after caps);
  - the daily caps in force and a link to Settings;
  - the Feature-019 **session length** choice (reusing
    `SessionSetup` / the default session length setting);
  - **Start** and **Cancel** controls.
- Starting the session snapshots the queue. The queue is **fixed for the
  session** (like a cycle snapshot): a puzzle graded `again` is scheduled
  but is **not** re-presented within the same session; it is picked up by
  the next session if it is due again.

### 3. Review session

- The solving experience is the existing Feature-012 `SolveScreen`
  (board, hints, skip, restart) hosted by the Feature-013 session host and
  wrapped by the Feature-019 session timer / End session.
- The session chrome shows `Puzzle X of Y`, the countdown (when timed),
  the retention/next-due hint for the just-solved puzzle, and an
  **End session** control.
- **Skip** writes a `skipped` attempt row (the immutable event log) but
  applies **no grade**; the puzzle remains due.
- **Discard** (leaving / expiry) writes no row and applies no grade
  (Feature-012 discard-on-leave rule).
- After each definite outcome the schedule is updated immediately (see 4);
  a schedule-write failure keeps the outcome visible with the existing
  inline retry and never loses the attempt row.
- The review queue is presented once per puzzle per session; there is no
  intra-session retry pass (review sessions use `retryFailed: 'none'`).

### 4. Grading & schedule update

- At each definite outcome the app derives a grade (see Domain behavior)
  and applies it to that puzzle's schedule projection:
  - `solvedFirstTry` + fast + clean → `easy`;
  - `solvedFirstTry` otherwise → `good`;
  - `solvedWithHelp` → `hard`;
  - `failed` → `again`;
  - `skipped` / discarded → **no grade**.
- The UI surfaces the outcome as text (e.g. "Next review in 4 days") with
  a polite live-region announcement; it is never colour-only.
- The grade is applied from the same `now` used to stamp the attempt row,
  so the schedule and the event log cannot disagree about ordering.

### 5. Review session summary

- At session end (timer expiry, End session, or queue exhaustion) an
  ephemeral summary is shown, derived from the review session's attempt
  rows (the Feature-019 window: same review `cycleId`,
  `endedAt >= sessionStart`):
  - solved first-try / solved-with-help / failed / skipped counts;
  - first-try accuracy, time used, average time per puzzle;
  - **retention** and **next due** after the session;
  - how many puzzles were **introduced** (first-ever schedule) and how
    many remain **due** for the next session.
- Actions: **Review again** (start the next session when anything is due)
  and **Back to training**. The summary reuses the canonical
  Feature-013/014 metric resolution over the session's row subset; Feature
  020 defines no new accuracy denominator.

### 6. Settings

Stored in the existing settings table; **no schema change**.

| Setting label          | Key (`SETTINGS_KEYS`)         | Type    | Default |
| ---------------------- | ----------------------------- | ------- | ------- |
| Daily new-puzzle cap   | `review.dailyNewCap` (new)    | integer | `20`    |
| Daily review cap       | `review.dailyReviewCap` (new) | integer | `100`   |

- Both are non-negative integers; `0` is valid and pauses that category.
- An invalid or missing stored value falls back to the default; a value
  above a documented safety maximum is clamped (see Performance).
- Caps reset on the **local calendar day** (`dayKey(now)`), matching the
  existing local-day spacing nudge semantics.
- Changes save immediately, consistent with the other Settings rows.

## Domain behavior

All of the following is **pure, deterministic domain code** — no React,
Dexie, engine, network or hidden clock. The scheduler adapter is the only
place the library is touched, behind the `Scheduler` interface.

### Scheduler abstraction

```text
Scheduler (domain interface, pure)
  initialState(now): ScheduleState
  preview(state, now): Record<Grade, ScheduleState>   // optional, for UI hints
  next(state, grade, now): ScheduleState
  retrievability(state, now): number                  // recall probability
```

- `Grade = 'again' | 'hard' | 'good' | 'easy'`.
- `ScheduleState` is a **serializable** value (timestamps as epoch millis,
  no `Date` instances) so it can be stored in Dexie and passed across the
  worker/UI boundary without conversion leaks.
- The adapter maps `ScheduleState` ⇄ the library's card type and is the
  only module that imports the scheduler library. `ts-fsrs` is the
  research recommendation (MIT, zero runtime dependencies,
  browser-compatible, storage-agnostic); the ADR selects the library and
  the Dependency policy fixes the version.
- The scheduler is **swappable**: replacing the adapter must not require
  changing the projection schema, the grade mapping or the review UI.

### Grade mapping

- Versioned by `GRADE_MAPPING_VERSION`. Deterministic from the immutable
  attempt fields and an injected latency.
- `failed` → `again`; `solvedWithHelp` → `hard`.
- `solvedFirstTry` → `easy` when the presentation was clean
  (`hintCount === 0`, `wrongMoveCount === 0`, `restartCount === 0`) and
  `solvingTimeMs <= EASY_SOLVE_MS` (`EASY_SOLVE_MS = 10_000`); otherwise
  `good`.
- Defensive: a `solvedFirstTry` row carrying any hint/wrong-move/restart
  counter is downgraded to `hard` (mirrors the mastery legitimacy rule).
- `skipped` (and a discarded presentation) produces **no grade**.
- Latency only modulates the `solvedFirstTry` case; it never upgrades a
  helped or failed outcome.

### Schedule projection

- `scheduleFromHistory(attempts)` folds a puzzle's **gradeable** attempts
  (`result !== 'skipped'`) in chronological order (by `endedAt`, then
  `presentationIndex`) from `initialState` through `next`, producing the
  puzzle's `ScheduleState`; a puzzle with no gradeable attempt has **no**
  schedule row (it stays new/due).
- `applyGrade(state, grade, now)` is the incremental path used at solve
  time; it must equal the corresponding fold step.
- The schedule is **global per puzzle** (across all sets/cycles), exactly
  like mastery.
- The schedule is a **derived projection**: it may be dropped at any time
  and rebuilt from `puzzleAttempts`. It is never authoritative and never
  mutates a `Puzzle` or an attempt row.
- A stored row whose `scheduleVersion` or `schedulerParamsVersion` differs
  from the current constants is **stale** and rebuilt lazily from history.

### Due queue

- `dueQueue({ schedules, puzzles, now, caps, dayUsage })` returns the
  ordered review-session snapshot:
  1. **due reviews** — scheduled puzzles with `dueAt <= now`, ordered by
     `dueAt` ascending, ties by difficulty ascending then `puzzleId`,
     capped by the remaining daily review allowance;
  2. **new intake** — puzzles with no schedule row, drawn from the
     canonical `derivePool` (unmastered, not in the open block) in
     `difficultyAsc` order (ties by `sourcePly` then `puzzleId`), capped by
     the remaining daily new allowance.
- `dayUsage` is derived at read time from the current local day's review
  sessions (the review-sentinel cycles started today and their attempt
  rows): a puzzle presented today counts as **new** when it had no schedule
  row before that session, otherwise as a **review**. No extra table.
- A due review that later becomes mastered is **still reviewed**; mastery
  affects only new intake (via `derivePool`).
- `dayKey(now)` is the local calendar day (Feature 013/019 semantics).

### Mastery & training-strategy separation

- Review sessions run under a reserved sentinel `REVIEW_SET_ID`
  (`'__review__'`), distinct from `QUICK_TRAIN_SET_ID`, with **no**
  `trainingSets` row (the Quick-train pattern).
- Review-sentinel cycles are **excluded from mastery** exactly like
  Quick-train cycles: `masteryOf` / `masteredPuzzleIds` must not credit
  review cycles, so the V1 mastery semantics are unchanged.
- Review attempts are **excluded from cycle/set statistics** (Feature 014)
  for this feature; review has its own session summary and entry card. A
  future feature may opt review analytics into Feature 014 explicitly.
- Cycle training remains the only path that produces mastery; individual
  scheduling and mastery are independent read models over the same
  immutable attempt log.

## Data requirements

### New derived table (schema v13)

`puzzleSchedules` — additive Dexie store, keyPath `puzzleId`, index
`dueAt`:

| Field                   | Type                                                        | Notes                                     |
| ----------------------- | ----------------------------------------------------------- | ----------------------------------------- |
| `puzzleId`              | string                                                      | primary key                               |
| `dueAt`                 | number                                                      | epoch millis, **indexed** (due query)     |
| `lastReviewedAt`        | number \| null                                              | epoch millis of the last grade            |
| `state`                 | `'learning' \| 'review' \| 'relearning'`                    | library state, normalized                 |
| `stability`             | number                                                      | library value                             |
| `difficulty`            | number                                                      | library value (not the ADR-025 score)     |
| `elapsedDays`           | number                                                      | library value                             |
| `scheduledDays`         | number                                                      | library value                             |
| `reps`                  | number                                                      | library value                             |
| `lapses`                | number                                                      | library value                             |
| `learningStep`          | number                                                      | library step index                        |
| `lastGrade`             | `Grade \| null`                                             | last applied grade                        |
| `scheduleVersion`       | number                                                      | projection/grade-mapping semantics        |
| `schedulerParamsVersion`| number                                                      | FSRS parameter-set version                |
| `updatedAt`             | number                                                      | merge/last-write timestamp (schema-v12 convention) |

- `PERSISTENCE_SCHEMA_VERSION` becomes **13**; a new `v13.ts` migration
  creates the store (additive, no data backfill). `database.ts` and the
  version-guard test are updated.
- The table is **not authoritative** and is **never synced** (ADR-016
  envelope exclusion, like the ADR-018 engine cache). On a new device it
  is rebuilt from the synced `puzzleAttempts`.
- **Deletion cascade:** schedule rows are owned by their puzzle; the game
  deletion cascade (`deleteGames`) removes `puzzleSchedules` rows by
  `puzzleId`, exactly like `puzzleAttempts`. No orphan rows may remain.
- A **reconcile** drops schedule rows whose puzzle no longer exists and
  rebuilds rows that are missing/stale. It is bounded, idempotent and may
  run lazily (on review use) or as a batched startup step with progress;
  it never blocks the UI.

### Settings

- Two new `SETTINGS_KEYS` entries (`review.dailyNewCap`,
  `review.dailyReviewCap`); stored in the existing `settings` store, no
  schema change.

### No new event data

- Review presentations write ordinary `puzzleAttempts` rows under the
  review-sentinel `cycleId`; the attempt natural key
  `[cycleId, puzzleId, presentationIndex]` is satisfied and the write path
  is the existing first-write-wins recorder.

## States

- **Schedule**: absent/new; learning; review; relearning; due
  (`dueAt <= now`); not-due; stale (`scheduleVersion` mismatch); orphaned
  (puzzle gone → removed).
- **Review entry**: loading; due+new available; only new; only due; empty
  ("All caught up"); insufficient retention data.
- **Review session**: setup; active; timer warning; expired; ended early
  (summary); queue exhausted (summary); error.
- **Grade application**: applied; no-grade (skipped/discarded);
  schedule-write pending; schedule-write failed (inline retry, attempt row
  preserved).
- **Rebuild**: fresh; missing row; stale version; rebuilding; rebuild
  failed (puzzle treated as unscheduled, non-blocking notice).
- **Caps**: under cap; at cap; cap `0` (category paused); invalid stored
  value (default).
- **Settings**: unset (defaults); valid; invalid/clamped.

## Error cases

The feature must never crash, fabricate data or block a session:

- **Scheduler library throws** on a persisted/invalid state → fall back to
  a full `scheduleFromHistory` rebuild; if that also fails, treat the
  puzzle as unscheduled and show a non-blocking notice. Never crash the
  session.
- **Schedule-write failure** → the attempt row is already persisted (the
  source of truth); show the existing inline retry and rebuild the
  projection on the next reconcile.
- **Missing/corrupt/stale schedule row** → rebuild from history; never
  trust a partially written row.
- **Puzzle deleted while queued** → drop it from the queue (the session
  host's `missingPuzzleIds` path); never present an orphan.
- **No due and no new** → explicit empty state, never a fabricated `0` or
  a zero-length session that starts.
- **Invalid cap setting** → fall back to the default / clamp; never a
  negative, `NaN` or unbounded cap.
- **Attempt-write pending at outcome** → the Feature-012 failure handling
  keeps the outcome visible with inline retry; no grade is applied until
  the row is durably written.
- **Clock moved backwards / backwards `dueAt`** → elapsed/retrievability
  calculations clamp to `0`; the puzzle is simply not due until its
  `dueAt`.
- **Two tabs review concurrently** → schedule rows are last-write-wins
  (the schema-v12 `updatedAt` convention) and the projection is
  rebuildable; attempt rows stay first-write-wins and immutable.
- **`again` sets a near-term due date** → the queue is a fixed session
  snapshot, so there is no infinite intra-session loop; the puzzle appears
  in the next session when due.
- **Rebuild over a very large history** → batched, resumable and
  non-blocking; a partial rebuild never surfaces a wrong due date (the
  puzzle stays pending until rebuilt).

## Edge cases

- **All puzzles mastered** → new intake is empty; already-scheduled
  puzzles are still reviewed (mastery does not unschedule).
- **Puzzle in the open Woodpecker block** → excluded from new intake (via
  `derivePool`) but still reviewed if already scheduled.
- **Same puzzle graded twice in one local day** → counts once toward the
  day's cap usage; each grade is a real schedule update.
- **Caps reached mid-queue** → the session contains only the puzzles that
  fit; the summary reports the remaining backlog.
- **Cap `0`** → that category is paused; the other category still runs.
- **First review of a brand-new library** → all intake, no reviews; the
  entry card shows "new puzzles available".
- **Puzzle scheduled far in the future** → not due; next-due reflects it.
- **Large due backlog** → the daily cap bounds the session; the true
  backlog is shown as text.
- **Skip-only session** → all result counts can be zero except `skipped`;
  rates are `empty`, not `0`.
- **A review cycle's puzzle row is deleted mid-session** → dropped via the
  missing-puzzle path; the session continues.
- **Game deletion removes a scheduled puzzle** → schedule row cascades;
  no stale due entry.
- **Cycle training and review on the same day** → independent; cycle
  metrics/mastery are untouched by review attempts.
- **A stale projection after an engine/grade-mapping upgrade** → lazily
  rebuilt from history; the user's data is never re-interpreted as a
  puzzle change.

## Accessibility requirements

- The review entry card, due/new counts, retention and next-due values are
  **text**, with accessible labels; counts are never conveyed by colour
  alone.
- The empty/insufficient-data states are explicit words ("All caught up",
  "Not enough data yet"), never a bare `0`.
- **Start review**, **End session**, **Review again** and **Back to
  training** are real labelled controls, keyboard- and touch-reachable,
  never hover-only or shortcut-only.
- The post-outcome next-review text is announced **politely**
  (`aria-live="polite"`), not per render; the session timer reuses the
  Feature-019 accessible timer (`role="timer"`, text state).
- The session setup panel is a labelled control group; caps and counts are
  read as text.
- `prefers-reduced-motion: reduce` disables any animation; the board and
  move list keep the existing accessible behaviour.

## Responsive / mobile requirements

- The review card and session setup stack on small viewports; all actions
  are touch-operable with targets ≥ ~44 px.
- The session chrome stays reachable without scrolling past the board,
  reusing the Feature-019 layout rules.
- The summary stacks on mobile; counts, rates and next-due are legible in
  both light and dark themes.
- No horizontal scroll from long counts or relative times; values wrap.

## Performance constraints

- **No engine, no network.** Review scheduling is pure arithmetic over
  already-loaded rows.
- The due query is **one indexed read** over `puzzleSchedules.dueAt`
  (`<= now`, ascending), bounded by the daily review cap — never a full
  table scan.
- New intake is drawn from the existing canonical pool derivation; the
  review queue is bounded by the caps.
- A schedule update is **O(1)** per outcome; the app never rebuilds the
  whole projection per outcome.
- Rebuild is **lazy and batched** (per puzzle on miss/stale, plus an
  optional bounded reconcile); it is pure math and must not block the UI
  for a large history. A rebuild pass may be chunked and resumable.
- Retention on the entry card is computed over the bounded set already
  loaded for the card (due queue + recently reviewed), never over the
  entire schedule table.
- Caps have a documented safety maximum; an excessive stored value is
  clamped so a session can never become unbounded.
- Bundle impact is limited to the scheduler library and the review UI; the
  library is small, tree-shakeable and ADR-approved.

## Acceptance criteria

1. A pure domain `Scheduler` interface exists with a single adapter that
   isolates the scheduler library; no React/Dexie/engine/network import
   leaks into the domain, and the adapter is swappable without schema or
   UI changes.
2. Grade mapping is deterministic and versioned: `failed → again`,
   `solvedWithHelp → hard`, clean fast `solvedFirstTry → easy`, other
   `solvedFirstTry → good`, skipped/discarded → no grade; a solvedFirstTry
   with counters is downgraded to `hard`.
3. A derived `puzzleSchedules` table (schema **v13**) keyed by `puzzleId`
   with a `dueAt` index is created; `PERSISTENCE_SCHEMA_VERSION` is 13 and
   the migration is additive.
4. `scheduleFromHistory` and `applyGrade` are pure and agree; a schedule
   can be dropped and rebuilt from `puzzleAttempts` with no data loss.
5. Stale (`scheduleVersion` / `schedulerParamsVersion`), missing or
   corrupt schedule rows are rebuilt lazily; a rebuild failure never
   crashes a session.
6. The due-queue builder returns due reviews (ordered by `dueAt`, ties by
   difficulty then id) then new intake from `derivePool` (difficulty
   ascending), each bounded by the per-local-day caps; caps reset on the
   local calendar day and cap usage is derived without a new table.
7. Review mode reuses the Feature-013 session host, the Feature-012
   `SolveScreen` and the Feature-019 session timer/summary; each queued
   puzzle is presented once per session and there is no intra-session
   retry.
8. Each definite review outcome writes one ordinary immutable
   `puzzleAttempts` row and applies one grade; skipped and discarded
   presentations apply no grade, and a discard writes no row.
9. Review-sentinel cycles are excluded from mastery and cycle/set
   statistics; cycle training, metrics, mastery, hints, retry and
   completion are otherwise unchanged.
10. The review session summary reports solved-first-try / solved-with-help
    / failed / skipped counts, first-try accuracy, time used, average time,
    retention, next due, introduced count and remaining due count, using
    the canonical metric resolution.
11. The Training home review card shows due/new counts, retention and next
    due with explicit empty/insufficient-data states, and **Start review**
    is a real control that is disabled with an explanation when empty.
12. Two settings (`review.dailyNewCap` default 20, `review.dailyReviewCap`
    default 100) exist with validation, `0`-allowed semantics and
    fallback/clamping; `settings` has no schema change.
13. Schedule rows cascade-delete with their source game and are excluded
    from sync; a new device rebuilds them from attempt history.
14. Accessibility and responsive requirements are met; the scheduler
    dependency is accepted under the Dependency policy and the feature's
    ADR is accepted before implementation.
15. All changes are covered by automated tests and the full gate passes.

## Testing requirements

### Focused tests first

- **Scheduler adapter**: `initialState`/`next`/`preview`/`retrievability`
  determinism with an injected `now`; serializable `ScheduleState`
  round-trip (no `Date` leakage).
- **Grade mapping**: every `TrainingResult` and the latency/counter
  branches, including the defensive downgrade and the no-grade cases;
  `GRADE_MAPPING_VERSION` behaviour.
- **Derivation**: `scheduleFromHistory` fold vs. incremental
  `applyGrade` equality on deterministic attempt-row fixtures; a
  skipped-only puzzle yields no schedule row; chronological ordering.
- **Due queue**: due ordering and ties; new intake from `derivePool`;
  mastery/open-block exclusion for intake; cap application; local-day
  reset; cap `0`; empty queue; backlog count.
- **Projection lifecycle**: stale `scheduleVersion` rebuild; missing row
  rebuild; corrupt row fallback; reconcile drops orphan rows; cascade
  deletion by `puzzleId`.
- **Review host integration**: the review-sentinel cycle snapshot, no
  retry, skip/discard, completion, mastery exclusion, and the summary
  window (`endedAt >= sessionStart`).
- **Settings**: key/value round-trip, defaults, clamping and invalid
  values.

### Accessibility / responsive

- Review card labels and text states; `Start review` / `End session` /
  summary actions keyboard- and touch-reachable; next-review text in a
  polite live region; reduced motion; mobile card/setup/summary layout
  (Playwright where Chromium is available).

### Deterministic fixtures

- Extend the existing Feature-012/013 attempt/cycle fixtures with
  review-session scenarios (all-new, all-due, mixed, skip-only, cap-hit,
  backlog, stale projection, cascade). No engine, network or real
  IndexedDB is required for domain tests; the scheduler adapter may use
  the library with an injected clock.

### Narrow-first order

Run the focused domain/adapter/component tests first, then the full gate
(`npm run lint`, `typecheck`, `format:check`, `test`, `build`, `dev`,
`test:browser` when Chromium is available, `npm audit`) per `AGENTS.md`.

## Dependencies

- Feature 011 — immutable `Puzzle` rows and `puzzleIdOf`.
- Feature 012 — immutable `PuzzleAttemptRow`, the recorder, and the
  `SolveScreen` / solve interaction.
- Feature 013 — the cycle-session host, the canonical pool derivation
  (`derivePool`), the canonical cycle metrics, the Quick-train sentinel
  pattern, and the mastery derivation to exclude.
- Feature 019 — the session timer/setup/summary chrome.
- Feature 001/004 — the settings store and the game-deletion cascade.
- `domain/tactical-training.md` — the attempt/cycle model this feature
  projects, and its §"Future scheduling" boundary.
- `domain/puzzle-model.md` — the immutable, scheduling-free `Puzzle`.
- `research/fsrs-implementation.md` — library research (recommendation
  only; re-evaluated under the Dependency policy).
- **New dependency:** the FSRS-style scheduler library selected by the new
  ADR (research recommends `ts-fsrs`; MIT, zero runtime dependencies,
  browser-compatible). Latest stable per the Dependency policy — **no
  version pin in this spec**.
- **New ADR** (see below) and a new `domain/review-scheduling.md` domain
  specification capturing the scheduler/grade/projection/due-queue rules.
- **Schema change:** additive Dexie v13 (`puzzleSchedules`).

## Conflicts, ambiguities & ADR assessment

### Conflict reported before any decision change

- **ADR-031** states: "No FSRS implementation is used in V1. No scheduler
  library is a V1 dependency and no general scheduling framework is
  built", and `DECISIONS.md` / `AGENTS.md` carry the same V1-scoped
  constraint. Feature 020 introduces exactly such a scheduler.
- This is **not a silent contradiction**: ADR-031 and
  `domain/tactical-training.md` §"Future scheduling" explicitly anticipate
  a future individual scheduler layered on the immutable puzzle/attempt
  model, and `ARCHITECTURE.md` §12 sketches the `Individual Scheduler`
  branch. Feature 020 is the post-V1 realization of that reserved branch.
- **Resolution:** `ADR-035 — Individual Review Scheduling` (Accepted)
  introduces the strategy, amends ADR-031's V1-only prohibition, adopts
  the scheduler library and defines the derived-projection contract. It:
  1. introduce the individual-scheduler training strategy beside cycle
     training;
  2. amend ADR-031's V1-only "no scheduler" prohibition to apply to V1
     only (ADR-031's cycle-training decision itself stays in force);
  3. adopt the scheduler library and record its license/Dependency-policy
     assessment; and
  4. define the derived-projection (not-authoritative, not-synced,
     rebuildable) storage contract and the mastery/statistics separation.
- ADR-031 and the V1 constraints are **left untouched** by this
  specification; nothing in Feature 020 changes cycle training.

### Ambiguities resolved with a recommended default

1. **Grade mapping** — `failed → again`, `solvedWithHelp → hard`,
   clean fast `solvedFirstTry → easy`, other `solvedFirstTry → good`;
   latency only modulates the clean fast case (`EASY_SOLVE_MS = 10 s`).
   Versioned, so it can be tuned without a schema change.
2. **Review session identity** — reuse the Quick-train sentinel pattern
   with a distinct `REVIEW_SET_ID = '__review__'` and no `trainingSets`
   row; the attempt natural key is satisfied and the session host is
   reused. Review cycles are excluded from mastery/statistics.
3. **Queue snapshot** — fixed at session start; no intra-session retry
   (`retryFailed: 'none'`); an `again` puzzle reappears in the next
   session when due.
4. **Skipped presentations** — recorded as a `skipped` attempt row (the
   event log) but no grade/schedule change; discarded presentations write
   no row and change nothing.
5. **Mastery vs scheduling** — independent; mastery excludes review
   cycles and affects only new intake (via `derivePool`), never
   unschedules a puzzle.
6. **Caps** — `review.dailyNewCap` (20) and `review.dailyReviewCap`
   (100), local-calendar-day reset, `0` pauses a category, derived from
   the day's review sessions without a new table.
7. **Rebuild strategy** — lazy per-puzzle rebuild on miss/stale plus an
   optional batched reconcile; `scheduleVersion` and
   `schedulerParamsVersion` gate staleness.
8. **Review statistics** — out of scope for Feature 014 in this feature;
   only the session summary and entry card surface review metrics.

### ADR assessment

**A new ADR was required and is now recorded as ADR-035 (Accepted)** (the
library dependency, the strategy introduction and the ADR-031 amendment
are architectural decisions). `ADR-031` itself is not modified by this
spec. No other ADR is changed:
the ADR-018 derived-cache/not-synced pattern is reused, and the ADR-001 /
ADR-016 storage/sync posture is preserved (the projection is derived and
unsynced).

## Context

Required reading (paths only; see `.opencode/CONTEXT-MAP.md`):

- `AGENTS.md`
- `.opencode/DECISIONS.md`
- `.opencode/specs/ARCHITECTURE.md` (§3 layers, §5 engine boundary, §7
  storage, §9 versioning, §10 performance, §12 future extensions)
- `.opencode/specs/PRODUCT.md` (§10–§11 training, §15 privacy)
- `.opencode/specs/features/012-puzzle-training.md`
- `.opencode/specs/features/013-tactical-training-cycles.md`
- `.opencode/specs/features/019-timed-training-sessions.md`
- `.opencode/specs/domain/tactical-training.md`
- `.opencode/specs/domain/puzzle-model.md`
- `.opencode/specs/decisions/ADR-018-engine-analysis-cache.md`
- `.opencode/specs/decisions/ADR-031-tactical-training-cycles.md`
- `.opencode/specs/research/fsrs-implementation.md`
- `.opencode/specs/decisions/ADR-035-individual-review-scheduling.md`
- `.opencode/specs/domain/review-scheduling.md`
