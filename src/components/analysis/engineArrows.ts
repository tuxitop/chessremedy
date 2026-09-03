import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import type { EngineLine } from '@/infrastructure/engine/types';
import { firstMoveSquares } from './engineFormat';
import type { EngineArrowMode } from './engineSettings';

export const ENGINE_ARROW_BRUSH_KEYS = [
  'best',
  'gray1',
  'gray2',
  'gray3',
  'gray4',
  'gray5',
] as const;

/** Brush key for the i-th engine line (0 = best, coloured). */
export function engineArrowBrush(index: number): string {
  return ENGINE_ARROW_BRUSH_KEYS[Math.min(index, ENGINE_ARROW_BRUSH_KEYS.length - 1)]!;
}

/**
 * Arrows for the engine's principal variations. The best line uses the
 * coloured `best` brush; when `mode === 'all'`, every line's first move is
 * drawn with greyed, progressively fainter brushes so they are never confused
 * with user-drawn (green) arrows.
 */
export function engineArrowShapes(
  lines: readonly EngineLine[],
  mode: EngineArrowMode,
): DrawShape[] {
  const count = mode === 'all' ? lines.length : Math.min(1, lines.length);
  const shapes: DrawShape[] = [];
  for (let i = 0; i < count; i += 1) {
    const squares = firstMoveSquares(lines[i]!);
    if (!squares) continue;
    shapes.push({
      orig: squares.from as Key,
      dest: squares.to as Key,
      brush: engineArrowBrush(i),
    });
  }
  return shapes;
}
