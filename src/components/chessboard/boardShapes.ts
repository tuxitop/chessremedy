import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import { annotationsFromComments } from './pgnAnnotations';

/**
 * Convert PGN `%cal` / `%csl` annotations (from a move's comments) into
 * Chessground auto-shapes so they are drawn on the board at the ply that
 * carries them.
 */
export function commentShapesToDrawShapes(comments: readonly string[]): DrawShape[] {
  const shapes: DrawShape[] = [];
  for (const annotation of annotationsFromComments(comments)) {
    if (annotation.kind === 'arrow') {
      shapes.push({
        orig: annotation.from as Key,
        dest: annotation.to as Key,
        brush: annotation.color.brush,
      });
    } else {
      shapes.push({ orig: annotation.square as Key, brush: annotation.color.brush });
    }
  }
  return shapes;
}

const SQUARE_PATTERN = /^[a-h][1-8]$/;

/**
 * Draw shape for a single UCI move token (`from`-`to` squares, ignoring any
 * trailing promotion role), so a move can be shown as an arrow on the board of
 * its own starting FEN. `null` when the token does not carry two legal squares.
 */
export function uciMoveArrow(uci: string, brush: string): DrawShape | null {
  const orig = uci.slice(0, 2);
  const dest = uci.slice(2, 4);
  if (!SQUARE_PATTERN.test(orig) || !SQUARE_PATTERN.test(dest)) {
    return null;
  }
  return { orig: orig as Key, dest: dest as Key, brush };
}
