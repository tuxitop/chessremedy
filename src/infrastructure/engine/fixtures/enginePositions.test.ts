import { describe, expect, it } from 'vitest';
import { ENGINE_POSITIONS, findEnginePosition } from './enginePositions';
import { parsePositionFen } from '@/domain/chess';
import type { Square } from 'chessops/types';

describe('engine verification positions (spec §16)', () => {
  it('has unique ids and covers the required position kinds', () => {
    const ids = ENGINE_POSITIONS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    const kinds = new Set(ENGINE_POSITIONS.map((p) => p.expected));
    expect(kinds.has('mate')).toBe(true);
    expect(kinds.has('material')).toBe(true);
    expect(kinds.has('quiet')).toBe(true);
    expect(kinds.has('coverage')).toBe(true);
    for (const p of ENGINE_POSITIONS) {
      expect(findEnginePosition(p.id).id).toBe(p.id);
      expect(p.label.length).toBeGreaterThan(0);
    }
  });

  it('every FEN parses as a legal chessops position with moves to analyze', () => {
    for (const fixture of ENGINE_POSITIONS) {
      const parsed = parsePositionFen(fixture.fen);
      expect(parsed.ok, `${fixture.id}: ${parsed.ok ? '' : parsed.message}`).toBe(true);
      if (parsed.ok) {
        expect(parsed.position.isEnd(), `${fixture.id}: terminal position`).toBe(false);
      }
    }
  });

  it('the mate-in-1 fixture is white to move with a mating move available', () => {
    const fixture = findEnginePosition('engine-mate-in-1');
    const parsed = parsePositionFen(fixture.fen);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const position = parsed.position;
    expect(position.turn).toBe('white');
    let mateFound = false;
    for (const [from] of position.board) {
      for (const to of position.dests(from)) {
        const next = position.clone();
        next.play({ from: from as Square, to: to as Square });
        if (next.isCheckmate()) {
          mateFound = true;
          break;
        }
      }
      if (mateFound) break;
    }
    expect(mateFound).toBe(true);
  });
});
