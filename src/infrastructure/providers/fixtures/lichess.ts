/**
 * Lichess NDJSON payload fixtures (Feature 007).
 *
 * Deterministic line shapes that mirror the `/api/games/user` export with
 * `pgnInJson=true`, built from the Feature-003 fixture `Game`s so adapter
 * output is known in advance. Shared by adapter unit tests and the
 * import-service integration tests.
 */

import type { Game } from '@/domain/chess/game';
import { parseTimeControl } from '@/domain/chess/timeControl';

export interface LichessGameOverrides {
  readonly variant?: string;
  readonly createdAtMs?: number;
}

export function lichessGameJson(
  game: Game,
  overrides: LichessGameOverrides = {},
): Record<string, unknown> {
  const externalId = game.externalId ?? game.id;
  // The provider label is derived with the Lichess profile (payload fidelity
  // only; adapters read `clock`, never `speed`/`perf`).
  const lichessCategory = parseTimeControl(game.timeControl, 'lichess').category;
  const line: Record<string, unknown> = {
    id: externalId,
    rated: true,
    variant: overrides.variant ?? 'standard',
    speed: lichessCategory === 'correspondence' ? 'correspondence' : lichessCategory,
    perf: lichessCategory,
    createdAt:
      overrides.createdAtMs ??
      (game.playedAt !== null ? Date.parse(game.playedAt) : 1_700_000_000_000),
    lastMoveAt: (overrides.createdAtMs ?? Date.parse(game.playedAt ?? '')) + 60_000,
    status: 'closed',
    players: {
      white: playerJson(game.whitePlayer.name, game.whitePlayer.rating),
      black: playerJson(game.blackPlayer.name, game.blackPlayer.rating),
    },
    pgn: game.pgn,
  };
  const clock = clockFromTimeControl(game.timeControl);
  if (clock) {
    line.clock = clock;
  }
  return line;
}

export function lichessNdjson(games: readonly Game[], overrides?: LichessGameOverrides): string {
  return games.map((game) => JSON.stringify(lichessGameJson(game, overrides))).join('\n');
}

function playerJson(name: string, rating: number | null): Record<string, unknown> {
  return {
    user: { id: name, name, title: '' },
    ...(rating !== null ? { rating } : {}),
  };
}

function clockFromTimeControl(raw: string): { initial: number; increment: number } | null {
  const match = /^(\d+)(?:\+(\d+))?$/.exec(raw.trim());
  if (!match) return null;
  const initial = Number(match[1]);
  const increment = match[2] === undefined ? 0 : Number(match[2]);
  return { initial, increment };
}
