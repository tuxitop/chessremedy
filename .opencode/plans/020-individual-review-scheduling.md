# Plan 020 — Individual Review Scheduling

> Feature: `.opencode/specs/features/020-individual-review-scheduling.md`
> ADR: `.opencode/specs/decisions/ADR-035-individual-review-scheduling.md`
> Domain: `.opencode/specs/domain/review-scheduling.md`
> Status: implementation plan. Do not implement until ADR-035 is
> confirmed accepted (it is) and the `ts-fsrs` dependency is installed
> under the `AGENTS.md` Dependency policy.

## 1. Objective

Add a post-V1 **individual review-scheduling** training strategy beside
V1 cycle training, without changing cycle training, mastery, or the
immutable `Puzzle`/`PuzzleAttemptRow` model:

1. A pure domain `Scheduler` interface over a serializable
   `ScheduleState`, with `ts-fsrs` isolated in a single adapter.
2. A deterministic, versioned grade mapping from `TrainingResult` +
   presentation counters + latency.
3. Pure schedule derivation (`scheduleFromHistory`, `applyGrade`) and a
   derived, rebuildable `puzzleSchedules` Dexie projection (schema v13).
4. A deterministic due-queue builder (due reviews + new intake) bounded
   by per-local-day caps.
5. A Review session that reuses `useCycleSession` (Feature 013),
   `SolveScreen` (Feature 012) and the Feature-019 session
   setup/timer/summary chrome, under `REVIEW_SET_ID = '__review__'`.
6. A Review entry card and session summary with explicit empty /
   insufficient-data states and accessible, touch-reachable controls.

## 2. Scope

**In scope** (Feature 020 §Scope "In scope", acceptance criteria 1–15):

- `Scheduler` domain interface + `ts-fsrs` adapter.
- Grade mapping (`again`/`hard`/`good`/`easy`) versioned by
  `GRADE_MAPPING_VERSION`.
- `scheduleFromHistory` / `applyGrade`; lazy/stale/corrupt rebuild.
- Derived `puzzleSchedules` table, schema **v13**, keyed by `puzzleId`,
  indexed by `dueAt`; never authoritative, never synced; cascade-deleted
  with the game.
- Due-queue builder + per-local-day caps `review.dailyNewCap = 20`,
  `review.dailyReviewCap = 100` in the existing `settings` store.
- Review mode reusing the cycle-session host and solving screen.
- Review entry card and session summary.
- Deletion cascade, sync exclusion, reconcile.
- Deterministic tests + full gate.

**Out of scope** (Feature 020 §Scope "Out of scope"): opening
repertoires; FSRS parameter optimization; any cycle/mastery/hint/retry/
completion change; syncing `puzzleSchedules`; any new event table;
scheduling state on `Puzzle`; automatic set/block creation; review
history/statistics in Feature 014.

## 3. Existing code to reuse

| Concern | Existing code |
| --- | --- |
| Immutable attempt rows / recorder | `src/infrastructure/training/attempts-service.ts` (`PuzzleAttemptRecorder`, `PuzzleAttemptRecorderLike`), `src/domain/training/outcome.ts` (`buildAttemptRow`, `presentationOutcomeOf`), `src/domain/training/types.ts` (`PuzzleAttemptRow`, `TrainingResult`, counters) |
| Attempt persistence | `src/infrastructure/db/attempts-repository.ts` (`listForPuzzle`, `listForCycle`, `listAll`, `deleteForPuzzleIds`) |
| Puzzle rows / ids | `src/domain/puzzle/types.ts`, `src/domain/puzzle/id.ts` (`puzzleIdOf`), `src/infrastructure/db/puzzles-repository.ts` (`listAll`, `getPuzzles`) |
| Canonical pool derivation | `src/domain/training/autoSet.ts` (`derivePool`, `QUICK_TRAIN_SET_ID`, `formWoodpeckerBlock`) |
| Canonical mastery | `src/domain/training/mastery.ts` (`masteredPuzzleIds`, `masteryOf`) |
| Cycle rows + lifecycle | `src/domain/training/cycleTypes.ts`, `src/infrastructure/db/training-cycles-repository.ts`, `src/infrastructure/training/cycle-service.ts` (`resume`) |
| Session host | `src/hooks/useCycleSession.ts` (`useCycleSession`, `reconstructResume` path) |
| Solving screen | `src/components/puzzles/solve/SolveScreen.tsx` (`row`, `context`, `config`, `recorder`, `onExit`, `allowSkip`, `onRestart`) |
| Feature-019 chrome | `src/components/puzzles/cycles/SessionSetup.tsx`, `SessionTimer.tsx`, `SessionSummary.tsx`, `src/hooks/useTrainingSession.ts`, `useTrainingSessionSettings.ts` |
| Local-day semantics | `src/domain/training/cycleMetrics.ts` (`isSameLocalCalendarDay`) |
| Settings plumbing | `src/infrastructure/db/settings-repository.ts`, `src/config/app-config.ts` (`SETTINGS_KEYS`), `src/hooks/useTrainingSessionSettings.ts` (pattern) |
| Derived-cache precedent | `src/infrastructure/db/engine-cache-repository.ts` (ADR-018), `src/infrastructure/db/schema/v12.ts` (additive migration) |
| Game deletion cascade | `src/infrastructure/db/games-repository.ts` `deleteGames` (transaction + `deleteForPuzzleIds`) |
| Sync envelope exclusion | `src/infrastructure/sync/snapshot.ts` (explicit collection list), `src/domain/sync/settings.ts` |
| Test fixtures / patterns | `src/domain/training/test-support.ts`, `src/domain/puzzle/test-support.ts`, `src/infrastructure/db/schema/v12-migration.test.ts`, `src/infrastructure/training/test-support/hosted-session.ts`, `src/pages/CycleSessionPage.test.tsx` |

Reuse the **canonical** functions (`derivePool`, `masteredPuzzleIds`,
`summarizeSession`, `computeCycleMetrics`, `reconstructResume`,
`buildAttemptRow`) rather than re-deriving any of them.

## 4. Files/modules to create or modify

### 4.1 Domain — new `src/domain/review/`

| File | Purpose |
| --- | --- |
| `types.ts` | `Grade`, `ScheduleState`, `Scheduler` interface, `ReviewCaps`, `DayUsage`, `ReviewQueueEntry`, `ReviewOverview` value types |
| `constants.ts` | `REVIEW_SET_ID`, `SCHEDULE_VERSION`, `GRADE_MAPPING_VERSION`, `SCHEDULER_PARAMS_VERSION`, `EASY_SOLVE_MS`, `DEFAULT_DAILY_NEW_CAP`/`DEFAULT_DAILY_REVIEW_CAP`, `MAX_DAILY_NEW_CAP`/`MAX_DAILY_REVIEW_CAP`, `SCHEDULE_REBUILD_BATCH` |
| `grade.ts` | `gradeForAttempt(attempt): Grade \| null`, `isCleanFastSolve(attempt)` |
| `projection.ts` | `scheduleFromHistory(scheduler, attempts)`, `applyGrade(scheduler, state, grade, at)`, `isScheduleStale(row)`, `scheduleRowFrom(state, puzzleId, lastGrade, updatedAt)` |
| `dueQueue.ts` | `dueQueue(input)`, `normalizeCaps(raw)` |
| `dayUsage.ts` | `dayUsageOf({ cycles, attempts, now })` |
| `test-support.ts` | Deterministic `fakeScheduler`, `scheduleStateFixture`, `puzzleScheduleRowFixture`, `reviewCycleFixture`, `reviewAttemptFixture` (no library/IndexedDB) |
| `index.ts` | Barrel |
| `grade.test.ts`, `projection.test.ts`, `dueQueue.test.ts`, `dayUsage.test.ts` | Focused domain tests |

### 4.2 Domain — modified

| File | Change |
| --- | --- |
| `src/domain/training/autoSet.ts` | Add `REVIEW_SET_ID = '__review__'` next to `QUICK_TRAIN_SET_ID` (both reserved training sentinels; documented) |
| `src/domain/training/index.ts` | Export `REVIEW_SET_ID` |
| `src/domain/training/mastery.ts` | `knownCycleIdsOf` excludes `REVIEW_SET_ID` in addition to `QUICK_TRAIN_SET_ID` (Review cycles never credit mastery) |
| `src/domain/training/mastery.test.ts` | Add review-sentinel exclusion cases |

### 4.3 Infrastructure — new

| File | Purpose |
| --- | --- |
| `src/infrastructure/db/review-schedules-repository.ts` | `PuzzleScheduleRow` (= `ScheduleState` + `puzzleId`/`lastGrade`/versions/`updatedAt`), `ReviewSchedulesRepository` (`get`, `put`, `bulkPut`, `listDue(now, limit)`, `countDue(now)`, `listAll`, `listByPuzzleIds`, `deleteForPuzzleIds`, `deleteStale`, `deleteNotInPuzzleIds`), Dexie impl + singleton |
| `src/infrastructure/db/schema/v13.ts` | `applyV13Schema` — additive store `puzzleSchedules: '&puzzleId, dueAt'` |
| `src/infrastructure/review/ts-fsrs-adapter.ts` | `TsFsrsScheduler implements Scheduler`; the **only** module importing `ts-fsrs`; `ScheduleState` ⇄ `Card`/`State`/`Rating` mapping; `enable_fuzz: false` |
| `src/infrastructure/review/review-service.ts` | `ReviewService`: `overview`, `startSession`, `applyOutcome`, `reconcile`, `retentionOf`, `rebuildPuzzle`; typed results, no throws for expected states |
| `src/infrastructure/review/index.ts` | Barrel |
| `src/infrastructure/review/ts-fsrs-adapter.test.ts`, `review-service.test.ts` | Adapter + service tests |

### 4.4 Infrastructure — modified

| File | Change |
| --- | --- |
| `src/infrastructure/db/schema/index.ts` | Export `applyV13Schema` |
| `src/infrastructure/db/database.ts` | Import/apply v13; add `puzzleSchedules!: Table<PuzzleScheduleRow, string>`; bump the version guard `12 → 13` and message |
| `src/infrastructure/db/database.test.ts` | Table list gains `puzzleSchedules`; `verno` 13 |
| `src/infrastructure/db/games-repository.ts` | `deleteGames` adds `puzzleSchedules` to the transaction scope and calls `deleteForPuzzleIds(puzzleIds)` in the cascade |
| `src/infrastructure/db/training-cycles-repository.ts` | Add `createReview(row)` (rejects a non-`REVIEW_SET_ID` sentinel), mirroring `createQuickTrain` |
| `src/config/app-config.ts` | `PERSISTENCE_SCHEMA_VERSION = 13` + comment; `SETTINGS_KEYS.reviewDailyNewCap = 'review.dailyNewCap'`, `SETTINGS_KEYS.reviewDailyReviewCap = 'review.dailyReviewCap'` |
| `src/infrastructure/sync/snapshot.test.ts` | Assert `puzzleSchedules` is absent from the envelope (and never cleared) |
| `package.json` / lockfile | Add `ts-fsrs` (latest stable, MIT, zero runtime deps) — see §"Dependencies" |

### 4.5 Presentation / hooks — new

| File | Purpose |
| --- | --- |
| `src/hooks/useReviewSettings.ts` | Read/write the two `review.*` caps (defaults, `0` valid, invalid → default, over-max clamp) |
| `src/hooks/useReviewOverview.ts` | Bounded `reconcile` loop + `overview` for the card/session page |
| `src/components/puzzles/review/ReviewCard.tsx` + `.module.css` | Entry card: due/new counts, retention, next due, explicit empty/insufficient states, real `Start review` control (disabled + explanation when empty) |
| `src/presentation/review/relativeTime.ts` + `.test.ts` | Pure `formatRelativeDue(dueAt, now)` for "Next review in 4 days" / next-due text |
| `src/pages/ReviewSessionPage.tsx` + `.module.css` | Setup → session host → summary route (`/training/review`) |
| `src/components/puzzles/review/ReviewCard.test.tsx`, `src/hooks/useReviewSettings.test.ts`, `src/pages/ReviewSessionPage.test.tsx` | UI/hook tests |

### 4.6 Presentation — modified

| File | Change |
| --- | --- |
| `src/components/puzzles/cycles/SessionSetup.tsx` | Add optional, backward-compatible props (`title`, `description`, `details`, `beginLabel`) so Review can show due/new counts + caps link and label the button **Start**; defaults keep Feature-019 behaviour |
| `src/components/puzzles/cycles/SessionSummary.tsx` | Add optional, backward-compatible props (`title`, `description`, `remainingLabel`, `resumeLabel`, `backLabel`, `extraRows`) so Review can show retention/next-due/introduced/remaining-due rows and **Review again**; defaults keep Feature-019 behaviour |
| `src/pages/TrainingHomePage.tsx` | Render `ReviewCard` (with optional injected `ReviewService`) |
| `src/pages/SettingsPage.tsx` | New "Review scheduling" row with the two cap inputs + help text |
| `src/app/routes.ts` | Add `ROUTES.trainingReview = '/training/review'` |
| `src/app/router.tsx` | Lazy `ReviewSessionPage` at `training/review` |
| `SessionSetup.test.tsx`, `SessionSummary.test.tsx`, `TrainingHomePage.test.tsx`, `SettingsPage.test.tsx` | Extended assertions (defaults unchanged + review usage) |

### 4.7 E2E

| File | Purpose |
| --- | --- |
| `tests/e2e/020-individual-review-scheduling.spec.ts` | Review card → setup → solve → summary; empty state; mobile layout; a11y |

## 5. Domain/data changes

### 5.1 Scheduler abstraction (`src/domain/review/types.ts`)

```ts
export type Grade = 'again' | 'hard' | 'good' | 'easy';
export type SchedulePhase = 'learning' | 'review' | 'relearning';

export interface ScheduleState {
  readonly dueAt: number;              // epoch millis
  readonly lastReviewedAt: number | null;
  readonly state: SchedulePhase;
  readonly stability: number;
  readonly difficulty: number;         // library difficulty, NOT ADR-025
  readonly elapsedDays: number;
  readonly scheduledDays: number;
  readonly reps: number;
  readonly lapses: number;
  readonly learningStep: number;
}

export interface Scheduler {
  initialState(now: number): ScheduleState;
  preview(state: ScheduleState, now: number): Record<Grade, ScheduleState>;
  next(state: ScheduleState, grade: Grade, now: number): ScheduleState;
  retrievability(state: ScheduleState, now: number): number;
}
```

- `ScheduleState` is serializable (epoch millis, no `Date`).
- `scheduleFromHistory(scheduler, attempts)` and
  `applyGrade(scheduler, state, grade, at)` take the injected scheduler so
  the domain stays library-free; tests inject `fakeScheduler`.

### 5.2 Grade mapping (`src/domain/review/grade.ts`)

`gradeForAttempt(attempt): Grade | null`, versioned by
`GRADE_MAPPING_VERSION`:

- `skipped` → `null` (no grade; discarded presentations write no row).
- `failed` → `'again'`; `solvedWithHelp` → `'hard'`.
- `solvedFirstTry`:
  - defensive: any `hintCount > 0 || wrongMoveCount > 0 ||
    (restartCount ?? 0) > 0` → `'hard'` (mirrors the mastery
    legitimacy rule);
  - else `solvingTimeMs <= EASY_SOLVE_MS (10_000)` → `'easy'`;
  - else → `'good'`.
- Latency never upgrades a helped/failed outcome.

### 5.3 Projection (`src/domain/review/projection.ts`)

- `scheduleFromHistory(scheduler, attempts)`: keep `result !== 'skipped'`,
  sort by `endedAt` then `presentationIndex`, fold from
  `scheduler.initialState(first.endedAt)` through
  `scheduler.next(state, grade, at)`. Returns `ScheduleState | null`
  (no gradeable attempt → no row).
- `applyGrade(scheduler, state, grade, at)` is the incremental path and
  **must equal** the corresponding fold step (invariant 3).
- `isScheduleStale(row)` → `row.scheduleVersion !== SCHEDULE_VERSION ||
  row.schedulerParamsVersion !== SCHEDULER_PARAMS_VERSION`.
- `scheduleRowFrom(state, puzzleId, lastGrade, updatedAt)` builds the
  persisted row (adds `puzzleId`, `lastGrade`, `scheduleVersion`,
  `schedulerParamsVersion`, `updatedAt`).

### 5.4 Due queue (`src/domain/review/dueQueue.ts`)

```
dueQueue({
  schedules,        // current puzzleSchedules rows
  pool,             // derivePool({ puzzles, masteredIds, openBlockPuzzleIds })
  now,
  caps,             // { newCap, reviewCap } (already normalized)
  dayUsage,         // { newCount, reviewCount }
  pendingRebuildIds // gradeable history but no schedule row yet
}) : ReviewQueueEntry[]
```

1. **Due reviews** — `schedules.filter(dueAt <= now)` ordered by `dueAt`
   ascending, ties by puzzle `difficulty` ascending then `puzzleId`,
   sliced to `max(0, caps.reviewCap - dayUsage.reviewCount)`.
2. **New intake** — `pool` minus puzzles already scheduled and minus
   `pendingRebuildIds`, ordered `difficultyAsc` (ties by `sourcePly`
   then `puzzleId`), sliced to `max(0, caps.newCap - dayUsage.newCount)`.
3. Concatenate reviews then intake. Mastery/open-block exclusion is
   inherited from `derivePool`; a mastered puzzle with a due row is
   still reviewed.

`normalizeCaps(raw)`: non-finite/absent → defaults; negative → `0`;
above `MAX_*` → clamp. `0` pauses a category.

### 5.5 Day usage (`src/domain/review/dayUsage.ts`)

`dayUsageOf({ cycles, attempts, now })` — derived from persisted rows,
**no extra table**:

- today's review cycles = `trainingSetId === REVIEW_SET_ID &&
  isSameLocalCalendarDay(startedAt, now)` (ordered by `startedAt`).
- For each puzzle presented in today's review cycles, take its earliest
  presentation's session start.
- `newCount` = puzzles whose earliest **gradeable** attempt overall
  (`result !== 'skipped'`, min `endedAt`) is not earlier than their
  earliest today review-session start.
- `reviewCount` = the rest. Count each puzzle once.

### 5.6 Schema v13 (`src/infrastructure/db/schema/v13.ts`)

Additive, no backfill:

```ts
db.version(13).stores({ puzzleSchedules: '&puzzleId, dueAt' });
```

`PERSISTENCE_SCHEMA_VERSION = 13`. `puzzleSchedules` is a derived,
unsynced projection; `database.ts` and the version guard are updated.

### 5.7 Row shape (`PuzzleScheduleRow`)

| Field | Type |
| --- | --- |
| `puzzleId` | string (PK) |
| `dueAt` | number (indexed) |
| `lastReviewedAt` | number \| null |
| `state` | `'learning' \| 'review' \| 'relearning'` |
| `stability`, `difficulty`, `elapsedDays`, `scheduledDays`, `reps`, `lapses`, `learningStep` | number |
| `lastGrade` | `Grade \| null` |
| `scheduleVersion`, `schedulerParamsVersion` | number |
| `updatedAt` | number (schema-v12 merge convention) |

### 5.8 ts-fsrs adapter (`src/infrastructure/review/ts-fsrs-adapter.ts`)

- Imports `{ fsrs, createEmptyCard, Rating, State, type Card }` from
  `ts-fsrs`; the **only** module that does.
- Maps `ScheduleState` ⇄ `Card` (`Date` ⇄ epoch millis), `Grade` ⇄
  `Rating`, `State` ⇄ `SchedulePhase` (`State.New` normalizes to
  `'learning'`).
- `initialState(now)` → `createEmptyCard(new Date(now))` mapped.
- `next` uses `scheduler.next(card, now, rating)`; `preview` uses
  `scheduler.repeat(card, now)`; `retrievability` uses
  `scheduler.get_retrievability(card, now)` (clamped `[0,1]`).
- **`enable_fuzz: false`** is required: fuzz uses `Math.random`, which
  would break `applyGrade === scheduleFromHistory` and the deterministic
  tests. `SCHEDULER_PARAMS_VERSION` identifies this default parameter
  set (see Open question O-6).

## 6. UI changes

1. **Review entry card** (`ReviewCard.tsx`) on `/training`:
   - **Due now** (display-capped) with the true backlog as text; **New**
     under the new cap; **Retention** (average retrievability over the
     card's bounded set) or "Not enough data yet"; **Next due** relative
     or "New puzzles available" / "Nothing scheduled".
   - Empty state "All caught up" (never a bare `0`).
   - `Start review` is a real labelled `Link`/button, keyboard/touch
     reachable, `aria-disabled` + explanatory text when the queue is
     empty. Test ids: `review-card`, `review-due`, `review-new`,
     `review-retention`, `review-next-due`, `review-start`,
     `review-empty`.
2. **Review session setup** (`/training/review`): extends `SessionSetup`
   with the due/new counts, the caps in force + Settings link, the
   Feature-019 duration choice, and **Start**/**Cancel**
   (`session-setup`, `session-begin`, `session-setup-cancel` reused).
3. **Review session**: `useCycleSession` + `SolveScreen` + `SessionTimer`
   + `End session`; chrome shows `Puzzle X of Y` and, after each
   outcome, a polite live region "Next review in …". `skip` writes a
   `skipped` row and applies no grade; discard writes nothing.
   `retryFailed: 'none'` → no intra-session retry.
4. **Review summary**: extends `SessionSummary` with the canonical counts
   (`summarizeSession`), first-try accuracy, time used, average time,
   plus retention, next due, introduced count and remaining due; actions
   **Review again** / **Back to training**.
5. **Settings**: new "Review scheduling" row with the two cap inputs
   (`setting-review-daily-new-cap`, `setting-review-daily-review-cap`),
   help text, `0`-pauses copy, immediate save.
6. **Accessibility/responsive**: text (never colour-only) counts; explicit
   empty/insufficient words; labelled keyboard/touch controls ≥ ~44 px;
   `prefers-reduced-motion` respected; mobile stacking reusing the
   Feature-019 layout.

## 7. Infrastructure changes

- **Repositories**: new `ReviewSchedulesRepository`; `TrainingCyclesRepository.createReview`;
  `GamesRepository.deleteGames` cascade extension.
- **ReviewService** (`src/infrastructure/review/review-service.ts`):
  - `overview(now)`: caps from settings → puzzles/attempts/cycles/schedules
    → `masteredPuzzleIds` (review cycles excluded) → open block →
    `derivePool` → `dayUsageOf` → `dueQueue` → retention (bounded: due
    queue rows + today's reviewed puzzles) → `nextDueAt`; returns the
    `ReviewOverview` (with `pendingRebuild` count/notice).
  - `reconcile({ batchSize })`: one bounded pass — drop schedule rows
    whose `puzzleId` is not a persisted puzzle; rebuild missing/stale/
    corrupt rows via `scheduleFromHistory`; returns
    `{ done, processed, rebuilt, dropped }`. Idempotent, resumable,
    non-blocking.
  - `startSession(now)`: normalize caps → compute queue → abandon any
    in-progress `REVIEW_SET_ID` cycles (quick-train pattern) → create one
    `trainingCycles` row under `REVIEW_SET_ID` with the queue snapshot and
    `REVIEW_CYCLE_CONFIG` (`retryFailed: 'none'`, `allowSkip: true`); no
    `trainingSets` row. Returns `{ cycle, set, puzzles }` for
    `useCycleSession`.
  - `applyOutcome(attemptRow)`: `gradeForAttempt`; `null` → no write.
    Load the schedule row; if missing/stale/corrupt, rebuild from
    `attemptsRepository.listForPuzzle`. `scheduler.next(...)` in
    try/catch → on throw fall back to `scheduleFromHistory`; if that
    throws, treat as unscheduled and return a non-blocking failure. Write
    the row with `at = attemptRow.endedAt` (same `now` as the row, so
    ordering cannot disagree). Returns `{ applied, nextDueAt }`.
  - `retentionOf(scheduleStates, now)`.
- **Settings**: two new keys in `SETTINGS_KEYS`; `useReviewSettings`
  mirrors `useTrainingSessionSettings` (default/fallback/clamp).
- **Sync**: `puzzleSchedules` is deliberately **not** added to
  `SyncEnvelopeCollectionsV1` / `readLocalCollections`, so it is excluded
  exactly like the ADR-018 cache. Add an explicit exclusion assertion.
  Review *cycles* and *attempts* continue to sync normally (the event
  log), so a new device rebuilds the projection.
- **Deletion**: `deleteGames` removes schedule rows by `puzzleId` in the
  same transaction as attempts.
- **Reconcile**: bounded, resumable, invoked from `useReviewOverview`
  before computing the overview; a partial rebuild leaves a puzzle
  "pending" (excluded from intake) rather than showing a wrong due date.
- **Performance**: one indexed `puzzleSchedules.dueAt` read (`<= now`,
  ascending) bounded by the review cap; O(1) per outcome; no engine/
  network.

## 8. Tests

### Focused domain
- `src/domain/review/grade.test.ts` — every `TrainingResult` branch;
  clean/fast → `easy`; slow → `good`; defensive downgrade; skipped →
  `null`; `GRADE_MAPPING_VERSION`.
- `src/domain/review/projection.test.ts` — `scheduleFromHistory` vs
  `applyGrade` equality on fixtures; chronological ordering; skipped-only
  → `null`; stale detection; serializable state (no `Date`).
- `src/domain/review/dueQueue.test.ts` — due ordering/ties; intake from
  `derivePool`; mastery/open-block/scheduled/pending exclusion; caps;
  cap `0`; empty queue; backlog.
- `src/domain/review/dayUsage.test.ts` — new vs review classification;
  local-day reset; multiple sessions per day; skip-only.
- `src/domain/training/mastery.test.ts` — review-sentinel cycles never
  credit (existing tests unchanged).

### Adapter / service / persistence
- `src/infrastructure/review/ts-fsrs-adapter.test.ts` — determinism with
  injected `now`; `initialState`/`next`/`preview`/`retrievability`;
  `ScheduleState` round-trip; no `Date` leakage.
- `src/infrastructure/review/review-service.test.ts` — overview
  counts/empty/insufficient retention; startSession snapshot + stale
  cycle cleanup; `applyOutcome` grade + next due; schedule-write failure
  → notice + reconcile repair; reconcile drops orphans / rebuilds
  missing/stale/corrupt; caps from settings.
- `src/infrastructure/db/review-schedules-repository.test.ts` — `get`/
  `put`/`listDue` ordering + limit/`countDue`/`deleteForPuzzleIds`/
  `bulkPut` (fake-indexeddb).
- `src/infrastructure/db/schema/v13-migration.test.ts` — v12→v13 creates
  the store additively, starts empty, idempotent reopen,
  `PERSISTENCE_SCHEMA_VERSION === 13`.
- `src/infrastructure/db/database.test.ts` — updated table list + `verno 13`.
- `src/infrastructure/db/games-repository.test.ts` — `deleteGames`
  cascades `puzzleSchedules` (no orphans).
- `src/infrastructure/sync/snapshot.test.ts` — `puzzleSchedules` absent
  from the envelope.

### Hooks / components / pages
- `src/hooks/useReviewSettings.test.ts` — defaults, `0`, invalid →
  default, over-max clamp, round-trip.
- `src/components/puzzles/review/ReviewCard.test.tsx` — counts,
  empty/insufficient states, disabled `Start review` + explanation.
- `src/presentation/review/relativeTime.test.ts` — relative next-due text.
- `src/pages/ReviewSessionPage.test.tsx` — setup → begin → stubbed
  `SolveScreen` outcome → grade applied → summary (review sentinel
  `cycleId`, no retry, skip/discard, mastery exclusion, summary window
  `endedAt >= sessionStart`).
- `src/pages/TrainingHomePage.test.tsx` — card renders + navigates to
  `/training/review`.
- `src/pages/SettingsPage.test.tsx` — review cap rows.
- `src/components/puzzles/cycles/SessionSetup.test.tsx` /
  `SessionSummary.test.tsx` — existing defaults unchanged + review props.

### E2E (Chromium)
- `tests/e2e/020-individual-review-scheduling.spec.ts` — card → setup →
  solve → summary; empty state; mobile card/setup/summary; polite
  next-review announcement; reduced motion.

### Focused commands (narrow first)
```
npx vitest run src/domain/review src/domain/training/mastery.test.ts
npx vitest run src/infrastructure/review
npx vitest run src/infrastructure/db/schema/v13-migration.test.ts \
  src/infrastructure/db/database.test.ts \
  src/infrastructure/db/review-schedules-repository.test.ts \
  src/infrastructure/db/games-repository.test.ts
npx vitest run src/hooks/useReviewSettings.test.ts \
  src/presentation/review src/components/puzzles/review \
  src/components/puzzles/cycles/SessionSetup.test.tsx \
  src/components/puzzles/cycles/SessionSummary.test.tsx \
  src/pages/ReviewSessionPage.test.tsx \
  src/pages/TrainingHomePage.test.tsx src/pages/SettingsPage.test.tsx
npx playwright test tests/e2e/020-individual-review-scheduling.spec.ts
```

## 9. Migration considerations

- **Additive only.** v13 creates `puzzleSchedules` empty; no backfill,
  no shape change to existing stores. Existing v12 installs open with
  no data loss.
- **Version guards**: bump `PERSISTENCE_SCHEMA_VERSION` to `13` and the
  `database.ts` runtime guard; update `database.test.ts` and add
  `v13-migration.test.ts` (v12 harness → open at v13, idempotent).
- **New device / restored sync**: `puzzleSchedules` is unsynced, so it
  is rebuilt from synced `puzzleAttempts` by the bounded reconcile;
  until rebuilt, a puzzle with gradeable history is "pending" and
  excluded from new intake (never shown with a wrong due date).
- **Projection staleness**: a row whose `scheduleVersion` or
  `schedulerParamsVersion` differs is stale and lazily rebuilt.
- **Deletion**: schedule rows cascade with the game via `deleteGames`;
  reconcile also drops any orphaned row.
- **No data migration for `Puzzle`/`PuzzleAttemptRow`** — both stay
  immutable and scheduling-free (ADR-031/ADR-035 invariant 1).
- **No settings schema change** — the two caps live in the existing
  `settings` store.

## 10. Risks

| # | Risk | Mitigation |
| --- | --- | --- |
| R-1 | **FSRS fuzz breaks determinism** (`applyGrade !== scheduleFromHistory`, flaky tests) | Adapter sets `enable_fuzz: false`; `SCHEDULER_PARAMS_VERSION` records the parameter set; determinism tests with injected `now` |
| R-2 | **`ts-fsrs` API/version drift** (research recorded 5.4.1; latest stable may differ) | Adapter is the only import; install latest stable and pin nothing; adapter tests cover the API surface used |
| R-3 | **Adapter `Date` leakage** into Dexie/domain | `ScheduleState` is epoch-millis only; round-trip test asserts no `Date` |
| R-4 | **New-device rebuild cost** (large attempt history) | Bounded, resumable `reconcile` chunks; puzzles pending until rebuilt; never blocks the UI |
| R-5 | **Schedule/attempt ordering disagreement** | Grade applied with `at = attemptRow.endedAt`; the row is durable before `applyOutcome` runs |
| R-6 | **Review cycles leaking into mastery/statistics** | `mastery.ts` excludes `REVIEW_SET_ID`; statistics are set-scoped (no set row for review); explicit tests |
| R-7 | **Session-page duplication** (review vs cycle host) | Reuse `useCycleSession`/`SolveScreen`/Feature-019 chrome; keep the review page a thin composition, not a second solver |
| R-8 | **Schema guard / migration regressions** | `v13-migration.test.ts` + updated `database.test.ts`; additive store only |
| R-9 | **Schedule-write failure after a durable attempt** | Non-blocking notice; reconcile rebuilds from the attempt log (source of truth); attempt row never lost |
| R-10 | **Caps unbounded** | `normalizeCaps` clamps to `MAX_*`; `0` pauses; bounded due query |
| R-11 | **`puzzleSchedules` accidentally synced** | Not in the envelope collection list; explicit `snapshot.test.ts` assertion |
| R-12 | **`SessionSetup`/`SessionSummary` prop changes regress Feature 019** | All new props optional with current defaults; existing tests assert unchanged defaults |

## 11. Acceptance criteria

Mapped to Feature 020 §Acceptance criteria 1–15:

1. Pure `Scheduler` interface + single swappable adapter; no
   React/Dexie/engine/network import in `src/domain/review/**`.
2. Deterministic, versioned grade mapping (incl. defensive downgrade and
   no-grade cases).
3. Derived `puzzleSchedules` (schema **v13**, `puzzleId` PK, `dueAt`
   index); `PERSISTENCE_SCHEMA_VERSION === 13`; additive migration.
4. `scheduleFromHistory`/`applyGrade` pure and equal; drop/rebuild with
   no data loss.
5. Stale/missing/corrupt rows rebuilt lazily; rebuild failure never
   crashes a session.
6. Due queue: ordered due reviews then `derivePool` intake, bounded by
   local-day caps; caps reset locally; usage derived without a new table.
7. Review mode reuses `useCycleSession`, `SolveScreen`, Feature-019
   timer/summary; one presentation per puzzle per session; no
   intra-session retry.
8. Each definite outcome writes one immutable attempt row and applies one
   grade; skipped applies none; discard writes nothing.
9. Review-sentinel cycles excluded from mastery and cycle/set statistics;
   cycle training/metrics/mastery/hints/retry/completion unchanged.
10. Summary reports solved-first-try/help/failed/skipped, first-try
    accuracy, time used, average time, retention, next due, introduced,
    remaining due, via canonical metrics.
11. Training-home Review card shows due/new/retention/next-due with
    explicit empty/insufficient states; `Start review` disabled with an
    explanation when empty.
12. `review.dailyNewCap` (20) and `review.dailyReviewCap` (100) with
    validation, `0` semantics, fallback/clamping; no `settings` schema
    change.
13. Schedule rows cascade-delete with the game and are excluded from
    sync; a new device rebuilds them from attempt history.
14. Accessibility/responsive requirements met; dependency accepted under
    the Dependency policy; ADR-035 accepted (it is).
15. Automated tests cover the changes and the full gate passes.

## 12. Verification commands

Narrow-first, then the full `AGENTS.md` Execution-policy gate
(`.opencode/skills/verify-gate/SKILL.md`):

```
# focused (see §8)
npx vitest run src/domain/review src/infrastructure/review
npx vitest run src/infrastructure/db/schema/v13-migration.test.ts
npx playwright test tests/e2e/020-individual-review-scheduling.spec.ts

# full gate
npm run lint
npm run typecheck
npm run format:check
npm run test
npm run build
npm run dev            # smoke run, no browser-console errors
npm run test:browser   # when Chromium is available
npm audit
```

Any warning/error: fix the cause first; if impossible, stop and consult
the user with the warning, cause, alternatives and a recommendation
before applying a workaround.

## Dependencies

- **New runtime dependency:** `ts-fsrs` (MIT, zero runtime dependencies,
  browser-compatible, storage-agnostic) per ADR-035. Install the
  **latest stable at implementation time** (research recorded `5.4.1`;
  verify with `npm view ts-fsrs version`); **no version pin** in this
  plan (Dependency policy). Add to `dependencies`; `npm audit` must
  pass; no new ADR is needed (ADR-035 already selects it).
- No other dependency changes. `ts-fsrs` replaces no existing library.

## Resolved decisions (confirmed 2026-09-14)

All recommendations below are **confirmed**: O-1…O-8 use the recommended
defaults. In particular **O-6 keeps FSRS fuzz disabled** so the derived
projection stays deterministic, idempotent and exactly rebuildable.

- **O-1 — Cap safety maxima.** The spec requires a "documented safety
  maximum" but does not give one. Recommended: `MAX_DAILY_NEW_CAP = 200`,
  `MAX_DAILY_REVIEW_CAP = 1000`. Confirm or supply the values.
- **O-2 — Review session resume.** The spec says "Starting the session
  snapshots the queue" and the card has `Start review` (no resume
  wording). Recommended: `startSession` abandons any in-progress
  `REVIEW_SET_ID` cycle and creates a fresh snapshot each start
  (quick-train cleanup), keeping attempts. Confirm if an interrupted
  review session must instead resume its original snapshot.
- **O-3 — Reconcile trigger.** The spec allows lazy or startup batching.
  Recommended: bounded `reconcile` chunks run from `useReviewOverview`
  on review use, resumable across mounts; no startup pass. Confirm.
- **O-4 — Retention window.** "due queue + recently reviewed" is
  unspecified. Recommended: due-queue rows + the distinct puzzles
  reviewed in today's review cycles (bounded). Confirm.
- **O-5 — Review caps sync.** `SYNCED_SETTINGS_KEYS` currently excludes
  session/puzzle-timer settings. Recommended: leave `review.*` caps
  unsynced (device-local), matching the existing preference precedent.
  Confirm if caps should sync.
- **O-6 — FSRS fuzz.** The spec does not mention fuzz; determinism
  requires `enable_fuzz: false`. Recommended: disable fuzz and record it
  as `SCHEDULER_PARAMS_VERSION = 1`. Confirm.
- **O-7 — `GRADE_MAPPING_VERSION` vs `SCHEDULE_VERSION`.** The spec lists
  both `scheduleVersion` and `GRADE_MAPPING_VERSION` without relating
  them. Recommended: keep them distinct; any grade-mapping bump also
  bumps `SCHEDULE_VERSION` (which gates lazy rebuild). Confirm.
- **O-8 — `dayUsage` derivation.** The spec defines "new before that
  session" against a schedule row; the current row cannot reconstruct
  pre-session state. Recommended: derive from the attempt log (earliest
  gradeable attempt vs earliest today review-session start) as in §5.5.
  Confirm.

## Suggested implementation order

1. Domain: `types`/`constants`/`grade`/`projection`/`dueQueue`/
   `dayUsage` + `test-support` + tests.
2. Schema v13 + repository + migration/database tests; `app-config` keys;
   cascade + sync-exclusion tests; `mastery.ts` exclusion.
3. `ts-fsrs` adapter + tests.
4. `ReviewService` + tests.
5. `useReviewSettings` / `useReviewOverview` / relative-time helper +
   tests.
6. `ReviewCard` on Training home; `SessionSetup`/`SessionSummary`
   extensions; Settings row.
7. `ReviewSessionPage` + route + page tests.
8. E2E + full gate.
