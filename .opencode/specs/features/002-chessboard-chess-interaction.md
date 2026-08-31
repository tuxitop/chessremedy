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
required by `@lichess-org/pgn-viewer` (ADR-029). See ADR-028 for the
rationale.

## Chessboard capabilities

The reusable board must support:

- responsive sizing
- desktop mouse interaction
- touch interaction
- drag-and-drop moves
- click-to-move where appropriate
- legal move validation
- board orientation
- coordinates
- board flipping
- piece movement animation
- configurable animation behavior
- last-move highlighting
- selected-square highlighting
- arbitrary square highlighting
- arrows
- multiple arrows where required
- clearing arrows
- configurable board theme
- configurable piece set
- disabled interaction mode
- read-only position display
- PGN move-list panel (variations, NAGs, comments, current-move
  highlighting, click-to-seek, keyboard navigation, ARIA `tree` /
  `treeitem` / `group` roles, themable via CSS variables)
- move-navigation controls (`start`, `previous`, `next`, `end`, plus
  Alt+← / Alt+→ for variation switching)
- resizable board on desktop via a bottom-right corner drag handle
  with snap-to-preset (240 / 320 / 480 / 640 / 800 / 1024 px, ±16 px
  tolerance)
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

## Arrow interaction

The board must support creating arrows interactively.

The implementation must allow the puzzle system to later use arrows for:

- hints
- explanations
- solution visualization
- tactical motifs
- analysis

The exact user gesture for creating an arrow should be documented and tested.

## Board resize

`<Chessboard />` owns `useBoardSize()`, `<ResizeHandle />`, and
`<BoardContainer />`. These pieces are reused by every chessboard
surface in the app (playground, live analysis board, game review, puzzle
training) so the persisted size is one global setting.

### Storage

- Backend: `localStorage` (per `ARCHITECTURE.md §4`). Dexie is **not**
  used for board-size state.
- Key: `chessremedy:board-size`.
- Default: `480` px. Values outside `[240, 1024]` are clamped on read.

### Drag handle

- Renders as a `<button type="button" aria-label="Resize board">` with
  an SVG grip icon and `cursor: nwse-resize`.
- Lives in the bottom-right corner of `<BoardContainer />`.
- Hidden on viewports `≤ 768 px` (mobile). Mobile uses fluid
  `width: 100%` sizing instead.

### Drag behavior

- `pointerdown` calls `useBoardSize.beginDrag`. The wrapper's CSS
  variable (`--board-drag-size`) switches to the drag value so the
  pointermove handler does not cause `localStorage` thrash.
- `pointermove` (RAF-throttled, via `setPointerCapture`) updates the
  CSS variable; clamped to `[240, 1024]`.
- `pointerup` snaps the final value to the nearest preset (240 / 320 /
  480 / 640 / 800 / 1024, ±16 px tolerance), then commits to
  `localStorage` via `useBoardSize.setSize`.
- `Escape` or `pointercancel` cancels the drag and restores the prior
  size; no persistence.

### Layout containment

`<BoardContainer />` sets:

- `style={{ width: size, height: size }}`
- `contain: layout size` so a resize never reflows the surrounding move
  list, eval panel, or control panel
- `touch-action: none` so the page does not scroll while dragging the
  handle
- `max-height: calc(100dvh - 200px)` on desktop so the board cannot
  exceed the viewport

### Keyboard popover slider

**Omitted from V1.** The keyboard accessibility for the handle is
limited to focus-visible focus styles; mouse drag is the only V1 input
method. A keyboard-popover slider is a future enhancement.

## Development Playground

Provide a development-only Chessboard Playground.

The playground must allow the board to be exercised without requiring real
games or database records.

### Route

The playground is accessible at `/playground`.

### Layout

The playground page displays:

1. A Chessboard component rendered at the top of the page.
2. A control panel below the board with the controls listed in the
   "Controls" section.

### Fixture positions

The playground must provide the following deterministic chess positions.
Each position exercises specific Chessboard behaviors. The set is
intentionally small but covers every category listed in the original
abstract requirement.

| # | Label                       | FEN                                                                              | Interactive | Exercises                                      |
|---|-----------------------------|----------------------------------------------------------------------------------|-------------|------------------------------------------------|
| 1 | Starting position           | `rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1`                       | yes         | Piece rendering, legal move dests              |
| 2 | Tactical / Scholar's Mate   | `r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4`             | yes         | Tactical move execution, position updates      |
| 3 | Check                       | `rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3`                 | yes         | Check highlighting, forced moves                |
| 4 | Capture                     | `r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4`           | yes         | Capture interaction, piece removal              |
| 5 | Arrows + highlights         | `rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1`                       | yes         | Arrow rendering, square highlighting           |
| 6 | Promotion                   | `8/P7/8/8/8/8/8/4K2k w - - 0 1`                                                  | yes         | Pawn promotion interaction                     |
| 7 | Endgame (K+Q vs K)          | `3k4/8/8/8/8/8/4Q3/4K3 w - - 0 1`                                                | yes         | Simplified endgame, few legal moves            |
| 8 | Non-standard FEN            | `r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1`           | yes         | Tricky castling rights, complex legal moves    |
| 9 | Scholar's Mate game (PGN)   | starting position; PGN: `1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6?? 4. Qxf7#`               | yes         | Move list, end-of-game, navigation              |
| 10 | Variation tree (PGN)         | starting position; PGN: `1. e4 e5 2. Nf3 Nc6 3. Bb5 (3. Bc4) a6 4. Ba4`           | yes         | Variation tree rendering, Alt+→ switching       |

Default arrows for fixture 5: `[{ from: 'd8', to: 'h4', color: 'red' }]`.
Default highlights for fixture 5: `[{ square: 'e4', color: 'yellow' }]`.

Selecting a fixture from the position selector immediately updates the
board. When a fixture is selected, all controls reset to their default
values for that fixture. The reset button restores the board to the
fixture's initial FEN without resetting the other controls. Moves made
on interactive fixtures update the board; the position selector reflects
that the board is no longer at the fixture's initial position (visual
indicator only, no enforcement).

### Controls

The control panel must include:

- Position selector (dropdown listing the 10 fixtures)
- Orientation toggle (white / black)
- Coordinates toggle (on / off)
- Show dests toggle (on / off)
- Animation toggle (on / off)
- Drawable toggle (on / off)
- Board theme selector (brown / blue / green / purple / wood)
- Piece theme selector (cburnett / merida / alpha / chess7 / spatial)
- Clear arrows button
- Toggle interaction button
- Reset button (returns the board to the current fixture's initial FEN)
- Reset board size button (restores the default 480 px)

The resize handle is rendered by `<BoardContainer />` itself and does
not appear in the control panel.

### Separation from production data

The playground must not insert fixture data into the user's persistent
database. Fixtures are a constant array in the playground module and
do not touch IndexedDB. The board size preference is the only state
persisted (via `localStorage` under `chessremedy:board-size`, per the
chessboard component's behaviour).

### Test coverage

Automated tests must cover the playground in addition to the
Chessboard component tests in the "Tests" section above:

- All fixture FENs are valid (parseable by chessops).
- Selecting a fixture updates the rendered position.
- The reset button restores the initial fixture FEN.
- Switching fixtures while pieces are mid-drag does not crash.
- The non-interactive fixture (or interaction toggle) disables piece
  movement.
- An automated end-to-end test navigates to `/playground`, selects a
  fixture, makes a legal move, and verifies the rendered FEN changes.
- Selecting Fixture 9 and clicking any move in the move list updates
  the board to that ply.
- Pressing `Home` / `End` jumps to start / end of the mainline.
- Selecting Fixture 10 displays the nested variation indented, and
  pressing `Alt+→` at the variation root switches to the alternate
  line.
- The drag handle changes the wrapper's width/height and persists
  `chessremedy:board-size` on `pointerup`.
- Pressing `Escape` mid-drag restores the prior size with no
  persistence.
- At a 600 px viewport, the resize handle is not rendered.

## Responsive behavior

The board must preserve its square aspect ratio and resize correctly as its
container changes.

It must remain usable on narrow mobile screens.

Touch interactions must not require hover.

The drag handle is hidden via `@media (max-width: 768px)`; mobile uses
fluid container sizing instead. The board wrapper applies
`contain: layout size` and `max-height: calc(100dvh - 200px)` on
desktop so a resize cannot push the surrounding UI off the viewport.

## Themes

The board component must support theme configuration rather than hardcoding
one visual theme.

The initial implementation should include the approved V1 board themes and
piece sets defined by the architecture/design specification.

Adding another theme should not require modifying chess logic.

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
- `ResizeHandle` pointer events, Escape cancels, mobile-hidden via
  `matchMedia` mock
- `BoardContainer` exposes `contain: layout size`
- `chessopsAdapter` FEN round-trip for the 10 playground fixtures
- move-list rendering (variations, NAGs, comments, `aria-current` on
  the active move)
- navigation buttons (click + keyboard shortcuts + Alt+→ variation
  switching)
- end-to-end: drag the handle, reload, assert persisted size; pressing
  Escape mid-drag restores prior size; selecting Fixture 9 and clicking
  the 4th move asserts board FEN; selecting Fixture 10 and pressing
  Alt+→ asserts variation switch

At least one browser-level test must verify the board can be interacted with
in a real browser.

## Acceptance Criteria

A developer can open the Chessboard Playground immediately after installing
the project and exercise all core board functionality without importing a
game.

The board works on desktop and mobile-sized viewports.

The dependency version is:

@lichess-org/chessground@10.1.1 or a higher 10.x version (per ADR-014).

The PGN move list is powered by `@lichess-org/pgn-viewer@^2.6.4`
(per ADR-029).

The chess state, PGN parsing, and position trees are powered by
`chessops@^0.15.1` (per ADR-028).

The board size is persisted to `localStorage` under
`chessremedy:board-size`, with one global value applied across every
chessboard surface.

No real game data is required to validate this feature.