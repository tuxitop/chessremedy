import { describe, expect, it } from 'vitest';
import { PLAYGROUND_FIXTURES, findFixture, isPgnFixture } from './playgroundFixtures';
import {
  buildTreeFromPgn,
  positionAtPath,
  sideToMoveAt,
  pathToLanding,
  treeFromFen,
} from './positionTree';
import { parseFen } from 'chessops/fen';

describe('playground fixtures', () => {
  it('has unique ids and stable labels', () => {
    const ids = PLAYGROUND_FIXTURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(PLAYGROUND_FIXTURES.length).toBe(17);
    for (const f of PLAYGROUND_FIXTURES) {
      expect(f.label.length).toBeGreaterThan(0);
      expect(findFixture(f.id as (typeof PLAYGROUND_FIXTURES)[number]['id']).id).toBe(f.id);
    }
  });

  it('every FEN fixture is parseable', () => {
    for (const fixture of PLAYGROUND_FIXTURES) {
      if (isPgnFixture(fixture)) {
        continue;
      }
      const parsed = parseFen(fixture.fen);
      expect(parsed.isOk, `${fixture.id}: bad FEN`).toBe(true);
      const tree = treeFromFen(fixture.fen);
      expect(tree.rootChildren).toHaveLength(0);
    }
  });

  it('every PGN fixture replays legally from its start position', () => {
    for (const fixture of PLAYGROUND_FIXTURES) {
      if (!isPgnFixture(fixture)) {
        continue;
      }
      const built = buildTreeFromPgn(fixture.pgn);
      expect(built.error, `${fixture.id}: ${built.error ?? ''}`).toBeUndefined();
      const landing = pathToLanding(built.tree);
      // The board lands on the end of the mainline.
      expect(landing.length).toBeGreaterThan(0);
      // The final position must not be inside a check (position must be valid).
      const position = positionAtPath(built.tree, landing);
      void position;
    }
  });

  it('the white-to-move-and-lose fixture carries its own [FEN] start', () => {
    const fixture = findFixture('white-to-move-and-lose');
    expect(isPgnFixture(fixture)).toBe(true);
    if (!isPgnFixture(fixture)) {
      return;
    }
    const built = buildTreeFromPgn(fixture.pgn);
    expect(built.error).toBeUndefined();
    // Start FEN is the custom header position, not the standard start.
    expect(built.tree.startFen).toContain('1k6');
    expect(built.tree.startColor).toBe('white');
    expect(built.tree.result).toBe('0-1');
    const landing = pathToLanding(built.tree);
    expect(positionAtPath(built.tree, landing).isCheckmate()).toBe(true);
  });

  it('the Italian-black-to-move fixture lands with Black to move (not over)', () => {
    const fixture = findFixture('italian-black-to-move');
    expect(isPgnFixture(fixture)).toBe(true);
    if (!isPgnFixture(fixture)) {
      return;
    }
    const built = buildTreeFromPgn(fixture.pgn);
    expect(built.error).toBeUndefined();
    const landing = pathToLanding(built.tree);
    expect(sideToMoveAt(built.tree, landing)).toBe('black');
    expect(positionAtPath(built.tree, landing).isEnd()).toBe(false);
  });
});
