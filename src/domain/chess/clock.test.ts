import { describe, expect, it } from 'vitest';
import { gameFromPgn } from './parseGame';
import { gameClocks, extractClockSeconds } from './clock';

const BASE = '[Event "?"]\n[Site "?"]\n[Result "*"]\n';

function clocksOf(pgn: string) {
  const parsed = gameFromPgn(`${BASE}\n${pgn}`, { source: 'local', userColor: 'white' });
  if (!parsed.ok) {
    throw new Error(parsed.error.message);
  }
  return gameClocks(parsed.game.moves);
}

describe('PGN %clk parsing', () => {
  it('parses the clock of each mover after their move', () => {
    const pgn =
      '1. e4 { [%clk 0:04:37] } 1... e5 { [%clk 0:03:59] } 2. Nf3 { [%clk 0:04:33] } 2... Nc6 { [%clk 0:03:55] } *';
    const clocks = clocksOf(pgn);
    expect(clocks).toEqual([
      { ply: 0, color: 'white', clockMs: 277000 },
      { ply: 1, color: 'black', clockMs: 239000 },
      { ply: 2, color: 'white', clockMs: 273000 },
      { ply: 3, color: 'black', clockMs: 235000 },
    ]);
  });

  it('tolerates fractional seconds and missing tags', () => {
    const pgn = '1. e4 { [%clk 0:02:58.3] } 1... e5 2. Nf3 { [%clk 0:02:57] } 2... Nc6 *';
    const clocks = clocksOf(pgn);
    // ply 1 has no clock → omitted, not fabricated.
    expect(clocks.map((c) => c.ply)).toEqual([0, 2]);
    expect(clocks[0]!.clockMs).toBe(178300);
    expect(clocks[1]!.clockMs).toBe(177000);
  });

  it('keeps %emt and %eval out of clock data', () => {
    const pgn = '1. e4 { [%eval 0.2] [%clk 0:04:00] [%emt 0:00:30] } 1... e5 *';
    const clocks = clocksOf(pgn);
    expect(clocks).toHaveLength(1);
    expect(clocks[0]!.clockMs).toBe(240000);
  });

  it('returns an empty list when no annotations are present', () => {
    expect(clocksOf('1. e4 e5 *')).toEqual([]);
  });

  it('ignores malformed clock annotations', () => {
    expect(extractClockSeconds(['{ [%clk 0:04:37] }'])).toBe(277);
    expect(extractClockSeconds(['{ [%clk not-a-clock] }'])).toBeNull();
    expect(extractClockSeconds(['no tag here'])).toBeNull();
  });
});
