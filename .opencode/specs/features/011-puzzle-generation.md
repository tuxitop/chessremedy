# Feature 011 — Tactical Puzzle Generation

## Goal

Turn Feature-010's **verified tactical candidates** into durable, immutable
**training puzzles** assembled from the user's own games, and make those
puzzles inspectable from the Game Library and ready for cycle-based training
(Features 012/013).

A puzzle represents a meaningful tactical objective from the user's own
decision point — never "reproduce the engine's first move" for its own sake —
and may contain a multi-move forcing solution (ADR-006, PRODUCT §8).

## Pipeline ownership (Feature-010/ADR-026 boundary)

Feature 011 **never runs the engine**: its tactical origin consumes Feature-010
**verified candidates only**, and its correct-move origin consumes the
analysis's own stored `MoveAnalysis` records (no engine work either way).
Feature 010's two-stage detection pipeline (ADR-026) already owns:

- Stage-1 candidate generation over persisted `MoveAnalysis` (ADR-026 Stage 1);
- Stage-2 engine verification at the **tactical profile** (ADR-012: depth 22,
  MultiPV 5) — the engine run, line walk to the tactical objective, forcingness
  and objective classification, and every false-positive guard;
- the ADR-025 difficulty estimate, computed and persisted on each verified
  candidate (there is **no** difficulty rejection floor in Feature-010 —
  `detectionVersion` 5; a missed tactic surfaces however easy a puzzle it
  would make);
- persistence of the **verified candidate** row (`verificationStatus:
  'verified'`) with `bestMove`/`bestPv` (the line walked to the objective),
  `tacticalObjective`, `candidateSolutionLength`, the stored `difficulty`
  and `acceptedFirstMoves`, plus `verificationMetadata`
  (`engineName/Version/Build`, `analysisVersion`, `verificationDepth`,
  `verificationTimestamp`, `wdlAfterBestLine`), `detectionVersion` and
  `candidateGenerationVersion`.

Feature 011 therefore:

- reads `verified` rows only — the `puzzleCandidates` repository's
  `listVerifiedForGame` is one documented Feature-011 input — **plus** the
  analysis's own per-ply `MoveAnalysis` records (its user-side `blunder` plies
  that the verified set does **not** already own form the one-move correct-move
  origin);
- does **no engine work**: no tactical or MultiPV run, no `deep`-profile (depth
  30) confirmation run, no re-verification, no difficulty recomputation;
- does not generate candidates (that is Feature-010); it may apply its **own
  quality threshold** (e.g. a minimum ADR-025 difficulty) when it decides
  which verified candidates become *training* puzzles — surfacing in Game
  Review is unaffected by any such threshold. (Blunder correct-move puzzles are
  included however lost the position was and carry no rejection floor.)
- owns the **final puzzle assembly and persistence**: candidate/blunder →
  immutable `puzzle` row (schema v8), the generation pass state machine, the
  Game Library row insight/action surface, and the read-only per-game puzzle
  view.

```text
Feature-010 verified candidates (puzzleCandidates, verified rows only)
      + analysis's user-side 'blunder' plies without a verified candidate (MoveAnalysis)
      ↓
Feature-011 puzzle assembly (pure domain)   ← no engine work
      ↓
puzzles table (schema v8, immutable rows)
      ↓
Game Library: row puzzleCount + "Puzzles from this game" → per-game puzzle list
      ↓
Feature 013: build TacticalTrainingSets from the game's puzzles (consumer)
```

## Puzzle sources

A puzzle originates from the user's own decision point in one of two ways:

1. **Verified tactical candidate (unchanged).** A position where a tactic was
   available **on the user's turn** and the user did not play the engine's best
   move (the user's own missed tactic / punished mistake). This includes:
   - user moves that crossed the ADR-023 mistake band (`wpLoss ≥ 5`);
   - opponent-conceded swings the user failed to punish;
   - missed decisive / missed mate positions;
   - quiet small-loss misses whose best first move is forcing.
   The puzzle is the full verified forcing line walked to the objective.
2. **User-side blunder not captured by a verified candidate (new; version-2
   generator).** A `MoveAnalysis` ply of the generation's analysis where the
   side to move is the user and the ADR-023 classification is `'blunder'`
   (`wpLoss ≥ 15`, Feature 009) and that **same ply produced no verified
   candidate** becomes a one-move **"correct-move"** puzzle: *find the move you
   should have played*. Its solution is the ply's stored analysis `bestMove`
   (single move), its side to move is the user, and it is included however lost
   the position was. There is no engine work, no Stage-2 verification and no
   difficulty recompute behind it — the row is assembled deterministically from
   the ply's own stored analysis record. If the same ply is *both* a verified
   tactical candidate and a user blunder, the tactical puzzle wins (see
   Deduplication & re-analysis): the blunder row is only created for plies the
   tactical pipeline did not already own.

The earlier direction — "a blunder or mistake that Feature-010 did **not**
verify as a tactical opportunity never becomes a puzzle" — is superseded for
**user-side blunders** by this delta. It reverses the stale
"opponent punishes the blunder" framing of `research/puzzle-generation.md` §1
that this spec previously cited (the position-centric, user-side ADR-026 v2
model stays authoritative for the *tactical* origin; see "Side to move"): a
user-side blunder the tactical pipeline did not verify still records a genuine
decision point the user trains — "play the move you should have played" — even
when no multi-move tactic was on offer. The verified-tactic origin is
unchanged.

The source game, ply and move remain traceable on the puzzle (provenance).

## Training-set consumption

Generated puzzles feed **tactical training sets** (ADR-031,
`specs/domain/tactical-training.md`): Feature 013 may group the game's puzzles
into a set by source/criteria for cycle training. Puzzle generation itself
never assigns scheduling state, ordering or set membership to a puzzle — a
`Puzzle` is an immutable definition (no due date, interval, stability or
per-user difficulty). Membership is tracked by the set; attempts are recorded
by Features 012/013.

## Puzzle assembly (domain behavior)

Assembly is a pure, deterministic function of one input (a verified candidate
or a qualifying user-side blunder ply) plus the generator version. The row
carries an optional `origin` discriminator — `'tactical'` (absent on rows
committed before the version-2 generator; every new row sets it explicitly) or
`'blunder'` — and the tactical-only fields are optional so blunder rows are
honest:

```text
verified candidate (Feature-010) → tactical row:  verified bestPv/objective/
                                                   ADR-025 difficulty/verification
                                                   metadata/accepted alternatives
qualifying user blunder ply (MoveAnalysis)       → blunder row: bestMove only,
                                                   one-move solution, deterministic
                                                   provisional difficulty, no
                                                   verification metadata
```

A **tactical row** contains:

- natural key `[sourceGameId + sourcePly]` — one durable puzzle per game
  position (see Deduplication & re-analysis);
- provenance: `sourceGameId`, `sourcePly`, the generating `analysisId`,
  `startingFen`, `userMovePlayed` (the move the user actually played — kept so
  the training UI can later explain "what you played vs. what you should have
  played"), `tacticalObjective`;
- `sideToMove` (see Side to move);
- the expected solution: the verified candidate's `bestPv` — the forcing line,
  already walked by Feature-010 from the starting position to the objective,
  including the opponent's responses within the line;
- accepted alternative first moves where present (see Alternative first moves);
- `difficulty` — the ADR-025 estimate produced by Feature-010 for the candidate
  (see Difficulty);
- engine verification metadata copied unchanged from the candidate
  (`engineName/Version/Build`, `analysisVersion`, `verificationDepth`,
  `verificationTimestamp`, `wdlAfterBestLine`), plus `detectionVersion` and
  `candidateGenerationVersion`;
- `puzzleGeneratorVersion` (ARCHITECTURE §9 — identifies which version of the
  generator/formula produced the puzzle);
- `createdAt`.

A **blunder row** (one-move "correct-move" puzzle) contains the same natural
key, provenance (`sourceGameId`, `sourcePly`, `analysisId`, `startingFen`,
`userMovePlayed`), `sideToMove`, `origin: 'blunder'`, `bestMove` (the ply's
stored analysis best move), a singleton `bestPv: [bestMove]`, `difficulty`
(see Difficulty), `puzzleGeneratorVersion`, `detectionVersion` (the
`DETECTION_VERSION` the pass gated on), `candidateGenerationVersion: null`
(no Feature-010 candidate exists) and `createdAt`. It carries **none** of the
tactical-only fields (`tacticalObjective`, `verificationMetadata`,
`candidateSolutionLength`, `acceptedFirstMoves`) — the objective chip reads
"Find the best move" instead.

The puzzle is immutable once written. No scheduling/training state is stored on
it (ADR-031).

### Side to move

The puzzle's side to move is **always the user's color at the position before
their missed move** (`startingFen` already encodes the position before the
user's move, so the user is the mover). This holds for both origins: a blunder
row's `startingFen` is the position before the user's blunder (the `MoveAnalysis`
ply's position, where the user was to move). The user trains their own decision
point: "what should I have played here, and why did it matter?" (PRODUCT §9).
The stale `research/puzzle-generation.md` §1 phrasing ("usually the opponent of
the player who made the mistake") is superseded by the user-side,
position-centric ADR-026 v2 candidate model; this spec records the resolved
direction. The user's original move is retained as provenance and for the
training-time explanation, never as the expected solution.

### Multi-move solutions

The solution may contain multiple moves. Multi-move determination already
happened in Feature-010: `bestPv` is the tactical-profile top line walked to
the objective (prefixes scanned inside the 8-ply window). Feature-011 persists
that verified line as the expected solution; it does not re-walk, extend or
re-derive continuations. Opponent-side branching (multiple defensive replies)
is not modelled in V1 — the verified line contains the opponent's responses
within the forcing continuation (research §5's single-best-defence note is
kept).

A **blunder row is a one-move puzzle by construction**: Feature-010 did not
verify any forcing continuation at that ply, so the puzzle asks only "find the
move you should have played" and its `bestPv` is the singleton `[bestMove]`.
Feature 012 must accept exactly that move; nothing beyond the single ply is
expected.

### Alternative first moves

When the candidate's verification established that **forcing alternative first
moves** also reach the same tactical objective, those alternatives are part of
the puzzle: Feature 012/013 must accept them as correct, and ADR-025's `C`
(candidate first moves) input is measured on the final puzzle. The puzzle
persists the accepted alternative first moves (and their continuations when
known) alongside the verified `bestPv`. V1 never requires the user to reproduce
an irrelevant engine move when several moves achieve the objective; a move that
is *not* an accepted alternative is incorrect.

Blunder rows carry no accepted alternatives: Feature-010 ran no Stage-2
verification for them, so no alternative first moves are known or stored.

> Interface note (open item, see "Open items" at the end): the verified
> candidate row currently persisted by Feature-010 does **not** yet carry the
> accepted-alternative set (only `bestMove`/`bestPv` of the top line). To keep
> Feature-011 a pure, engine-free, cache-independent consumer, Feature-010's
> verified-candidate output should persist the accepted-alternative first moves
> (and continuations) it already computes during Stage-2 verification. The
> ADR-018 tactical-profile cache entry is a fallback source for
> `'tactical-search'` candidates only and is absent by design for
> `'stored-analysis'` (fast-path mate) candidates, so it cannot be the sole
> source of the contract.

### Difficulty

The puzzle's `difficulty` is the **ADR-025 estimate Feature-010 computed for
that verified candidate** at its Stage-2 verification — i.e. at the **tactical
profile's depth 22** — stored unchanged. Feature-011 performs **no deep-profile
(depth 30) confirmation run** and never recomputes difficulty.

Consequence, stated explicitly: because difficulty is evaluated at depth 22, the
ADR-025 `depthBonus` (applied only when `depth ≥ 26`) **never applies to any V1
puzzle difficulty**. The formula, weights, caps and bucket boundaries remain
ADR-025's; only the `depth` input is the tactical verification depth (22), so
the depth term contributes 0 to every V1 score. A future feature that adds a
deeper verification would change the depth input semantics and must be handled
as a generator-version/formula change (new ADR, `puzzleGeneratorVersion` bump;
stored scores are never retroactively re-mapped).

Difficulty is a single integer in `[0, 100]`, bucketed per ADR-025. Each
verified candidate already carries the estimate Feature-010 persisted (the
tactical-profile run at depth 22; the stored-mate fast path at the stored
line's depth). The puzzle inherits that value as-is — Feature-011 does not
recompute it. Because Feature-010 applies no difficulty rejection floor, a
verified candidate can have any score `≥ 0`; Feature-011 decides whether a
*puzzle-quality* threshold applies when it promotes candidates into the
training-puzzle set (Game-Review surfacing is unaffected).

#### Blunder-row difficulty (deterministic, provisional)

A blunder row has **no engine-verified ADR-025 estimate** (no Stage-2 run
happened), so its difficulty is a deterministic, provisional score derived from
the blunder ply's own stored analysis record. The engine's evaluation of the
best move is **not stored per ply**: a `MoveAnalysis` row stores `evalBefore`
(the best-line evaluation of the position before the blunder, from the mover's
perspective — i.e. the value the best move achieves) and `evalAfter` (the value
the user's actual move achieved, same perspective). The swing the user missed is
therefore:

```text
swingWp = |wp(evalBefore) − wp(evalAfter)|          (ADR-023 win percentages)
difficulty = clamp(round(100 − swingWp), 0, 100)
```

Difficulty inverts that swing — the bigger the win-probability swing the user
handed away, the more obvious the correct move and the **easier** the puzzle
(larger swing → lower score). The score is deterministic for a fixed record,
lives in `[0, 100]` and buckets through the standard ADR-025 buckets. It is
**provisional**: it encodes "how obvious was this correction from the eval
signal", not a solver-calibrated rating; Feature 013 may re-rate blunder puzzles
from solver data (re-rating is a Feature-013 generator/formula concern, never a
retroactive re-map of stored scores).

Blunder rows are included however lost the position was: there is no
lost-position or difficulty rejection floor for the correct-move origin (a
blunder is always "find the better move", even in a lost game).

### Deduplication & re-analysis

- **One puzzle per game position**, keyed `[sourceGameId + sourcePly]`.
  Candidates are scoped per analysis identity (`[analysisId + sourcePly]`,
  Feature-010), so a verified candidate maps to the puzzle row of its
  `(game, sourcePly)`; the row is created only when absent. The **first**
  input to arrive for that game position (from whichever analysis) creates the
  row; any later input at the same `(game, sourcePly)` — including one from a
  re-analysis — maps to the existing row and is skipped (see re-analysis
  below).
- **Tactical rows win over blunder rows at the same ply.** A generation pass
  processes its verified candidates **before** its blunder plies, and writes
  through the same add-only natural key: a ply that is *both* a verified
  tactical candidate and a user blunder keeps the richer tactical row, and no
  blunder row is created for it. A blunder ply whose `(game, sourcePly)` already
  has a puzzle from an older analysis is likewise skipped (rows are immutable).
  Pass progress counts **items settled** (candidate + blunder at the same ply
  settle twice), exactly like a resumed pass counts an already-persisted row;
  the Library/row count is always the live `puzzles` row count.
- **No cross-game FEN merge.** Two games containing the same tactic produce two
  puzzles, each owned by its source game (deletion cascade). The stale
  FEN-keyed "update the existing record when strictly stronger" dedup of
  `research/puzzle-generation.md` §7 is superseded: puzzle rows are immutable
  and game-scoped, and Feature-010's candidates are already keyed
  `[analysisId + sourcePly]`, not by FEN.
- **Re-analysis (new `analysisId`):** previously generated puzzles persist
  immutably (protects training-set membership and attempt history, consistent
  with ADR-031). The new analysis's generation pass adds a puzzle only for a
  newly verified candidate whose `(game, sourcePly)` does **not** already have a
  puzzle. It never silently replaces, overwrites or deletes existing puzzles or
  their attempts/membership — even when the new analysis verifies a different
  or better tactic at the same ply. (Mirror of ADR-020: a puzzle stays valid
  for the engine/analysis that produced it; re-verification is a future,
  opt-in pass, never automatic.)
- Generation is therefore **idempotent**: re-running the pass for an analysis
  (resume, retry, or a later analysis over the same game positions) writes only
  rows whose `(game, sourcePly)` is absent.

## Puzzle-generation pass (states & lifecycle)

Puzzle generation is derived work scoped to one analysis identity, mirroring
Feature-010's detection pass:

```text
absent → queued → inProgress → completed | failed
```

- `absent` — no generation pass exists for the analysis:
  - detection has not completed for the analysis (detection
    `absent`/`queued`/`inProgress`/`failed` or interrupted) — the Library
    shows no puzzle item/count (the Feature-010 detection-state note already
    tells the truth);
  - or detection has completed but the generation pass was never run (e.g. the
    analysis predates the feature or generation was not scheduled) — the
    Library renders "Puzzles not generated" with the on-demand
    Generate/Resume affordance, never a zero.
- `queued` — the analysis's detection pass **completed** (whether it produced
  zero or more verified candidates) and the generation pass is scheduled but
  not yet running.
- `inProgress` — the pass is running; a persisted progress counter
  (`done`/`total` over the analysis's input items: verified candidates plus
  qualifying user-side blunder plies) advances as each item is
  assembled/written or skipped.
- `completed` — every input item of the analysis was processed. A pass over
  zero inputs completes normally and is a real "no puzzles generated by this
  analysis".
- `failed` — a write/assembly error interrupted the pass. Already-written
  puzzle rows persist; the pass is retried via the same resume/retry entry
  point.

### Trigger & scheduling

- **Automatic:** as soon as a game's detection pass **completes** for its
  latest completed analysis, a generation pass for that analysis is scheduled
  and starts detached. Generation is derived data and **never blocks the
  analysis queue** (mirror of Feature-010: the analysis job is `completed` and
  the queue advances immediately; the generation pass runs in the background).
- **Resumable on demand:** an interrupted, failed, or never-run pass for a
  completed detection offers a dedicated "Generate/Resume puzzles" affordance
  (Game Library row and the per-game puzzle view), exactly like Feature-010's
  "Resume / Run tactics scan". It processes only that analysis's input items
  (verified candidates and qualifying blunder plies) that do not yet have a
  puzzle for the game.
- **Cancellable:** a live pass can be cancelled in place; it stops at the next
  input-item boundary and leaves the state resumable (`queued`). Progress is
  restored on resume from the already-persisted puzzle rows of the game.
- **Live registry:** passes are registered as live in the session (like
  Feature-010's scan registry) so the UI renders progress only while a pass is
  genuinely running; an interrupted pass never claims progress.
- **No engine involvement:** the pass does pure assembly plus batched IndexedDB
  writes; it never touches the engine service, workers, or ADR-018 cache.

### Re-analysis interplay

A forced re-analysis cancels the superseded analysis's live/queued generation
pass (no ghost pass ahead of the new run). Already-created puzzles of the
superseded analysis persist (immutability rule above); the new analysis starts
its own pass from `absent` once its detection pass completes.

## Game Library integration & user-facing behavior

Two surfaces are owned here (Game Library page stays a read-only consumer,
per `domain/game-library.md`):

1. **Per-row `puzzleCount` insight + "Puzzles from this game" action**,
   registered through the Library row-action/insight capability registry
   (`domain/game-library.md` §7; capability key `puzzles`).
2. **A minimal read-only per-game puzzle list/preview view**, reachable from
   the row action.

### Row `puzzleCount` — absent-vs-zero

The Library row shows the game's puzzle count only when puzzle data genuinely
exists:

- The count is the number of the game's persisted `puzzles` rows (a repository
  count over the game-scoped index, never a per-row `MoveAnalysis`/candidate
  scan).
- A **real zero** is shown only when the latest completed analysis's generation
  pass completed and the game has no puzzles.
- While the latest completed analysis's generation state is
  `absent`/`queued`/`inProgress`/`failed`, the row renders the corresponding
  state note ("not generated", "generating…", "generation interrupted /
  failed") instead of a number — **absent is not zero**, mirroring the
  Feature-010 missed-tactic contract. If detection has not completed for the
  latest completed analysis, the existing Feature-010 detection-state note
  applies and no puzzle count is shown.
- Rows without a completed analysis show no puzzle item (Feature-008 status
  rules unchanged).

### "Puzzles from this game" row action

The row action (capability `puzzles`) opens the game's read-only puzzle list.
On a game with no puzzles and a not-yet-completed generation state, the action
may still open the view in its empty/state-note state, or be disabled with an
explanation — the affordance never implies a zero count.

### Per-game puzzle list/preview (read-only)

A dedicated, deliberate (not a shrunk table) view listing the game's puzzles.
Each puzzle entry (card) shows:

- a Chessground board of the starting position through the shared board wrapper
  (oriented to the side to move; pieces frozen — no move mutates game/analysis
  data — but the board is **drawable for inspection**, matching the live
  analysis board). A **red arrow** always marks the move the user actually
  played (`userMovePlayed` from `startingFen`);
- difficulty (ADR-025 bucket and/or score; blunder rows carry the deterministic
  provisional score);
- the objective — a tactical row's stored tactical objective, or the fixed
  "Find the best move" label for a blunder correct-move row;
- provenance (source ply, the user's original move, generator/detection
  versions where useful).

The expected solution is **hidden by default on each card** behind an
accessible per-card "Show solution" toggle (button with `aria-pressed` +
`Show`/`Hide solution` label, keyboard-operable, independent per card).
Revealing shows the solution in SAN (accepted alternative first moves when
present) and draws a **green arrow** for the solution's first move (`bestMove`)
on that card's board. The reveal is per card and read-only — real solving is
Feature 012.

The view is **read-only**: no solving, no attempt recording, no post-solve
analysis (Features 012/013), no re-generation controls beyond the
Generate/Resume state affordance when the pass is not complete. Building a
training set from these puzzles is Feature-013's job (consumer); this feature
only exposes the puzzles and hands off the set-building entry point to Feature
013.

## Data requirements

Additive persistence only:

- **New `puzzles` table (schema v8).** One immutable row per puzzle; natural
  key `[sourceGameId + sourcePly]`; game-scoped index for per-game counting,
  listing and cascade deletion. Columns as listed under "Puzzle assembly".
  Exact Dexie schema/index details and the `PERSISTENCE_SCHEMA_VERSION` bump
  are implementation details of the schema milestone; the row must round-trip
  the candidate's verification metadata and provenance unchanged.
- **Generation-pass state holders** are additive on the analysis identity that
  owns the pass (the per-analysis summary row already used for Feature-010's
  detection state and scan progress gains puzzle-generation state/progress),
  so the Library can distinguish absent / queued / inProgress / completed /
  failed and render progress only while a pass is live. Exact placement is an
  implementation detail; older rows simply lack the fields.
- **Ownership & deletion cascade** (ARCHITECTURE §7, `domain/puzzle-model.md`,
  `domain/game-library.md` §8): puzzles are game-scoped derived data. Deleting
  a game deletes its puzzles and transitively their attempts and training-set
  membership once those exist (cascade-ready `deleteGames` dependent-kind list
  extended by this feature). No orphaned puzzle may remain.
- **Sync:** puzzles and puzzle-generation state are derived per-game data and
  are never synced as standalone values (Feature 016 syncs only game deletions
  as tombstones; derived insights/filter state are never synced). The ADR-018
  engine cache is untouched by this feature.
- **Row shape (additive; no schema bump).** The row fields above are additive —
  a blunder
  row stores no `tacticalObjective`/`verificationMetadata`/
  `candidateSolutionLength`/`acceptedFirstMoves`, and a version-2 row stores an
  explicit `origin` (`'tactical'`/`'blunder'`); older committed rows simply
  lack `origin` (= tactical). `candidateGenerationVersion` is `null` on blunder
  rows (there is no Feature-010 candidate). No schema version bump is needed —
  Dexie stores plain objects and the `puzzles` schema/indexes are unchanged
  (schema v8 string identical).
- **Versions:** every puzzle stores `puzzleGeneratorVersion` (2 for the
  two-origin generator), `detectionVersion` and `candidateGenerationVersion`
  (plus the candidate's engine/analysis metadata on tactical rows) so existing
  records remain identifiable after algorithm or engine changes
  (ARCHITECTURE §9, ADR-020).

## States, errors and edge cases

- **Detection pass not completed / failed / interrupted** → generation stays
  `absent`; the Library shows the Feature-010 detection-state note, never a
  puzzle count and never a zero. When detection is later resumed and completes,
  the generation pass is scheduled automatically.
- **Zero input items** (no verified candidates and no qualifying user-side
  blunder plies) → the generation pass runs and completes with
  zero rows. If the game has no puzzles, the row count is the real value `0`
  (only once the pass completed).
- **Pass interrupted** (page close, cancel) → state `queued` (resumable);
  already-written puzzle rows persist; resume skips them via the
  `(game, sourcePly)` key and continues.
- **Puzzle-table write/assembly failure** mid-pass → state `failed`; rows
  already written persist; the pass is retried via the on-demand entry point.
- **Re-analysis of a game whose pass is live/queued** → the superseded pass is
  cancelled (its in-flight writes settle); existing puzzles persist; the new
  analysis generates only missing `(game, sourcePly)` rows.
- **Candidate rows deleted while a pass runs** (forced re-analysis cleanup,
  Feature-010) → the pass for that analysis is superseded/cancelled; written
  rows persist.
- **Game deleted while a pass runs** → cascade removes the game's puzzles; the
  pass aborts cleanly at the next boundary.
- **Same tactic in two games** → two puzzle rows (one per game). No FEN merge.
- **Same position reached twice in one game at different plies** → two
  inputs → two rows (`sourcePly` differs). Transposition-level merging is
  out of V1 scope (documented limitation of per-position keying).
- **New analysis verifies a different/better tactic at an already-puzzled ply**
  → the existing puzzle is kept unchanged (immutable; protects membership and
  attempts); no silent replacement.
- **Engine upgrade (ADR-020)** → existing puzzles retain their generating
  engine/analysis metadata and stay valid for that engine; re-verification/
  regeneration is opt-in and versioned, never automatic.
- **Terminal/book positions** never appear (Feature-010 already excludes them
  from candidates).
- **User blunder with no engine best move** at that ply (e.g. a book/terminal
  gap) → no "move you should have played" can be derived; the ply is skipped,
  never a malformed row. A blunder in a **lost** position is still generated
  (no lost-position floor for the correct-move origin). An unparseable blunder
  starting FEN is a pipeline defect: assembly throws and the pass reports
  `failed` (mirroring the tactical-assembly contract).
- **A ply that is both a verified candidate and a user blunder** → one tactical
  row; the blunder item settles against that row (see Deduplication). The
  Library count is unchanged (still the live `puzzles` row count).

## Accessibility

- The row `puzzleCount`/state note and the "Puzzles from this game" action are
  real interactive elements with visible labels; state is conveyed textually
  ("Generation interrupted — resume", "3 puzzles"), never by color alone.
- The per-game puzzle list is a labelled region; each puzzle entry exposes
  board position, difficulty bucket and objective as text for assistive tech
  (screen-reader text spells values out, Feature-010 precedent).
- Live generation progress ("Generating puzzle 2 of 5…") is announced
  (`aria-live`) only while the pass is genuinely running in the session; an
  interrupted pass never announces progress.
- Keyboard focus is managed when opening/closing the per-game puzzle view; all
  essential actions are reachable by keyboard and touch (never hover-only).

## Responsive / mobile

- The per-game puzzle list uses a deliberate mobile layout (cards), not a
  shrunk table; the shared board wrapper sizes fluidly on mobile and tablet.
- The "Puzzles from this game" row action is available from the per-row menu on
  mobile and the row/contextual toolbar on desktop (Feature-007 patterns).
- No interaction requires hover; touch is supported throughout.

## Performance

- Per-game generation work is bounded by the analysis's verified-candidate
  count (≤ Feature-010's `MAX_CANDIDATES_PER_GAME` cap of 16) **plus** the
  analysis's qualifying user-side blunder plies, so one pass is at most a
  small number of pure assembly + write steps.
- Generation is pure domain assembly plus batched Dexie writes; it runs off the
  UI thread (application/infrastructure service layer, detached), never freezes
  the UI, and never runs engine analysis synchronously (ARCHITECTURE §10).
- Progress persistence is one small IndexedDB write per settled input item,
  bounded by the same cap; the pass is resumable/cancellable like the
  Feature-010 tactics scan.
- The Library reads the game-scoped `puzzles` count/index and the per-analysis
  generation-state holder — no per-row scans, no engine.

## Fixture puzzles

Provide deterministic puzzle fixtures (usable without Stockfish, network or
real user data for UI/component tests), covering at least:

- mate-in-one;
- mate-in-two or a short mating sequence;
- a material-winning combination;
- an exchange-winning tactic;
- a missed-tactical-opportunity puzzle (from a verified candidate);
- a multi-move combination;
- a puzzle with more than one acceptable first move (where the accepted
  alternatives are exercised);
- a one-move blunder "correct-move" puzzle (origin `'blunder'`: a user blunder
  with no verified candidate, deterministic provisional difficulty, no
  verification metadata).

Domain fixtures feed pure assembly tests; component fixtures feed the Library
row/count and per-game puzzle-view tests (including the per-card solution
reveal and the red-played/green-solution arrows).

## Acceptance Criteria

1. Given a verified candidate (domain fixture or engine e2e), assembly produces
   exactly one immutable puzzle row for the candidate's `(game, sourcePly)`
   with starting FEN, user's original move, verified solution line, objective,
   accepted alternatives (where present), difficulty, verification metadata and
   generator version.
2. The puzzle's difficulty equals Feature-010's ADR-025 estimate at the
   tactical verification depth (22); no deep-profile run occurs and the
   `depthBonus` never applies.
3. The puzzle's side to move is the user's color at the position before the
   missed move; the user's original move is retained as provenance.
4. Re-running generation for the same analysis/game adds no duplicate rows;
   two games with the same tactic produce two puzzles.
5. Re-analysis (new `analysisId`) never deletes or replaces existing puzzles;
   it adds rows only for verified candidates whose `(game, sourcePly)` is
   absent. Training-set membership and attempts referencing existing puzzles
   are untouched.
6. A game whose detection pass completed with zero verified candidates yields
   a completed generation pass and a real `0` count; a game whose generation
   pass has not completed shows a state note, never a zero.
7. The Game Library row shows `puzzleCount` with the absent-vs-zero contract
   and exposes "Puzzles from this game", which opens the read-only per-game
   puzzle list (board, difficulty, objective, provenance) without an engine.
8. Deleting a game deletes its puzzles (and transitively attempts/set
   membership once those tables exist); no orphaned puzzle remains.
9. Puzzle fixtures are deterministic and require no engine/network for UI
   tests.
10. A user-side blunder ply of the analysis that has no verified candidate at
    its `(game, sourcePly)` produces exactly one one-move correct-move puzzle
    row (`origin: 'blunder'`, `bestPv = [bestMove]`, no tactical-only fields,
    deterministic provisional difficulty from the ply's stored eval swing,
    version-2 generator). A ply that is *both* a verified candidate and a
    blunder produces only the tactical row (dedup; Library count unchanged).
11. The per-game puzzle view hides each card's solution behind an accessible
    per-card reveal; revealing shows the SAN solution (and accepted
    alternatives where present) and draws the green solution arrow, while the
    user's actual move is always marked by a red arrow on the drawable
    inspection board. Rows committed before the version-2 generator render
    unchanged (origin absent = tactical).

## Testing requirements

- **Unit/domain:** pure assembly from deterministic verified-candidate
  fixtures — row shape, immutability, difficulty passthrough (no recompute, no
  bonus), side-to-move, alternatives persistence, `(game, sourcePly)` keying,
  re-analysis skip/no-overwrite semantics, cross-game separation,
  puzzleGeneratorVersion/detectionVersion/candidateGenerationVersion retention,
  zero-input completion, absent-vs-zero derivation. Blunder assembly from a
  deterministic qualifying-blunder input — one-move row, honest absence of
  tactical-only fields, deterministic provisional difficulty (monotonic:
  larger eval swing → easier score; clamped `[0, 100]`; mate evaluations
  handled), version retention.
- **Service (infrastructure):** the engine-free pass over verified candidates
  **plus** qualifying user-side blunder plies — state machine, freshness gate,
  real-zero completion, per-input-item progress, candidate-first ordering so a
  ply that is both keeps the tactical row, natural-key idempotency across
  resume/abort/failure, opponent/non-blunder/no-best-move plies never produce
  rows.
- **Repository (infrastructure):** `puzzles` natural-key put/get/list-by-game,
  idempotent re-put, per-analysis generation-state holders, cascade deletion
  with the game (and, once Feature-012/013 tables exist, transitive attempt/set
  cleanup).
- **Component:** Library row `puzzleCount` rendering across states (absent,
  queued/inProgress note, failed note, real zero, N), "Puzzles from this game"
  action wiring, per-game puzzle list/preview rendering fixture puzzles with no
  engine, per-card solution reveal (hidden by default, per-card independence,
  keyboard/`aria-pressed`), red-played/green-solution arrows, the blunder
  correct-move objective label, empty/state-note states, mobile layout,
  keyboard/AT behaviour.
- **End-to-end (committed engine fixture proof, mirroring Feature-010):** a
  deterministic fixture game engineered to contain a real missed tactic is
  analysed; the detection pass completes; the generation pass then completes;
  the test asserts a genuine puzzle appears in **both** the Library row count
  and the per-game puzzle view with the expected objective, difficulty and
  provenance. This proves the whole chain (analysis → detection → generation →
  Library/read surfaces) with a real engine and a real verified candidate. The
  missed-mate fixture's ply is also a user blunder, so this proof doubles as
  the tactical-wins dedup check (Library count stays 1). A dedicated engine e2e
  for a blunder-only ply is optional (blunder generation is otherwise covered
  at service + component level).

## V1 boundary

Feature 011 intentionally does not include:

- any engine work (no tactical/MultiPV/deep runs, no re-verification, no cache
  reads) — blunder correct-move rows are derived from the analysis's stored
  per-ply records only, with no Stage-2 verification and no difficulty
  recompute;
- candidate generation (Feature-010) — Feature-010 also no longer applies any
  difficulty rejection floor (`detectionVersion` 5), so a puzzle-quality
  threshold, if Feature-011 uses one, is Feature-011's own policy;
- solving interaction, hints, attempts or post-solve analysis (Feature-012) —
  the per-card solution reveal in this feature is a read-only preview of the
  expected solution, not solving;
- re-rating blunder difficulty from solver data (blunder difficulty is
  deterministic and provisional here; re-rating belongs to Feature 013);
- training-set/cycle lifecycle or per-puzzle scheduling (Feature-013; ADR-031:
  no FSRS, no per-puzzle scheduler in V1);
- per-puzzle editing/deletion UI (deletion is via the source game);
- cross-game FEN dedup / transposition merging;
- branching opponent defences beyond the verified forcing line (and nothing
  beyond the single correct move for blunder rows);
- semantic motif labelling (`tacticalMotifs` reserved, unpopulated in V1);
- puzzle difficulty re-rating from user performance or retroactive re-mapping
  after generator changes;
- sync of derived puzzle/generation data as standalone values (Feature-016
  tombstones only).

## Dependencies

Feature 011 depends on:

- Feature 010 — verified candidates (`puzzleCandidates` repository
  `listVerifiedForGame`) and the completed-detection signal that triggers the
  generation pass;
- Feature 007 — Game Library page, canonical row view, capability registry and
  per-row action/insight surfaces;
- `domain/puzzle-model.md` / ADR-031 — immutable puzzle contract (no
  scheduling state);
- `domain/game-library.md` — row-view insight/action extension and ownership
  rules.

Feature 011 output is consumed by:

- Feature 013 — training-set creation over the game's puzzles;
- Feature 012 — solving within a set/cycle (via Feature 013);
- the Game Library page — read-only `puzzleCount` and per-game puzzle list.

## Context

Required reading (see `.opencode/CONTEXT-MAP.md`):

- Architecture/decisions: `decisions/ADR-006`, `decisions/ADR-025`,
  `decisions/ADR-026`, `decisions/ADR-012`, `decisions/ADR-018`,
  `decisions/ADR-031`
- Domain: `domain/puzzle-model.md`, `domain/tactics.md`,
  `domain/tactical-training.md`, `domain/game-library.md`
- Research: `research/puzzle-generation.md`, `research/tactical-detection.md`

Feature dependencies: Feature 007 (Library row surface + capability registry),
Feature 010 (verified candidates); output consumed by Features 012/013.

## Open items

Recorded here for the owner; none block this spec's structure but each needs a
decision before implementation:

1. **Feature-010 output extension — resolved.** Verified candidates now persist
   the numeric ADR-025 difficulty estimate (`difficulty`, engine-verified at
   the tactical depth 22, stored-mate fast path at the stored line's depth)
   and the accepted solving first moves (`acceptedFirstMoves`: the best move
   plus every distinct-first-move alternative whose own line reached an
   objective and survived the guards). Puzzle assembly reads these straight
   off the verified candidate row — no cache reads and no second engine run
   are needed. (Rows verified before this change carry neither field.)
2. **ADR-025 depth wording.** ADR-025's input table says the difficulty `depth`
   input is the `deep` profile, default 30. This V1 decision fixes difficulty
   at the tactical verification depth (22, bonus never applies for
   engine-verified puzzles). If ADR-025 should state that its depth default
   applies only when a deep confirmation exists, that clarification belongs in
   a follow-up ADR-025 note/new ADR.
3. **Stale research.** `research/puzzle-generation.md` §1 (opponent side to
   move), §6 (deep verification), §7 (FEN-keyed "update existing" dedup) and
   the §11 pipeline (Feature-011 doing candidate/MultiPV work) predate ADR-026
   v2 and this decision set. They are flagged for a future research-doc
   reconciliation; they were not rewritten in this task.
