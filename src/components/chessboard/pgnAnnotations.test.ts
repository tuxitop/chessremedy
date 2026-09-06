import { describe, expect, it } from 'vitest';
import {
  parseCommentAnnotations,
  annotationsFromComments,
  nagMeta,
  NAG_META,
} from './pgnAnnotations';

describe('pgnAnnotations', () => {
  describe('%cal / %csl parsing', () => {
    it('extracts arrows and square highlights and strips the tags', () => {
      const parsed = parseCommentAnnotations('[%cal Ge2e4,Rd7d5] [%csl Gd4,Re5]');
      expect(parsed.text).toBe('');
      const arrows = parsed.shapes.filter((s) => s.kind === 'arrow');
      const squares = parsed.shapes.filter((s) => s.kind === 'square');
      expect(arrows).toHaveLength(2);
      expect(arrows[0]).toMatchObject({ from: 'e2', to: 'e4' });
      expect(squares).toHaveLength(2);
      expect(squares[0]).toMatchObject({ square: 'd4' });
    });

    it('maps colour letters to chessground brushes', () => {
      const parsed = parseCommentAnnotations('[%cal Ge2e4,Oa1a8,Pb1b2,Yh1g1] [%csl Rd4,Bd5]');
      const brushes = parsed.shapes.map((s) => s.color.brush);
      expect(brushes).toEqual(['green', 'orange', 'purple', 'yellow', 'red', 'blue']);
    });

    it('keeps non-annotation comment text', () => {
      const parsed = parseCommentAnnotations("The King's Pawn opening [%cal Ge2e4]");
      expect(parsed.text).toBe("The King's Pawn opening");
      expect(parsed.shapes).toHaveLength(1);
    });

    it('collects annotations across multiple comments', () => {
      const shapes = annotationsFromComments(['[%cal Re2e4]', '[%csl Gd4]']);
      expect(shapes).toHaveLength(2);
    });
  });

  describe('NAG metadata', () => {
    it('covers the standard glyphs and the $9 miss marker', () => {
      const map: Record<number, string> = {
        1: '!',
        2: '?',
        3: '!!',
        4: '??',
        5: '!?',
        6: '?!',
        9: 'X',
      };
      for (const [nag, glyph] of Object.entries(map)) {
        expect(nagMeta(Number(nag))?.glyph).toBe(glyph);
      }
    });

    it('has distinct tone labels and colours', () => {
      const tones = Object.values(NAG_META).map((m) => m.tone);
      expect(new Set(tones).size).toBe(Object.keys(NAG_META).length);
      const colors = Object.values(NAG_META).map((m) => m.color);
      expect(new Set(colors).size).toBe(Object.keys(NAG_META).length);
    });

    it('keeps inaccuracy visually distinct from mistake (and mistake from blunder)', () => {
      const hue = (hex: string): number => {
        const value = Number.parseInt(hex.slice(1), 16);
        const r = (value >> 16) & 255;
        const g = (value >> 8) & 255;
        const b = value & 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        if (max === min) return 0;
        let h = 0;
        if (max === r) h = 60 * (((g - b) / (max - min)) % 6);
        else if (max === g) h = 60 * ((b - r) / (max - min) + 2);
        else h = 60 * ((r - g) / (max - min) + 4);
        return (h + 360) % 360;
      };
      const inaccuracy = hue(nagMeta(6)!.color);
      const mistake = hue(nagMeta(2)!.color);
      const blunder = hue(nagMeta(4)!.color);
      // Amber (#d89000) vs orange-red (#d94f00) vs deep red (#c4261c).
      expect(Math.abs(inaccuracy - mistake)).toBeGreaterThan(12);
      expect(Math.abs(mistake - blunder)).toBeGreaterThan(10);
    });
  });
});
