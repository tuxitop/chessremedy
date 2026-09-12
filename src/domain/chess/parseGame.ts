/**
 * PGN → Game parsing (Feature 003).
 *
 * `gameFromPgn` parses a raw PGN with chessops and maps the first parsed game
 * onto a domain `Game`. Provider identifiers/source come from the import
 * context, never from guessing inside the PGN text. Full-tree legality is
 * enforced before a `Game` is returned.
 */

import type { Color } from 'chessops/types';
import { parsePgn } from 'chessops/pgn';
import { fenOf, resolveStartPosition } from './position';
import { createMoveList, validateReplay } from './moveList';
import { makeGameId, type Game, type GameResult, type Player } from './game';
import { GAME_SOURCES, type GameSource } from './gameSource';
import { normalizeTimeControl, timeControlProfileForSource } from './timeControl';

export interface ImportContext {
  readonly source: GameSource;
  /** Provider game id; required for `chesscom`/`lichess`. */
  readonly externalId?: string;
  /** Explicit side of the importing user (local/fixture imports). */
  readonly userColor?: Color;
  /** Importing user's name; used to derive `userColor` when not explicit. */
  readonly username?: string;
}

export type GameParseResult =
  | { ok: true; game: Game }
  | { ok: false; error: { code: GameParseErrorCode; message: string; ply?: number } };

export type GameParseErrorCode =
  | 'parseError'
  | 'noGame'
  | 'noMoves'
  | 'invalidSource'
  | 'missingExternalId'
  | 'ambiguousColor'
  | 'illegalMove';

const ILLEGAL_PLY_PATTERN = /^Illegal move \(ply (\d+)\):/;

export function gameFromPgn(rawPgn: string, ctx: ImportContext): GameParseResult {
  if (!GAME_SOURCES.includes(ctx.source)) {
    return {
      ok: false,
      error: { code: 'invalidSource', message: `Unknown source: ${ctx.source}` },
    };
  }
  if ((ctx.source === 'chesscom' || ctx.source === 'lichess') && !hasExternalId(ctx)) {
    return {
      ok: false,
      error: { code: 'missingExternalId', message: `${ctx.source} imports require an external id` },
    };
  }

  let games;
  try {
    games = parsePgn(rawPgn);
  } catch (err) {
    return {
      ok: false,
      error: { code: 'parseError', message: err instanceof Error ? err.message : String(err) },
    };
  }
  if (games.length === 0) {
    return { ok: false, error: { code: 'noGame', message: 'No game found in the PGN text' } };
  }

  const parsed = games[0]!;
  const result = resultOf(parsed.headers);

  // Arbitrary non-PGN text parses to a single placeholder game (zero moves,
  // synthesized headers, `Result "*"`). Reject it; a genuine zero-move game
  // that ended with a real result (e.g. a forfeit) is accepted below.
  if (parsed.moves.children.length === 0 && result === '*') {
    return {
      ok: false,
      error: { code: 'noMoves', message: 'The PGN text contains no game moves' },
    };
  }

  const startPosition = resolveStartPosition(parsed.headers);
  if (!startPosition.ok) {
    return { ok: false, error: { code: 'parseError', message: startPosition.message } };
  }

  const moves = createMoveList(parsed.moves, fenOf(startPosition.position));
  const replayErrors = validateReplay(moves);
  if (replayErrors.length > 0) {
    const first = replayErrors[0]!;
    const plyMatch = ILLEGAL_PLY_PATTERN.exec(first);
    return {
      ok: false,
      error: {
        code: 'illegalMove',
        message: first,
        ...(plyMatch ? { ply: Number(plyMatch[1]) } : {}),
      },
    };
  }

  const colorResult = resolveUserColor(ctx, parsed.headers);
  if (!colorResult.ok) {
    return { ok: false, error: { code: 'ambiguousColor', message: colorResult.message } };
  }

  const externalId = ctx.externalId ?? null;
  const game: Game = {
    id: makeGameId(ctx.source, externalId, rawPgn),
    source: ctx.source,
    externalId,
    playedAt: playedAtOf(parsed.headers),
    whitePlayer: playerOf(parsed.headers, 'White', 'WhiteElo'),
    blackPlayer: playerOf(parsed.headers, 'Black', 'BlackElo'),
    result,
    timeControl: parsed.headers.get('TimeControl') ?? '',
    normalizedTimeControl: normalizeTimeControl(
      parsed.headers.get('TimeControl') ?? '',
      timeControlProfileForSource(ctx.source),
    ).category,
    userColor: colorResult.color,
    pgn: rawPgn,
    moves,
  };
  return { ok: true, game };
}

function hasExternalId(ctx: ImportContext): boolean {
  return ctx.externalId !== undefined && ctx.externalId.trim() !== '';
}

function resultOf(headers: ReadonlyMap<string, string>): GameResult {
  const value = headers.get('Result');
  if (value === '1-0' || value === '0-1' || value === '1/2-1/2' || value === '*') {
    return value;
  }
  return '*';
}

function playerOf(headers: ReadonlyMap<string, string>, nameKey: string, eloKey: string): Player {
  return {
    name: headers.get(nameKey) ?? '?',
    rating: parseElo(headers.get(eloKey)),
  };
}

function parseElo(raw: string | undefined): number | null {
  if (raw === undefined) {
    return null;
  }
  const value = raw.trim();
  if (value === '' || value === '?' || value === '-') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function resolveUserColor(
  ctx: ImportContext,
  headers: ReadonlyMap<string, string>,
): { ok: true; color: Color } | { ok: false; message: string } {
  if (ctx.userColor === 'white' || ctx.userColor === 'black') {
    return { ok: true, color: ctx.userColor };
  }
  const username = ctx.username?.trim();
  if (!username) {
    return { ok: false, message: 'Cannot determine the importing user\u2019s color' };
  }
  const whiteName = (headers.get('White') ?? '').trim();
  const blackName = (headers.get('Black') ?? '').trim();
  const white = whiteName === username;
  const black = blackName === username;
  if (white === black) {
    return { ok: false, message: 'Username matches neither or both player headers' };
  }
  return { ok: true, color: white ? 'white' : 'black' };
}

function playedAtOf(headers: ReadonlyMap<string, string>): string | null {
  const date = parseDate(headers.get('UTCDate') ?? headers.get('Date') ?? '');
  if (!date) {
    return null;
  }
  const time = parseTime(headers.get('UTCTime') ?? headers.get('Time') ?? '');
  return time ? `${date}T${time}Z` : `${date}T00:00:00Z`;
}

interface DateParts {
  year: number;
  month: number;
  day: number;
}

function parseDate(raw: string): string | null {
  const match = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(raw.trim());
  if (!match) {
    return null;
  }
  const parts: DateParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  if (!isValidDate(parts)) {
    return null;
  }
  return pad(parts.year) + '-' + pad(parts.month) + '-' + pad(parts.day);
}

function parseTime(raw: string): string | null {
  const match = /^(\d{2}):(\d{2}):(\d{2})$/.exec(raw.trim());
  if (!match) {
    return null;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3]);
  if (hour > 23 || minute > 59 || second > 59) {
    return null;
  }
  return pad(hour) + ':' + pad(minute) + ':' + pad(second);
}

function isValidDate(parts: DateParts): boolean {
  if (parts.year < 1 || parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > 31) {
    return false;
  }
  const daysInMonth = new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate();
  return parts.day <= daysInMonth;
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}
