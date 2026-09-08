# Feature 010 — Tactical Detection

## Goal

Identify meaningful missed tactical opportunities in analyzed games and make those opportunities available for review and downstream puzzle generation.

A missed tactical opportunity is a position where the player failed to find a forcing continuation that achieves a meaningful tactical objective.

## Pipeline

```text
Candidate generation
→ engine verification
→ tactical objective
→ candidate quality
→ Game Review annotation
→ Feature 011 puzzle generation
```

## Requirements

* Do not reduce tactical detection to simple "best move" extraction.
* Support multi-move tactical sequences.
* Reject weak or ambiguous candidates.
* Detect forcing tactical opportunities according to `research/tactical-detection.md` and ADR-026.
* Persist the concrete tactical solution/PV so the missed opportunity can be inspected later.
* Detection is separate from move classification. A move may be classified as a mistake/blunder without being a missed tactic.
* A verified missed tactic is an additional annotation on the analyzed game/move.

### Tactical Motifs

V1 detects and verifies tactical opportunities but does not require semantic motif classification.

The concrete tactical solution and tactical objective are sufficient to represent the detected tactic.

Motif labels such as fork, pin, skewer, discovered attack, and similar semantic labels may be added in a later version without changing the core detection pipeline.

See `domain/tactics.md`.

## Game Review Integration

Verified missed tactics must be visible in Game Review.

For every verified missed tactic:

1. Associate the detection with its `sourceGameId` and `sourcePly`.
2. Mark the corresponding move in the Game Review move list with the canonical **missed-tactic glyph**.
3. Display the missed-tactic indication on the move without replacing the normal move classification.
4. When the user selects the affected move, Game Review must make the corresponding missed tactic available for inspection.
5. The existing engine analysis / PV display should be reused to show the tactical solution where possible.
6. The user must be able to navigate through the tactical continuation using the existing analysis-board variation/PV interaction.
7. Do not introduce a separate tactical-board implementation in V1.

The missed-tactic indicator is an additional annotation.

For example, a move may conceptually have:

```text
classification = blunder
missedTactic = true
```

and the UI may show both the classification indicator and the missed-tactic indicator according to the canonical presentation rules.

The exact glyph is owned by the shared classification/review presentation tooling established by Feature 009. Feature 010 must not create a competing glyph mapping.

## What the User Should Be Able to See

V1 does not require a separate "What did I miss?" visualization.

The verified candidate already contains:

* starting position
* user's played move
* best move
* best PV / tactical solution
* tactical objective
* verification metadata

Game Review should expose this information through the existing analysis-board experience.

When a missed tactic is selected, the user should be able to:

1. See the position in which the tactic was available.
2. See the user's actual move.
3. See the engine's tactical continuation.
4. Navigate through the continuation to understand the missed opportunity.
5. Compare the played move with the tactical solution.

The existing persisted engine PV should be reused rather than creating a second tactical-line representation.

## Pipeline Ownership

### Stage 1 — Candidate Generation

Feature 010 consumes the existing `MoveAnalysis[]` produced by Feature 008.

No additional engine work is required for this stage.

Use the candidate-generation rules defined in:

* `research/tactical-detection.md`
* ADR-026
* `domain/tactics.md`

The Stage 1 result is a raw candidate, not a verified missed tactic.
Candidate rules are versioned (`CANDIDATE_GENERATION_VERSION`, currently
2 — the position-centric plan-013 rules in ADR-026/research) and the
emitted set is capped per game (`MAX_CANDIDATES_PER_GAME`, swing-ordered)
so the Stage-2 engine load stays bounded.

### Stage 2 — Tactical Verification

Each raw candidate is verified using the tactical engine profile defined by ADR-012 and the tactical-detection research.

Verification must establish:

* a forcing tactical continuation;
* a supported tactical objective;
* sufficient candidate quality;
* that the opportunity was genuinely missed;
* that the result is not trivially achievable through an alternative move;
* that the tactical line satisfies the V1 depth/forcingness constraints.

Verification is **recall-first** (`detectionVersion` 8): a fork/pin whose
retained `>= 2` material gain is collected after a quiet defender reply, and
a `winning_material` secured at an interior prefix of the engine line, are
surfaced even when the surrounding game is already lost. Guard semantics and
the exact relaxations live in ADR-026 §Stage 2 (see
`research/tactical-detection.md` §5 for the guard mechanics).

The recall-first relaxations are bounded by a **lost-position material
floor** (`detectionVersion` 10): `winning_material` does not surface when the
mover's start position is already decisively lost (start eval below −350cp).
Because the retention delta is relative to the walked window, a dead-lost
mover can appear to gain two points inside it while remaining dead lost
before and after; at such depths the engine's "best" losing line is one of
many near-equivalent continuations, so the apparent gain is not a tactic the
user missed. Forced mate and the defensive objectives still surface from
lost positions.

Only verified candidates receive the `missedTactic` annotation.

## Relationship to Move Classification

Move classification and tactical detection are separate concepts.

```text
MoveAnalysis
├── classification
│   └── best / good / inaccuracy / mistake / blunder
│
└── missedTactic
    └── absent / verified tactical opportunity
```

A move can therefore be:

```text
mistake + missed tactic
```

or:

```text
blunder + missed tactic
```

or:

```text
blunder without a missed tactic
```

The existence of a large evaluation loss does not by itself make a move a missed tactic.

Conversely, a verified tactical miss should not replace or redefine the move's primary classification.

## Game Library Integration

Tactical detection is what turns an analyzed game into results the user
can act on, so this feature also owns the milestone where the Game
Library starts surfacing an analyzed game's statistics and lets the
user filter the collection by them. The Game Library page (Feature 007)
stays a read-only consumer: it renders persisted analysis results and
never computes classifications, accuracy or counts
(`domain/game-library.md`).

### Per-game statistics in a Library row

An analyzed game's row already shows its metadata (players with
ratings, result, platform, time control, side, date), a meta line with
the termination and move count, and the Feature-008 Analysis cell
(`Analyze` / `Review` / `Re-analyze` / progress; Feature 008 §22). The
sketch below is a suggested arrangement; the region it describes is the
**insights region** reserved on every row by `domain/game-library.md`
(read model + capability registry). Placement is an ordinary UI
decision; in the current implementation it fits as a full-width strip
below the termination/move-count line on desktop rows and inside the
same card on mobile:

```text
Sep 04 · Lichess · Rapid 10|5 · White · Win    vs. OpponentName · 38 moves
Accuracy 78.4% · Blunders 2 · Mistakes 3 · Inaccuracies 4 · Missed tactics 1
```

Mapping to the current row: date, platform, time control (`M|I` +
category), side, result and ratings already exist as row cells, and the
termination/move-count meta already exists; the strip adds the second
line above.

For a game whose latest completed analysis exists, the strip shows
**user-side** values only (`Game.userColor`):

* **Accuracy** — the canonical ADR-024 per-game accuracy produced by the
  Feature-009 accuracy function over the latest completed analysis's
  persisted `MoveAnalysis`, displayed with **one decimal** (the same figure
  Game Review shows — never a second calculation). When the function yields
  no value (no usable user moves) the item is omitted (em-dash), never
  shown as `0`.
* **Blunders / Mistakes / Inaccuracies** — user-side counts of the
  corresponding ADR-023 classifications from the canonical Feature-009
  per-game classification summary (`domain/classification.md`); one
  classification per persisted move; never recomputed by the page.
* **Missed tactics** — the number of the user's moves annotated
  `missedTactic: true` by this feature in that analysis. This is
  Feature 010's own contribution to the row.
* The analysis state itself remains the Feature-008 Analysis cell: a
  `Completed` state with its Review entry point is the "Analysis ✓" of
  the sketch. No duplicate indicator is added.

Rules:

* The strip renders only for statuses `completed` and `outdated`
  (a completed run exists). Unanalyzed, queued, in-progress, cancelled
  and failed games show no strip — absent data is never rendered as
  zeros.
* All values derive from the game's **latest completed analysis job**
  (the run the Feature-008 status derivation treats as completed). An
  `outdated` run still renders, with the row already flagged outdated,
  until an opt-in re-analysis replaces it; a queued/in-progress
  re-analysis hides the strip until the new run completes.
* A **zero** is shown only when the owning data exists and truly is
  zero: an analyzed game with no user blunder shows `Blunders 0`;
  missed tactics show `0` only when a detection pass has completed for
  that analysis (absent ≠ zero below).
* Opponent-side counts remain Game Review context and are never row
  statistics.

### Detection-state surfacing (never a silent absence)

A completed analysis whose detection pass has not produced a real count is
never shown as if it were zero — the row (and Game Review summary) say
what is actually true:

* **Scanning** — the pass is genuinely running **right now in this
  session**. "In progress" is never read from the persisted summary alone:
  a `queued`/`inProgress` summary only renders "scanning…" while the
  shared analysis service reports the game as **actively detecting** (an
  in-memory session registry). A pass scheduled by an earlier session (or
  interrupted by a page close / cancelled run) reads **"Tactics scan
  interrupted"** with a "Resume tactics scan" affordance instead — the
  scan-only entry point continues it without re-analysing the game.
* **Failed** — a scan attempt ended in failure ("Tactics scan failed");
  retried via the scan action. A pass only ends failed when one or more
  candidates could not be verified after a bounded per-candidate engine
  retry: verification searches are time-bounded (`VERIFY_MOVETIME_MS`),
  so a slow-but-healthy position returns a shallower result instead of
  failing, and a single flaky candidate no longer aborts the scan of the
  rest of the game (deferred candidates are retried by the next scan,
  which is cheap because settled rows and cached positions are reused).
* **Not scanned** — the run predates this feature (its summary was
  backfilled with an `absent` state) or was never scanned ("Tactics not
  scanned"); the user runs the scan for that analysis.

The Library polls the live registry while a scan is active so the real
count appears the moment the pass settles, and never keeps polling (or
claiming "in progress") for an interrupted pass. Game Review mirrors this:
its summary shows a real `Missed tactics` value once the pass completed,
and otherwise the matching state note above.

### Numeric scan progress (plan 013, W3)

While a pass is genuinely running, the row/banner (Library) and the
Review scan bar show a **numeric progress bar** in a **distinct colour**
(the canonical missed-tactic magenta, not the blue analysis progress):
"Verifying tactic 3 of 7…", with the numbers spelled out for assistive
tech. The `done`/`total` values come from the additive `scanProgress`
field on the per-analysis summary (`done` = candidates that have reached
a definitive verdict — verified, or rejected by a Stage-2 guard — out of
the Stage-1 `total`). An interrupted pass never claims progress: the bar
appears only while the shared service reports the game as actively
detecting, and a resumed pass restores its real `done` from the already
verified rows before continuing.

### Rejection provenance on candidate rows

Stage-2 guard rejections persist their `rejectionReason` (and the engine's
evaluated top line) on the candidate row, and the ADR-018 position cache
reuses the verification search, so a later re-scan never re-searches a
settled position. This diagnostic provenance is stored data only — Game
Review does not render a scan-report block for it (the plan-13 option C
summary UI was removed by the owner; the candidate rows and the persisted
rejection reasons remain the source of truth for debugging recall).

### Resumable scans & engine-activity surfacing (plan 012, WP-A/WP-B)

A scan is resumable derived work, never something that requires a full
re-analysis:

- **On-demand scan action.** An interrupted/paused, failed, or never-scanned
  analysis offers a dedicated **Resume / Retry / Run tactics scan** affordance
  (Library row and Game Review). It runs only the detection pass for the
  game's latest completed analysis — no positions are re-analysed (ADR-018
  cache and already-verified candidates are reused) — and a live scan is
  cancellable in place. Detection passes are never auto-started by these
  actions.
- **Orphan reconciliation.** At Library load the shared analysis service
  reconciles owner-less persisted work once per session: `queued`/`inProgress`
  analysis jobs with no live owner in this session are auto-resumed, and
  owner-less `inProgress` detection summaries are relabelled resumable-paused
  (`queued`) — nothing is ever silently "in progress" without a live pass.
- **Ghost-pass cancellation.** A forced re-analysis of a game whose scan is
  still live/queued cancels the superseded pass (its engine jobs) and drops
  its summary/candidates cleanly, so no ghost pass is left ahead in the
  engine FIFO.
- **Persistent engine activity.** Engine work that survives a page change is
  visible when you return: the Library shows a whole-queue banner over
  resumed analysis jobs and running tactics scans (with a Cancel that stops
  both), per-row progress bars come from persisted jobs, and Game Review shows
  an in-progress banner (analysis **and** scan) with a Cancel.
- **Lifecycle guards (plan 012, WP-D).** A queued engine job that waits too
  long is failed by the engine-queue watchdog so "queued" is never permanent
  (its caller fails/resumes the owning work), and closing/reloading the tab
  while analysis or a scan is live raises the browser's native confirmation —
  the work is resumable, so the user can keep it or pause it for later.

### Missed tactics: absent vs zero

The `missedTactic` annotation appears only after this feature's
two-stage pipeline has processed the game: Stage 1 candidate generation
runs over the persisted `MoveAnalysis` as soon as the game's analysis
completes (ADR-026); Stage 2 verification is the engine-heavy pass
(`research/tactical-detection.md` §6). A missed-tactic count is
therefore meaningful only when a detection pass has **completed** for
the analysis.

Feature 010 persists per-game detection state so the Library and the
filters can distinguish:

* **Absent** — no detection pass completed for the analysis: the strip
  omits the item (or shows an em-dash) and neither missed-tactic filter
  outcome matches the game.
* **Zero** — a completed detection pass found nothing: the value is `0`
  and matches the "No" filter outcome.

The detection pass state model is defined by this feature's pipeline
work; this specification only fixes the contract the Library consumes.
Detection results are scoped to the analysis identity they processed: a
re-analysis produces a new analysis identity, so its detection state
starts absent again until the new pass completes (Stage 2 reuses the
ADR-018 position cache where possible).

**Freshness gate (plan 015, owner decision):** a completed detection
result is consumed — rendered in Review, shown as a Library strip item,
matched by the missed-tactics filters — only while its persisted
`detectionVersion` equals the current `DETECTION_VERSION`. A result
persisted by an older version is **outdated**: it is suppressed
everywhere and a refresh scan is offered instead. The next pass over the
same analysis detects the mismatch, wipes the stale candidate rows and
move annotations, and re-derives the result from the current rules, so
an outdated marker or count can never survive a re-scan.

### Analysis-result filters

The Library filter bar gains three single-select dimensions. They
follow the canonical Library filter/search state and URL codec in
`domain/game-library.md` (AND with all other filters and search,
default `all`, individually clearable, URL-encoded, selection cleared on
change):

| Filter | Options | Semantics (user side, latest completed analysis) |
|--------|---------|-------------------------------------------------|
| **Analysis** | All / Analyzed / Not analyzed | `Analyzed`: status `completed` or `outdated`. `Not analyzed`: every other status. |
| **Has blunders** | All / Yes / No | `Yes`: ≥ 1 user move classified `blunder`. `No`: completed analysis with 0 user blunders. No completed analysis ⇒ neither. |
| **Has missed tactics** | All / Yes / No | `Yes`: detection pass completed and ≥ 1 user move `missedTactic: true`. `No`: detection pass completed and 0. Absent detection (or no analysis) ⇒ neither. |

Query semantics:

* The Analysis dimension is evaluated from the persisted analysis-job
  status derivation (Feature-008 status domain), never from transient
  UI state.
* Blunder and missed-tactic outcomes are evaluated from the stored
  game-scoped per-analysis summary described below. These dimensions are
  part of the pushed-down Library query: a filter change must never
  trigger a full scan of `MoveAnalysis` rows.

### Data requirements

Additive, game-scoped derived data only:

* When an analysis run completes, the pipeline persists a **per-analysis
  summary** (keyed by game + analysis identity): user-side
  classification counts, per-game accuracy (ADR-024) and the detection
  state. When a detection pass completes for that analysis, the summary
  is updated with the missed-tactic count and final detection state. The
  computation uses the canonical Feature-009 domain functions
  (`domain/analysis-model.md`, `domain/classification.md`) — never a
  second implementation.
* The summary follows the ownership rule (`ARCHITECTURE.md` §7,
  `domain/game-library.md` §8): it is game-scoped derived data deleted
  with its game; Feature 016 never syncs derived per-game insights or
  filter state as standalone values.
* Rows and filters read the summary so the Library stays practical from
  a few to thousands of games: no per-row `MoveAnalysis` rescan and
  index pushdown for the new filter dimensions, consistent with the
  Library data flow in `ARCHITECTURE.md` §7.

Required document updates in this milestone (see `## Context`): the
canonical filter/search state and row-view read model in
`domain/game-library.md` gain the dimensions and strip semantics above;
Feature 007's filter-bar text registers the new controls; Feature 014's
Game Library integration note is refined so these persisted
per-analysis summaries are the per-game source its aggregates read.

### States, errors and edge cases

* Unanalyzed / queued / in-progress / cancelled / failed games: no
  strip; the existing Analysis cell and progress carry the state.
* Outdated analysis: the strip shows the last completed run's values and
  the row is flagged outdated; re-analysis is offered as today.
* Re-analysis in progress: the strip is hidden until the new run
  completes.
* Very short or error-free games: `Blunders 0` etc. render (the data
  exists); accuracy may be omitted when the canonical function returns
  no value.
* Detection not run or failed for an otherwise analyzed game:
  missed-tactic item is absent, never `0`, and the missed-tactic filter
  does not match.
* No matches from a filter combination: the existing "no games match"
  Library state applies.
* Filter/search/selection interplay (clear on change, URL restore,
  AND semantics) follows `domain/game-library.md` unchanged.

### Responsive, accessibility and performance

* Responsive: the strip wraps inside the row on desktop and inside the
  card on mobile; the filters keep the Library's deliberate mobile
  layout (collapsible controls), never a shrunk table.
* Accessibility: the strip is one labelled region per row whose
  screen-reader text spells out every value ("Accuracy 78 per cent, 2
  blunders, 3 mistakes, 4 inaccuracies, 1 missed tactic"); values are
  text, never color-only; the filters are labelled selects with visible
  focus and textually conveyed active state.
* Performance: page rendering reads summaries (never a per-row
  `MoveAnalysis` rescan); filter changes push down into the Library
  query inside the existing windowed/paginated rendering; no engine or
  heavy computation runs on the UI thread.

## Acceptance Criteria

A verified tactical candidate contains:

* starting position;
* original/user move;
* tactical solution;
* tactical objective;
* verification metadata;
* `detectionVersion`;
* source game and ply.

Game Review:

* shows a missed-tactic glyph on the corresponding move;
* preserves the normal move classification;
* allows the user to inspect the tactical continuation;
* reuses the existing engine PV/analysis-board infrastructure;
* does not require a separate tactical visualization component for V1.

Feature 011 can consume the verified candidate and transform it into a training puzzle.

### Game Library statistics & filters — acceptance criteria

* A game row with a completed analysis shows Accuracy, Blunders,
  Mistakes, Inaccuracies and — once a detection pass completed —
  Missed tactics, user side only, matching Game Review's canonical
  values.
* Unanalyzed / queued / in-progress / cancelled / failed games show no
  strip.
* Absent missed-tactic data is never rendered or filtered as zero.
* An outdated completed result (older `detectionVersion`) is never
  rendered or filtered as current: the row shows an out-of-date note and
  a refresh-scan action instead of the missed-tactics strip.
* `winning_material` never surfaces from a mover start position already
  decisively lost (start eval below −350cp, `detectionVersion` 10): such
  "gains" are relative-window noise in a dead-lost position, not tactics
  the user missed; Review therefore shows no missed-tactic marker for
  them while still surfacing genuine recall forks from slightly-lost
  starts and all forced-mate / defensive objectives.
* The Analysis, Has blunders and Has missed tactics filters default to
  All, combine (AND) with the other filters and search, round-trip
  through the URL, and clear selection on change.
* Filter outcomes match the stored per-analysis summary; `No` never
  matches unanalyzed games or analyses whose detection pass has not
  completed.
* Rows and filters remain practical for thousands of games without
  scanning `MoveAnalysis` per row or per filter change.
* The layout is deliberately responsive on tablet and mobile; the strip
  and filters are keyboard-accessible and never color-only.

### Testing

* Unit (domain): per-analysis summary derivation over the existing
  deterministic `MoveAnalysis` fixtures (known counts, accuracy, missed
  tactics), absent-vs-zero detection state, filter predicate semantics
  for every Analysis / Yes / No outcome and their AND combinations, and
  URL round-trips.
* Component: strip rendering for analyzed vs unanalyzed fixtures, hidden
  strip for queued/in-progress/failed games, zero vs absent rendering,
  the three filter controls, the "no games match" state, and the mobile
  layout.
* End-to-end: analyze a fixture game → the row shows the canonical
  stats → filter by Has blunders → the visible set and cleared selection
  are verified.

## Missed-tactic verification commitment (end-to-end fixture proof)

Detection surfacing is not assumed — it is **verified end-to-end by a
deterministic engine fixture e2e**: a fixture game engineered to contain a
real missed tactic (White misses the one-move mate `4.Qxf7#` after
`3...Nf6` and mates later) is analysed and scanned, and the test asserts
that the genuine missed tactic actually surfaces in **both** consumers:

- the **Library row insights strip** shows a real `Missed tactics` count
  for the game, and
- **Game Review** shows the owning ply's marker (the Summary
  missed-tactics value and the missed-tactic marker/NAG on the ply that
  missed the tactic).

This proves the whole pipeline (analysis → detection pass → per-analysis
summary → Library/Review read path) with a real engine. Detection-state
surfacing is never a silent absence: queued / in-progress / failed /
absent detection is always shown as the corresponding state note (above),
never as a missing zero.

## V1 Boundary

V1 intentionally does not include:

* semantic tactical motif classification;
* a separate tactical visualization system;
* a second chessboard implementation;
* a separate engine-analysis representation;
* detection of quiet/non-forcing tactical themes outside the
  research-defined pipeline — plan 013's quiet/small-loss rule only
  fires when the engine's best first move is forcing (a check or a
  capture), so purely non-forcing themes (zugzwang, positional
  sacrifices) remain out of scope;
* automatic natural-language explanations of why the tactic works;
* per-row game-phase breakdown of the statistics (errors/accuracy by
  opening/middlegame/endgame in the Library row) — phase is stored per
  move (`domain/game-phase.md`) so this stays possible in the
  statistics milestone;
* opponent-side per-row statistics (opponent context remains in Game
  Review).

These can be considered independently in later versions.

## Dependencies

Feature 010 depends on:

* Feature 008 — Game Analysis / persisted `MoveAnalysis` and analysis-status derivation;
* Feature 009 — canonical per-game classification summary and accuracy (`domain/classification.md`, ADR-024);
* Feature 007 — Game Library page, canonical filter/search state and per-row insights region;
* Feature 005 — shared analysis infrastructure.

Feature 010 output is consumed by:

* Feature 011 — Puzzle Generation (verified candidates);
* Feature 014 — missed-tactic statistics (`missedTactic` annotations/counts);
* the Game Library page — read-only per-row insights and filters.

## Canonical Sources

Detection behavior is defined by:

* `research/tactical-detection.md`
* `domain/tactics.md`
* ADR-026

Do not duplicate the tactical-detection algorithm in this feature specification. The feature spec defines ownership, integration, persistence, and user-visible behavior; the research and ADR define the detection algorithm.

Row-statistics values (accuracy, classification counts) follow the canonical analysis/classification domain and Feature-009 tooling; this specification never redefines them.

## Context

Required reading (see `.opencode/CONTEXT-MAP.md`):

- Architecture/decisions: `decisions/ADR-026`, `decisions/ADR-023`,
  `decisions/ADR-024`, `decisions/ADR-025`, `decisions/ADR-012`,
  `decisions/ADR-018`, `decisions/ADR-019`, `decisions/ADR-020`
- Domain: `domain/tactics.md`, `domain/analysis-model.md`,
  `domain/puzzle-model.md`, `domain/classification.md`,
  `domain/game-library.md`
- Research: `research/tactical-detection.md`,
  `research/move-classification.md`

Feature dependencies: Features 005, 007 (Library surface + canonical
filter state), 008 (persisted `MoveAnalysis` + analysis status), 009
(per-game summary/accuracy tooling). Output consumed by Features 011
and 014 and by the Game Library read-only row insights.
