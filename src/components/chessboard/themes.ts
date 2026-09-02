/**
 * Board themes + piece sets for the ChessRemedy chessboard.
 *
 * Each theme / piece set ships as a standalone CSS file under
 * `src/components/chessboard/styles/`. The Chessboard wrapper applies a
 * `board-<name>` and `piece-<name>` class pair to the host element; the
 * matching CSS file applies the colors / piece imagery.
 *
 * Adding a new theme or piece set requires only:
 *   1. Adding a CSS file in `styles/` with the right scope class.
 *   2. Adding the value to one of the unions below.
 *   3. Adding the option to the playground's settings popover.
 */

export const BOARD_THEMES = ['brown', 'blue', 'green', 'purple', 'wood'] as const;

export type BoardTheme = (typeof BOARD_THEMES)[number];

export const PIECE_SETS = ['cburnett', 'merida', 'alpha', 'chess7', 'spatial'] as const;

export type PieceSet = (typeof PIECE_SETS)[number];

export const DEFAULT_BOARD_THEME: BoardTheme = 'brown';
export const DEFAULT_PIECE_SET: PieceSet = 'cburnett';
