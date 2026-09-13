# Feature 019 — Timed Training Sessions

> Cross-cutting training-experience feature. It adds an ephemeral, time-boxed
> **training session** around the current cycle's solving queue: a focus
> wrapper, not a new content type. A session **persists nothing new**, the cycle
> stays the source of truth and remains resumable, and the feature introduces
> **no new domain rule, no persisted table, no new dependency and no ADR**.

## Purpose

Training cycles are open-ended: a user solves for as long as they like and
leaves at any point. The product wants a deliberate, bounded focus run — "train
for 15 minutes" — without inventing a new training artifact or breaking the
resumable-cycle model.

This feature wraps the existing Feature-013 cycle session in a wall-clock
**session timer**:

- a pre-session gate lets the user commit to a duration (or no limit);
- the session chrome shows a quiet countdown and an **End session** control;
- expiry stops the run and shows an ephemeral **session summary** derived from
  the attempt rows written during the run;
- the existing per-puzzle `solve-clock` gains a reveal-at-threshold rule so a
  slow puzzle becomes visible even when the timer is otherwise hidden.

A session never changes what a cycle is or what an attempt row is. It is a view
over the same Feature-012/013 data, computed on demand and discarded.

## Scope

### In scope

1. The **pre-session commit gate** on the cycle page (after the existing
   same-day spacing nudge, before the first puzzle) with the duration options
   **5 / 10 / 15 / 20 / 30 / 45 / 60 minutes + "No time limit"**.
2. The **session countdown timer** in the session chrome: small text + a thin
   progress bar, red at the warning threshold, expiry at zero.
3. **Expiry behavior**: stop immediately and discard the in-progress
   presentation (no new attempt row; the puzzle stays queued).
4. The **End session** control that stops the run early and shows the summary.
5. The ephemeral **session summary** derived from the session's attempt rows,
   with **Resume cycle** / **Back to training** actions.
6. **Session summary before results** when the cycle completes before the timer.
7. The **per-puzzle timer reveal-at-threshold** rule for the existing
   `solve-clock`.
8. Four **Settings** entries: Show puzzle timer (existing), Puzzle timer red
   threshold, Default session length, Session warning threshold.
9. Wall-clock session semantics matching Feature 012.
10. Deterministic component/domain tests and fixtures.

### Out of scope

- **Session persistence, session history and session statistics** — explicitly
  deferred to a future feature. No session row, log or aggregate is stored.
- Any change to `puzzleAttempts`, the attempt-row write path, cycle metrics,
  mastery, completion, retry, skip or hint semantics.
- Any new table, column, index or `PERSISTENCE_SCHEMA_VERSION` bump.
- Any new dependency, ADR or scheduler (ADR-031 stays untouched).
- Time limits or per-puzzle scheduling that would block, fail or alter a cycle.
- Redesigning the cycle session, results page or training home beyond the
  timer, gate, End session and progress additions described here.

## User-facing behavior

### 1. Pre-session commit gate

- Shown on the cycle page (start **or** resume) **after** the existing
  same-day spacing nudge (Feature 013 §4) and **before** the first puzzle is
  presented.
- Duration options: **5, 10, 15, 20, 30, 45, 60 minutes** and **No time
  limit**.
- The preselected option is the **Default session length** setting (default
  `10` minutes).
- The gate states the chosen length and that the cycle stays resumable.
- The timer starts **only when the user activates Begin**; nothing counts down
  before that.
- The gate is not shown when the cycle is already `completed`/`abandoned`
  (results are shown) and is not re-shown mid-session.

### 2. Session timer

- A wall-clock countdown `mm:ss` rendered quietly in the session chrome: small
  text plus a thin progress bar; **no modal, no alert, no blocking dialog**.
- The progress bar reflects remaining time against the chosen duration.
- When remaining ≤ the **Session warning threshold** (default `30` s) the timer
  turns **red** (colour **and** text/state, never colour alone).
- At zero the session **ends** (see 3).
- **No time limit** shows no countdown and never auto-expires; **End session**
  still produces the summary.

### 3. Expiry mid-puzzle

- On expiry the session stops **immediately** and the in-progress presentation
  is **discarded**: no new attempt row is written and the puzzle stays queued
  for the next session (the Feature 012 discard-on-leave rule).
- A wrong move may already have recorded a durable `failed` row (Feature 012
  fail-once); that row **still counts** in the session summary and toward cycle
  metrics. Expiry never deletes or rewrites a row.
- The session summary is then shown.

### 4. End session

- An **End session** control in the session chrome stops the run early,
  discards the in-progress presentation (same rule as expiry) and shows the
  session summary.
- The cycle is left `inProgress` and resumable (Feature 013); **End session
  does not abandon the cycle**.
- The existing Feature-013 **Exit** control remains; see "Conflicts,
  ambiguities & ADR assessment".

### 5. Session summary

The summary is **ephemeral** and derived at session end from the attempt rows
written during the session window — the rows of the **same `cycleId`** whose
`endedAt >= sessionStart`:

- puzzles **solved first-try** (`solvedFirstTry`);
- **solved with help** (`solvedWithHelp`);
- **failed** (`failed`);
- **skipped** (`skipped`);
- **first-try accuracy** = `solvedFirstTry / definite`, where `definite` is the
  session rows with `result !== 'skipped'`;
- **time used** = session wall-clock `sessionEnd - sessionStart`;
- **average time per puzzle** = the canonical average `solvingTimeMs` over the
  session's definite rows;
- **cycle puzzles remaining** = the cycle snapshot's non-terminal puzzles under
  the canonical completion predicate.

Actions: **Resume cycle** (return to the cycle at the next unanswered puzzle)
and **Back to training** (training home).

The counts and rates reuse the canonical Feature-013/014 cycle-metric
resolution applied to the session's row subset; Feature 019 defines no new
metric and no new denominator.

### 6. Cycle completes before the timer

- If the cycle reaches `completed` while time remains, the session ends and the
  **session summary is shown first**, with a **View cycle results** action that
  opens the existing cycle results page.
- The results page itself is unchanged.

### 7. Per-puzzle timer reveal

- The existing `solve-clock` is rendered when the **Show puzzle timer** setting
  is on.
- New rule: even when that setting is **off**, the timer is revealed (red) once
  the puzzle's elapsed time reaches the **Puzzle timer red threshold** (default
  `30` s).
- When the setting is on, the timer is always visible and turns red at the
  threshold.
- The clock is wall-clock and a restart does not reset it (Feature 012), so a
  revealed timer stays revealed until the presentation ends.

### 8. Settings

All four settings are stored in the existing settings table; there is **no
schema change**.

| Setting label              | Key (`SETTINGS_KEYS`)                   | Type            | Default |
| -------------------------- | --------------------------------------- | --------------- | ------- |
| Show puzzle timer          | `puzzle.timer` (existing)               | boolean         | `false` |
| Puzzle timer red threshold | `puzzle.timerRedThreshold` (new)        | integer seconds | `30`    |
| Default session length     | `training.session.defaultMinutes` (new) | integer minutes | `10`    |
| Session warning threshold  | `training.session.warningSeconds` (new) | integer seconds | `30`    |

- The **Default session length** value is one of the offered options
  (5/10/15/20/30/45/60); an out-of-range stored value is snapped to the nearest
  offered option.
- Thresholds are positive seconds; an invalid stored value falls back to the
  default.
- Changes save immediately, consistent with the other Settings rows.

## Domain behavior

Feature 019 adds **no domain entity and no domain rule**. It is a presentation
and ephemeral-state feature over existing data.

- **Session** — an ephemeral, time-boxed solving run over the current cycle's
  queue. It has no id, is never persisted, and is discarded when the user
  leaves. A **cycle may span multiple sessions**; the cycle remains the durable
  artifact and is always resumable (Feature 013).
- **Session window** — the cycle's attempt rows with the same `cycleId` and
  `endedAt >= sessionStart`. The summary is a read-time projection of this
  subset.
- **Canonical metrics reuse** — the summary's first-try accuracy, average
  solving time, result counts and remaining count reuse the canonical
  Feature-013/014 cycle-metric resolution applied to the session row subset.
  Feature 019 never re-derives an accuracy, average or completion rule.
- **Per-puzzle timer threshold** — a display threshold on the presentation's
  wall-clock elapsed time. It changes only whether/when the clock is shown and
  coloured; it never ends, fails or alters a presentation, an attempt row or a
  cycle. The reveal-at-threshold rule applies when the Show puzzle timer
  setting is off; when the setting is on the clock is always visible and the
  threshold only controls the red state.
- **Wall-clock semantics** — session and puzzle timers use wall-clock time
  (Feature 012): backgrounded/hidden-tab time counts, and a restart does not
  reset the puzzle clock. A backwards clock reading is clamped to `0`.
- **No persistence** — the summary is computed at session end from already
  persisted rows and is shown once; navigating away discards it. There is no
  session history in V1.

## Data requirements

- **Nothing new is persisted.** No session table, row, column, index or
  aggregate; `PERSISTENCE_SCHEMA_VERSION` is unchanged.
- The **summary is derived** at read time from existing `puzzleAttempts` rows
  (same `cycleId`, `endedAt >= sessionStart`) and the cycle snapshot.
- Reads reuse existing methods: the cycle's attempt rows (the existing
  `listForCycle` read) and the existing settings repository for the four keys.
- The session timer, warning state, expiry and gate selection are **in-memory
  UI state only**; they are not stored and are not synced.
- **No new dependency.**

## States

- **Gate**: default length preselected; another length selected; No time limit
  selected; Begin pending.
- **Session timer**: running (normal); warning (red); expired; no-limit (no
  countdown).
- **Session**: active; ended early (summary); expired (summary); cycle
  completed during the session (summary, then results).
- **Summary**: has definite rows; all-skipped (`empty` rates, not `0`); zero
  rows (e.g. expiry before any outcome).
- **Settings**: unset (defaults apply); stored valid; stored invalid
  (fallback/snap).
- **Puzzle timer**: hidden; revealed at threshold (setting off); always visible
  (setting on); red at threshold.

## Error cases

The feature must never crash, fabricate data or block a cycle:

- **Settings read failure** — fall back to the documented defaults; the session
  still starts.
- **Invalid stored setting** — an out-of-range threshold or session length
  falls back/snaps; never `NaN`, negative or zero-length timers.
- **Attempt write pending at expiry** — Feature 012's write-failure handling
  keeps the outcome visible with an inline retry; the summary counts only
  persisted rows and never invents one.
- **Summary with zero definite rows** — rates/time averages report `empty`
  (consistent with the canonical metric), never `0`.
- **Clock moves backwards** — elapsed/remaining clamp to `0`; the session never
  shows a negative countdown.
- **Tab backgrounded past expiry** — on return the wall clock has advanced, so
  the session ends and shows the summary; no row is written for the discarded
  presentation.
- **Cycle deleted / record missing at session end** — the session ends with the
  existing notice and returns to the training home; no summary is fabricated.
- **No-time-limit session** — never auto-expires; only End session or cycle
  completion ends it.
- **Timer at zero as the cycle completes** — the cycle-completed path wins and
  the summary is shown with **View cycle results**.

## Edge cases

- **Duration equals the remaining work**: the cycle may complete exactly as the
  timer expires; the summary-then-results path applies.
- **Single-puzzle cycle** and **very large cycle** both work; the summary is
  bounded by the session's rows.
- **A wrong move recorded just before expiry** — the durable `failed` row
  counts in the summary and the cycle, even though the presentation was
  discarded.
- **Expiry on the last unanswered puzzle** — the puzzle stays queued; the
  summary shows it in "cycle puzzles remaining".
- **Restart near the puzzle threshold** — the clock is not reset, so the timer
  stays revealed.
- **Puzzle red threshold shorter than the reveal** — the clock shows red from
  the first render once elapsed ≥ threshold.
- **Session warning threshold larger than the chosen duration** — the timer is
  red from the start; it still counts down and expires.
- **Changing Default session length between sessions** — only the preselection
  of the next gate changes; an active session keeps its chosen duration.
- **Multiple tabs on one cycle** — sessions are per-tab and ephemeral; the
  summary derives from persisted rows, and a cycle completed in another tab is
  reflected on the next read.
- **Skip-only session** — all four result counts can be zero except `skipped`;
  rates are `empty`.
- **No time limit + End session** — time used is the elapsed wall clock; all
  other summary fields are computed normally.

## Accessibility requirements

- The session timer is **not colour-only**: it is rendered as text (`mm:ss`)
  with an accessible label such as "Time remaining" and, when red, also carries
  a text state (e.g. "Time remaining — warning"). The container uses
  `role="timer"`.
- Threshold crossings are announced **politely** (`aria-live="polite"`) at the
  warning threshold and at expiry — **not every second**. The progress bar has
  an accessible name and value.
- The pre-session gate is a labelled control group: duration options are real
  radio/button choices reachable by keyboard and touch, and **Begin** is a
  labelled control; the default is not conveyed by colour alone.
- **End session** is a real labelled control reachable by keyboard and touch,
  never hover-only or shortcut-only.
- The session summary is text (counts, rates, times) with a heading; the
  Resume cycle / Back to training / View cycle results actions are real
  controls; rates report `empty` in words, never a bare `0`.
- The per-puzzle revealed timer is announced as text and does not rely on the
  red colour alone.
- `prefers-reduced-motion: reduce` disables any progress-bar animation; the
  countdown itself is information, not decoration.

## Responsive / mobile requirements

- The session chrome (timer, progress bar, End session) stays reachable
  **without scrolling past the board** on small viewports.
- The timer is compact and legible on mobile; the progress bar spans the chrome
  width without causing horizontal scroll.
- The pre-session gate presents the duration options as a wrapped, touch-sized
  group (targets ≥ ~44 px); **No time limit** and **Begin** are always visible.
- The summary stacks on mobile; all actions are touch-operable.
- Both light and dark themes render the timer, warning state and progress bar
  legibly (the warning state is not colour-only).

## Performance constraints

- **No engine, no network.** The session adds only a wall-clock timer and a
  read-time projection of already-loaded rows.
- The countdown is driven by a single lightweight interval/rAF that updates the
  chrome text/bar; it does not re-render the board or the move list and does
  not measure layout per tick.
- The summary is O(session rows) and reuses the canonical metric function; it
  is computed once at session end.
- No new storage read per tick; settings are read once at gate/session start.
- No new dependency; no bundle impact beyond the session chrome and gate.

## Acceptance criteria

1. A pre-session commit gate appears on the cycle page after the same-day
   spacing nudge and before the first puzzle, offering **5/10/15/20/30/45/60
   minutes + No time limit** with the Default session length preselected, and
   the timer starts only on **Begin**.
2. The session chrome shows a quiet wall-clock `mm:ss` countdown and a thin
   progress bar (no modal/alert) that turns red when remaining ≤ the Session
   warning threshold (default 30 s) and ends the session at zero.
3. Expiry mid-puzzle stops immediately, discards the in-progress presentation
   with **no new attempt row**, keeps the puzzle queued, and still counts any
   already-written `failed` row.
4. An **End session** control stops the run early, discards the in-progress
   presentation and shows the summary; the cycle stays `inProgress` and
   resumable.
5. The session summary is derived from the cycle's attempt rows with
   `endedAt >= sessionStart` and reports first-try, solved-with-help, failed and
   skipped counts, first-try accuracy, time used, average time per puzzle and
   remaining cycle puzzles, with **Resume cycle** and **Back to training**
   actions.
6. When the cycle completes before the timer, the session summary is shown
   first with a **View cycle results** action, then the existing results page.
7. The existing `solve-clock` is revealed (red) once elapsed ≥ the Puzzle timer
   red threshold (default 30 s) even when Show puzzle timer is off; when on it
   is always visible and turns red at the threshold.
8. The four settings exist with the documented keys and defaults: Show puzzle
   timer (existing, default off), Puzzle timer red threshold (default 30 s),
   Default session length (default 10 min), Session warning threshold (default
   30 s).
9. Session and puzzle timers use wall-clock time: backgrounded/hidden-tab time
   counts and a restart does not reset the puzzle clock.
10. The timer is not colour-only (`role="timer"`, text state) and announces
    threshold crossings politely, not every second.
11. **Nothing new is persisted** and the summary is derived; there is no
    session table, row, column or index, and `PERSISTENCE_SCHEMA_VERSION` is
    unchanged.
12. No new dependency, no ADR and no change to cycle/attempt semantics; session
    history and statistics are out of scope.
13. All changes are covered by automated tests and the full gate passes.

## Testing requirements

### Focused tests first

- **Gate**: the options and their order; Default session length preselection;
  Begin starts the timer; no countdown before Begin; the gate is skipped for a
  completed/abandoned cycle.
- **Timer**: countdown formatting (`mm:ss`); warning state at the threshold;
  expiry ends the session; no-limit never expires; clamping on a backwards
  clock.
- **Expiry**: discards the in-progress presentation (no new row), keeps the
  puzzle queued, and includes an already-written `failed` row.
- **End session**: stops the run, discards the presentation, leaves the cycle
  `inProgress`, shows the summary.
- **Summary**: counts per result, first-try accuracy denominator, `empty` rates
  with zero definite rows, time used, average time per puzzle, remaining count;
  the window predicate (`same cycleId`, `endedAt >= sessionStart`); Resume
  cycle / Back to training; summary-before-results on completion.
- **Per-puzzle timer**: hidden by default; revealed at the red threshold when
  the setting is off; always visible and red at the threshold when on; restart
  does not reset the reveal.
- **Settings**: key/value round-trip and fallback/snap for the three new keys;
  the existing `puzzle.timer` boolean unchanged.

### Accessibility / responsive

- `role="timer"` with a text label; polite threshold announcements (not
  per-second); keyboard/touch reachability of the gate, End session and summary
  actions; red state has a text equivalent; reduced-motion; mobile chrome and
  summary layout (Playwright where Chromium is available).

### Deterministic fixtures

- Reuse Feature-012/013 attempt and cycle fixtures; add sessions covering
  first-try / help / failed / skipped mixes, a wrong-move-before-expiry case, a
  zero-definite-row session, a cycle-completed-during-session case, and
  invalid/unset setting values. No engine, network or real IndexedDB required
  for domain/component tests.

### Narrow-first order

Run the focused component/domain tests first, then the full gate
(`npm run lint`, `typecheck`, `format:check`, `test`, `build`, `dev`,
`test:browser` when Chromium is available, `npm audit`) per `AGENTS.md`.

## Dependencies

- Feature 012 — the `solve-clock`, wall-clock timing semantics, discard-on-leave
  rule and immutable attempt rows.
- Feature 013 — the cycle session host, the cycle page, the same-day spacing
  nudge, the resumable cycle and the canonical cycle metrics.
- `domain/tactical-training.md` — the cycle/attempt model the summary projects.
- Feature 001 — the settings repository and Settings page.
- **No new dependency, no ADR, no schema change.**

## Conflicts, ambiguities & ADR assessment

### Conflicts with existing specs

1. **Feature 012 states the solve clock is "not rendered at all" when Show
   puzzle timer is off.** Feature 019 supersedes that clause: the clock is
   revealed (red) at the Puzzle timer red threshold even when the setting is
   off. The default-hidden behaviour is kept; only the reveal rule is added.
2. **Feature 013's cycle session has an Exit control** that leaves the cycle
   `inProgress`. Feature 019 adds **End session** with a different post-action
   (show the ephemeral summary). Both leave the cycle resumable; the exact
   relationship (End session alongside Exit, or End session replacing Exit on
   the session chrome) is flagged below.
3. **Feature 013 owns the cycle session and results.** Feature 019 adds the
   session wrapper, the summary and cycle-progress display without changing
   cycle/attempt semantics.

### Ambiguities resolved with a recommended default

1. **"Time used" definition.** Recommended: session wall-clock elapsed time
   (`sessionEnd - sessionStart`, the timer's consumed time), which is what the
   user experiences; the per-puzzle average separately uses the canonical
   `solvingTimeMs` average. Confirm if "time used" should instead be the sum of
   puzzle solving times.
2. **Exit vs End session.** Recommended: keep Feature-013 Exit (leave the
   cycle) and add End session (stop the run and show the summary); End session
   is the primary session control. Confirm if End session should replace Exit
   on the session chrome.
3. **No-time-limit presentation.** Recommended: no countdown and no progress
   bar, with an elapsed-time label; End session still summarizes. Confirm if a
   count-up timer is preferred.
4. **Gate on resume.** Recommended: the gate is shown whenever a solving run is
   begun (start or resume), so each session has an explicit duration. Confirm
   if resuming should reuse the previous session's remaining time (which would
   require ephemeral session state and is more complex).
5. **Summary window predicate.** Recommended: the same `cycleId` and
   `endedAt >= sessionStart`; no upper bound is needed because no row is written
   after the session ends. Confirm.
6. **New setting key names.** Recommended:
   `puzzle.timerRedThreshold`, `training.session.defaultMinutes`,
   `training.session.warningSeconds` (grouping session settings under
   `training.session.*` and keeping puzzle-timer settings under `puzzle.*`).
   Confirm the exact key strings before implementation.
7. **Session history/statistics.** Explicitly out of scope; no persisted
   session artifact is created, so a future session-history feature would need
   its own spec and (if stored) a schema decision.

### ADR assessment

**No new ADR is required.** Every decision is presentation, ephemeral UI state
or a settings default:

- The session is not a domain entity and persists nothing; the cycle/attempt
  model and ADR-031 (no per-puzzle scheduler) are untouched.
- The four settings are ordinary values in the existing settings store; no
  scheduler or retention semantics are introduced.
- The per-puzzle reveal is a display rule over the existing wall-clock timer;
  it does not gate, fail or alter a presentation.
- No dependency change and no persistence/schema change (ADR-001, ADR-002/014,
  ARCHITECTURE §7 remain intact).

## Context

Required reading (paths only; see `.opencode/CONTEXT-MAP.md`):

- `AGENTS.md`
- `.opencode/DECISIONS.md`
- `.opencode/specs/ARCHITECTURE.md` (§3 layers, §7 storage, §10 performance)
- `.opencode/specs/features/012-puzzle-training.md`
- `.opencode/specs/features/013-tactical-training-cycles.md`
- `.opencode/specs/domain/tactical-training.md`
- `.opencode/specs/decisions/ADR-031-tactical-training-cycles.md`
