# Feature 002 — Chessboard Playground

## Purpose

The Chessboard Playground provides a dedicated, self-contained environment for
validating the Chessboard component and its integration with Chessground and
chess.js. It uses deterministic chess fixtures so that the feature is fully
testable without imported games, Stockfish analysis, puzzle generation, or any
real user data.

The playground serves as both a development validation tool and a living
specification of Chessboard capabilities.

---

## Scope

### In scope

- A playground page accessible via a dedicated route
- Deterministic chess position fixtures
- Chessground @lichess-org/chessground@10.1.1 integration validation
- chess.js integration validation
- Responsive board sizing validation
- Desktop mouse interaction validation
- Touch interaction validation
- Board orientation (white/black) control
- Legal move interaction (dests display, move execution)
- Arrow drawing and display
- Square highlight display
- Coordinate display toggle
- Board theme selection
- Piece theme selection
- Animation toggle

### Out of scope

- Game importing from Chess.com or Lichess
- Stockfish analysis
- Move classification
- Puzzle generation
- Puzzle training
- Spaced repetition (FSRS)
- Progress analytics
- Cloud synchronization
- Real user data
- Opening repertoires
- Endgame training
- AI coaching

---

## User-facing behavior

### Route

The playground is accessible at `/playground`.

### Page layout

The playground page displays:

1. A Chessboard component rendered at the top of the page
2. A control panel below the board with the following controls:
   - Position selector (dropdown to select from fixture positions)
   - Orientation toggle (white / black)
   - Coordinates toggle (on / off)
   - Show dests toggle (on / off)
   - Animation toggle (on / off)
   - Drawable toggle (on / off)
   - Board theme selector (brown / blue / green / purple / wood)
   - Piece theme selector (cburnett / merida / alpha / chess7 / spatial)
   - Reset button (returns to starting position of current fixture)

### Fixture positions

The playground provides the following deterministic chess positions. Each
position exercises specific Chessboard behaviors:

#### 1. Starting position

- **FEN**: `rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1`
- **Purpose**: Standard starting position; validates piece rendering, legal
  move dests for all pieces, basic interaction
- **Interactive**: yes

#### 2. Scholar's Mate threat

- **FEN**: `r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4`
- **Purpose**: Positions with tactical threats; validates move execution,
  position updates, highlights after moves
- **Interactive**: yes

#### 3. Endgame — King and Queen vs King

- **FEN**: `4k3/8/8/8/8/8/4Q3/4K3 w - - 0 1`
- **Purpose**: Simple endgame; validates few legal moves, clean dests display,
  board interaction in simplified positions
- **Interactive**: yes

#### 4. Promotion position

- **FEN**: `8/P7/8/8/8/8/8/4K2k w - - 0 1`
- **Purpose**: Pawn promotion; validates promotion interaction and move
  callbacks
- **Interactive**: yes

#### 5. Check position

- **FEN**: `rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 3`
- **Purpose**: King in check; validates check highlighting, legal move
  constraints (must escape check)
- **Interactive**: yes

#### 6. View-only position

- **FEN**: `r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4`
- **Purpose**: Board rendered in non-interactive mode; validates viewOnly
  rendering, piece display without interaction
- **Interactive**: no

#### 7. Arrow and highlight demonstration

- **FEN**: `rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1`
- **Purpose**: Board with pre-configured arrows and highlights applied via
  controls; validates arrow rendering and square highlighting
- **Interactive**: yes
- **Default arrows**: `[{ from: 'd8', to: 'h4', color: 'red' }]`
- **Default highlights**: `[{ square: 'e4', color: 'yellow' }]`

### Interaction with fixtures

- Selecting a fixture from the position selector immediately updates the board
- When a fixture is selected, all controls reset to their default values for
  that fixture
- The reset button restores the board to the fixture's initial FEN without
  resetting controls
- Moves made on interactive fixtures update the board; the position selector
  reflects that the board is no longer at the fixture's initial position
  (visual indicator only, no enforcement)

---

## Domain behavior

### Chessboard component

The Chessboard component wraps Chessground and chess.js. The playground
exercises the following component behaviors:

- **FEN loading**: Component accepts a FEN string and renders the position
- **Legal move computation**: Component computes legal moves via chess.js and
  passes them to Chessground as dests
- **Move execution**: Component executes moves via chess.js and updates the
  board via Chessground
- **Position callback**: Component calls `onPositionChange` with the new FEN
  after a move
- **Move callback**: Component calls `onMove` with move details after a move
- **Orientation**: Component passes orientation to Chessground
- **Coordinates**: Component passes coordinates flag to Chessground
- **Drawable**: Component passes drawable config (arrows) to Chessground
- **Highlights**: Component maps highlight props to Chessground highlight
  config
- **Animation**: Component passes animation config to Chessground
- **View-only**: Component sets `viewOnly: true` when `interactive` is false
- **Responsive sizing**: Component adapts to container width in fluid mode,
  or uses fixed size with resize handle in sized mode

### Chess.js integration

- Chess.js validates all moves before execution
- Chess.js provides legal move dests for each position
- Chess.js detects check, checkmate, stalemate
- Chess.js handles pawn promotion

### Chessground integration

- Chessground renders the board and pieces
- Chessground handles user interaction (click, drag)
- Chessground displays legal move indicators
- Chessground highlights last move and check
- Chessground renders arrows via drawable
- Chessground applies board and piece CSS classes

---

## Data requirements

### Fixture data

Fixtures are static, deterministic chess positions. They do not require
IndexedDB storage. Fixtures are defined as a constant array in the feature
module.

### No persistent storage

The playground does not persist any state to IndexedDB or localStorage, except
for the board size preference which is handled by the Chessboard component's
existing `useBoardSize` hook.

---

## States

### Page states

| State | Description |
|-------|-------------|
| Loaded | Page is rendered with the starting position fixture selected |
| Position changed | User has made moves or selected a different fixture |

### No loading or error states

The playground has no asynchronous operations, network requests, or data
loading. All state is immediate and deterministic.

---

## Error cases

### Invalid FEN handling

If a user manually modifies a fixture FEN (future extensibility) and provides
an invalid FEN, the Chessboard component keeps the previous position. The
playground does not surface FEN input in V1.

### No network errors

The playground operates entirely offline with no external dependencies beyond
the bundled Chessground and chess.js libraries.

---

## Edge cases

### Rapid fixture switching

Switching fixtures rapidly should not cause rendering artifacts. The
Chessground API's `set` method handles reconfiguration.

### Orientation change during interaction

Changing orientation while the user is mid-drag should cancel the drag and
reorient the board cleanly.

### Window resize during playback

Board should reflow responsively without losing position state.

### Mobile viewport

On mobile viewports, the resize handle is hidden. The board fills the
available container width. Touch interactions are handled by Chessground.

---

## Accessibility requirements

### Resize handle

- The resize handle has `role="separator"` and `aria-label="Resize board"`
- The resize handle has `aria-orientation="horizontal"`

### Controls

- All controls are native HTML form elements (select, checkbox, button)
- Controls have associated labels
- The reset button has an accessible label

### Keyboard navigation

- All controls are keyboard-focusable in logical tab order
- The Chessboard itself is not keyboard-navigable (Chessground limitation);
  this is documented as a known limitation

### Screen readers

- The board region has an appropriate ARIA landmark or label
- Position changes are not announced (Chessground limitation)

---

## Responsive/mobile requirements

### Breakpoints

- **Desktop** (>768px): Board and controls displayed side by side or stacked
  with controls below
- **Tablet** (768px and below): Controls stacked below the board
- **Mobile** (480px and below): Controls stacked, compact layout, resize
  handle hidden

### Board sizing

- Desktop: Board uses fluid sizing (fills container width) or fixed size
  with resize handle
- Tablet: Board uses fluid sizing (fills container width)
- Mobile: Board uses fluid sizing (fills container width)

### Touch interaction

- Chessground handles touch events for piece movement
- The resize handle is hidden on touch devices (detected via
  `(pointer: coarse)` media query)

---

## Performance constraints

### Initial render

- The playground page must render within 100ms of route activation
- No lazy loading required; all fixtures are inlined

### Move interaction

- Move response must be immediate (< 16ms) to maintain 60fps interaction
- Chess.js move validation is synchronous and fast for individual moves

### No performance bottlenecks

- No network requests
- No Web Workers required
- No large data processing
- No IndexedDB queries

---

## Acceptance criteria

1. **Route**: Navigating to `/playground` renders the playground page
2. **Starting position**: The board renders the starting position by default
3. **Position selector**: Selecting a fixture from the dropdown updates the
   board to that position
4. **Orientation toggle**: Toggling orientation flips the board between white
   and black perspective
5. **Coordinates toggle**: Toggling coordinates shows/hides rank and file
   labels
6. **Show dests toggle**: Toggling show dests shows/hides legal move
   indicators when clicking a piece
7. **Animation toggle**: Toggling animation enables/disables piece movement
   animation
8. **Drawable toggle**: Toggling drawable enables/disables arrow drawing via
   right-click drag
9. **Board theme selector**: Selecting a board theme updates the board
   appearance
10. **Piece theme selector**: Selecting a piece theme updates the piece
    appearance
11. **Reset button**: Clicking reset restores the board to the fixture's
    initial FEN
12. **Legal moves**: On interactive fixtures, clicking a piece shows legal
    move dests
13. **Move execution**: Making a legal move updates the board and triggers
    onMove and onPositionChange callbacks
14. **Check highlighting**: On the check position fixture, the king in check
    is highlighted
15. **View-only mode**: On the view-only fixture, pieces cannot be moved
16. **Responsive sizing**: The board fills the available container width on
    all viewport sizes
17. **Resize handle**: On desktop, the resize handle appears and allows
    resizing the board
18. **No resize handle on mobile**: On touch devices, the resize handle is
    hidden
19. **Dark theme**: The playground page respects the dark/light theme setting
20. **Offline**: The playground functions without a network connection

---

## Testing requirements

### Unit tests

- **Fixture data**: Test that all fixture FENs are valid (parseable by
  chess.js without error)
- **Fixture count**: Test that the expected number of fixtures are defined
- **Fixture properties**: Test that each fixture has required properties
  (fen, label, interactive)

### Component tests

- **Playground page renders**: Test that the page renders with the board and
  controls
- **Position selector updates board**: Test that selecting a fixture updates
  the board FEN
- **Orientation toggle**: Test that toggling orientation changes the board
  orientation prop
- **Controls toggle**: Test that each toggle control updates the expected
  Chessboard prop
- **Reset button**: Test that reset restores the initial fixture position
- **Fixture switching**: Test that switching fixtures resets the board

### Integration tests

- **Chessboard with real Chessground**: Test that Chessground initializes
  and renders a position (no mocking)
- **Legal move interaction**: Test that clicking a piece shows dests and
  executing a move updates the position
- **Responsive behavior**: Test that the board reflows when container size
  changes

### E2E tests (Playwright)

- **Playground page loads**: Test navigation to `/playground`
- **Fixture selection**: Test that selecting a fixture updates the visible
  board
- **Move interaction**: Test that a legal move can be made on the board

### Test fixtures

Fixtures must be separated from production data. The fixture file must not
contain any real user data, game imports, or analysis results.

---

## Dependencies

### Internal dependencies

- `Chessboard` component (`src/components/Chessboard/`)
- `useBoardSize` hook (`src/components/Chessboard/useBoardSize.ts`)
- Chess types (`src/types/chess.ts`)
- CSS tokens and theme (`src/styles/tokens.css`, `src/styles/theme.css`)
- Layout component (`src/components/Layout/Layout.tsx`)

### External dependencies

- `@lichess-org/chessground@10.1.1` (or higher 10.x)
- `chess.js@^1.4.0`

### No dependencies on future features

This feature is fully self-contained. It does not depend on:

- Game importing
- Stockfish analysis
- Puzzle generation
- Spaced repetition
- Analytics
- Synchronization

---

## Architecture notes

### Separation from production data

The playground uses hardcoded fixture positions. It does not read from or
write to IndexedDB. This separation ensures the feature is testable in
isolation.

### Chessboard component as the integration boundary

The playground exercises the Chessboard component's public API
(`ChessboardProps`). It does not directly interact with Chessground or
chess.js. This validates the abstraction boundary.

### No new domain concepts

The playground introduces no new domain types or business logic. It is
purely a validation surface for existing infrastructure.

---

## Implementation guidance

### File structure

```
src/
  pages/
    PlaygroundPage.tsx          # Playground page component
    PlaygroundPage.test.tsx     # Playground page tests
  features/
    playground/
      fixtures.ts              # Deterministic chess position fixtures
      fixtures.test.ts         # Fixture validation tests
```

### Fixture interface

```typescript
interface PlaygroundFixture {
  id: string;
  label: string;
  fen: string;
  interactive: boolean;
  defaultArrows?: Array<{ from: string; to: string; color?: string }>;
  defaultHighlights?: Array<{ square: string; color: string }>;
}
```

### Route registration

Add the `/playground` route to `App.tsx`.

### Navigation

The playground route should be added to the Navigation component for
development access. In production builds, it may be hidden from navigation
but remain accessible via direct URL.
