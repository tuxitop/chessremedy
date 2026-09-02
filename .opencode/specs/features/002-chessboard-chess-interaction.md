# Feature 002 — Chessboard & Chess Interaction

## Goal

Provide the reusable chessboard and chess interaction layer used throughout
ChessRemedy.

The feature must be independently testable without imported games, Stockfish,
the puzzle generator, or real user data.

The chessboard MUST use:

@lichess-org/chessground@10.1.1 or a higher 10.x version.

Do not substitute another chessboard library without an explicit
architectural decision. The installed version must never be lower than
10.1.1 and must remain within the 10.x major range; major-version upgrades
require a new ADR.

chessops should be used for chess rules, move validation, FEN handling,
PGN parsing (including variations, NAGs, comments), and position trees.
chessops is the same library that powers Lichess's own analysis UI and is
required by `@lichess-org/pgn-viewer`'s transitive dep chain (ADR-029,
ADR-030 — pgn-viewer was dropped). See ADR-028 for the rationale.

## Chessboard capabilities

The reusable board must support:

- responsive sizing
- desktop mouse interaction
- touch interaction
- drag-and-drop moves
- click-to-move where appropriate
- legal move validation
- board orientation
- coordinates (toggleable)
- board flipping
- piece movement animation (toggleable)
- last-move highlighting
- selected-square highlighting
- arbitrary square highlighting
- arrows
- multiple arrows where required
- clearing arrows (via the settings cog → "Clear arrows")
- comment-driven arrows (`%cal`) and square highlights (`%csl`) drawn
  automatically on the ply that carries them
- configurable board theme (5 themes: brown, blue, green, purple, wood)
- configurable piece set (5 sets: cburnett, merida, alpha, chess7, spatial)
- disabled interaction mode
- read-only position display
- check highlighting on the king in check (color follows the side to move)
- a checkmate `#` badge on the mated king, and the NAG glyph of the
  last move displayed top-right of its destination square (Lichess /
  Chess.com convention)
- PGN move-list panel (variations, NAGs, comments, current-move
  highlighting, click-to-seek, keyboard navigation, ARIA `tree` /
  `treeitem` / `group` roles, themable via CSS variables)
- move-navigation controls (`start`, `previous`, `next`, `end`, plus
  Alt+← / Alt+→ for variation switching)
- resizable board on desktop via an **invisible** bottom-right corner
  hit region with snap-to-preset (240 / 320 / 480 / 640 / 800 / 1024
  px, ±16 px tolerance). The hit region itself is not rendered visually;
  only the cursor changes to `nwse-resize` on hover.
- resize bounds (min 240 px, default 480 px, max 1024 px) persisted to
  `localStorage` under `chessremedy:board-size`

The board must work correctly at desktop, tablet and mobile widths.

The board must not assume that it is displaying a game. It must accept a
position/state supplied by its caller.

## Chess state

The chessboard layer must be able to display and manipulate positions using
standard chess representations, including FEN.

Chess rules must not be implemented manually in the UI.

The UI must delegate chess legality and position manipulation to chessops
(ADR-028) or the appropriate domain chess abstraction.

## Position model

The playground (and later chess surfaces) is driven by a single position
tree (`positionTree`) that is the source of truth for the board, the move
list, navigation, orientation, and overlays:

- A FEN-only position has no history; moves the user plays build the line.
- A PGN (optionally carrying `[SetUp "1"]` + `[FEN "..."]` headers) replays
  to a tree whose *landing* is the end of the mainline. Selecting such a
  fixture shows that final position; `Reset position` returns there and
  clears appended user moves.
- Every move the user plays on the board appends to the current node of the
  tree and therefore **appears in the move list** (live, analysis-board
  behaviour). Playing a different move at an interior node creates a
  variation.

## Promotion

When a pawn reaches the back rank, the Chessboard wrapper must:

1. Refuse to apply the move immediately (revert the internal move).
2. Surface a `pendingPromotion` event to the caller.
3. Stay paused (no further drag acceptance) until the caller resolves
   the promotion (either choosing Q / R / B / N or cancelling).

The caller renders a centered modal with four **piece-image buttons**
matching the active piece theme. The Q button is the default focus
target. `Escape` cancels and re-selects the source square so the
user can pick a different move. Promoting plays like a real game: the
promotion role flows through the position model and both the board and
the move list update (`a8=Q+`).

## Board overlays & annotations

- When the current node has a NAG, a **small circular badge** (Lichess /
  Chess.com style) is anchored to the top-right corner of the move's
  destination square, filled with the NAG colour and containing the white
  glyph. The badge scales with the board and is never clipped to a square.
- `%cal` arrows and `%csl` square highlights from the node's comments are
  drawn on the board (comment text itself is hidden from the list).
- When the current position is checkmate, a circular `#` badge is drawn on
  the mated king. A drawn game (stalemate, insufficient material or the
  fifty-move rule) shows a grey `½` chip above **both** kings.
- The input is locked on finished positions (mate / draw / no legal
  moves): no piece may be moved and no error is raised.
- Overlay geometry is shared (square→pixel mapping) so later analysis
  features (engine evaluations, custom shapes, saved comments) reuse it.

### Supported PGN comment annotations

Lichess/Chess.com style arrows and square highlights live inside comments:

```pgn
1. e4 {[%cal Ge2e4,Rd7d5] [%csl Gd4,Re5]} e5 2. Nf3
```

- `[%cal Ge2e4,Rd7d5]` draws arrows from `e2`→`e4` (green) and `d7`→`d5`
  (red).
- `[%csl Gd4,Re5]` highlights squares `d4` (green) and `e5` (red).
- Colour letters: `G` green, `R` red, `B` blue, `Y` yellow, `O` orange,
  `P` purple.
- The tags are stripped from the visible comment text.

### NAG glyphs and move colours

| NAG | Glyph | Meaning  | Move-list / badge colour |
|-----|-------|----------|--------------------------|
| $1  | `!`   | Good     | green                    |
| $2  | `?`   | Mistake  | orange                   |
| $3  | `!!`  | Brilliant| green (bold)             |
| $4  | `??`  | Blunder  | red                      |
| $5  | `!?`  | Interesting | blue                  |
| $6  | `?!`  | Dubious  | yellow                   |
| $9  | `X`   | Miss     | crimson (distinct shape) |

`$9` is not a standard PGN NAG; Chess.com uses it for missed tactics and
ChessRemedy renders it as a distinct `X` so move classification can reuse
the marker later. Inline glyphs (`1. e4!`) and numeric NAGs (`1. e4 $1`)
both parse to the same numeric list. NAG colour applies to the move text in
the move list and to the badge on the board.

## Board resize

`<Chessboard />` owns `useBoardSize()`, the invisible corner hit
region, and `<BoardContainer />`. These pieces are reused by every
chessboard surface in the app (playground, live analysis board, game
review, puzzle training) so the persisted size is one global setting.
The owning surface may pass its shared `useBoardSize()` instance down so
the footer / "Reset board size" control and the board agree.

### Storage

- Backend: `localStorage` (per `ARCHITECTURE.md §4`). Dexie is **not**
  used for board-size state.
- Key: `chessremedy:board-size`.
- Default: `480` px. Values outside `[240, 1024]` are clamped on read.

### Hit region

- Invisible `<div aria-hidden="true">` anchored to the bottom-right
  corner of `<BoardContainer />`. The hit region has `cursor: nwse-resize`
  on `:hover` and intercepts pointer events.
- Hidden on viewports `≤ 768 px` (mobile). Mobile uses fluid
  `width: 100%` sizing instead.
- No visible button, no icon, no aria-label. It is intentionally
  decorative-only because it cannot be operated by keyboard in V1.

### Drag behavior

- `pointerdown` calls `useBoardSize.beginDrag`. The wrapper uses an
  internal CSS variable for the live drag value so the pointermove
  handler does not cause `localStorage` thrash.
- `pointermove` (RAF-throttled) updates the drag value; clamped to
  `[240, 1024]`. Listener is attached on `window` because the invisible
  handle never takes keyboard focus.
- `pointerup` snaps the final value to the nearest preset
  (240 / 320 / 480 / 640 / 800 / 1024, ±16 px tolerance), then commits
  to `localStorage` via `useBoardSize.setSize`.
- `Escape` or `pointercancel` cancels the drag and restores the prior
  size; no persistence.

### Layout containment

`<BoardContainer />` sets:

- `aspect-ratio: 1 / 1` so the wrapper is always square
- a fluid `width: 100%` square on viewports `≤ 768 px`
- `touch-action: none` so the page does not scroll while dragging the
  handle

### Keyboard popover slider

**Omitted from V1.** The keyboard accessibility for the resize hit
region is limited to none — the user can only resize via mouse drag.

## Move list

`<MoveList />` renders a chessops `PgnNode` tree as a Lichess-style table
with three columns: **move number**, **White**, **Black**:

```
   #    White   Black
   1.   e4      e5
   2.   Nf3     Nc6
   3.   Bb5     a6
   4.   Ba4
```

- Move numbers are bold; each number appears once per white/black pair
  (never `1. Qe5+ 1... Kd8`).
- NAG glyphs render after the SAN and colour the whole move (see the NAG
  table above).
- Variations take their **own indented lines** directly under the move
  they replace, with their own numbers:
  `3. Bb5 a6` / `(3. Bc4 a6 4. Ba4)` below it. Multi-ply variations
  continue on the same indented line; deeper levels nest with further
  indentation.
- Comments (`{ ... }`) render as italic gray paragraphs under the row
  they belong to. `%cal`/`%csl` tags are hidden. End-of-line style
  comments read the same way.
- The active move has `aria-current="step"` plus a CSS background
  highlight; variations that the user seeks into highlight too.
- Click any move (mainline or inside a variation) to seek to it.
- Keyboard: `ArrowDown` / `ArrowUp` move through all plies one at a time;
  `Home` / `End` jump to the first / last ply; `Alt+ArrowLeft` /
  `Alt+ArrowRight` switch between variations at the current position.
- The list is a pure view over the position tree, so moves the user plays
  on the board appear automatically.

## Development Playground

Provide a development-only Chessboard Playground.

The playground must allow the board to be exercised without requiring real
games or database records.

### Route

The playground is accessible at `/playground`.

### Layout

The playground uses a two-column layout on desktop (≥ 768 px): the
chessboard (with fixture controls below it) on the left, and a right-hand
"analysis" panel on the right that mirrors a Lichess analysis board:

- a slim header with the settings cog,
- an **engine lines** placeholder block (real evaluations arrive with
  Feature 005; the panel reserves the space),
- the **move list**, which fills the available height and scrolls
  internally,
- the **board / move controls** at the bottom of the panel.

The whole right panel is sized to match the board height on desktop so the
move list and board are always the same height. Both the board column and
the right panel use a fixed width equal to the board size, so switching
fixtures never reflows the columns (the panel neither moves nor changes
width). On mobile (< 768 px) the columns stack and the panel takes its
natural height with an internal scroll cap.

### Fixture positions

The playground must provide the following deterministic chess positions.
A fixture is either a FEN-only position or a PGN (whose end-of-mainline is
the landing position; PGNs may carry their own `[FEN]` start header).

| #  | Label                              | FEN / PGN                                                                                                                                                                                              | Side to move (landing)          | Exercises                                                            |
|----|------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------|----------------------------------------------------------------------|
| 1  | Starting position                  | FEN: `rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1`                                                                          | White                           | Piece rendering, legal-move dests                                   |
| 2  | Scholar's Mate position            | FEN: `r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4`                                                               | White                           | Tactical move execution                                              |
| 3  | Fool's Mate (white to move)        | FEN: `rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3`                                                                   | White                           | Check highlighting, forced moves                                     |
| 4  | Capture                            | FEN: `r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4`                                                            | White                           | Capture interaction, piece removal                                   |
| 5  | Comment arrows & highlights        | PGN: `1. e4 {[%cal Ge2e4,Rd7d5] [%csl Gd4,Re5]} e5 2. Nf3`                                                                               | White (after 2. Nf3)            | `%cal` arrows + `%csl` highlights drawn from comments                |
| 6  | Promotion                          | FEN: `8/P7/8/8/8/8/8/4K2k w - - 0 1`                                                                                                    | White                           | Pawn promotion dialog                                                |
| 7  | Endgame (K+Q vs K)                 | FEN: `3k4/8/8/8/8/8/4Q3/4K3 w - - 0 1`                                                                                                  | White                           | Simplified endgame, few legal moves                                  |
| 8  | Non-standard FEN (castling)        | FEN: `r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1`                                                             | White                           | Tricky castling rights, complex legal moves                          |
| 9  | Italian Game — Black to play       | PGN: `1. e4 e5 2. Nf3 Nc6 3. Bc4`                                                                                                       | **Black** (auto-flip)           | Black-to-move landing, orientation auto-flip                         |
| 10 | Scholar's Mate game                | PGN: `1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6?? 4. Qxf7#`                                                                                       | (mate)                          | Move list, end-of-game, navigation                                   |
| 11 | Variation tree (Italian)           | PGN: `1. e4 e5 2. Nf3 Nc6 3. Bb5 (3. Bc4) a6 4. Ba4`                                                                                    | White                           | Variation rendering, click-to-seek into variation                    |
| 12 | Pin tactic (Fried Liver / Lolli)   | PGN: `1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. Ng5 d5 5. exd5 Nxd5 6. Nxf7! Kxf7 7. Qf3+`                                                     | White                           | Sacrifice, NAG `!` badge and move colour                             |
| 13 | White to move and lose             | PGN headers `[SetUp "1"] [FEN "8/8/8/8/8/1k6/3q4/QK6 w - - 0 1"]`, moves `1. Qa4+ Kxa4 2. Ka1 Ka3 3. Kb1 Qb2# 0-1`                      | (mate)                          | Header-carrying PGN, checkmate `#` badge                            |
| 14 | NAG annotations (inline glyphs)    | PGN: `1. e4! e5 2. Nf3!! Nc6? 3. Bb5?! a6!? 4. Ba4 Nf6??`                                                                               | White                           | Inline NAG glyphs and move colouring                                 |
| 15 | NAG annotations (numeric `$N`)     | PGN: `1. e4 $1 e5 $2 2. Nf3 $3 Nc6 $4 3. Bb5 $5 a6 $6`                                                                                  | White                           | Numeric NAG glyphs and move colouring                                |
| 16 | Comments                           | PGN: `1. e4 {The King's Pawn opening} e5 {A solid response} 2. Nf3 {Developing the knight toward the center} Nc6`                        | White                           | Readable PGN comments in the move list                               |
| 17 | Insufficient material (draw)       | FEN: `4k3/8/8/8/8/8/8/4K3 w - - 0 1`                                                                                                     | White                           | Draw `½` chips over both kings, input freeze                          |

Selecting a fixture updates the board immediately to its landing position;
the move list shows the full sequence. Selecting a fixture whose landing
side is Black (and the game is not over) auto-flips the board so Black is
at the bottom. A manual orientation change is remembered per fixture.

The reset button returns the board to the fixture's landing position.
Moves made on the board update the live position tree, so the move list
grows with them.

### Settings cog

A settings cog button (`⚙`) is rendered at the top-right of the
move-list pane. Clicking it opens a popover containing:

- Orientation toggle (white-at-bottom / black-at-bottom)
- "Show legal moves" checkbox
- "Coordinates" checkbox
- "Animation" checkbox
- "Drawable" checkbox
- "Interactive" checkbox
- Board theme radio group (brown / blue / green / purple / wood)
- Piece set radio group (cburnett / merida / alpha / chess7 / spatial)
- A "Reset board size" button
- A "Clear arrows" button

Closing the popover: outside click, `Escape`, or clicking the cog
again. Focus is trapped inside the popover while open and returns to the
cog on close. The popover is not clipped by the move-list height: it has
its own scroll (`max-height: min(72vh, 540px)`), so every setting stays
reachable even when the side panel is short.

### Promotion dialog

Triggered automatically when a pawn reaches the back rank.
Centered modal over the board with four piece-image buttons (Q, R, B, N
— the images come from the active piece theme for **all five** piece sets,
including the default cburnett). The Q button has default focus.
`Escape` cancels, keeps the board on the pre-move position and re-selects
the source square.

### Separation from production data

The playground must not insert fixture data into the user's persistent
database. Fixtures are a constant array in the playground module and
do not touch IndexedDB. The board size preference is the only state
persisted (via `localStorage` under `chessremedy:board-size`).

### Test coverage

Automated tests must cover the playground in addition to the
Chessboard component tests in the "Tests" section above:

- All fixture FENs are valid (parseable by chessops).
- Every PGN fixture replays legally from its start position (FEN+PGN are
  consistent); an inconsistent PGN surfaces an error instead of being
  silently "fixed".
- Selecting a fixture updates the rendered position.
- The reset button restores the fixture's landing position.
- The non-interactive fixture (or interaction toggle) disables piece
  movement.
- The promotion dialog appears when a pawn reaches the back rank and
  accepts Q/R/B/N correctly; the board and move list update.
- An automated end-to-end test navigates to `/playground`, selects a
  fixture, makes a legal move, and verifies the move list updates.
- Selecting Fixture 9 (Italian Game — Black to play) auto-flips the
  orientation; any fixture whose landing side is Black and not over does
  the same (finished positions stay White at the bottom).
- Selecting Fixture 10 (Scholar's Mate game) and clicking any move in
  the move list updates the board to that ply.
- Pressing `Home` / `End` jumps to start / end of the mainline.
- Selecting Fixture 11 (Variation tree) and clicking the variation
  move seeks into the variation line.
- The drag handle changes the wrapper's width/height and persists
  `chessremedy:board-size` on `pointerup`.
- Pressing `Escape` mid-drag restores the prior size with no
  persistence.
- At a 600 px viewport, the resize hit region is not rendered.
- Changing any setting in the cog popover does NOT reset the
  position.
- Drawing an arrow and clicking "Clear arrows" removes the arrow.
- Checkmated positions show the `#` badge; drawn positions show grey
  `½` chips over both kings; finished positions lock the input.

## Responsive behavior

The board must preserve its square aspect ratio and resize correctly as its
container changes.

It must remain usable on narrow mobile screens.

Touch interactions must not require hover.

The resize hit region is hidden via `@media (max-width: 768px)`;
mobile uses fluid container sizing instead.

## Themes

The board component must support theme configuration rather than hardcoding
one visual theme. **Five board themes** (brown / blue / green / purple /
wood) and **five piece sets** (cburnett / merida / alpha / chess7 /
spatial) ship as standalone CSS files in
`src/components/chessboard/styles/`. The Chessboard wrapper applies a
`board-<name>` and `piece-<name>` class pair to the host element; the
matching CSS file applies the colors / piece imagery.

The board-theme files are generated by `scripts/build-board-theme-css.mjs`
from the canonical Lichess palette pairs (light square = board background,
dark squares = an SVG overlay); they are valid, two-tone, and contain no
hand-edited data URIs. Piece-set images for all five sets are fetched from
Lichess's CDN by `scripts/fetch-piece-assets.mjs` (run from `postinstall`).

Adding another theme or piece set requires only adding a CSS file
plus an enum value plus a class — no JS changes.

The coordinate labels are legible in both app themes via
`board-coordinate-contrast.css`. Rank labels overlay the a-file squares,
so their colour alternates with the squares underneath (light text on
the dark a1/a3/… squares, dark text on the light squares), reversing
when the board is flipped to Black at the bottom; file letters and
per-square coordinates (`coords.squares coord.coord-light/dark`) keep
the same convention.

## Tests

Automated tests must cover:

- rendering a FEN position
- legal move interaction
- illegal move rejection
- board orientation
- board flipping
- arrow creation/removal
- highlights
- read-only mode
- responsive container behavior where practical
- touch interaction through browser tests where practical
- `useBoardSize` read/write round-trip, clamp, default fallback, and
  snap-to-preset function (in-between, ±16 px tolerance, extremes)
- The board wrapper has no visible resize button (only an invisible
  hit region)
- The wrapper exposes a `clearArrows` imperative handle
- Position-tree reducer: build from PGN/FEN, replay, step, seek into
  variations, append/play moves, promotion, illegal-move rejection
- Fixture FEN↔PGN consistency (every PGN replays from its start)
- Move-list rendering (column table with one number per pair,
  variations, NAGs incl. `$9`, comments, `aria-current` on the active
  move)
- navigation buttons (click + keyboard shortcuts + Alt+→ variation
  switching)
- promotion dialog opens on back-rank pawn move; Escape cancels;
  piece-image buttons resolve to the correct role; all 5 piece sets
  have promotion images
- Settings popover focus trap + toggles propagate without resetting the
  position
- `%cal`/`%csl` comment parsing + board-shape conversion for all colours
- NAG colour mapping incl. the `$9`/`X` miss marker
- Board theme CSS: every theme is two-tone with valid embedded assets
- end-to-end: drag a piece → board + move list update; promote a pawn;
  seek into a variation; checkmate `#` badge; draw `½` chips; NAG badge;
  resize persistence & Escape-cancel

At least one browser-level test must verify the board can be interacted with
in a real browser.

## Acceptance Criteria

A developer can open the Chessboard Playground immediately after installing
the project and exercise all core board functionality without importing a
game.

The board works on desktop and mobile-sized viewports.

The dependency version is:

@lichess-org/chessground@10.1.1 or a higher 10.x version (per ADR-014).

The PGN move list is rendered by a custom React-only `MoveList`
component built on `chessops/pgn` (ADR-030 supersedes ADR-029).

The chess state, PGN parsing, and position trees are powered by
`chessops@^0.15.1` (per ADR-028).

The board size is persisted to `localStorage` under
`chessremedy:board-size`, with one global value applied across every
chessboard surface.

No real game data is required to validate this feature.
