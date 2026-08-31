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

chess.js should be used for chess rules, move validation, FEN handling and
PGN-related chess operations.

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

The board must work correctly at desktop, tablet and mobile widths.

The board must not assume that it is displaying a game. It must accept a
position/state supplied by its caller.

## Chess state

The chessboard layer must be able to display and manipulate positions using
standard chess representations, including FEN.

Chess rules must not be implemented manually in the UI.

The UI should delegate chess legality and position manipulation to chess.js
or the appropriate domain chess abstraction.

## Arrow interaction

The board must support creating arrows interactively.

The implementation must allow the puzzle system to later use arrows for:

- hints
- explanations
- solution visualization
- tactical motifs
- analysis

The exact user gesture for creating an arrow should be documented and tested.

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
| 3 | Check                       | `rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 3`                  | yes         | Check highlighting, forced moves                |
| 4 | Capture                     | `r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4`           | yes         | Capture interaction, piece removal              |
| 5 | Arrows + highlights         | `rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1`                       | yes         | Arrow rendering, square highlighting           |
| 6 | Promotion                   | `8/P7/8/8/8/8/8/4K2k w - - 0 1`                                                  | yes         | Pawn promotion interaction                     |
| 7 | Endgame (K+Q vs K)          | `4k3/8/8/8/8/8/4Q3/4K3 w - - 0 1`                                                | yes         | Simplified endgame, few legal moves            |
| 8 | Non-standard FEN            | `r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1`           | yes         | Tricky castling rights, complex legal moves    |

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

- Position selector (dropdown listing the 8 fixtures)
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

### Separation from production data

The playground must not insert fixture data into the user's persistent
database. Fixtures are a constant array in the playground module and
do not touch IndexedDB. The board size preference is the only state
persisted (via the existing `useBoardSize` hook), per the chessboard
component's behaviour.

### Test coverage

Automated tests must cover the playground in addition to the
Chessboard component tests in the "Tests" section above:

- All fixture FENs are valid (parseable by `chess.js`).
- Selecting a fixture updates the rendered position.
- The reset button restores the initial fixture FEN.
- Switching fixtures while pieces are mid-drag does not crash.
- The non-interactive fixture (or interaction toggle) disables piece
  movement.
- An automated end-to-end test navigates to `/playground`, selects a
  fixture, makes a legal move, and verifies the rendered FEN changes.

## Responsive behavior

The board must preserve its square aspect ratio and resize correctly as its
container changes.

It must remain usable on narrow mobile screens.

Touch interactions must not require hover.

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

At least one browser-level test must verify the board can be interacted with
in a real browser.

## Acceptance Criteria

A developer can open the Chessboard Playground immediately after installing
the project and exercise all core board functionality without importing a
game.

The board works on desktop and mobile-sized viewports.

The dependency version is:

@lichess-org/chessground@10.1.1 or a higher 10.x version (per ADR-014).

No real game data is required to validate this feature.
