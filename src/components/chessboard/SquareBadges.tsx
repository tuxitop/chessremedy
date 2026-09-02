import { useLayoutEffect, useRef, useState } from 'react';
import type * as React from 'react';
import styles from './SquareBadges.module.css';

export interface SquareBadgeItem {
  /** Board square (`a1`-`h8`) the badge anchors to. */
  square: string;
  /** Glyph text (a NAG glyph, `#`, ...). */
  text: string;
  /** Fill colour. */
  color: string;
  /** Visual style: NAG glyphs vs. a checkmate marker. */
  kind?: 'nag' | 'mate';
  /** Extra test id. */
  testId?: string;
}

export interface SquareBadgesProps {
  orientation: 'white' | 'black';
  items: readonly SquareBadgeItem[];
}

function squareColRank(square: string): { col: number; rank: number } {
  const col = square.charCodeAt(0) - 97;
  const rank = Number.parseInt(square[1]!, 10) - 1;
  return { col, rank };
}

/**
 * Small circular badges anchored to the top-right corner of board squares
 * (NAG glyphs, `#` on a checkmated king). The overlay is measured so the
 * badges scale with the board (including the fluid mobile board).
 */
export function SquareBadges({ orientation, items }: SquareBadgesProps): React.JSX.Element | null {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      return undefined;
    }
    const update = (): void => setSize(el.clientWidth);
    update();
    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);

  if (items.length === 0) {
    return null;
  }

  const sqPx = size > 0 ? size / 8 : 60;
  const style = { '--sq': `${sqPx}px` } as React.CSSProperties;

  return (
    <div className={styles.root} ref={ref} style={style} data-testid="square-badges">
      {items.map((item) => {
        const { col, rank } = squareColRank(item.square);
        const whiteBottom = orientation === 'white';
        const xCol = whiteBottom ? col : 7 - col;
        const yRow = whiteBottom ? 7 - rank : rank;
        // Chip sits in the square's top-right corner, just inside it.
        const sizePx = sqPx * 0.5;
        const margin = sqPx * 0.05;
        return (
          <span
            key={`${item.square}-${item.text}-${item.kind ?? ''}`}
            className={`${styles.badge} ${item.kind === 'mate' ? styles.mate : ''}`}
            style={{
              backgroundColor: item.color,
              left: xCol * sqPx + sqPx - margin,
              top: yRow * sqPx + margin,
              height: sizePx,
              minWidth: sizePx,
              paddingLeft: sqPx * 0.12,
              paddingRight: sqPx * 0.12,
            }}
            data-testid={item.testId ?? 'square-badge'}
            data-square={item.square}
            aria-hidden="true"
          >
            {item.text}
          </span>
        );
      })}
    </div>
  );
}
