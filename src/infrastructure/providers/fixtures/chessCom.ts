/**
 * Chess.com raw payload fixtures (Feature 007).
 *
 * Deterministic JSON bodies that mirror the PubAPI shapes, built from the
 * Feature-003 fixture `Game`s so adapter output is known in advance. Shared
 * by adapter unit tests and the import-service integration tests.
 */

import type { Game } from '@/domain/chess/game';

export function chessComProfileJson(username: string): string {
  return JSON.stringify({ username, player_id: 1, title: '', status: 'basic' });
}

export function chessComArchivesJson(months: readonly string[]): string {
  return JSON.stringify({ archives: months });
}

export interface ChessComGameOverrides {
  readonly rules?: string;
  readonly endTimeSec?: number;
  readonly url?: string;
}

/** Month key in `YYYY/MM` form. */
export function monthOf(dateIso: string): string {
  const date = dateIso.slice(0, 10);
  return `${date.slice(0, 4)}/${date.slice(5, 7)}`;
}

export function chessComMonthUrl(username: string, month: string): string {
  return `https://api.chess.com/pub/player/${username}/games/${month}`;
}

export function chessComGameJson(
  username: string,
  game: Game,
  overrides: ChessComGameOverrides = {},
): Record<string, unknown> {
  const externalId = game.externalId ?? game.id;
  const payload: Record<string, unknown> = {
    url: overrides.url ?? `https://www.chess.com/game/live/${externalId}`,
    pgn: game.pgn,
    time_control: game.timeControl,
    time_class: game.normalizedTimeControl,
    end_time:
      overrides.endTimeSec ??
      Math.floor(Date.parse(`${game.playedAt?.slice(0, 10)}T00:00:00Z`) / 1000),
    rated: true,
    rules: overrides.rules ?? 'chess',
    eco: 'C50',
    opening: 'Italian Game',
    white: playerJson(username, game.whitePlayer.name, game.whitePlayer.rating),
    black: playerJson(username, game.blackPlayer.name, game.blackPlayer.rating),
  };
  return payload;
}

export function chessComMonthJson(username: string, games: readonly Game[]): string {
  return JSON.stringify({ games: games.map((g) => chessComGameJson(username, g)) });
}

function playerJson(
  _importUsername: string,
  name: string,
  rating: number | null,
): Record<string, unknown> {
  return {
    username: name,
    ...(rating !== null ? { rating } : {}),
  };
}
