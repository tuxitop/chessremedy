# Feature 013 — Tactical Training Cycles

## Purpose

Deliver the V1 **training lifecycle**: explicit, one-click **Woodpecker
blocks** and repeated **training cycles** over a fixed block (Woodpecker-
inspired; ADR-031). This feature replaces the interim `/puzzles` practice host
with the real cycle host, owns block formation and management and the cycle
start → resume → complete → abandon → repeat lifecycle, and hosts Feature
012's solving screen and its immutable `puzzleAttempts` rows under **real
cycle ids**.

It answers the product question "What should I train next?" by turning the
user's own generated puzzles (Feature 011) into a deliberate, measurable
training artifact, and produces the set/cycle records Feature 014 aggregates
over and Feature 015 renders.

The app **never forms a block on its own**: the user commits with a single
primary button. Membership is machine-selected (the user never hand-picks
puzzles) but only on explicit user action, and is frozen once created.

This feature:

- never schedules puzzles individually (no FSRS, no due/review state, no
  per-puzzle difficulty; ADR-031);
- never runs the engine and never touches the network (solving is Feature
  012; cycle metrics are pure domain functions over persisted rows);
- never modifies, re-rates or deletes an immutable `PuzzleRow`;
- never re-implements the Feature-012 solving interaction, hint content or
  outcome write;
- owns the derived **pool** (unmastered puzzles not in the open block), the
  one-click **Woodpecker block** (a fixed, difficulty-ascending snapshot) and
  the **Quick train** ad-hoc session over the pool;
- owns the canonical **puzzle-mastery** derivation (a legitimate first-try
  solve in 3 distinct cycles) shared with Feature 014 — **informational only**,
  driving no automatic retirement;
- owns the full **block lifecycle**: one-click create, repeated cycles,
  finish/abandon (which archive the block and preserve its history) and
  **delete** (which removes the block and cascades its cycles/attempts behind a
  destructive confirmation);
- performs a **one-time, idempotent startup cleanup** of the pre-block-model
  legacy auto sets (`auto:all-puzzles`, `auto:woodpecker-random`) and their
  cycles/attempts — remediation for rows written before the explicit block
  model, never a block-creation path;
- never computes the Dashboard's statistics (Feature 014) or renders charts
  (Feature 015).

All domain behavior is deterministic for fixed inputs and a caller-supplied
`now`, and is independently testable with fixtures — no engine, network or
real IndexedDB required for domain tests.

**Supersedes.** This revision replaces the earlier Feature-013 model of two
system-seeded auto sets (`allPuzzles`, `woodpeckerRandom`) with per-cycle
virtual membership and mastery-driven retirement. The app no longer seeds or
forms any set automatically: a **Woodpecker block** is an explicit one-click,
fixed snapshot, the **pool** is derived, and mastery is informational. The
random-subset selection, per-cycle membership refresh and auto-retirement
rules are removed.

---

## Scope

### In scope

1. **Set management** — create a custom set from a puzzle source/criteria,
   name and (re)configure it, select it for training, archive/unarchive it,
   delete it (with confirmation); create/close/delete a **Woodpecker block**
   with one click (close archives and preserves history; delete removes the
   block and its history behind a destructive confirmation).
2. **Cycle lifecycle** — start a cycle over a set/block, present its puzzles
   in the cycle's order, record every attempt through Feature 012, handle
   wrong answers/hints/skips/retries per the configured behavior, resume an
   interrupted cycle, complete it, abandon it, and start the next cycle.
3. **Cycle configuration** — ordering, retry-failed behavior, hint-level
   availability and threshold, completion rules (skip allowed), optional
   target solving time, and the optional planned number of cycles. There is
   **no accuracy gate** (target accuracy is optional and informational only).
4. **Cycle results** — the read-only per-cycle results view and the canonical
   per-cycle aggregate metrics (shared with Feature 014), including the
   **total solving time and its delta vs the previous cycle**.
5. **Persistence** — the `trainingSets` and `trainingCycles` tables (schema
   v10), their repositories, indexes, ownership and deletion cascade.
6. **Host contract** — the cycle session host that drives Feature 012's
   `SolveScreen`/`usePuzzleSolve`/`PuzzleAttemptRecorder` and replaces the
   interim practice host.
7. **Deterministic fixtures** for sets, blocks, cycles and attempt-driven
   aggregates.
8. **Woodpecker block formation** — the one-click action that auto-selects up
   to N (default 200) puzzles from the derived pool, easy→hard, and stores a
   fixed membership snapshot; the close/return-to-pool lifecycle; the
   one-open-block-at-a-time rule.
9. **Derived pool & Quick train** — the derived unmastered pool (not stored as
   a set) and the non-stored ad-hoc session over it, writing attempts under a
   real ad-hoc cycle identity.
10. **Mastery (informational)** — the canonical 3-distinct-cycle legitimate
    first-try mastery derivation and the read-only mastered-puzzles surface;
    mastery excludes nothing automatically and retires nothing.
11. **Legitimate in-cycle solve rule** — the hint / wrong-move / restart
    disqualification and the immutable one-row-per-presentation guarantee that
    prevents re-rolling a clean first-try credit.
12. **Legacy auto-set cleanup** — the one-time, idempotent startup removal of
    the pre-block-model `auto:all-puzzles` / `auto:woodpecker-random` rows and
    their cycles/attempts.

### Out of scope

- The solving interaction, hints, wrong-move handling, outcome derivation and
  the attempt-row write (Feature 012; consumed, never re-implemented).
- Puzzle generation, immutability and the per-game puzzle view (Feature 011;
  Feature 013 only consumes `PuzzleRow` and hands off the set-building entry
  point).
- Blunder-puzzle difficulty re-rating from solver data (deferred; see
  "No puzzle re-rating").
- Individual-puzzle scheduling / FSRS / due/retention state (ADR-031).
- Cross-game FEN dedup or transposition merging (Feature-011 V1 rule).
- Statistics aggregation, cross-cycle series and the Dashboard (Features
  014/015).
- Sync of sets/cycles/attempts as standalone values (Feature 016 tombstones
  only).
- Semantic tactical-motif taxonomy (V1; `domain/tactics.md`).
- **Automatic block/set creation or seeding** — the app never forms a block
  or a set on its own; no `ensureAutoSets()` and no system-managed rows.
- **Per-cycle membership refresh** — a block's membership is frozen at
  creation and never re-derived per cycle (this supersedes the former
  virtual/auto-refresh rule).
- **Random-subset selection** — the former `woodpeckerRandom` recipe is
  dropped; a block is always the easiest-N snapshot of the pool.
- **An accuracy gate / enforced cycle count** — the Woodpecker method has no
  100% gate and the ~6-cycle plan is guidance only; the app never blocks a
  cycle or completion on accuracy or a cycle target.
- User editing of a block's membership or recipe: a block is a fixed snapshot;
  custom game/pool/manual sets keep editable stored membership.
- An un-master action: mastery is monotonic and the mastered list is read-only
  in V1.
- Storing mastery, per-puzzle progress or scheduler state on a puzzle or any
  row: mastery is derived at read time (ADR-031).

---

## Relationship to other features

| Feature | Role |
|---|---|
| 003/004 | `chessops` game/domain types and local persistence primitives. |
| 006/008 | Shared analysis-board surface and stored `MoveAnalysis` (used by Feature 012, inherited through it). |
| 007 | Game Library and the canonical row/insight/action surface; set creation is reached from the per-game puzzle view. |
| 011 | Immutable `PuzzleRow` source (both origins); hands the set-building entry point to this feature. |
| 012 | The solving screen, hint/outcome rules and the immutable `puzzleAttempts` write; **Feature 013 hosts it** and consumes its outcomes. |
| 014 | Aggregates over the set/cycle records and attempts this feature owns; the canonical cycle metric, **mastery** and pool functions are shared, never duplicated. |
| 015 | Dashboard, read-only consumer of Feature 014. |
| 016 | Deletion tombstones consistent with this feature's ownership rules. |

**Boundary with Feature 012.** Feature 012 is the solving experience; it
writes exactly one immutable attempt row per presentation and never computes
cycle aggregates. Feature 013 owns the ordered queue, set/cycle lifecycle,
retry passes, resume, completion and every cycle-level metric. Feature 013
never writes or mutates an attempt row itself — it drives the Feature-012
recorder and reads the rows.

**Feature-012 restart contract (consumed, not re-implemented).** Feature 012
defines `restartCount` on `PresentationCounters` and the immutable
`PuzzleAttemptRow`, and `deriveResult` returns `solvedWithHelp` for a `solved`
trigger when `restartCount > 0` (in addition to the existing hint/wrong-move
conditions). Feature 013 consumes the persisted counter for the mastery
derivation and never re-derives it.

---

## User-facing behavior

This feature owns the training surfaces under the existing `/puzzles` nav
entry and **removes the interim practice host** (see "Interim host
supersession"). Exact route paths are a plan decision; the required surfaces
and behaviors are:

### 1. Training home (`/puzzles`)

- Shows the single **open Woodpecker block** when one exists (name, fixed
  puzzle count, current cycle number/status, last-activity date) and a primary
  **Create Woodpecker block** action when none is open.
- Shows the derived **pool** size (unmastered puzzles not in the open block)
  and a **Quick train** action that starts an ad-hoc session over the pool
  without creating a set.
- Lists any custom (game/pool/manual) training sets; archived sets are
  reachable behind an "Archived" affordance.
- **Guidance copy** (see "Woodpecker block + pool + Quick train"): a block is
  fixed once created, the recommended size is 200–400 puzzles, and below about
  100 puzzles later cycles risk memorising diagrams.
- Shows a link to the read-only **Mastered puzzles** list (see "Mastered
  puzzles list").
- Shows a **resume banner** when a cycle is `inProgress`, linking directly
  back into that cycle at the next unanswered puzzle. The banner shows the
  cycle's **progress** from the canonical cycle metrics — **first-try
  accuracy**, **solved count** and **remaining count** — never a fabricated or
  re-derived number.
- Offers **New custom set** and, when no puzzles exist at all, an explicit
  empty state that explains puzzles must first be generated from games
  (Feature 011) and links to the Game Library.
- Never shows a bare `0` for absent data (e.g. a custom set whose puzzles were
  all removed by game deletion shows an empty/archived state, not a fake
  count).

### 2. Block and set creation

- **Create Woodpecker block** (primary, one click): a single primary action
  auto-selects up to N puzzles (default **200**) from the derived pool in
  difficulty-ascending order. The user never hand-picks puzzles. Mastery is
  handled automatically (mastered puzzles are excluded because they are not in
  the pool). If the pool is smaller than N, the block takes all of the pool.
  - **Minimal options.** The only option is block size (**100 / 200 / 400**),
    and it lives behind an **"Advanced"** disclosure, never in the main flow;
    the main flow is the single button at the default 200.
  - **One open block at a time.** While a block is open the create action is
    disabled; the open block must be finished or abandoned first.
  - **Fixed membership.** The selected ids are stored as the block's frozen
    `puzzleIds` snapshot. New puzzles are not added mid-plan and membership is
    not re-derived per cycle.
- **Custom sets** (secondary, explicit): a custom set can be created from a
  game's puzzles (Feature 011's per-game puzzle view) or from a filtered
  puzzle selection, honoring target size and ordering. Custom sets store a
  human-readable `source` descriptor plus the resolved membership snapshot;
  their membership is editable, unlike a block's.
- Creation resolves membership **once** and stores it: every set (block or
  custom) is a fixed collection, not a live query. There is no virtual or
  per-cycle membership.

### 3. Block and set detail

- **Block detail**: shows the recipe (size), the frozen membership (with
  per-puzzle origin, objective and difficulty bucket), the cycle history and a
  start/continue action. It explains that the block is **fixed** (new puzzles
  are not added mid-plan) and that finishing or abandoning it returns its
  still-unmastered members to the pool. A block has no rename, no membership
  editing and no per-cycle refresh. It closes via **Finish block** (the plan is
  complete) or **Abandon block** — both **archive** it and keep its history —
  and it can also be **deleted** via a destructive **Delete block** action that
  removes the block and all of its cycles and recorded attempts (see "11.
  Ownership, archive and deletion"). The delete confirmation names the block
  and its cycle/attempt counts and cannot be undone; delete is distinct from
  finish/abandon, which preserve history.
- **Custom set detail**: rename, edit configuration, view membership, view
  cycle history, start/continue a cycle, archive/unarchive and delete
  (destructive confirmation naming the set and its cycle/attempt counts).
- **Per-cycle progress**: the block/set **cycle history** shows each cycle's
  progress from the canonical cycle metrics (**first-try accuracy**, **solved
  count**, **remaining count**) alongside its status, so progress is visible
  across cycles without opening each one. No new metric is computed.
- Starting a cycle shows the effective config snapshot and the puzzle count
  before committing.

### 4. Cycle session

- Hosts Feature 012's `SolveScreen` for one presentation at a time, with the
  cycle's ordered queue and config snapshot.
- Session chrome shows progress ("Puzzle X of Y" plus the cycle's **first-try
  accuracy**, **solved count** and **remaining count** from the canonical cycle
  metrics), the set name, the current cycle number, an **Exit** control that
  leaves the cycle `inProgress` (resumable) and a **Skip** control when
  skipping is allowed.
- **Timed session setup (Feature 019).** Before the first puzzle of a solving
  run, the host shows a **pre-session commit gate** (after the same-day spacing
  nudge) offering 5/10/15/20/30/45/60 minutes or **No time limit**; the timer
  starts on **Begin**.
- **Session timer and summary (Feature 019).** A quiet wall-clock countdown and
  progress bar sit in the chrome, turning red at the warning threshold and
  ending the session at zero. Expiry stops the run immediately and discards the
  in-progress presentation (no row; the puzzle stays queued), while any
  already-written `failed` row still counts. An **End session** control stops
  the run early; both paths leave the cycle `inProgress` and resumable and show
  the ephemeral **session summary** (first-try / help / failed / skipped
  counts, first-try accuracy, time used, average time per puzzle, remaining
  puzzles; Resume cycle / Back to training). If the cycle completes before the
  timer, the summary is shown first with a **View cycle results** action.
- Does **not** show puzzle difficulty, cycle ordering rationale or any
  scheduling language (no "due", no "next review"; ADR-031).
- When a new cycle is started **on the same local calendar day** as the
  previous cycle of the same block ended, shows a non-blocking **spacing nudge**
  recommending training the block on different days; the user may proceed. This
  is guidance, not a gate.
- Advancing happens only after the attempt row is durably written (Feature
  012 guarantees this); an unwritten outcome keeps the result visible with an
  inline retry and the session does not advance.
- Leaving mid-presentation discards that presentation (no row) and the puzzle
  is re-presented as the next unanswered puzzle on resume (Feature 012 rule).

### 5. Cycle results

- Read-only view of a cycle: status, cycle number, start/completion times,
  per-puzzle outcomes (including retries/skips), and the canonical cycle
  aggregates.
- Completed cycles can be reviewed and compared with previous cycles of the
  **same set/block**; a comparison never claims the training method caused the
  change (same caveat as `domain/statistics.md`).
- Shows the cycle's **total solving time** and its **delta vs the previous
  cycle of the same block**, with a "beat half the previous cycle's time"
  target once a previous cycle exists (the Woodpecker time-halving ladder).
- Surfaces the **60–75% first-cycle first-try** band as guidance, not a gate,
  and suggests an optional **~6-cycle plan**; neither is enforced and neither
  blocks completion.
- "Start next cycle" (repeat) is offered from a completed or abandoned cycle.
- An `inProgress` cycle shows partial aggregates and a resume action; an
  `abandoned` cycle is shown separately and is never resumable.
- A cycle completed by a timed session (Feature 019) shows the ephemeral
  **session summary** first (with a **View cycle results** action) before this
  page.
- **Per-cycle progress**: the results/history surfaces show each cycle's
  **first-try accuracy**, **solved count** and **remaining count** from the
  canonical cycle metrics; no value is re-derived.

### 6. Woodpecker block + pool + Quick train

Three concepts replace the former auto-generated sets; **none is created
without an explicit user action**.

| Concept | What it is | Stored? | Trainable |
|---|---|---|---|
| **Pool** | every owned puzzle that is **not mastered** and **not a member of the currently-open block** | no (derived) | via **Quick train** only |
| **Woodpecker block** | a **fixed snapshot** of up to N pool puzzles, easy→hard, formed by one click | yes (`trainingSets` row, frozen `puzzleIds`) | yes, as repeated cycles |
| **Quick train** | an ad-hoc, non-stored session over the whole pool, easy→hard | cycle row only; **no set row** | yes, immediately |

- **Pool.** Derived at read time from `puzzles` minus the derived mastery set
  minus the open block's members. It grows as games are analyzed and puzzles
  are generated; it is never stored as a set and there is no "pool set".
- **Woodpecker block.** Created by the one-click **Create Woodpecker block**
  action (default size 200; 100/200/400 behind "Advanced"). Membership is
  frozen at creation; it never refreshes per cycle. Only **one block is open
  at a time**. When the block is finished or abandoned it closes, and its
  still-unmastered members return to the pool; the same button then forms the
  next block from the remaining pool plus any newly generated puzzles.
- **Quick train.** A one-tap session over the pool for a brand-new user (or
  any time) who wants to practise before committing a block. It creates no
  `trainingSets` row; it snapshots the pool into an ad-hoc `trainingCycles`
  row (see Domain behavior §3c) and writes normal immutable attempts. Tapping
  it again **resumes** the open session instead of starting a new one, and its
  solves **do not** count toward mastery (casual practice).

**Guidance copy shown to the user** (training home and block detail):

- a block is **fixed** once created — new puzzles are **not** added mid-plan;
- the recommended size is **200–400** puzzles;
- below about **100** puzzles, later cycles risk **memorising the diagrams**
  rather than training pattern recognition;
- success is **speed and automaticity**, not a perfect score — there is no
  100% gate.

A user who has generated no puzzles sees the pool empty with the
"generate puzzles first" empty state; a user with a small pool can still use
**Quick train**.

### 7. Mastered puzzles list

A read-only surface under `/puzzles` lists every mastered puzzle (definition
in "Legitimate in-cycle solves" and "Mastery"): puzzle id/provenance, source
game, origin and objective, difficulty bucket, and the distinct cycles that
earned mastery (count and dates). Mastery is **informational**: it is a
read-time filter, not an action. A mastered puzzle is outside the pool by
definition and so is not selected into a future block, but mastery never
mutates a stored row, never removes a puzzle from an existing block, and never
archives anything. It has an explicit empty state and requires no un-master
action in V1 (mastery is monotonic). It is reachable from the training home
and never starts a solve.

### 8. Legitimate in-cycle solves (restart and re-entry)

Only a **legitimate in-cycle solve** may earn a clean first-try result or a
mastery credit. A `solvedFirstTry` is legitimate only when it is the **first
presentation** of the puzzle in a **real cycle** and records **no hint, no
wrong move and no restart**. Consequently:

- a hint solve is `solvedWithHelp` (never clean);
- a wrong move records `failed` immediately (never clean);
- **restarting/resetting** the puzzle disqualifies the presentation: a later
  clean line in the same presentation records `solvedWithHelp`
  (`restartCount > 0`), never `solvedFirstTry`;
- navigating away and back cannot launder a clean credit: an attempt row is
  immutable and first-write-wins on
  `[cycleId, puzzleId, presentationIndex]`, so re-entry can neither overwrite
  an existing row nor add a second clean credit for the same presentation; and
  a presentation abandoned after a hint or restart is recorded durably
  (V1 default: a `failed` row carrying the recorded counters, per the
  Feature-012 contract extension) so the cycle cannot later earn a clean
  first-try for it;
- a **retry presentation** (bounded, at most two per cycle) is a distinct row
  but the **same cycle**, so it never adds a distinct-cycle mastery credit;
  mastery counts the cycle's first presentation only.

Only real cycle ids produce attempts. The interim practice host is deleted (see
"Interim host supersession"); no `practice:*` pseudo ids and no non-persisting
recorder remain, so every attempt row belongs to a persisted `trainingCycles`
row.

### Interim host supersession

Before this feature ships, Feature 012 introduced a temporary `/puzzles`
practice host (`src/pages/PuzzlesPage.tsx`) with a non-persisting in-memory
recorder and ephemeral `practice:*` pseudo ids. When the real cycle host
lands, Feature 013 **replaces and removes** that page, its practice copy, its
`practice:*` ids and its in-memory recorder, and takes over the `/puzzles`
nav entry. The practice-host tests are replaced by the cycle-host tests.
Real sessions persist attempts under **real cycle ids** through the
Feature-012 `SolveScreen` + `PuzzleAttemptRecorderLike` contract.

---

## Domain behavior

All functions are pure, synchronous domain functions over already-loaded
inputs. The application service loads persisted rows; the domain module has
no React/Dexie/Worker imports.

### 1. Training set model

```ts
type TrainingSetStatus = 'active' | 'archived';
type OrderingPolicy = 'difficultyAsc' | 'sourcePly' | 'manual';
type RetryFailed = 'none' | 'endOfCycle' | 'immediate';

interface HintConfig {
  enabledLevels: readonly HintLevel[]; // subset of [1,2,3,4]
  firstHintLevel: HintLevel;           // first press reveals this level
}

interface CycleConfig {
  ordering: OrderingPolicy;
  retryFailed: RetryFailed;
  hints: HintConfig;
  allowSkip: boolean;
  targetAccuracy: number | null;       // 0..1, informational only; never a gate
  targetSolvingTimeMs: number | null;  // informational
  plannedCycles: number | null;        // informational (~6 suggested; not enforced)
  configVersion: number;               // semantics version (ARCHITECTURE §9)
}

// One-click Woodpecker block recipe. The app never forms a block on its own;
// the user commits with the create button. `size` is the requested cap.
type BlockRecipe = { kind: 'woodpeckerBlock'; size: number }; // 100 | 200 | 400

type SetSource =
  | { kind: 'game'; gameId: string }
  | { kind: 'pool'; filters: PuzzlePoolFilters }
  | { kind: 'manual' }
  | { kind: 'auto'; recipe: BlockRecipe };   // one-click Woodpecker block

interface TacticalTrainingSetRow {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  status: TrainingSetStatus;      // 'active' = open block (at most one); 'archived' = closed
  source: SetSource;              // provenance, or the block recipe
  puzzleIds: readonly string[];   // fixed membership for every kind, incl. the block
  targetSize: number;             // creation cap (default 10); for a block, the recipe size
  config: CycleConfig;            // current config; snapshotted per cycle
}
```

- Every set's membership is **stored state**, not a live query; editing a
  custom set re-resolves membership explicitly, and a block's membership is
  frozen at creation and never edited.
- The former virtual/derived `auto` membership is removed: a block stores its
  resolved `puzzleIds` snapshot (the easiest-N pool selection at creation).
  `source.kind === 'auto'` identifies the block and carries its recipe for
  provenance/versioning; it does **not** mean the app created it — creation is
  always an explicit one-click user action.
- The **pool** is not a set and is never stored: it is derived at read time as
  `pool := [p | p in puzzles, not mastery.isMastered(p.id), p.id not in
  openBlock.members]`.
- A puzzle may belong to zero, one or many sets; membership lives on the set,
  never on the `Puzzle` (ADR-031).
- At most one set with `source.kind === 'auto'` may be `active` (the open
  block); closing it sets `status: 'archived'`. `source` is provenance for
  custom sets and the block recipe for a block.
- A Woodpecker block is identified by `source.kind === 'auto'` **and**
  `source.recipe.kind === 'woodpeckerBlock'`. The extra recipe check is
  defensive: it prevents a pre-block-model legacy auto row (`allPuzzles` /
  `woodpeckerRandom`, removed by the startup cleanup) from ever being read as
  the open block if cleanup has not run.
- Deletion is **row removal**, not a third `status`: there is no `deleted`
  status. Finish/Abandon keep the row (`status: 'archived'`); delete removes it
  and its cycles/attempts.

### 2. Set creation and membership resolution

Block creation is a pure function of the persisted puzzles, the derived
mastery map and the currently-open block:

- **block** source → the pool (unmastered, not in the open block), ordered
  `difficultyAsc` (see §3), take at most `recipe.size`; the resolved ids are
  stored as the block's frozen `puzzleIds`. If the pool is smaller than
  `size`, the block holds all of it. If the pool is empty, creation is blocked
  with an explanation (no empty block is created). If a block is already open,
  creation is rejected with a typed result.

Custom set resolution is unchanged and is a pure function of the persisted
puzzles, the optional source game summaries and the config:

- **game** source → the game's `puzzles` rows, optionally filtered by origin
  and/or difficulty bucket.
- **pool** source → all puzzles matching the explicit library filters at
  creation time (a snapshot, distinct from the derived pool).
- **manual** → the caller-provided id selection.

Then, under the configured `ordering` (see §3), take at most `targetSize`
puzzles. If fewer exist, the set holds all of them. A custom set with zero
resolved puzzles is created empty with an explicit empty state (it is never
silently deleted). Membership ids are canonical
`puzzleIdOf(sourceGameId, sourcePly)` values; a missing puzzle row at training
time is skipped (Feature 012 error case).

### 3. Ordering and target size

Allowed V1 orderings, all deterministic:

- `difficultyAsc` (default) — puzzle difficulty ascending, ties by
  `sourcePly` ascending, then `puzzleId` ascending;
- `sourcePly` — by `sourceGameId` then `sourcePly` ascending;
- `manual` — the stored `puzzleIds` base order.

For a **block**, selection is always `difficultyAsc` (fixed; no user choice)
and `recipe.size` is the cap: the block takes the **easiest N** pool puzzles.
`targetSize` (default 10) is the creation cap for custom sets; it is not a
hard runtime limit on an existing set. The exact "first N under the ordering"
selection rule is deterministic and fixture-testable.

### 3a. Block formation (one-click, fixed snapshot)

A **Woodpecker block** is formed only by the explicit one-click **Create
Woodpecker block** action; the app never forms one on its own. Formation is a
pure function of the persisted puzzles, the derived mastery map, the
currently-open block and the requested size:

```text
formWoodpeckerBlock(puzzles, mastery, openBlock, size):
  pool := [p | p in puzzles, not mastery.isMastered(p.id),
               p.id not in openBlock.members]
  ordered := sortAscending(pool, difficulty, then sourcePly, then puzzleId)
  blockMembers := first(size, ordered)   // all of it when |pool| < size
  return { members: blockMembers, recipe: { kind: 'woodpeckerBlock', size } }
```

- **One click, no hand-picking.** The user presses one primary button; the app
  selects up to `size` puzzles. The only option is size (**100 / 200 / 400**,
  default **200**) and it lives behind an **"Advanced"** disclosure, never in
  the main flow.
- **Easy→hard bias.** Difficulty-ascending order means the block is the
  easiest N of the pool, which biases selection toward easier puzzles as the
  Woodpecker method prescribes. The order is **fixed and identical every
  cycle**; it is never shuffled.
- **Fixed snapshot.** The selected ids are written to the block's `puzzleIds`
  and never change. New puzzles are **not** added mid-plan and the membership
  is **not** re-derived per cycle (this supersedes the former "re-derived at
  each cycle start" rule).
- **Mastery handled automatically.** Mastered puzzles are excluded because
  they are not in the pool; no manual exclusion is needed.
- **One open block at a time.** While a block is `active`, creating another is
  rejected. There is no system seeding, no `ensureAutoSets()`, and no
  system-managed row.
- **Close / return to pool.** The block's plan ends when the user **finishes**
  the block (the optional ~6-cycle plan is complete) or **abandons** it. Both
  close it (`status: 'archived'`) and return its **still-unmastered** members
  to the pool; mastered members stay outside the pool by definition. The same
  create button then forms the next block from the remaining pool plus any
  newly generated puzzles.
- **Delete (full removal).** A block (open or closed) can be **deleted**
  entirely, not only closed. Deletion removes the block row and cascades its
  `trainingCycles` and `puzzleAttempts` rows in the same transaction as a
  custom-set delete (the `trainingSetId`/`cycleId` indexes); the puzzles and
  every other game/analysis are untouched. It is behind an explicit destructive
  confirmation naming the block and its cycle/attempt counts. Delete is
  **distinct from Finish/Abandon**: Finish/Abandon archive the block
  (`status: 'archived'`) and **preserve** its cycle history, while delete
  **discards** that history and cannot be undone. Deleting the open block
  immediately frees the single open-block slot (its members were never removed
  from `puzzles`, so the pool and the create action behave as if it never
  existed).
- **Small / empty pool.** If the pool is smaller than `size`, the block takes
  all of it (never padded or fabricated). If the pool is empty, creation is
  blocked with an explanation and a link to generate puzzles; the user can
  still **Quick train** when the pool is non-empty.
- **Recommended size guidance.** Guidance copy recommends **200–400** puzzles
  and warns that below about **100** puzzles later cycles risk memorising
  diagrams rather than training recognition; this is guidance, not a gate, and
  the user may create a smaller block.

### 3b. Mastery (canonical derivation, informational)

Mastery is derived, monotonic and global per puzzle (across all sets/cycles):

```text
isLegitimateFirstTrySolve(row) :=
  row.presentationIndex === 1
  && row.result === 'solvedFirstTry'
  && row.hintCount === 0
  && row.wrongMoveCount === 0
  && row.restartCount === 0

masteryOf(puzzleId) :=
  distinct cycleIds among the puzzle's legitimate first-try rows
  mastered := distinctCycleCount >= 3
```

- **Three distinct cycles.** A puzzle is mastered when it has a legitimate
  first-try solve in **3 distinct cycles**. Multiple rows in one cycle count
  once; a retry presentation never adds a credit (only
  `presentationIndex === 1` counts). "Distinct cycle" is the persisted
  `cycleId` of a real `trainingCycles` row; orphaned rows are ignored.
- **Legitimate only.** Hints, wrong moves and restarts disqualify (see "8.
  Legitimate in-cycle solves"); a `solvedFirstTry` row that records any of
  them is not possible under the Feature-012 contract, and the derivation
  checks the counters defensively.
- **Monotonic.** Once the 3-cycle threshold is met it stays met for the
  retained history: a later failure never un-masters. Deleting the source game
  deletes the puzzle and its attempts (ownership rule), so mastery for that
  puzzle disappears with it.
- **Derived at read time.** No mastery flag, counter or scheduler state is
  stored on the puzzle or any row (ADR-031). `masteryOf` is the single
  canonical pure function, versioned by `MASTERY_VERSION`; Feature 013 (pool
  membership) and Feature 014 (mastered counts) both call it and never
  re-implement it.
- **Informational only — no retirement.** Mastery performs no automatic
  action: it never archives a set, never removes a puzzle from an existing
  block, and never mutates a row. Because the pool is defined as the
  unmastered, not-in-open-block puzzles, a mastered puzzle is simply outside
  the pool and is not selected into a **future** block; this is a read-time
  filter, not a retirement. A block that already contains a puzzle keeps it
  even if it becomes mastered mid-plan, and a custom set is never auto-retired.
- **Mastered list.** The read-only `/puzzles` mastered list is the surfaced
  view of `masteryOf`; V1 has no un-master action.

### 3c. Quick train (ad-hoc identity)

Quick train is an ad-hoc session over the whole pool; it is **not** a stored
set.

- It builds the same `difficultyAsc` queue from the pool (unmastered, not in
  the open block) and drives the Feature-012 solving screen exactly like a
  block cycle.
- It creates **no `trainingSets` row**. It creates a real `trainingCycles`
  row with a reserved ad-hoc `trainingSetId` sentinel (e.g.
  `QUICK_TRAIN_SET_ID = '__quick_train__'`) and a `puzzleIds` snapshot of the
  pool, then writes ordinary immutable attempt rows under that real
  `cycleId`/sentinel `trainingSetId`.
- The sentinel keeps the attempt model intact (every attempt has a real
  `cycleId` and a `trainingSetId`) without inventing a second write path.
  Quick-train attempts are recorded but **do not count toward mastery** (owner
  decision): the canonical mastery derivation ignores cycles whose
  `trainingSetId` is `QUICK_TRAIN_SET_ID`.
- Quick train **resumes** the open session: starting it again reuses the latest
  `inProgress` sentinel cycle (abandoning any other in-progress sentinel cycles)
  rather than creating a new numbered cycle; a fresh sentinel cycle is created
  only when none is in progress. Its session header shows **Quick train**, not
  a cycle number.
- **Conflict to flag:** the ownership/cascade model assumes every cycle
  belongs to a `trainingSets` row. The sentinel has none, so set-deletion
  cascade does not apply to it; Quick-train cycles/attempts are removed only
  by the game-deletion/puzzle cascade. Set-scoped reads (`listForSet`,
  `masteredPuzzleCountForSet`) must exclude the sentinel, and Feature 014 must
  not present Quick train as a set. See "Conflicts surfaced".

### 4. Training cycle model

```ts
type TrainingCycleStatus = 'inProgress' | 'completed' | 'abandoned';

interface TrainingCycleRow {
  id: string;
  trainingSetId: string;
  cycleNumber: number;            // 1-based, per set
  status: TrainingCycleStatus;
  startedAt: number;
  completedAt: number | null;
  abandonedAt: number | null;
  puzzleIds: readonly string[];   // ordered snapshot at cycle start
  config: CycleConfig;            // snapshot at cycle start
  cycleMetricsVersion: number;    // aggregation-semantics version
}
```

- **Snapshot semantics.** A cycle snapshots the set's membership and config
  at start. Editing the set afterwards affects only future cycles; an
  in-progress or completed cycle keeps its snapshot (deterministic resume and
  results).
- **Cycle number** is `max(existing cycleNumber for the set) + 1`; the pair
  `[trainingSetId, cycleNumber]` is unique.
- **Repeat** means starting a **new** cycle over the same set (new
  `cycleNumber`, new snapshot). A completed/abandoned cycle is never reopened.
- Cycle-level aggregate metrics are **derived**, never authoritative stored
  state (see §8).

### 5. Presentation queue and retry semantics

The cycle's ordered queue is the snapshot order. Each puzzle is presented at
most **twice per cycle**:

- first pass — every puzzle in snapshot order;
- retry pass — puzzles whose first presentation was `failed`, re-presented
  per `retryFailed`:
  - `none` — no retry (one presentation per puzzle);
  - `immediate` — the failed puzzle is re-presented next (front of queue);
  - `endOfCycle` (default) — re-presented after all first-pass puzzles.

A puzzle re-presented in the retry pass that fails again is **terminal for
the cycle** and is revisited in the next cycle (it stays in the set). This
bounds each puzzle to at most two presentations per cycle and makes the cycle
always terminate; it is the resolution of the domain's retry wording.

Presentation context supplied to Feature 012:

- `SessionPuzzleContext.trainingSetId` = the set id;
- `SessionPuzzleContext.cycleId` = the cycle id;
- `SessionPuzzleContext.presentationIndex` = 1 for the first presentation, 2
  for the retry presentation (reconstructed from existing attempt rows on
  resume);
- `SolveHintConfig` derived from the cycle's `config.hints`.

Only `presentationIndex === 1` can earn a mastery credit. The host persists the
presentation's `restartCount` (Feature-012 contract) so a solve after a restart
is `solvedWithHelp`, and it records a presentation abandoned after a
hint or restart so a later re-entry cannot be a clean first-try (see "8.
Legitimate in-cycle solves"). A pristine presentation (no move, hint or
restart) may still be discarded with no row, per Feature 012.

A skipped puzzle is recorded (`skipped`) and is terminal for the cycle: it is
not retried and never enters an accuracy denominator. Skipping is available
only when `config.allowSkip` is true.

### 6. Completion and terminal states

A puzzle is **terminal** in a cycle when any of:

- any presentation was solved (`solvedFirstTry` / `solvedWithHelp`); or
- the last presentation was `skipped`; or
- it has reached the allowed presentation count under `retryFailed`
  (`1` for `none`, `2` for `immediate`/`endOfCycle`) and was not solved.

A cycle is **completed** when every puzzle in its snapshot is terminal, or
its puzzle row no longer exists (deleted source game). Skipped puzzles do not
block completion but are not counted as completed. A cycle with zero definite
puzzles completes with `empty` (not `0`) rate/time aggregates.

A cycle is **abandoned** only by explicit user action; it is terminal, keeps
its attempts, is reported separately from completed cycles, and is never
resumable. Exiting the session without completing leaves the cycle
`inProgress` and resumable.

### 7. Resume reconstruction

Resume is **derived**, with no stored cursor: load the cycle snapshot and its
attempt rows (via the `[cycleId+puzzleId]` index), then

- pending first-pass puzzles = snapshot puzzles with no attempt row, in order;
- pending immediate retries = puzzles with exactly one `failed` row when
  `retryFailed === 'immediate'`, in snapshot order, presented next;
- pending end-of-cycle retries = puzzles with exactly one `failed` row when
  `retryFailed === 'endOfCycle'`, appended after the first pass;
- when nothing is pending, the cycle is complete and is marked `completed`.

A missing puzzle row is skipped without an attempt (Feature 012 error case).
This makes resume deterministic and idempotent across reloads.

### 8. Cycle metrics (shared canonical resolution)

Cycle metrics are the canonical definitions of `domain/tactical-training.md`,
reconciled with Feature 012's **one-row-per-presentation** storage. The
per-puzzle cycle resolution and the cycle aggregates are the definitions
already stated in Feature 014 §8; Feature 013 introduces the **single shared
pure domain function** that computes them (needed for completion, results and
Feature 012/013 tests) and Feature 014 reuses it rather than re-deriving.
Duplicate implementations are forbidden.

Summary of the resolution (authoritative formulas live in the shared
function):

```text
presentations    = attempt rows of (cycleId, puzzleId) by presentationIndex
skipped          = presentations non-empty and all results 'skipped'
definite         = presentations with result != 'skipped'
firstTrySolved   = presentations[0].result === 'solvedFirstTry'
eventuallySolved = any presentation result ∈ { solvedFirstTry, solvedWithHelp }
wrongMoves       = Σ presentation.wrongMoveCount
hints            = Σ presentation.hintCount
solvingTimeMs    = Σ presentation.solvingTimeMs over definite presentations
```

Cycle aggregates (sample unit `puzzles` for rates): `puzzlesAttempted`,
`puzzlesCompleted`, `puzzlesSkipped`, `firstTryAccuracy`, `solveRate`,
`totalPresentations`, `totalWrongMoves`, `hintsUsed`,
`puzzlesRequiringHint`, `retries`, `puzzlesRequiringRetry`,
`solvingTime.totalMs/averageMs/medianMs`.

Rules:

- `skipped` is never in any accuracy/solve-rate denominator.
- `inProgress` cycles report partial aggregates; `abandoned` cycles are
  reported separately from completed ones.
- A cycle with zero definite puzzles yields `empty`, not `0`, for rate/time
  aggregates.
- Cross-cycle comparison uses the same set and the same metric definition and
  reports measured deltas only — never causation (ADR-031,
  `domain/tactical-training.md`, `domain/statistics.md`).
- **Time goal.** Cross-cycle comparison additionally exposes the cycle's
  `solvingTime.totalMs` delta vs the previous cycle of the same block and the
  derived target "beat half the previous cycle's time"
  (`previous.totalMs / 2`). This is a displayed target, never a gate and never
  a stored field.
- **Success band and plan.** The first cycle's first-try rate is surfaced
  against the 60–75% guidance band and an optional **~6-cycle plan** may be
  suggested; neither is a gate and neither blocks completion. `targetAccuracy`
  is informational only and the app never enforces it.
- Cycle metrics are never mixed with game-analysis metrics.

### 9. Wrong-move and hint semantics (adopted from Feature 012)

Feature 013 consumes the implemented Feature-012 outcome semantics and does
not reinterpret them:

- the first wrong move records a `failed` attempt immediately while the
  presentation stays open (fail-once keep-trying);
- a later in-presentation correct solve does **not** write a second row and
  the recorded result stays `failed`; `foundAfterFail` is presentation
  feedback only and is never persisted;
- `solvedWithHelp` is a hint-assisted and/or restart solve with no wrong move;
- hints never fail a puzzle; the highest hint level reached is recorded on
  the attempt;
- a **restart** clears the line/hint reveal but keeps the counters and clock;
  the presentation records `restartCount > 0`, and a later clean line in the
  same presentation derives `solvedWithHelp`, not `solvedFirstTry` (Feature-012
  contract; see "8. Legitimate in-cycle solves").

Consequently a puzzle's cycle resolution is based on the **stored rows**
above; the retry pass is driven by a stored `failed` result regardless of a
later in-presentation solve. This replaced the domain's earlier looser
"retry step recorded"/"solvedWithHelp after retry" wording, which has been
reconciled (see "Reconciliations applied").

### 10. No puzzle re-rating

Feature 013 does **not** mutate, re-rate or delete a `PuzzleRow`. The
Feature-011 and `domain/puzzle-model.md` notes that previously said Feature 013
"may re-rate blunder puzzles from solver data" have been **reworded to defer
re-rating out of V1** (see "Reconciliations applied"): any per-puzzle
performance signal (repeatedly failed, mastered) is derived from attempts —
mastery by this feature's canonical `masteryOf` and consumed by Feature 014 as
an aggregate — and is never written onto the puzzle. This preserves puzzle
immutability and ADR-031's no-per-user-difficulty rule. Re-rating requires a
new ADR and is not V1 scope.

### 11. Ownership, archive and deletion

- A custom set is user data owned by the user. **Archive** sets
  `status: 'archived'` (hidden from the active list, history retained);
  unarchive restores it.
- **Blocks** are user-created sets: `status: 'active'` while open (at most
  one), `status: 'archived'` once finished or abandoned. Closing a block
  returns its still-unmastered members to the pool (a read-time consequence,
  no row mutation of the puzzles) and **preserves its cycle history** (the row
  stays, archived). A block is therefore **closed — not deleted — by
  Finish/Abandon**.
- **Delete** removes the set row, its cycles, and their attempt rows (via the
  `trainingSetId`/`cycleId` indexes), whether the set is a custom set or a
  Woodpecker block, and whether the block is open or closed. The puzzles
  themselves are untouched — they remain owned by their source games. This is
  the set/cycle-owned removal Feature 012 anticipated. Deleting a block
  **discards** its history, unlike Finish/Abandon, which archives and preserves
  it; the destructive confirmation names the block and its cycle/attempt counts.
  Deleting the open block frees the single open-block slot.
- **Quick train** has no `trainingSets` row; its sentinel cycle/attempts are
  not covered by set deletion and are removed only by the game-deletion/puzzle
  cascade (see §3c and "Conflicts surfaced").
- **Game deletion cascade** (ARCHITECTURE §7, `domain/game-library.md` §8):
  deleting a game deletes its puzzles and their attempts (Feature 012); this
  feature additionally removes the deleted puzzle ids from every custom set's
  membership and from the open block's frozen snapshot (deletion is the one
  exception to "frozen": the puzzle no longer exists). In-progress cycle
  snapshots are immutable; a snapshot puzzle whose row no longer exists is
  skipped and treated as terminal.
- **Sync:** sets, cycles and attempts are local/derived data and are never
  synced as standalone values by this feature; Feature 016 syncs deletions as
  tombstones consistent with the ownership rule.

### 12. Determinism and versioning

- All functions are deterministic for fixed inputs and a caller-supplied
  `now`; no hidden clock or locale reads. Block formation and mastery
  derivation are pure and fixture-testable.
- `CycleConfig.configVersion` and `TrainingCycle.cycleMetricsVersion` follow
  ARCHITECTURE §9. A semantics change (completion rule, retry bound, ordering
  rule, metric denominators, hint mapping) bumps the relevant version; stored
  rows are never retroactively re-mapped.
- `MASTERY_VERSION` (domain constant, starting at `1`) versions the mastery
  derivation (threshold, legitimate-solve conditions, distinct-cycle rule) and
  is exposed with mastery reads; Feature 014 surfaces it in its version
  summary and bumps `STATISTICS_VERSION` when it changes.
  `BLOCK_RECIPE_VERSION` versions the block recipe/selection (size,
  ordering/tie-break); a change to a recipe's semantics is a new recipe, not a
  silent mutation of stored rows.
- Attempt rows are never rewritten to change a result; a contract change is a
  new presentation or a new version, never an in-place edit.

---

## Data requirements

Additive persistence only; the immutable `puzzles` table and the schema-v9
`puzzleAttempts` table/indexes are unchanged.

**No schema bump for the block model (schema stays v10).** Confirmed by
inspection of the stored shapes:

- the block recipe lives in the existing `TacticalTrainingSetRow.source` field
  (a plain JSON object) — the `trainingSets` table stores the row verbatim and
  needs no new column or index;
- the block's fixed membership uses the existing `puzzleIds` field (a plain
  JSON array); the pool is **derived**, never stored, so it needs no column;
- "one open block at a time" and "closed" reuse the existing `status` field
  (`active`/`archived`); no new flag or index is required;
- the Feature-012 restart contract adds `restartCount` to the attempt row's
  plain object (already landed in Feature 012) — like the earlier `origin`
  addition to `puzzles`, an unindexed field needs no Dexie version bump;
- mastery is **derived**, never stored: no mastery column, table or index;
- Quick train's ad-hoc cycle uses the existing `trainingCycles` row with a
  sentinel `trainingSetId`; no new table or column;
- the one-time legacy cleanup only deletes existing rows by deterministic id
  and writes one settings marker; it needs no new column, table or index.

A schema bump (v11) would be required only if a genuinely new **stored** field
or index were needed (e.g. a persisted pool, a stored open-block pointer, or a
mastery index). None is needed: the pool is a derived view, the open block is
`active` + `source.kind === 'auto'` + `recipe.kind === 'woodpeckerBlock'` (at
most one), and mastery is derived from attempts. If profiling later shows the mastery read needs an index, that is an
**additive v11** change (e.g. a compound `[puzzleId+result]` index on
`puzzleAttempts`), never a rewrite of existing rows; it is not required for V1
because mastery reads scan the bounded attempts table through the existing
`puzzleId` index or a batched full read.

### New tables (schema v10, additive)

```text
trainingSets    &id, status, createdAt
trainingCycles  &id, &[trainingSetId+cycleNumber], trainingSetId, status
```

- `trainingSets` stores `TacticalTrainingSetRow` verbatim.
- `trainingCycles` stores `TrainingCycleRow` verbatim.
- Both tables start empty, so no migration backfill is required; bump
  `PERSISTENCE_SCHEMA_VERSION` to 10 in `src/config/app-config.ts` and add
  `schema/v10.ts` following the existing pattern.
- Exact index additions for the Feature-014 reads (e.g. `startedAt`) are a
  plan detail; the compound unique key `[trainingSetId+cycleNumber]` is
  required.

### Repositories

- `trainingSetsRepository` — `get`, `list({ status? })`, `create`, `update`
  (name/config/membership/status), `delete` (kind-agnostic; cascades cycles +
  attempts for a custom set or a block), `removePuzzleIds` (game-deletion
  cascade), `listContainingPuzzle(puzzleId)`, `getOpenBlock()` (the single
  `active` `source.kind === 'auto'` + `recipe.kind === 'woodpeckerBlock'` row,
  if any) and `closeBlock(id, now)` (sets `status: 'archived'`). There is
  **no** `ensureAutoSets()`; the app never seeds a set. The set service's
  `delete` accepts a block (it no longer refuses one as `auto-set-immutable`);
  that typed refusal remains only for a block's rename/config/membership/archive
  mutation.
- `trainingCyclesRepository` — `get`, `listForSet`, `getByNumber`, `create`,
  `updateStatus` (`completed`/`abandoned` timestamps), `deleteForSet`,
  `createQuickTrain` (a cycle under the `QUICK_TRAIN_SET_ID` sentinel). Set
  listing/aggregation excludes the sentinel.
- The existing `attemptsRepository` reads (`listForCycle`,
  `listForCycleAndPuzzle`) and the `trainingSetId`/`cycleId` indexes serve
  Feature 013. The mastery read adds one read-only method — a batched
  `listAll()` (or `listForMastery()`) over `puzzleAttempts` grouped by
  `puzzleId`/`cycleId` — with **no schema change**; the pool read uses the
  existing `puzzlesRepository.listAll()`.
- `restartCount` is persisted through the existing `addAttempt` write path
  (the row is stored verbatim); the repository still exposes no update path.

### Deletion cascade

- Set deletion removes its cycles and attempt rows in one transaction, for a
  custom set or a Woodpecker block (open or closed).
- The one-time legacy auto-set cleanup reuses the same transaction for the two
  deterministic legacy ids (see "Legacy auto-set cleanup (one-time)").
- Game deletion (existing `deleteGames` transaction) additionally removes the
  deleted puzzle ids from all sets' `puzzleIds` (custom sets and the open
  block's frozen snapshot); extend the cascade-ready dependent-kind list per
  the introducing milestone. A block whose membership shrinks this way simply
  trains the remaining members; there is no re-derivation.
- Quick-train sentinel cycles/attempts are not owned by a set row and are
  removed by the game-deletion/puzzle cascade only.
- No orphaned cycle or attempt may remain (the sentinel is a documented
  exception to the "cycle belongs to a set row" rule).

### Legacy auto-set cleanup (one-time)

Before the explicit block model, the app seeded two system-managed auto sets
with deterministic ids — `auto:all-puzzles` and `auto:woodpecker-random` — and
stored their cycles and attempts under those ids. Those rows are dead data under
the current model (the app no longer seeds or reads them), so a **one-time,
idempotent cleanup** removes them on startup / first load:

- It deletes exactly the persisted `trainingSets` rows whose `id` is
  `auto:all-puzzles` or `auto:woodpecker-random`, together with their
  `trainingCycles` rows and their `puzzleAttempts` rows, by reusing the existing
  set-delete transaction (`trainingSetsRepository.delete(id)`), which already
  cascades through the `trainingSetId`/`cycleId` indexes. No second cascade
  path is introduced.
- It touches **no other data**: not custom sets, not current Woodpecker blocks
  (their ids are generated and their recipe is `woodpeckerBlock`), not puzzles,
  games, analyses, jobs or the engine cache.
- It is **idempotent**: a second run finds no matching rows and is a no-op; a
  legacy row whose cycles/attempts are already gone is still removed.
- It is **guarded** by a persisted settings marker (a boolean flag such as
  `training.legacyAutoSetsCleaned` in the settings table) so the scan runs once
  per install; the marker is written after the cleanup completes. If the app is
  interrupted before the marker is written, the next startup re-runs the
  cleanup safely (idempotent).
- It runs in the **infrastructure** layer during app bootstrap, awaited before
  the training surfaces read `trainingSets`, so a legacy row is never rendered
  or mistaken for the open block. It is **not** a Dexie schema migration: the
  schema stays v10 (no `upgrade()` callback, no version bump, no backfill).
- It is **not** block creation and never creates a row. The cleanup only
  removes pre-existing legacy rows; the invariant that the app never creates a
  block without an explicit user action is unchanged (see §3a).

Cleanup removals are a local data-remediation step, not a user-facing deletion:
they are not a block/set delete the user performed. Feature 016 need not
tombstone them (the legacy rows predate sync and never appear in a synced
envelope); the deterministic ids make the removal reproducible on any device
that still holds them.

### Sync

- Feature 013 data is local user/derived data; this feature adds no sync.
  Feature 016 must tombstone set/cycle/attempt deletions consistently with the
  ownership rules and must not sync derived cycle aggregates.

---

## States

- **Set states**: `active`, `archived`, plus transient UI states (loading,
  empty membership, load error).
- **Block states**: `open` (the single `active` `source.kind === 'auto'` +
  `recipe.kind === 'woodpeckerBlock'` row), `closed` (archived after
  finish/abandon, history retained), `none` (no open block yet). **Deleted** is
  not a state: deletion removes the row and its history, so a deleted block
  simply ceases to exist.
- **Pool states**: `ready` (≥1 eligible puzzle), `empty` (no puzzles at all),
  `belowRecommended` (< ~100, guidance only), `small` (< requested size, the
  block takes all of it).
- **Quick-train states**: available (pool non-empty), empty pool (disabled
  with the "generate puzzles first" copy).
- **Mastery states**: `unmastered` (0–2 distinct-cycle credits), `mastered`
  (≥3); always derived, never stored, informational only (no retirement). The
  mastered list is read-only.
- **Cycle states**: `inProgress` (resumable; partial aggregates), `completed`
  (terminal; immutable snapshot), `abandoned` (terminal; reported
  separately).
- **Presentation states** (Feature 012, transient): `presenting`, `solving`,
  `outcome`, `postSolve`; attempt write `pending → written`, or `retryable`
  on failure.
- **Attempt results**: `solvedFirstTry`, `solvedWithHelp`, `failed`,
  `skipped`.
- **Queue states**: pending first pass, pending immediate retry, pending
  end-of-cycle retry, complete. The session shows which is active without
  exposing scheduling language.

---

## Error cases

The feature must never crash a consumer and must never fabricate data:

- **Custom set creation resolves zero puzzles** — the set is created empty
  with an explicit empty state; never a fake count.
- **Block creation with an empty pool** — not created; the action is blocked
  with an explanation and a link to generate puzzles. Never a fake count and
  never an empty block.
- **Block creation while a block is already open** — rejected with a typed
  result; the UI shows the open block instead.
- **Pool below the recommended size (or below the requested size)** — a
  non-blocking guidance notice; the block takes all of the pool when it is
  smaller than `size`.
- **Attempt to edit a block's membership or refresh it per cycle** — rejected
  (fixed snapshot); the UI explains the block is fixed and offers close +
  create-next instead.
- **Delete block with zero cycles/attempts** — allowed; the destructive
  confirmation shows `0 cycles` / `0 attempts` rather than hiding the action.
- **Legacy cleanup fails** (storage error mid-transaction) — the cleanup is
  best-effort and never blocks app startup; the guard marker is only written on
  success, so the next startup retries, and no data outside the two legacy ids
  is touched.
- **Unknown block recipe / malformed `source`** (row written by a future
  build) — rejected on read with a typed error; never silently coerced or
  trained.
- **Mastery read with an orphaned attempt row** (no matching `trainingCycles`
  row, or no matching puzzle) — the row is ignored for mastery; it is not a
  crash and not a credit.
- **Legacy attempt row without `restartCount`** — normalized to `0` on read
  (consistent with the `origin` normalization); never `undefined` in the
  derivation.
- **Cycle start on an empty/fully-removed set or block** — blocked with an
  explanation and a link to edit membership (custom) or to create a new block
  / Quick train (block); no empty cycle is created.
- **Quick train with an empty pool** — blocked with the "generate puzzles
  first" copy; no cycle row is created.
- **Quick-train sentinel appears in a set-scoped read** — excluded, never
  shown as a set or counted in set aggregates.
- **Puzzle row missing at presentation** (source game deleted between queue
  construction and presentation) — skipped with a notice, no attempt row, the
  session continues (Feature 012 rule).
- **Attempt write fails** — Feature 012 keeps the outcome visible with an
  inline retry and the session never advances; Feature 013 must not mark the
  cycle complete while a row is unwritten.
- **Cycle already `completed`/`abandoned`** — starting/resuming is rejected
  with a typed result; the UI offers "start next cycle" instead.
- **Concurrent sessions on one cycle** (two tabs) — the natural-key
  first-write-wins attempts repository makes duplicate writes idempotent; the
  resume reconstruction stays consistent and the UI reconciles to persisted
  rows.
- **Game deleted mid-session** — the cascade removes the puzzle/attempts; the
  host reconciles (skip missing rows, treat as terminal) and never crashes.
- **Set/cycle record missing during a session** (deleted in another tab) —
  the session ends with a notice and returns to the training home.
- **Invalid persisted config** (unknown enum/version from a future build) —
  rejected on read with a typed error; never silently coerced.

---

## Edge cases

- **A set that mixes tactical and blunder origins** — trains normally; only
  the objective label and accepted-move set differ (Feature 012).
- **A puzzle belonging to several sets** — its attempts are scoped by
  `cycleId`; aggregates per set/cycle never double-count across sets.
- **A puzzle failed across cycles** — remains in the set and is revisited;
  no removal by default.
- **A puzzle solved first-try in cycle 1 then failed in cycle 2** — remains
  in its block/set; mastery is monotonic (the earlier legitimate credit
  stands). It is outside the **pool** once mastered (so it is not selected
  into a future block), but it stays in any existing block and in any custom
  set.
- **Mastery earned across different sets** — a puzzle mastered in set A is
  globally mastered; `masteredPuzzleCountForSet(B)` still counts it if it is a
  member of B.
- **A new puzzle generated between cycles** — does **not** join the open
  block (membership is frozen); it joins the pool and is eligible for the
  **next** block formed after the open block closes. It is immediately
  available to **Quick train**.
- **Pool empty / all pool puzzles mastered** — block creation is blocked with
  an explanation; Quick train is disabled; the mastered list still shows the
  mastered puzzles. No "allMastered" cycle-start error exists.
- **Quick train after a block opens** — the pool excludes the open block's
  members, so Quick train trains only the remaining pool.
- **Closing a block with an `inProgress` cycle** — closing abandons that
  cycle (it becomes terminal, keeps its attempts) and returns the block's
  still-unmastered members to the pool.
- **Deleting a block with an `inProgress` cycle** — delete removes the block,
  that cycle and all attempts; no resumable cycle remains. Unlike
  Finish/Abandon (which abandon the in-progress cycle but keep it in history),
  delete removes the history.
- **Deleting a closed block** — allowed; removes the archived block and its
  history. Close preserves history; delete does not.
- **Legacy auto sets present at startup** — removed once by the guarded
  cleanup; the training home and set lists never show `auto:all-puzzles` or
  `auto:woodpecker-random`. A fresh install (no such rows) is a no-op, and a
  second run is a no-op.
- **Restart then clean line** — the presentation derives `solvedWithHelp`
  (`restartCount > 0`); no clean first-try credit.
- **Hint/restart then leave and re-enter** — the abandoned presentation is
  recorded, so the cycle cannot later earn a clean first-try; an existing
  durable row is never overwritten (first-write-wins).
- **Clean solve on a retry presentation** — the row may be `solvedFirstTry`
  (presentation-scoped), but it is `presentationIndex === 2` and therefore
  adds **no** distinct-cycle mastery credit.
- **Two clean rows for one puzzle in one cycle** — impossible by the retry
  rules; if data ever held it, mastery still counts the cycle once.
- **All-skipped cycle** — completes; rate/time aggregates are `empty`.
- **Single-puzzle set** and **very large set** (hundreds of puzzles) — both
  supported; large sets rely on the performance rules below.
- **Re-presentation after a failed prior cycle** — each presentation is a
  fresh Feature-012 presentation with its own counters/timer.
- **Retry pass where the puzzle is solved on the second presentation** —
  resolution records `eventuallySolved`; the first-try accuracy still counts
  only the first presentation.
- **`retryFailed: 'none'`** — a failed first presentation is terminal for the
  cycle.
- **Ordering ties** — resolved deterministically by `sourcePly` then
  `puzzleId`.
- **`targetSize` smaller/larger than the source** — selection takes the first
  N under the ordering; fewer sources yield a smaller set. For a block, the
  pool smaller than `recipe.size` yields a block of the whole pool.
- **Same-day cycle restart** — a cycle started on the same local calendar day
  as the previous cycle of the same block ended shows the spacing nudge; it is
  never blocked.
- **Archived set with an `inProgress` cycle** — archiving does not abandon
  the cycle; the resume banner still surfaces it, and the set can be
  unarchived.
- **Deleting a source game** — membership and attempts shrink; historical
  cycle metrics are derived and therefore change (an accepted consequence of
  the ownership rule, ARCHITECTURE §7).
- **Clock/date display** — cycle times are stored as epoch millis and
  displayed in the user's local time zone; no date math beyond formatting.

---

## Accessibility requirements

- Every action (create/finish/abandon block, create/edit/archive/delete custom
  set, start/resume/abandon/repeat cycle, quick train, skip, exit session,
  start next cycle) is a real labelled control, reachable by keyboard and
  touch — never hover-only, never shortcut-only.
- Destructive actions (delete set, delete block, abandon cycle, abandon block)
  require an explicit confirmation dialog that names the object and its
  consequences; the delete-block dialog names the block and its cycle/attempt
  counts and is distinct from Finish/Abandon.
- The one-click **Create Woodpecker block** action is a labelled button whose
  accessible name states the default size and that the block is fixed; the
  size selector is behind a labelled "Advanced" disclosure.
- Status is conveyed textually (active/archived, open/closed block,
  in progress/completed/abandoned, "Puzzle X of Y"), never by colour alone;
  cycle results spell out every value and its sample size.
- Session progress and completion are announced (`aria-live`) only when a
  real state change occurs; focus is managed on session start/exit and on
  landing in cycle results.
- The board interaction is Feature 012's (mouse + touch, promotion dialog,
  keyboard transport); Feature 013 adds no move-entry path.
- An unwritten attempt keeps the result visible with an accessible inline
  error and retry.
- Pool/block/Quick-train states (pool count, "no open block", "pool below
  recommended size", "block fixed") and the mastered list (puzzle count, empty
  state) are exposed as text, never by colour or a bare `0`.
- The **spacing nudge** and the **time-halving target** are announced as
  guidance (`aria-live` polite) and never block the action; the 60–75% band
  and the ~6-cycle suggestion are text, not colour.
- A solve after a restart is labelled "Solved with hints" (Feature 012 result
  copy), so the disqualification is understandable, not a hidden rule; the
  mastered list explains the 3-distinct-cycle rule in text.

---

## Responsive / mobile requirements

- Deliberate mobile layouts: the open block, custom sets and the pool/Quick
  train render as cards (not a shrunk table); set detail and cycle results
  stack; the solving screen uses Feature 012's mobile stacking.
- The session chrome (progress, exit, skip) stays reachable without scrolling
  past the board on small viewports.
- Block/set creation supports touch; the one-click create and the "Advanced"
  size selector need no hover or pointer precision.
- Large block/set membership lists paginate or virtualize on mobile rather
  than rendering thousands of rows; the mastered list does the same.
- The block/pool cards show their counts/state without a layout shift when the
  pool or mastery changes.

---

## Performance constraints

- **No engine, no network.** Cycle lifecycle and metrics are pure domain
  computations over persisted rows; the session never starts Stockfish except
  Feature 012's opt-in post-finish engine.
- **Main thread is never blocked.** No single synchronous task may exceed the
  long-task threshold (≈50 ms). Loading a cycle's attempts, reconstructing
  resume state and computing results are bounded by the cycle's puzzle count
  (default 10; large sets allowed) and use indexed reads; large sets/results
  run in bounded batches or a worker.
- **Bounded reads.** Set lists read `trainingSets` by status; set detail
  reads only its cycles and membership; resume reads only the active cycle's
  attempts via `[cycleId+puzzleId]`; results read only that cycle's attempts.
  Per-row views never scan `puzzles`/`puzzleAttempts`.
- **Mastery/pool derivation is bounded and off the critical path.** The pool
  read uses `puzzlesRepository.listAll()` (one row per puzzle) and the mastery
  read is one batched pass over `puzzleAttempts` grouped by
  `puzzleId`/`cycleId`, run once per training-home load and once per block
  creation (not per row and not per move). It is memoized by a data-version
  key and runs in a worker/bounded batches when the attempt table is large; no
  single synchronous task exceeds the long-task threshold.
- **Block formation is O(pool log pool)** (a single sort of the pool) and runs
  once per user click; it is bounded by the puzzle count, not attempts.
- **Cascade cost.** Game deletion's membership cleanup scans the (small) set
  table; it is bounded by the number of sets, not puzzles.
- **Scale target.** Practical from a few to hundreds of puzzles per set and
  tens of thousands of attempts overall; the plan records the measured budget
  and the worker/batch strategy.
- **No materialized aggregates in V1.** Cycle metrics are derived; a future
  cache must be additive, derivable and versioned.

---

## Acceptance criteria

1. A user can create a set from a game's puzzles and from the puzzle pool,
   name/configure it, archive/unarchive it, and delete it with confirmation;
   membership is stored (not a live query) and deterministic under the chosen
   ordering and target size.
2. Starting a cycle snapshots membership and config, assigns the next 1-based
   cycle number, and presents the puzzles in the configured order through
   Feature 012's solving screen.
3. Each presentation is recorded as exactly one immutable `puzzleAttempts`
   row under the real `cycleId`/`trainingSetId` with the correct
   `presentationIndex` (1 for the first, 2 for the retry); no practice rows
   are written.
4. `retryFailed` `none`/`immediate`/`endOfCycle` behave as specified, each
   puzzle is presented at most twice per cycle, and a re-failed retry is
   terminal for the cycle and revisited in the next cycle.
5. A skipped puzzle is recorded, excluded from accuracy/solve-rate
   denominators, and does not block completion; skipping is available only
   when configured.
6. A cycle is `completed` exactly when every snapshot puzzle is terminal or
   missing; exiting early leaves it `inProgress` and resumable from the next
   unanswered puzzle; abandoning is terminal and keeps its attempts.
7. Resume reconstruction from persisted attempts is deterministic and
   idempotent (reload mid-cycle returns to the same next presentation and
   `presentationIndex`), with no stored cursor.
8. Cycle results show per-puzzle outcomes and the canonical aggregates with
   their sample sizes; a cycle with zero definite puzzles reports `empty`,
   not `0`; abandoned cycles are reported separately.
9. Cross-cycle comparison uses the same set and metric definition and reports
   measured deltas only; it never claims causation and never mixes
   game-analysis metrics.
10. A puzzle may belong to multiple sets; per-set/cycle aggregates never
    double-count across sets; deleting a set removes its cycles and attempt
    rows but never its puzzles, and the same holds when the deleted set is a
    Woodpecker block (open or closed).
11. Deleting a source game removes its puzzles/attempts and the deleted puzzle
    ids from every set's membership; no orphaned cycle or attempt remains and
    no session crashes.
12. Feature 013 never schedules puzzles individually, stores no scheduling
    state on a `Puzzle`, and never mutates/re-rates a `PuzzleRow`; no FSRS or
    scheduler dependency is introduced.
13. The interim `/puzzles` practice host, its in-memory recorder and its
    `practice:*` ids are removed; the `/puzzles` nav entry is served by the
    training home.
14. Set/cycle domain logic is deterministic and fully testable with fixtures
    and no engine, network or real IndexedDB; the canonical cycle metric
    function is shared with Feature 014 (no duplicate implementation).
15. All essential set/cycle/session actions are keyboard- and touch-operable,
    status is never colour-only, and destructive actions are confirmed.
16. The app never creates a set or block on its own: there is no
    `ensureAutoSets()`, no system seeding and no auto-generated row — not at
    startup/first load and not on any data change; the only block creation path
    is the explicit one-click **Create Woodpecker block** action. A one-time,
    idempotent, guarded startup cleanup removes only the pre-block-model legacy
    auto sets (`auto:all-puzzles`, `auto:woodpecker-random`) and their
    cycles/attempts; it touches no other data and is not a schema migration.
17. The one-click action auto-selects up to N (default 200) puzzles from the
    derived pool (unmastered, not in the open block) in `difficultyAsc` order
    (ties by `sourcePly` then `puzzleId`), stores them as the block's frozen
    `puzzleIds`, and takes all of the pool when it is smaller than N. Size
    (100/200/400) is the only option and lives behind "Advanced".
18. A block's membership is fixed at creation: new puzzles are not added
    mid-plan and membership is never re-derived per cycle; only **one block**
    is open at a time. Finishing or abandoning a block closes it and returns
    its still-unmastered members to the pool; the next block is formed from
    the remaining pool plus new puzzles.
19. Mastery is a legitimate first-try solve in **3 distinct cycles** (global
    across sets); it is monotonic, derived at read time (no stored state;
    ADR-031) and **informational only** — it retires nothing from a block and
    mutates no row. A mastered puzzle is outside the pool by definition and so
    is not selected into a future block; the read-only mastered list remains.
20. Only legitimate in-cycle solves count: a `solvedFirstTry` requires no hint,
    no wrong move, no restart, the cycle's first presentation, and a real
    cycle id. A restart disqualifies a later clean line (`solvedWithHelp`);
    navigating away and back cannot overwrite an existing row or add a second
    clean credit; a retry presentation adds no distinct-cycle mastery credit;
    the interim practice host and its `practice:*` ids are gone.
21. The mastered-puzzles list under `/puzzles` is read-only and shows mastered
    puzzles with their qualifying cycles; there is no un-master action in V1.
22. **Quick train** starts or resumes an ad-hoc session over the whole pool,
    creates no `trainingSets` row, and writes ordinary immutable attempts under
    a real ad-hoc `trainingCycles` row (sentinel `trainingSetId`). Re-starting
    it resumes the open sentinel cycle (no new cycle number, no restart at
    puzzle 1) and its attempts do **not** count toward mastery; the sentinel is
    excluded from set-scoped reads and set deletion.
23. The extension adds no persisted table, column or index and no stored
    mastery state (schema stays v10); the block recipe lives in `source`, the
    fixed membership in `puzzleIds`, and the open block is derived from
    `status` + `source.kind`. No FSRS or scheduler dependency is introduced.
24. There is no accuracy gate: `targetAccuracy` is optional and informational,
    the 100% preset is removed, and success is framed as speed and
    automaticity. Cycle results show the total solving time delta vs the
    previous cycle and a "beat half the previous cycle's time" target, plus
    the optional ~6-cycle suggestion and the 60–75% first-cycle band as
    guidance only.
25. A same-day cycle restart (a new cycle started on the same local calendar
    day as the previous cycle of the same block ended) shows a non-blocking
    spacing nudge; the user may proceed.
26. A Woodpecker block can be **deleted** entirely, not only closed: deletion
    removes the block row and cascades its `trainingCycles` and
    `puzzleAttempts` rows in one transaction, leaving puzzles, games and
    analyses untouched; it is behind an explicit destructive confirmation
    naming the block and its cycle/attempt counts. Delete is distinct from
    Finish/Abandon, which archive the block and preserve its history.

---

## Testing requirements

### Deterministic fixtures

Fixtures are separated from production data, run without engine/network and
cover at least:

- **Sets** — active, archived, empty membership, single-puzzle, mixed-origin
  (tactical + blunder), multi-set membership, and a set with all puzzles
  removed by a simulated game deletion.
- **Cycles** — `inProgress` (partial), `completed`, `abandoned`; multiple
  cycles per set with known metric deltas; a cycle snapshotted before a set
  edit; a cycle whose snapshot contains a since-deleted puzzle.
- **Attempts** — every result; a puzzle re-presented in-cycle (retry); a
  puzzle failed across ≥ 2 cycles; hints/retries/skips; varied solve times
  (including median/average cases); both puzzle origins; a restarted
  presentation (`restartCount > 0`) and a legacy row without the field.
- **Blocks** — one-click formation with pool sizes below/at/above 200; the
  default 200 and the 100/400 Advanced sizes; a pool with no puzzles and a
  fully-mastered pool; mastery exclusion; the fixed easy→hard order with
  `sourcePly`/`puzzleId` tie-breaks; the frozen snapshot after a new puzzle is
  generated; one-open-block enforcement; close/finish/abandon returning
  unmastered members to the pool; a block with cycles/attempts to delete
  (open and closed, including one with an `inProgress` cycle).
- **Pool & Quick train** — the derived pool excludes mastered and open-block
  members; Quick train over a small pool creates no set row and writes a
  sentinel cycle + ordinary attempts; the sentinel is excluded from
  set-scoped reads.
- **Legacy cleanup** — a persisted DB seeded with the `auto:all-puzzles` and
  `auto:woodpecker-random` set rows plus their cycles/attempts, alongside a
  custom set, an open block and unrelated puzzles/games; the guarded cleanup
  removes only the legacy rows and their dependents, leaves everything else
  untouched, writes the guard marker, and a second run is a no-op (including
  when a legacy row's cycles/attempts are already gone).
- **Mastery** — 0/1/2/3 distinct-cycle credits; multiple rows in one cycle
  counting once; a retry-presentation clean row adding no credit; a
  hint/wrong-move/restart row adding no credit; credits earned across
  different sets; monotonic after a later failure; an orphaned attempt row
  ignored; mastery performs no retirement/mutation.
- **Config** — each ordering, each `retryFailed`, skip enabled/disabled,
  hint-level availability/threshold variants, set/unset targets; the fixed
  block presets.
- **Persistence** — schema-v10 migration on an empty and a populated v9 DB;
  the extension adds no v11 migration.

### Test cases

- **Domain (pure):** block formation (`formWoodpeckerBlock` for each size,
  determinism, mastery exclusion, open-block exclusion, easy→hard order and
  tie-breaks, smaller-than-size pool, empty pool); custom membership
  resolution and target-size/ordering selection; `masteryOf` (distinct-cycle
  counting, legitimate-solve predicate, retry/hint/wrong/restart exclusion,
  monotonicity, cross-set credits, orphaned rows); cycle snapshot and
  cycle-number assignment; terminal/completion predicate for every
  `retryFailed` mode; retry bound (max two presentations); skip handling;
  resume reconstruction (fresh, mid-first-pass, pending immediate, pending
  end-of-cycle, complete); per-puzzle cycle resolution; all cycle aggregates
  and empty states; the time-delta/`beat half` target; config/hint mapping to
  `SolveHintConfig`; `restartCount` outcome derivation; version stamping.
- **Repository (infrastructure):** `trainingSets`/`trainingCycles` create/get/
  list/update/delete; the unique `[trainingSetId+cycleNumber]` key; status
  filters; `getOpenBlock`/`closeBlock` (recipe-aware block detection); no
  `ensureAutoSets` exists; the mastery `listAll` read; set-deletion cascade
  over cycles and attempts, including a **block** row (kind-agnostic `delete`);
  game-deletion membership cleanup (custom sets + open block); Quick-train
  sentinel cycle creation and exclusion; no orphans.
- **Service/application:** create a block from the pool (including the
  one-open-block rejection and empty-pool block); create a custom set from a
  game and from the pool; start a cycle; drive a full session over fixtures
  through the Feature-012 host contract (order, retries, skips, completion); a
  restart during a presentation; abandon-after-hint/restart then re-enter;
  resume after reload; abandon; repeat; close a block and confirm members
  return to the pool; **delete a block** (open and closed, incl. an in-progress
  cycle) with the correct cycle/attempt counts and no puzzle/game mutation; the
  guarded legacy cleanup removes only the two legacy ids, leaves everything
  else untouched and is idempotent; Quick train; results computation incl. the
  time goal; mastery read and mastered-list assembly; write-failure containment
  (no advance while a row is unwritten).
- **Component:** training home (open block / no open block, pool count, Quick
  train, guidance copy, empty/resume banner), block detail (fixed membership,
  finish/abandon, delete with a confirmation naming the block and its
  cycle/attempt counts, history), custom set detail, mastered list
  (populated/empty), cycle session chrome (progress/exit/skip + spacing
  nudge), cycle results (per-puzzle outcomes + aggregates + cross-cycle time
  comparison), archive/delete confirmations, keyboard/AT behavior, mobile
  layout; the interim practice host is gone.
- **End-to-end:** create block from pool → cycle → solve (via Feature 012,
  including a restart-disqualified attempt) → attempt rows → cycle completion
  → close block → next block from the remaining pool; **delete a block** (its
  cycles/attempts disappear and its puzzles stay); a startup with seeded legacy
  auto rows removes them before the training home renders; Quick train writes a
  sentinel cycle; results/mastered list, using the real persistence layer and
  the Feature-012 screen with a stubbed engine.

---

## Dependencies

Feature 013 depends on:

- Feature 011 — immutable `PuzzleRow` source (both origins) and the
  set-building hand-off from the per-game puzzle view;
- Feature 012 — `SolveScreen`/`usePuzzleSolve`, `SolveHintConfig`,
  `SessionPuzzleContext`, `PuzzleAttemptRecorderLike`, and the immutable
  `puzzleAttempts` rows (the host contract);
- Feature 007 — the Game Library/per-game puzzle surfaces used for set
  creation entry;
- `domain/tactical-training.md` — the canonical cycle model and metrics;
- `ARCHITECTURE.md` §7/§9/§10 — ownership/deletion, versioning, performance.

Feature 013 output is consumed by:

- Feature 014 — training sets/blocks/cycles, the canonical cycle metric
  function and the canonical `masteryOf`/pool derivation (reused, never
  re-derived);
- Feature 015 — Dashboard, via Feature 014;
- the Game Library `masteredPuzzleCount` insight (via Feature 014);
- Feature 016 — deletion tombstones.

---

## Owner decisions to confirm

These are resolved in this rewrite with a recommended default so planning can
proceed. The owner may override any of them; each override is a small,
localized change:

1. **Retry bound** — at most one retry presentation per puzzle per cycle
   (max two presentations), so a cycle always terminates (default). The
   alternative (unbounded immediate retry until solved) is rejected: it
   cannot complete and conflicts with resume semantics.
2. **Retry driven by stored result** — a puzzle recorded `failed` is
   re-presented even if the user later found the move in the same
   presentation (default, consistent with Feature 012's immutable fail-once
   row). Alternative: treat `foundAfterFail` as solved and skip the retry
   (would require a Feature-012 contract change).
3. **`solvedWithHelp` semantics** — adopt Feature 012's implemented
   semantics (hint solve with no wrong move); `domain/tactical-training.md`'s
   "and/or after a retry" wording is reconciled to the implemented model.
   Alternative: distinguish "solved after wrong move" as its own result
   (requires a Feature-012 domain change and a schema/value review).
4. **Skip affordance** — the cycle host owns a Skip control (when allowed)
   and Feature 012's `SolveScreen` exposes the seam (small Feature-012
   contract extension). Alternative: no skip in V1 (removes the `skipped`
   result from the cycle flow).
5. **Target size** — default 10 applied as a creation cap for custom sets,
   overridable to large sets (default). A block's size is the recipe size
   (default 200; 100/200/400 behind "Advanced").
6. **Set sources** — V1 supports game, filtered-pool and manual **custom**
   sets, plus the one-click **Woodpecker block** (default). There is no `auto`
   seeding. Alternative: block + Quick train only.
7. **Ordering options** — `difficultyAsc` (default), `sourcePly`, `manual`.
   Blocks are always `difficultyAsc` with ties by `sourcePly` then `puzzleId`;
   a `random` ordering/selection is dropped.
8. **Blunder re-rating** — deferred out of V1 (default; no mutation of
   immutable puzzles; per-puzzle signals stay derived — Feature 013 mastery,
   Feature 014 aggregates). Alternative: a separate derived per-user rating
   (needs a new ADR; not V1).
9. **Aggregate persistence** — cycle metrics are derived, not stored
   (default; matches Feature 014's no-materialization rule and the ownership
   cascade). Alternative: persist a versioned completion snapshot for stable
   history after source-game deletion.
10. **Cycle deletion** — deleting a set removes its cycles/attempts (default);
    standalone cycle deletion is not offered in V1 (abandon covers the user
    intent).
11. **Block recipe/presets** — one-click, size default 200 (100/200/400
    Advanced), always `difficultyAsc`, hints enabled, retry `endOfCycle`; no
    accuracy gate (default). This removes the former 100% goal and random
    subset.
12. **Block lifecycle** — one open block at a time; finish/abandon closes it
    and returns still-unmastered members to the pool; closed blocks are
    archived (history retained) (default). Alternative: allow multiple open
    blocks (rejected; the pool/return rule assumes one).
13. **Mastery scope** — global per puzzle across all sets/cycles, threshold 3
    distinct cycles (default); informational only (no retirement). A mastered
    puzzle is outside the pool but stays in any existing block.
14. **Restart representation** — `restartCount` on `PresentationCounters` and
    the attempt row; `deriveResult` treats a solve after a restart as
    `solvedWithHelp` (landed in Feature 012; no schema bump). Alternative: a
    new `restarted` result value (larger Feature-012 change).
15. **Abandon-after-hint/restart** — the presentation is recorded durably
    (not silently discarded) so re-entry cannot launder a clean first-try for
    the cycle (default; Feature-012 contract). A pristine presentation may
    still be discarded with no row.
16. **No un-master action** — the mastered list is read-only in V1 (default);
    mastery is monotonic.
17. **Time goal & plan** — track each cycle's total solving time, show the
    delta vs the previous cycle, target "beat half the previous cycle's time",
    suggest ~6 cycles and the 60–75% first-cycle band (default; guidance only,
    never enforced).
18. **Spacing nudge** — warn on a same-day cycle restart (a new cycle started
    on the same local calendar day as the previous cycle of the same block
    ended); non-blocking (default).
19. **Quick-train identity** — a reserved `QUICK_TRAIN_SET_ID` sentinel
    `trainingCycles` row with no `trainingSets` row; excluded from set-scoped
    reads/aggregates (default). Alternative: create a hidden ephemeral set row
    (rejected: violates "no set row" and pollutes set listing).
20. **Block deletion** — a Woodpecker block (open or closed) can be **deleted**
    entirely, cascading its cycles/attempts through the existing set-delete
    transaction; the destructive confirmation names the block and its
    cycle/attempt counts. Delete is distinct from Finish/Abandon, which archive
    the block and preserve its history (owner-approved).
21. **Legacy auto-set cleanup** — a one-time, idempotent, guarded startup
    cleanup removes only the pre-block-model `auto:all-puzzles` /
    `auto:woodpecker-random` rows and their cycles/attempts; no other data is
    touched and no schema bump is needed (owner-approved).

### Reconciliations applied

These specification-consistency edits outside this feature spec were required
before implementation; they do not change the model above:

- **`domain/tactical-training.md`** — reconciled the `PuzzleAttempt`/`Retries`
  prose with Feature 012's one-row-per-presentation, fail-once semantics and
  this feature's retry bound (at most one retry presentation per puzzle per
  cycle); `solvedWithHelp` is hint/restart only with no wrong move; cycle
  aggregates are a derived read model; one shared canonical cycle-metric
  function with Feature 014.
- **`domain/tactical-training.md`** — replaced the two auto-generated sets and
  their per-cycle virtual membership with the derived **pool**, the one-click
  fixed **Woodpecker block** and **Quick train**; mastery is now informational
  (no retirement).
- **`features/011-puzzle-generation.md`** and **`domain/puzzle-model.md`** —
  reworded the note that "Feature 013 may re-rate blunder puzzles" to defer
  solver-calibrated re-rating out of V1 (per decision 8).
- **`features/014-game-history-statistics.md` §11** — reconciled the mastered
  definition to the canonical 3-distinct-cycle rule and clarified that mastery
  is informational (the statistics read model reuses the Feature-013/domain
  function and `MASTERY_VERSION`); the version bump and tests were updated to
  match.
- **`research/cycle-training.md`** — reconciled the "what to encode"
  recommendations with the final block model: no auto-creation, an explicit
  one-click fixed block, no 100% gate, no retirement, a time-halving goal and
  a same-local-calendar-day spacing nudge.
- **`features/012-puzzle-training.md`** — the restart contract
  (`restartCount`, `solvedWithHelp` after restart) has landed; Feature 013
  consumes it.
- **`domain/tactical-training.md`** — added the explicit block **delete**
  lifecycle (distinct from finish/abandon) and the one-time legacy auto-set
  cleanup; block detection is recipe-aware so legacy rows can never shadow the
  open block.

---

## Conflicts surfaced

These are surfaced rather than silently resolved; each needs an explicit owner
or follow-up spec decision:

1. **Block close trigger.** "When the block's plan ends (completed or
   abandoned)" does not state what ends the plan. The encoded default is an
   explicit user action — **Finish block** (the optional ~6-cycle plan is
   complete) or **Abandon block** — because the plan is guidance, not an
   enforced count and the app must not close a block on its own. Confirm, or
   define an automatic close rule (e.g. reaching the planned cycle count or all
   members mastered).
2. **Completed vs abandoned block not separately stored.** Closing reuses the
   existing `status: 'archived'` (no new field, schema stays v10). The
   finish/abandon reason is UI copy and can be inferred from the cycle history;
   if it must be persisted, an unindexed `closedReason` field can be added
   without a Dexie version bump (like `restartCount`), but it is not required
   for V1.
3. **Quick-train ad-hoc identity.** Quick train must write real attempts but
   create no set row, so it uses a reserved `QUICK_TRAIN_SET_ID` sentinel
   `trainingCycles` row. This is a documented exception to "every cycle
   belongs to a `trainingSets` row": the sentinel is excluded from set-scoped
   reads/aggregates and from set-deletion cascade, and is removed only by the
   game-deletion/puzzle cascade. Alternative: a hidden ephemeral set row
   (rejected) or a separate ad-hoc attempt identity (a larger attempt-model
   change).
4. **Quick-train attempts and mastery.** Quick-train attempts are ordinary
   immutable attempts under a real cycle id, so a legitimate first-try solve
   in a Quick-train cycle counts toward mastery. This is consistent with the
   mastery rule but means mastery can be earned outside a block; confirm this
   is intended (the alternative is to exclude the sentinel from `masteryOf`,
   which would special-case mastery).
5. **Custom sets retained.** The agreed model specifies the block + Quick
   train but does not remove the existing game/pool/manual custom sets; they
   are kept as explicit secondary set management. If the intent is block +
   Quick train only, custom set creation should be removed (a larger scope
   change).
6. **Pool terminology.** The derived **pool** (unmastered, not in the open
   block) shares the name with the existing `'pool'` **set source** (a
   creation-time filter snapshot). They are distinct; if the collision is
   undesirable, rename one (e.g. the source kind to `'filters'`).
7. **Legacy auto rows shadow the open block.** Block detection currently keys
   only on `source.kind === 'auto'`; a pre-block-model `auto:all-puzzles` row is
   `active` with that source kind, so it could be read as the open block if the
   cleanup has not run (or fails). The encoded mitigation is twofold: the
   guarded startup cleanup removes the legacy rows, and block identification
   additionally requires `source.recipe.kind === 'woodpeckerBlock'` (see §1).
   Confirm the recipe check is the intended defensive rule rather than relying
   on cleanup ordering alone.

## ADR assessment

No new ADR is required for the block/pool/mastery model. It is consistent
with the current decisions:

- **ADR-031** — the block is a fixed set of puzzles trained in cycles; the
  pool and mastery are derived read models. There is no due date, interval,
  stability or per-puzzle stored state, no FSRS/scheduler dependency, and the
  immutable `Puzzle` is unchanged; the model stays open to a future individual
  scheduler.
- **ADR-025** — block ordering reuses the deterministic `difficultyAsc` order
  over the immutable static difficulty; no puzzle is re-rated.
- **ADR-001 / ARCHITECTURE §7** — a block is an ordinary local `trainingSets`
  row; the pool is derived; Quick train reuses `trainingCycles`. No new
  persistence architecture or table.
- The block recipe (one-click, size 200, no accuracy gate) and the
  3-distinct-cycle mastery threshold are **product parameters** recorded as
  owner decisions, not architectural decisions; changing them is a versioned
  spec change (`MASTERY_VERSION`/`BLOCK_RECIPE_VERSION`), not a new ADR.
- **Block deletion** reuses the existing set-owned deletion cascade (no new
  persistence architecture or table), and the **legacy cleanup** is a one-time,
  idempotent data remediation in the infrastructure layer, not a schema
  migration (schema stays v10). Neither changes an architectural decision, so no
  new ADR is required.

---

## Context

Required reading (see `.opencode/CONTEXT-MAP.md`):

- Architecture/decisions: `ARCHITECTURE.md` §7/§9/§10;
  `decisions/ADR-031`, `decisions/ADR-025` (difficulty ordering default);
  optional `history/ADR-007/011/021/022` (history only)
- Domain: `domain/tactical-training.md`, `domain/puzzle-model.md`,
  `domain/game-library.md`, `domain/statistics.md`
- Research: `research/cycle-training.md`; optional
  `research/fsrs-implementation.md` (deferred future scheduler)

Feature dependencies: Feature 011 (puzzle source), Feature 012 (solve
interaction + attempt rows); consumers Features 014/015 (and Feature 016 for
deletion tombstones). Feature 013 owns the canonical cycle metric function and
the canonical `masteryOf`/pool derivation reused by Feature 014.
