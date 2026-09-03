import { describe, expect, it } from 'vitest';
import type { EngineLine } from '@/infrastructure/engine/types';
import { ENGINE_ARROW_BRUSH_KEYS, engineArrowBrush, engineArrowShapes } from './engineArrows';

function line(uci: string, multipv = 1): EngineLine {
  return {
    multipv,
    evaluation: { cp: 20 },
    principalVariation: [{ uci }],
    wdl: null,
  };
}

describe('engine arrows', () => {
  it('maps line index to distinct brush keys', () => {
    expect(engineArrowBrush(0)).toBe('best');
    expect(engineArrowBrush(1)).toBe('gray1');
    expect(engineArrowBrush(5)).toBe(ENGINE_ARROW_BRUSH_KEYS[5]);
  });

  it('draws only the first line arrow in first mode', () => {
    const shapes = engineArrowShapes([line('e2e4', 1), line('d2d4', 2)], 'first');
    expect(shapes).toHaveLength(1);
    expect(shapes[0]).toMatchObject({ orig: 'e2', dest: 'e4', brush: 'best' });
  });

  it('draws every line arrow in all mode with greyed brushes', () => {
    const shapes = engineArrowShapes([line('e2e4', 1), line('d2d4', 2), line('g1f3', 3)], 'all');
    expect(shapes.map((s) => s.brush)).toEqual(['best', 'gray1', 'gray2']);
  });

  it('skips lines without a PV', () => {
    const empty: EngineLine = {
      multipv: 1,
      evaluation: { cp: 0 },
      principalVariation: [],
      wdl: null,
    };
    expect(engineArrowShapes([empty, line('e2e4')], 'all')).toHaveLength(1);
  });
});
