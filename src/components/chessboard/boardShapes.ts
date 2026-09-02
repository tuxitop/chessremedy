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
