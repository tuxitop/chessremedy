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

It should provide deterministic positions including at minimum:

1. Starting position
2. Position containing a legal tactical move
3. Position involving check
4. Position involving capture
5. Position suitable for demonstrating arrows
6. Position suitable for demonstrating highlights
7. Endgame position
8. Position with non-standard FEN

The playground should provide controls for:

- reset position
- load fixture position
- flip board
- clear arrows
- toggle interaction
- change orientation

The playground must not insert fixture data into the user's persistent
database.

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
