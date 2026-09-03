import { describe, expect, it } from 'vitest';
import {
  parseUciLine,
  positionFenCommand,
  goDepthCommand,
  goMovetimeCommand,
  setoptionCommand,
  isMeaningfulInfo,
} from './uciProtocol';

describe('uciProtocol formatting', () => {
  it('formats UCI commands', () => {
    expect(setoptionCommand('Hash', '64')).toBe('setoption name Hash value 64');
    expect(positionFenCommand('4k3/8/8/8/8/8/8/4K3 w - - 0 1')).toBe(
      'position fen 4k3/8/8/8/8/8/8/4K3 w - - 0 1',
    );
    expect(goDepthCommand(10)).toBe('go depth 10');
    expect(goMovetimeCommand(500)).toBe('go movetime 500');
  });
});

describe('uciProtocol info parsing', () => {
  it('parses a full info line with score, pv and bounds', () => {
    const line =
      'info depth 12 seldepth 15 multipv 1 score cp 42 nodes 12345 nps 234567 hashfull 12 time 345 pv e2e4 e7e5 g1f3';
    const parsed = parseUciLine(line);
    expect(parsed.kind).toBe('info');
    if (parsed.kind !== 'info') return;
    expect(parsed.info).toMatchObject({
      depth: 12,
      seldepth: 15,
      multipv: 1,
      nodes: 12345,
      nps: 234567,
      hashfull: 12,
      timeMs: 345,
    });
    expect(parsed.info.score).toEqual({ type: 'cp', value: 42 });
    expect(parsed.info.pv).toEqual(['e2e4', 'e7e5', 'g1f3']);
  });

  it('distinguishes mate scores from centipawn scores', () => {
    const mate = parseUciLine('info depth 6 score mate -3 pv d8h4').kind;
    const cp = parseUciLine('info depth 6 score cp 18 pv g1f3').kind;
    expect(mate).toBe('info');
    expect(cp).toBe('info');
    const infoMate = parseUciLine('info depth 6 score mate -3 pv d8h4');
    if (infoMate.kind !== 'info') return;
    expect(infoMate.info.score).toEqual({ type: 'mate', value: -3 });
    const infoCp = parseUciLine('info depth 6 score cp 18 pv g1f3');
    if (infoCp.kind !== 'info') return;
    expect(infoCp.info.score).toEqual({ type: 'cp', value: 18 });
  });

  it('parses score bound suffixes', () => {
    const line = parseUciLine('info depth 9 score cp -120 upperbound nodes 99');
    if (line.kind !== 'info') return;
    expect(line.info.bound).toBe('upper');
  });

  it('parses WDL triplets', () => {
    const line = parseUciLine('info depth 5 score cp 18 wdl 22 974 4 pv e2e4');
    if (line.kind !== 'info') return;
    expect(line.info.wdl).toEqual({ w: 22, d: 974, l: 4 });
  });

  it('handles negative depth on search-string info gracefully', () => {
    const line = parseUciLine('info string NNUE evaluation using nn-1234.nnue');
    expect(line.kind).toBe('info');
    if (line.kind !== 'info') return;
    expect(line.info).toEqual({});
    expect(isMeaningfulInfo(line.info)).toBe(false);
  });

  it('tolerates malformed tokens without throwing', () => {
    expect(() => parseUciLine('info depth banana score cp nope pv')).not.toThrow();
    expect(() => parseUciLine('info score nope')).not.toThrow();
    expect(parseUciLine('garbage line').kind).toBe('unknown');
    expect(parseUciLine('').kind).toBe('unknown');
  });

  it('parses partial info lines', () => {
    const partial = parseUciLine('info depth 4 nodes 7');
    if (partial.kind !== 'info') return;
    expect(partial.info.depth).toBe(4);
    expect(partial.info.nodes).toBe(7);
    expect(partial.info.score).toBeUndefined();
  });

  it('parses MultiPV rank', () => {
    const line = parseUciLine('info depth 11 multipv 3 score cp 5 pv g1f3');
    if (line.kind !== 'info') return;
    expect(line.info.multipv).toBe(3);
  });

  it('keeps pv as UCI tokens in order', () => {
    const line = parseUciLine('info depth 1 score cp 0 pv d2d4 d7d5 c2c4');
    if (line.kind !== 'info') return;
    expect(line.info.pv).toEqual(['d2d4', 'd7d5', 'c2c4']);
  });
});

describe('uciProtocol control lines', () => {
  it('parses uciok, readyok, id and bestmove lines', () => {
    expect(parseUciLine('uciok').kind).toBe('uciok');
    expect(parseUciLine('readyok').kind).toBe('readyok');
    const id = parseUciLine('id name Stockfish 18');
    expect(id.kind).toBe('id');
    if (id.kind === 'id') expect(id.name).toBe('Stockfish 18');
    const author = parseUciLine('id author the Stockfish developers');
    if (author.kind === 'id') expect(author.author).toBe('the Stockfish developers');
  });

  it('parses bestmove with and without ponder', () => {
    const withPonder = parseUciLine('bestmove e2e4 ponder e7e5');
    if (withPonder.kind !== 'bestmove') return;
    expect(withPonder.move).toBe('e2e4');
    expect(withPonder.ponder).toBe('e7e5');

    const withoutPonder = parseUciLine('bestmove (none)');
    if (withoutPonder.kind !== 'bestmove') return;
    expect(withoutPonder.move).toBe('(none)');
  });

  it('parses option lines during the uci handshake', () => {
    const option = parseUciLine('option name Hash type spin default 16 min 1 max 33554432');
    expect(option.kind).toBe('option');
    if (option.kind === 'option') expect(option.name).toBe('Hash');
  });
});
