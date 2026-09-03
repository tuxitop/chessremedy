# ChessRemedy Product Specification

## 1. Product

ChessRemedy is a local-first chess training application that analyzes a
player's own games and converts meaningful mistakes and missed tactical
opportunities into personalized training.

The initial product focuses exclusively on:

- game analysis
- blunders
- tactical misses
- personalized puzzles
- cycle-based tactical training
- progress analysis

Opening repertoire functionality is future scope.

---

## 2. V1 Goal

The application should answer three questions:

1. What mistakes am I repeatedly making?
2. Am I improving?
3. What should I train next?

---

## 3. Game Sources

V1 supports:

- Chess.com
- Lichess

The user can import their games in batches.

Imported games retain:

- platform
- external game ID
- players
- ratings
- result
- date/time
- PGN
- time control
- user's color

Duplicate games must not be imported twice.

---

## 4. Analysis

Games are analyzed locally using Stockfish running in a Web Worker.

Analysis identifies:

- move evaluation
- best move
- principal variation
- evaluation change
- WDL where appropriate
- move classification
- tactical opportunities
- game phase

Analysis must be resumable.

---

## 5. Move Classification

ChessRemedy distinguishes:

- best move
- good move
- inaccuracy
- mistake
- blunder
- missed tactical opportunity

Classification is contextual.

A difference from the engine's top move is not automatically a mistake.
The exact methodology is defined in `specs/research/move-classification.md`
and ADR-023. A `best` move is played when it matches the engine's top
choice; `good` allows for a small WDL-derived swing; `inaccuracy`,
`mistake` and `blunder` are bucketed by `wpLoss` thresholds of 2, 10
and 20 percentage points.

---

## 6. Time Controls

Time control is a first-class dimension.

The canonical V1 normalized time-control categories are:

- bullet
- blitz
- rapid
- classical
- correspondence
- unknown

The original source time-control string is preserved alongside the
normalized category. Statistics must distinguish each category listed
above and must not silently combine different time controls.

Rating progress must be separated by:

- platform
- time control

---

## 7. Game Phase

Relevant analysis is categorized as:

- Opening
- Middlegame
- Endgame

The methodology for phase classification is documented separately.

---

## 8. Personalized Puzzles

Puzzles originate from the user's own games.

A puzzle represents a meaningful tactical opportunity or mistake.

A puzzle is not simply:

"Play Stockfish's first choice."

A puzzle may contain a sequence of moves.

The sequence continues until the tactical objective is resolved.

Possible objectives include:

- winning material
- forcing mate
- obtaining a decisive advantage
- neutralizing a tactical threat

Candidate puzzles must be engine-verified.

Alternative valid solutions must be considered.

---

## 9. Puzzle Provenance

Every generated puzzle retains:

- source game
- source position
- original played move
- expected solution
- tactical objective
- engine/version used
- analysis metadata
- puzzle-generation version

The user should eventually be able to understand:

"What did I play, what should I have played, and why did it matter?"

---

## 10. Puzzle Training

The puzzle interface supports:

- responsive chessboard
- mouse interaction
- touch interaction
- arrows
- highlights
- board orientation
- hints
- retry
- restart
- previous
- next
- start
- end
- engine analysis after completion (see Feature 012 — Post-Solve Analysis, built on the Live Analysis Board primitive in Feature 006)

If a user plays a wrong move:

- identify it as incorrect
- allow automatic retry according to settings

Hints are organized into four progressive levels. Each level reveals
strictly more information than the previous one. The exact level at
which a hint becomes available is configurable.

1. **Relevant piece** — indicate the piece type that initiates the
   solution.
2. **Piece highlight** — highlight that piece on the board.
3. **Destination** — highlight the destination square of the first
   solution move.
4. **Move** — show the full first move of the solution.

If the puzzle solution has multiple moves, additional hints after level
4 are out of scope for V1.

The exact hint behavior is configurable.

---

## 11. Tactical Training

Personalized puzzles are trained in **fixed sets over repeated
training cycles** (a Woodpecker-inspired approach; the product is not
bound to any author's exact protocol). See ADR-031 and
`specs/domain/tactical-training.md`.

A **tactical training set** groups puzzles by a source or criteria.
A **training cycle** is one pass through a set; each puzzle produces a
**puzzle attempt**, and cycles aggregate attempts into cycle metrics
(first-try accuracy, solve rate, solving time, hints, retries,
completion).

Training behavior is configurable:

- training-set size
- puzzle ordering
- retry behavior for failed puzzles
- hint-level availability
- cycle completion rules
- target accuracy
- optional target solving time
- number of cycles

A wrong answer does not remove a puzzle from the set by default; a
puzzle still failing at the end of a cycle is revisited in the next
cycle. Puzzles are not scheduled individually in V1: there is no
per-puzzle "next review" or FSRS scheduling. Attempt records keep:

- puzzle
- training set / cycle
- timestamp
- outcome
- attempts
- hints
- response time where available

Individual-puzzle scheduling (e.g. FSRS) is intentionally deferred and
may be added later without discarding the immutable puzzle model or the
attempt history (ADR-031).

---

## 12. Dashboard

The dashboard is the **presentation layer** for the application's
analytics. It renders charts and summary cards but does not calculate
statistics itself.

All numbers shown in the dashboard are produced by the statistics
service (Feature 014 — Game Analysis History & Statistics) and consumed
read-only.

The dashboard surfaces (rendered by Feature 015 — Dashboard, sourced
from Feature 014 — Statistics):

### Rating

Rating trends separated by:

- platform
- time control

### Errors

Trends for:

- inaccuracies
- mistakes
- blunders
- missed tactics

### Game phase

Errors by:

- opening
- middlegame
- endgame

### Training

- active tactical training sets
- current cycle and cycle progress
- previous cycle accuracy
- current cycle accuracy
- cycle solving time
- improvement over previous cycles
- weakest tactical categories
- puzzles repeatedly failed

Terminology and definitions follow `specs/domain/tactical-training.md`;
there is no "puzzles due" or retention-scheduling concept in V1.

Charts must expose the selected platform/time-control filters.

Charts must obey the V1 sample-size rule from
`specs/domain/statistics.md` (minimum aggregate sample size 5; below
that threshold an "insufficient data" placeholder is shown; rendered
by Feature 015 — Dashboard using statistics computed by Feature 014).

Empty and insufficient-data states must be rendered explicitly and must
not be replaced by a literal zero.

---

## 13. Responsive UI

The application must work on:

- desktop
- tablet
- mobile

Essential functionality must not depend on hover.

Chess interaction must support touch.

---

## 14. Themes

The application supports:

- light theme
- dark theme
- multiple chessboard themes
- multiple piece sets

The exact initial themes are an implementation decision.

---

## 15. Privacy

Game analysis occurs locally.

User game data should remain local unless the user explicitly enables
synchronization.

---

## 16. Synchronization

Synchronization is optional.

V1 architecture must allow:

- local-only use
- export/import
- future cloud synchronization

The first planned synchronization provider is Dropbox. Sub-decisions
are recorded in:

- ADR-008 (provider-independent synchronization architecture)
- ADR-015 (Dropbox App Folder scope)
- ADR-016 (gzipped JSON envelope file format)
- ADR-017 (JSON-level merge with last-write-wins fallback)

Synchronization must not become a prerequisite for using the
application.

---

## 17. Future Scope

Future versions may include:

- opening repertoires
- opening training
- opening puzzles
- repertoire compliance
- tactical motif training
- endgame training
- AI explanations
- additional game providers

These are not V1 implementation requirements.
