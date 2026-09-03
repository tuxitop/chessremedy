/**
 * Pure UCI protocol formatting and parsing (Feature 005).
 *
 * No Worker or engine globals here — every function is deterministic and
 * Node-testable (ADR-009 consequence). Malformed engine output is tolerated
 * (parse functions return `null` / neutral results, never throw).
 *
 * Evaluation keeps `score cp` and `score mate` distinct (spec §10) and WDL
 * triplets are parsed when present (ADR-019).
 */

import type { Wdl } from '@/domain/chess';

export interface ParsedScore {
  readonly type: 'cp' | 'mate';
  readonly value: number;
}

export interface ParsedInfo {
  depth?: number;
  seldepth?: number;
  multipv?: number;
  nodes?: number;
  nps?: number;
  hashfull?: number;
  timeMs?: number;
  score?: ParsedScore;
  wdl?: Wdl;
  pv?: readonly string[];
  currmove?: string;
  /** Score bound suffix (`lowerbound` / `upperbound`) when present. */
  bound?: 'lower' | 'upper';
}

export type ParsedUciLine =
  | { readonly kind: 'id'; readonly name?: string; readonly author?: string }
  | { readonly kind: 'uciok' }
  | { readonly kind: 'readyok' }
  | { readonly kind: 'bestmove'; readonly move: string; readonly ponder?: string }
  | { readonly kind: 'info'; readonly info: ParsedInfo }
  | { readonly kind: 'option'; readonly name: string; readonly value?: string }
  | { readonly kind: 'unknown'; readonly text: string };

export function setoptionCommand(name: string, value: string): string {
  return `setoption name ${name} value ${value}`;
}

export function positionFenCommand(fen: string): string {
  return `position fen ${fen}`;
}

export function goDepthCommand(depth: number): string {
  return `go depth ${depth}`;
}

export function goMovetimeCommand(millis: number): string {
  return `go movetime ${millis}`;
}

function toNumber(token: string): number | undefined {
  const n = Number(token);
  return Number.isFinite(n) ? n : undefined;
}

/** Parse an `info` payload (the tokens after `info`). Never throws. */
export function parseInfoTokens(tokens: readonly string[]): ParsedInfo {
  const info: ParsedInfo = {};
  let i = 0;
  while (i < tokens.length) {
    const key = tokens[i];
    // Read the next token (without advancing the shared index past it in a
    // way that could stall when a field has no payload).
    const read = (): string | undefined => (i + 1 < tokens.length ? tokens[++i] : undefined);
    switch (key) {
      case 'depth': {
        const v = toNumber(read() ?? '');
        if (v !== undefined) info.depth = v;
        break;
      }
      case 'seldepth': {
        const v = toNumber(read() ?? '');
        if (v !== undefined) info.seldepth = v;
        break;
      }
      case 'multipv': {
        const v = toNumber(read() ?? '');
        if (v !== undefined) info.multipv = v;
        break;
      }
      case 'nodes': {
        const v = toNumber(read() ?? '');
        if (v !== undefined) info.nodes = v;
        break;
      }
      case 'nps': {
        const v = toNumber(read() ?? '');
        if (v !== undefined) info.nps = v;
        break;
      }
      case 'hashfull': {
        const v = toNumber(read() ?? '');
        if (v !== undefined) info.hashfull = v;
        break;
      }
      case 'time': {
        const v = toNumber(read() ?? '');
        if (v !== undefined) info.timeMs = v;
        break;
      }
      case 'score': {
        const type = read();
        const raw = read();
        if (type === 'cp' || type === 'mate') {
          const value = toNumber(raw ?? '');
          if (value !== undefined) {
            info.score = { type, value };
            // Optional bound suffix: `lowerbound` / `upperbound`.
            const bound = tokens[i + 1];
            if (bound === 'lowerbound') {
              info.bound = 'lower';
              i += 1;
            } else if (bound === 'upperbound') {
              info.bound = 'upper';
              i += 1;
            }
          }
        }
        break;
      }
      case 'wdl': {
        const w = toNumber(read() ?? '');
        const d = toNumber(read() ?? '');
        const l = toNumber(read() ?? '');
        if (w !== undefined && d !== undefined && l !== undefined) {
          info.wdl = { w, d, l };
        }
        break;
      }
      case 'pv': {
        const pv: string[] = [];
        while (i + 1 < tokens.length) {
          pv.push(tokens[++i]!);
        }
        info.pv = pv;
        break;
      }
      case 'currmove': {
        const move = read();
        if (move) info.currmove = move;
        break;
      }
      case 'currmovenumber': {
        read();
        break;
      }
      case 'string':
      case 'refutation':
      case 'currline': {
        // Textual info — ignore the rest of the line.
        return info;
      }
      default:
        // Unknown token: attempt to consume a following numeric payload.
        read();
    }
    // Guarantee forward progress even when a field had no payload.
    i += 1;
  }
  return info;
}

/** Parse a single engine output line. Never throws. */
export function parseUciLine(line: string): ParsedUciLine {
  const trimmed = line.trim();
  if (trimmed === '') {
    return { kind: 'unknown', text: line };
  }
  const tokens = trimmed.split(/\s+/);
  const head = tokens[0]!;

  switch (head) {
    case 'uciok':
      return { kind: 'uciok' };
    case 'readyok':
      return { kind: 'readyok' };
    case 'id': {
      const what = tokens[1];
      const value = tokens.slice(2).join(' ');
      if (what === 'name') return { kind: 'id', name: value };
      if (what === 'author') return { kind: 'id', author: value };
      return { kind: 'unknown', text: line };
    }
    case 'option': {
      // `option name X type ...` (during `uci`). Extract the option name.
      const nameIdx = tokens.indexOf('name');
      const name = nameIdx >= 0 ? tokens[nameIdx + 1] : undefined;
      if (!name) return { kind: 'unknown', text: line };
      return { kind: 'option', name };
    }
    case 'info': {
      if (tokens[1] === 'string') {
        return { kind: 'info', info: {} };
      }
      return { kind: 'info', info: parseInfoTokens(tokens.slice(1)) };
    }
    case 'bestmove': {
      const move = tokens[1];
      if (!move || move === '(none)') {
        return { kind: 'bestmove', move: '(none)' };
      }
      const ponderIdx = tokens.indexOf('ponder');
      const ponder = ponderIdx >= 0 ? tokens[ponderIdx + 1] : undefined;
      return ponder !== undefined ? { kind: 'bestmove', move, ponder } : { kind: 'bestmove', move };
    }
    default:
      return { kind: 'unknown', text: line };
  }
}

/** True when an info line carries data worth surfacing as progress. */
export function isMeaningfulInfo(info: ParsedInfo): boolean {
  return (
    info.depth !== undefined ||
    info.seldepth !== undefined ||
    info.nodes !== undefined ||
    info.nps !== undefined ||
    info.hashfull !== undefined ||
    info.score !== undefined ||
    info.pv !== undefined ||
    info.wdl !== undefined
  );
}
