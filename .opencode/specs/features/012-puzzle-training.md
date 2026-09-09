# Feature 012 — Puzzle Training

## Goal

Deliver the puzzle **solving experience** for the user's personalized
puzzles (both Feature-011 origins): presenting a puzzle from a fixed
training row, handling the user's moves, hints, retries and skips,
deciding the outcome, recording that outcome as a `PuzzleAttempt`, and
offering an engine-free post-solve analysis of the completed puzzle.

Puzzles are trained as part of a fixed **training set** and an active
**training cycle** (Feature 013 / ADR-031). This feature is the solving
experience inside a cycle; the set/cycle lifecycle, the puzzle ordering
within a cycle, cycle navigation and cycle results are owned by Feature
013. Feature 013 hosts Feature 012's solving screen and consumes the
attempt rows Feature 012 writes.

**Boundary with Feature 013.** Attempt rows are written by this feature
at the moment a puzzle presentation ends with an outcome; Feature 013
reads them to drive its lifecycle (completion conditions, end-of-cycle
retry passes) and derives every cycle-level metric from them
(`domain/tactical-training.md`). Feature 012 never computes cycle
aggregates. Per the V1 roadmap, Feature 012 is implemented before
Feature 013: the solving screen is driven by a session host contract
(see "Solving-session model"), so it is built and tested standalone
against deterministic fixtures, and Feature 013 later wires the real
entry surfaces and navigation around it. The two features are released
as one user-facing training slice.

## Scope & boundaries

In scope:

- Presenting a persisted `PuzzleRow` (Feature-011 `puzzles` table row —
  never a position regenerated or re-derived on the fly) inside a
  training session.
- The in-puzzle interaction: legal-move entry, correct/wrong move
  evaluation against the row's stored solution, hints (PRODUCT §10
  levels), wrong-move feedback, restart, and board transport over the
  moves made.
- Outcome determination and the end-of-presentation write of one
  `PuzzleAttempt` row (result, solving time, wrong-move count, hints
  used).
- The post-solve analysis step (a read-only use of the shared
  analysis-board surface in stored mode — Feature 006 / ADR-033).

Out of scope (owned elsewhere):

- Training-set and training-cycle lifecycle, ordering, resuming,
  completion and cycle results — Feature 013 (this feature only consumes
  the ordered queue and configuration the host provides).
- Any engine work — Feature 012 never starts Stockfish, never reads the
  ADR-018 cache, and never recomputes classification in a view
  (ADR-033). All annotations come from stored records.
- Per-puzzle scheduling, "due/review" state or FSRS — ADR-031.
- Direct ad-hoc solving outside a cycle (e.g. solving from the read-only
  per-game puzzle list). Real solving only happens inside a training
  session hosted by Feature 013.
- Blunder-difficulty re-rating from solver data (Feature 013's concern).
- Cross-game FEN dedup or transposition merging (Feature-011 V1 rule).

### Interim practice host (temporary, superseded by Feature 013)

Until Feature 013 ships, a **temporary `/puzzles` practice host** (introduced
with Feature 012, replacing the placeholder page) surfaces Feature-012's
`SolveScreen` over a chosen game's Feature-011 puzzle rows. It lets a user
solve real generated puzzles today while Feature 013 is not yet built.

- The host lists the games that own at least one puzzle row and presents each
  chosen game's rows (both tactical and blunder origins) in `sourcePly` order
  through the standard Feature-012 solving flow.
- Attempts are recorded through a **non-persisting, in-memory recorder**:
  practice sessions are **not** training history and write **no** attempt rows.
  Practice must never write to the `puzzleAttempts` table under its ephemeral
  pseudo cycle ids (`practice:…`).
- This host is **not** the Feature-013 cycle host: it is an owner-directed
  interim surface only. Feature 013 supersedes it and removes the host, its
  `/puzzles` entry and its practice copy when the real cycle host lands (see
  Feature 013).

## Solving-session model

A **solving session** is one contiguous run of the solving screen over an
ordered queue of puzzle rows provided by a host. In V1 the only host is
Feature-013's active cycle. The host contract is explicit so Feature 012
is testable before Feature 013 exists:

The host supplies, per session:

- the ordered list of `PuzzleRow` rows (cycle order; snapshot semantics
  per Feature 013);
- the session configuration snapshot for the set (hint-level
  availability and first-hint threshold, retry-failed behavior,
  completion rules allowing skips) per `domain/tactical-training.md`;
- per-puzzle context: `trainingSetId`, `cycleId`, and the 1-based
  `presentationIndex` of this presentation within the cycle (1 for the
  first presentation of the puzzle in the cycle; incremented whenever a
  retry pass re-presents the same puzzle — see Outcomes).

The session returns to the host after every presentation outcome with
the recorded outcome; the host decides what comes next (next puzzle in
cycle order, an immediate re-presentation when retry-failed is
`immediate`, the end-of-cycle retry pass, or cycle results). After
completing or exiting a puzzle the view returns to the current cycle —
next puzzle or cycle results — never to a per-puzzle scheduler
(ADR-031).

### Entering and leaving a presentation

- A presentation starts when the host hands the next puzzle row to the
  solving screen. The board shows `startingFen` oriented to
  `sideToMove` (always the user's color, Feature-011), the objective
  chip (the tactical objective, or the fixed "Find the best move" label
  for a blunder row), and a fresh timer/counters. Difficulty is not
  shown while solving (it would leak cycle ordering, which is difficulty
  ascending by default).
- The presentation ends when one of the outcomes in "Outcomes" occurs.
- Leaving the session mid-presentation (navigate away, session end)
  **discards** the presentation: no attempt row is written and the
  puzzle stays unanswered, so a resumed cycle re-presents it as the next
  unanswered puzzle (Feature 013). The post-solve solution is never
  shown for a discarded presentation (it would spoil the future
  re-presentation).

## User-facing behavior

Required capabilities on the solving screen:

- responsive Chessground board (shared wrapper), oriented to the side to
  move; mouse and touch move entry.
- move-list transport over the moves played in the current presentation:
  **start**, **previous**, **next**, **end** (these navigate the current
  presentation's move line only — they never move between puzzles).
- **restart** — clears the current presentation's move line (and any
  revealed hint content) and returns the board to `startingFen`; it does
  not end the presentation, does not reset the wrong-move count, hint
  counters or the solving clock, and does not create a new attempt
  (presentation-scoped replay).
- **hint** — requests the next hint level (see Hints).
- **skip** — ends the presentation with result `skipped` and moves on.
- **give up / show solution** — ends the presentation with result
  `failed` and opens the post-solve analysis step.
- **analyze** — after any definite outcome, opens the post-solve
  analysis step; on a `failed` outcome the step opens automatically.
- **continue** — closes the post-solve step and returns control to the
  cycle host (next puzzle, configured re-presentation, or cycle
  results). Available on every outcome screen so the user never loses
  the just-recorded outcome.
- wrong moves must be identified as incorrect (see Solving rules).

The exact layout (board + objective chip + transport + outcome summary)
is a UI decision; the behaviors above are required. Keyboard shortcuts
may accelerate these actions but must never be their only trigger
(AGENTS.md).

## Solving rules & answer evaluation

Answer evaluation is deterministic, pure domain logic over the stored
row — no engine, no cache. Solving plays the position with `chessops`
(ADR-028) starting from `startingFen`. The user is always the mover.

**Accepted moves.** The set of accepted moves at the first decision
point is stored, per origin:

- tactical row: `{ bestMove } ∪ acceptedFirstMoves` (an empty or absent
  `acceptedFirstMoves` means `{ bestMove }`);
- blunder row: `{ bestMove }` exactly — Feature 012 must accept exactly
  that single move and nothing beyond the one ply (Feature-011 contract).

A move is compared as its canonical UCI (including promotion piece); any
legal move outside the accepted set is **incorrect**.

**Advancing the line.** A correct first move is appended to the move
line. The opponent's reply is then auto-played from the stored line of
the chosen branch — never chosen by an engine:

- if the user played `bestMove`, the branch is `bestPv`;
- if the user played an accepted alternative whose continuation is
  stored, the branch is that continuation;
- if the user played an accepted alternative with **no stored
  continuation**, the puzzle is solved immediately: Feature-010 already
  verified that the move reaches the objective, and the solver cannot
  extend beyond stored lines (V1 stores no further moves for it).

**Multi-move completion (tactical rows).** After the first move the
position is on the chosen branch; the next expected user move is the
branch line's next user move (the line's tokens alternate
user/opponent; the opponent tokens are auto-played). Any other legal
move is incorrect. The puzzle is **solved** when the user has played
every user move of the branch line; any trailing opponent token is
auto-played for display only. A blunder row is solved when its single
`bestMove` is played.

**Wrong moves.** A wrong move is played on the board and immediately
identified as incorrect (visual marker plus non-visual announcement —
never color alone), the wrong-move count is incremented, and the move
does **not** advance the exercise: the board returns to the decision
point and the user may try again (auto-retry, per PRODUCT §10). Wrong
moves tried are kept in presentation memory for the post-solve step
("you tried X") but never enter the recorded move line. There is no
fixed wrong-move limit in V1: the user decides between solving,
requesting hints, giving up and skipping. Illegal moves cannot be
played via the board (Chessground constrains to legal moves); an illegal
entry through a keyboard/text path is rejected with feedback and is not
counted as a wrong move.

Replaying the user's own historical move (`userMovePlayed`) is almost
always a wrong answer (the puzzle exists because that move was a miss or
blunder) and is handled like any other wrong move; its stored
explanation appears in the post-solve step.

## Hints

Hints implement the four progressive levels defined in `PRODUCT.md` §10
(the authoritative definition); this feature renders each level's
information and nothing more. Hints beyond level 4 are out of scope for
V1, and hints never reveal anything beyond the **first** solution move:
once the first move is solved, further hints are unavailable.

- One **hint** control advances one level per press through the enabled
  levels, starting at the set's configured first-hint threshold and
  skipping disabled levels (hint-level availability is set configuration
  from `domain/tactical-training.md`, provided by the host).
- Using a hint never marks a puzzle failed and never increments the
  wrong-move count. A solve that used any hint is recorded as
  `solvedWithHelp` with the highest level reached.
- Hint content revealed in the current presentation is cleared by
  **restart** and is never persisted on the puzzle or attempt (only the
  hint count and highest level reached are recorded on the attempt).

## Outcomes

Every presentation that reaches a definite end maps to exactly one
domain result (`domain/tactical-training.md`):

| Trigger | Result on the attempt row |
| --- | --- |
| solved with no hint and no wrong move | `solvedFirstTry` |
| solved after any hint and/or any wrong move | `solvedWithHelp` |
| gave up / revealed the solution | `failed` |
| explicitly skipped (result shows only on **skip**) | `skipped` |

A skipped puzzle is not completed, is excluded from all accuracy and
solving-time aggregates, and remains in the set for future cycles
(aggregate handling is Feature 013). A failed puzzle does not leave the
cycle or the set by default; retry-failed behavior
(`none`/`immediate`/`endOfCycle`) and the next-cycle revisit are Feature
013 decisions over the recorded results.

Each outcome screen shows the recorded result, solving time, wrong-move
count and hints used before **continue** returns to the host.

## Post-solve analysis

After a definite outcome the user can open an analysis step that is a
**read-only use of the shared analysis-board surface in stored mode**
(Feature 006 / ADR-033). No engine runs and no new analysis is produced:
the step renders only records that already exist — the puzzle row, the
source game's persisted `MoveAnalysis` records (Feature 008), and the
presentation's in-memory attempt line. There is no "lines"/
MultiPV configuration and no ADR-018 cache read: the step shows the
stored content that actually exists, exactly like stored review, and
never recomputes classifications or evaluations in the view (ADR-033).

The step shows, for the puzzle's starting position:

- the move list of the user's attempt alongside the stored verified
  solution (SAN) — for tactical rows the full `bestPv`, plus accepted
  alternative first moves where stored; for blunder rows the single
  correct move;
- rejected wrong moves listed as "your move X — not the move that
  achieves the objective" (no fabricated evaluation for novel wrong
  moves: no engine ran on them);
- the divergence point highlighted.

**Stored-data annotation only.** An ADR-023 classification glyph and an
eval-swing line ("your move lost X win%; the engine preferred Y") are
rendered only when the divergence move at a ply matches a move the game
actually played and a stored `MoveAnalysis` classification exists for it
(that record carries the engine's preferred move, the classification and
the win-percentage loss). In practice this is the puzzle's source ply
and the user's historical move (`userMovePlayed`), which is exactly the
explanation the puzzle exists to teach. Any other divergence shows the
objective-achieving move from the stored line without glyph or eval. A
correctly solved puzzle marks each attempt move as *matching the
verified solution* — never as an ADR-023 `best` label (accepted
alternatives are correct without being the engine's top move, and no
in-session move is engine-classified).

Outcomes rendered by the step:

- **solved** (`solvedFirstTry`/`solvedWithHelp`): the attempt line is
  shown fully marked as matching the solution; the verified line is
  shown for reference (plus alternatives where stored); the attempt
  summary (time, hints, wrong moves) is displayed. No divergence, no
  eval annotations.
- **failed**: the divergence point is highlighted; if the wrong move at
  the divergence is the stored historical move of the source ply, its
  stored classification glyph and eval swing are shown; otherwise the
  stored solution is shown as "the move that achieves the objective".
  The stored solution is always shown in full as the reference
  continuation.
- **skipped**: no post-solve step is offered (the user chose to move
  on; the solution stays unseen so future cycles stay fair).

**Continue** closes the step and returns to the cycle host without
losing the recorded outcome (next puzzle, configured re-presentation, or
cycle results).

## Game Library integration

Solves are recorded against puzzles owned by their source game. Feature
012 adds no Game Library row action or insight of its own (Feature-011's
per-game puzzle view stays read-only; set-building entry points belong to
Feature 013). Training activity contributes the **mastered-from-game**
count shown in Game Library insights (`domain/game-library.md` §7,
`masteredPuzzleCount`) through the attempt rows this feature writes; the
aggregate definition is Feature 013/014's, and the Library never
computes it.

## Data requirements

Additive persistence only; no change to the immutable `puzzles` table
(Feature-011 rows are inputs, never modified).

- **New `puzzleAttempts` table** (schema v9, additive). One row per
  puzzle presentation in a cycle, written once at presentation outcome:
  - natural key `[cycleId, puzzleId, presentationIndex]` — a puzzle
    re-presented within the same cycle (retry-failed `immediate`/
    `endOfCycle` retry pass) produces an additional row with an
    incremented `presentationIndex`, never an overwrite;
  - columns: `puzzleId`, `trainingSetId`, `cycleId`,
    `presentationIndex`, `startedAt`, `endedAt`, `result`
    (`solvedFirstTry`/`solvedWithHelp`/`failed`/`skipped`), solving time
    (ms), wrong-move count (the domain's "number of attempts"), hint
    count, highest hint level reached, `solved` boolean — plus the
    puzzle's `puzzleGeneratorVersion`/`origin` copied at write time so
    rows stay interpretable after generator advances (ARCHITECTURE §9).
    Exact Dexie schema/index details are an implementation detail of the
    joint Feature-012/013 schema milestone.
- **Ownership & deletion cascade** (ARCHITECTURE §7,
  `domain/puzzle-model.md`, `domain/game-library.md` §8): attempts are
  game-owned through their puzzle. Deleting a game deletes its puzzles
  and transitively their attempt rows (the cascade-ready
  `deleteGames` dependent-kind list is extended by the introducing
  milestone); no orphaned attempt may remain. Set/cycle deletion
  (Feature 013) removes the attempt rows it owns consistently.
- **Sync:** attempts are derived per-game data and are never synced as
  standalone values (Feature 016 syncs only game deletions as
  tombstones).
- **Immutability:** an attempt row is never updated once written; a
  corrected outcome is a new presentation, never a mutation.

## States

Transient solving-screen states (never persisted; the cycle's persisted
state is Feature 013's):

- `presenting` — loading the row and building the position from
  `startingFen`;
- `solving` — accepting moves at the decision point (counters running);
- `outcome` — result summary shown; the attempt row is being/awaiting
  write;
- `postSolve` — the analysis step is open.

Attempt-write states at outcome: `pending` → `written`; on failure the
row write is `retryable` and the outcome stays visible on the outcome
screen until it succeeds or the user explicitly confirms leaving with
the outcome unrecorded (never silently dropped).

## Error cases

- **Attempt write fails** at outcome: the outcome screen stays with an
  inline error and a retry; the session must not advance to the next
  puzzle while the row is unwritten unless the user confirms discarding
  it.
- **Puzzle row missing at presentation** (source game deleted between
  queue construction and presentation): the puzzle is skipped with a
  notice; no attempt row; the session continues with the next row.
- **Unparseable `startingFen`/solution** (pipeline defect, mirroring
  Feature-011's assembly contract): the presentation fails to load and
  is reported/skipped; the session never crashes.
- **Missing stored analysis/classification** for the source ply (older
  analysis, outdated run): the post-solve step renders without glyphs or
  eval — absent data is never replaced by fabricated or zero values.
- **Deletion mid-presentation** (game deleted while solving): the just
  written row may be removed by the cascade; the session returns control
  to the host, which reconciles.

## Edge cases

- **UCI exactness:** promotion moves must carry the promotion piece;
  castling and en-passant capture compare by canonical UCI; SAN display
  is rendered via `chessops` (Feature 003 / ADR-028).
- **Terminal alternative:** an accepted first move without a stored
  continuation completes the puzzle immediately (documented V1 contract,
  see Solving rules).
- **Duplicate positions:** two puzzles from different games may hold the
  same `startingFen`; they are distinct rows and both train normally —
  no FEN merge in V1.
- **Both origins in one set:** a set may mix tactical and blunder rows;
  the solving flow is identical, only the accepted-move set and the
  objective label differ.
- **Line parity:** a solution line may end on an opponent token; the
  puzzle is solved when the last *user* token is played, and any trailing
  opponent token is auto-played for display only.
- **Row mutation:** puzzle rows are immutable (Feature-011); no
  mid-session row change can occur. A generator-version advance never
  changes stored rows.
- **Clock:** solving time is wall-clock from presentation start to
  outcome; backgrounded/hidden-tab time counts (V1 default; no
  per-puzzle pause). Restart does not reset the clock.
- **Hint request after the first move is solved:** unavailable (hints
  cover the first solution move only).
- **Puzzle revisited after a failed prior cycle:** each presentation is
  a fresh row with its own counters and timer.
- **Offline:** the whole solve and post-solve flow works offline (no
  engine, no network) per ARCHITECTURE §11.

## Accessibility

- Every action (hint, skip, give up, restart, transport, analyze,
  continue) is a real control with a visible text label, reachable by
  keyboard and touch — never hover-only, never shortcut-only.
- **Move entry must be pointer-free-possible:** playing moves is an
  essential action, so a keyboard path to enter a move must exist (e.g.
  square selection via focus or algebraic entry); the Feature-006 rule
  that arrow keys do not move pieces still applies.
- The puzzle's objective, the side to move and the position are exposed
  as text for assistive technology; the wrong-move verdict, hint content
  and outcome are announced (`aria-live`) — color and glyphs are never
  the only signal.
- Focus is managed on presentation start/end and when the post-solve
  step opens/closes; returning via **continue** restores the outcome
  context.

## Responsive / mobile

- The board uses the shared fluid wrapper; the solving screen stacks on
  tablet/mobile (board, then objective/controls, then move list/
  analysis) rather than shrinking a desktop layout.
- The post-solve step follows the Feature-008 mobile patterns
  (collapsible sections for move list and engine-lines content).
- No interaction requires hover; touch targets stay practical for
  mouse and touch.

## Performance

- Feature 012 never runs the engine and never touches the ADR-018 cache:
  per-move cost is bounded `chessops` legal-move handling plus constant
  state work — nothing freezes the UI (ARCHITECTURE §10).
- Persistence is a single small IndexedDB write per presentation
  outcome; the session keeps only the current puzzle in memory (the host
  owns the queue).
- The post-solve step reads only already-persisted rows (one game-scoped
  `MoveAnalysis` lookup at the source ply); opening it is cheap and
  repeatable.

## Acceptance criteria

1. Given a fixture puzzle row of either origin, presenting it inside a
   hosted session starts a fresh presentation (board at `startingFen`,
   oriented to the user's color, objective label correct for the origin,
   zero counters) and solving is possible with mouse and touch.
2. A blunder row accepts exactly its single `bestMove`; any other legal
   move is identified as incorrect and does not advance the position.
3. A tactical row accepts `{ bestMove } ∪ acceptedFirstMoves` at the
   first decision point, rejects everything else, auto-plays the
   opponent reply from the chosen stored branch, requires the branch's
   subsequent user moves in order, and completes when the branch's user
   tokens are exhausted; an accepted alternative without a stored
   continuation completes the puzzle on that first move.
4. A clean solve records `solvedFirstTry`; a solve after a hint and/or a
   wrong move records `solvedWithHelp` (with hint count/highest level);
   give-up records `failed`; skip records `skipped`; leaving the session
   mid-presentation records nothing and leaves the puzzle unanswered.
5. Each outcome writes exactly one immutable `puzzleAttempts` row keyed
   `[cycleId, puzzleId, presentationIndex]` with result, solving time,
   wrong-move count, hints and solved flag; a re-presentation of the same
   puzzle within a cycle creates an additional row, never an overwrite.
6. Deleting the source game deletes its puzzles and their attempt rows;
   no orphaned attempt remains.
7. Hints reveal exactly the PRODUCT §10 level information, respect the
   set's level availability/threshold, stop at level 4, never reveal
   beyond the first solution move, and never mark the puzzle failed.
8. The post-solve step is read-only over stored data: no engine starts,
   no ADR-018 cache read, no MultiPV configuration; a solved puzzle shows
   the attempt marked as matching the verified solution (no ADR-023
   glyphs invented); a failed puzzle highlights the divergence and shows
   stored classification/eval annotation only where a stored
   `MoveAnalysis` record for that move exists; **continue** returns to
   the cycle host with the outcome preserved.
9. Feature 012 never computes cycle aggregates, never starts the engine,
   and never re-derives or regenerates puzzle rows.
10. The solving screen is keyboard-operable end to end (including a
    pointer-free move-entry path), outcomes are announced, and no
    essential signal relies on color alone.
11. Fixtures (both origins, multi-move, accepted alternatives,
    promotion) are deterministic and require no engine, network or
    IndexedDB for domain/component tests.

## Testing requirements

- **Domain (pure):** accepted-move evaluation per origin; continuation
  matching on multi-move lines; terminal accepted alternatives;
  promotion/castling UCI comparison; wrong-move rejection and counting;
  hint-level gating (availability/threshold, first-move only, stop at
  level 4); outcome derivation per trigger (clean solve / hint / wrong
  move / give-up / skip / discard-on-exit).
- **Repository (infrastructure):** `puzzleAttempts` natural-key put,
  per-cycle/per-puzzle listing, idempotent presentation-index behavior,
  immutability, and cascade deletion with the game (and with
  set/cycle-owned rows once Feature 013 exists).
- **Service/application:** a hosted-session harness drives presentations
  end to end over deterministic fixtures — exactly one row per outcome,
  discard-on-exit writes nothing, retry-pass re-presentation writes an
  additional row with an incremented index, write-failure retry keeps the
  outcome visible.
- **Component:** the solving screen renders fixture puzzles with no
  engine/network/IndexedDB (presentation, correct/wrong move feedback,
  hints text, skip/give-up/restart/transport, outcome summary,
  post-solve step contents and the stored-only divergence annotation,
  continue returning to the host); keyboard/AT behaviour (announcements,
  focus, pointer-free move entry); mobile layout.
- **End-to-end:** requires the Feature-013 host and lands with that
  feature (a full set → cycle → solve → attempt → cycle-completion
  flow). Feature-012's own slice is covered by the harness above.

## Dependencies

Feature 012 depends on:

- Feature 006 — the shared analysis-board surface (stored mode) reused
  by the post-solve step, and the rule that glyphs render only where
  classification output exists (ADR-033);
- Feature 008 — persisted `MoveAnalysis` of the source ply backing the
  stored divergence annotations;
- Feature 011 — the immutable `PuzzleRow` input (both origins, accepted
  first moves, `startingFen`/`bestPv`/`bestMove`, provenance);
- Features 002/003 — board wrapper and `chessops` move handling
  (inherited through the features above);
- the session host (Feature 013 in V1) for the ordered queue,
  configuration and cycle context — implemented after Feature 012 per
  the roadmap, built here against the host contract and deterministic
  fixtures;
- `PRODUCT.md` §10 (hint levels, authoritative).

Feature 012 output is consumed by:

- Feature 013 — attempt rows (lifecycle, retry passes, cycle metrics);
- Features 014/015 — statistics/dashboard aggregates over attempts.

## Context

Required reading (see `.opencode/CONTEXT-MAP.md`):

- Architecture/decisions: `ARCHITECTURE.md` (post-solve panel on the
  shared analysis board; ownership & deletion cascade);
  `decisions/ADR-031`, `decisions/ADR-023`, `decisions/ADR-033`;
  optional `history/ADR-007/011/021/022` (history only)
- Domain: `domain/tactical-training.md`, `domain/puzzle-model.md`,
  `domain/analysis-model.md`, `domain/game-library.md`
- Research: `research/cycle-training.md`

Feature dependencies: Features 006, 008, 011 (constructs); Feature 013
(host, implemented after 012) consumes the solving screen and attempt
rows. PRODUCT §10 (hint levels, authoritative).

## Open questions

Genuine product/domain questions left for the owner; none block this
spec's structure, but each needs a decision before or during
implementation:

1. **Attempt-row granularity & cycle aggregates.** This spec adopts one
   `PuzzleAttempt` row per puzzle presentation — natural key
   `[cycleId, puzzleId, presentationIndex]` — to keep rows additive
   under in-cycle retry passes. `domain/tactical-training.md` is ambiguous about granularity
   when retry-failed `immediate`/`endOfCycle` re-presents a puzzle
   within the same cycle, and Feature-013's aggregate formulas
   (first-try-accuracy denominator, "puzzles completed", retry-pass
   handling) must be defined over this choice. If the owner/domain keeps
   a single final-outcome row per (cycle, puzzle), this feature's write
   contract changes accordingly.
2. **`solvedWithHelp` covers wrong-move solves.** Per
   `domain/tactical-training.md`, a solve after a wrong move (no hint)
   is `solvedWithHelp` ("and/or after a retry"). Confirm this is the
   intended semantics for reporting, or whether a distinct "solved after
   error, no hint" bucket should exist for Features 013/014.
3. **Post-solve depth.** The engine-free, stored-data-only post-solve
   step (chosen here because stored game `MoveAnalysis` cannot supply
   eval swings or multi-PV for novel wrong moves, and ADR-033 forbids
   recomputing classification in the view) cannot explain *why* an
   arbitrary novel wrong move loses. If the product later wants true
   per-divergence engine evaluation, that is new scope built on the
   Feature-006 live mode (engine runs, labelled live) — deferred.
4. **Presentation-scoped defaults.** Restart semantics, wall-clock
   timing across backgrounded tabs, hint-button granularity and the
   "analyze opens automatically on failure" default are stated here as
   V1 defaults and are revisable product choices.
