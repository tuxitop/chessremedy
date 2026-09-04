/**
 * Provider → domain game normalization (Feature 007).
 *
 * Adapters (infrastructure) isolate the raw Chess.com/Lichess HTTP shapes and
 * produce a provider-agnostic `ProviderGameRecord`. This module maps that
 * record onto a domain `Game` deterministically:
 *
 *  - identity (`source`, `externalId`, `id`) comes from the record, never
 *    guessed from the PGN;
 *  - `userColor` is derived by comparing the record's white/black usernames
 *    with the importing username (case-insensitive), passed explicitly to
 *    `gameFromPgn`;
 *  - scalar metadata is stored authoritative, using the provider's exact
 *    timestamp / time-control enrichment and falling back to the parsed PGN
 *    when a field is missing (ADR-013 retention).
 *
 * Repeated imports of the same provider record therefore produce
 * byte-identical rows → `duplicate`, never churn.
 */

import { gameFromPgn, type GameParseErrorCode } from '@/domain/chess/parseGame';
import type { Game } from '@/domain/chess/game';
import { normalizeTimeControl } from '@/domain/chess/timeControl';
import type { TimeControlCategory } from '@/domain/chess/timeControl';
import type { Player } from '@/domain/chess/game';
import type { Color } from 'chessops/types';

export const IMPORT_PROVIDERS = ['chesscom', 'lichess'] as const;
export type ImportProvider = (typeof IMPORT_PROVIDERS)[number];

export interface ProviderGameRecord {
  readonly source: ImportProvider;
  /** Provider game id. */
  readonly externalId: string;
  /** Importing username exactly as requested (original case kept). */
  readonly username: string;
  /** Provider PGN text (embedded in the provider JSON). */
  readonly pgn: string;
  /** Exact provider instant (Chess.com `end_time`, Lichess `createdAt`). */
  readonly playedAtIso: string | null;
  /** Provider time-control string used when the PGN lacks a header. */
  readonly timeControlRaw: string | null;
  readonly whiteName: string;
  readonly blackName: string;
  readonly whiteElo: number | null;
  readonly blackElo: number | null;
}

export type ProviderSkipCode =
  | 'missingId'
  | 'userNotInGame'
  | 'parseError'
  | 'noGame'
  | 'noMoves'
  | 'illegalMove'
  | 'ambiguousColor';

export type ProviderGameOutcome =
  | { readonly kind: 'game'; readonly game: Game }
  | { readonly kind: 'skip'; readonly code: ProviderSkipCode; readonly message: string };

function skip(code: ProviderSkipCode, message: string): ProviderGameOutcome {
  return { kind: 'skip', code, message };
}

function mapParseCode(code: GameParseErrorCode): ProviderSkipCode {
  switch (code) {
    case 'noGame':
      return 'noGame';
    case 'noMoves':
      return 'noMoves';
    case 'illegalMove':
      return 'illegalMove';
    case 'ambiguousColor':
      return 'ambiguousColor';
    case 'invalidSource':
    case 'missingExternalId':
    case 'parseError':
      return 'parseError';
  }
}

/** Build a domain `Game` from a provider record, or a skip outcome. */
export function providerGameToGame(record: ProviderGameRecord): ProviderGameOutcome {
  const externalId = record.externalId.trim();
  if (externalId === '') {
    return skip('missingId', 'The provider record carries no game id');
  }

  const username = record.username.trim().toLowerCase();
  const white = record.whiteName.trim().toLowerCase();
  const black = record.blackName.trim().toLowerCase();
  const whiteMatches = white !== '' && white === username;
  const blackMatches = black !== '' && black === username;
  if (whiteMatches === blackMatches) {
    return skip(
      'userNotInGame',
      `Importing user "${record.username}" is not one of the players (White: "${record.whiteName}", Black: "${record.blackName}")`,
    );
  }
  const userColor: Color = whiteMatches ? 'white' : 'black';

  const parsed = gameFromPgn(record.pgn, {
    source: record.source,
    externalId,
    userColor,
  });
  if (!parsed.ok) {
    return {
      kind: 'skip',
      code: mapParseCode(parsed.error.code),
      message: parsed.error.message,
    };
  }

  return { kind: 'game', game: applyEnrichment(parsed.game, record, userColor) };
}

function applyEnrichment(game: Game, record: ProviderGameRecord, userColor: Color): Game {
  const timeControlRaw = record.timeControlRaw ?? '';
  const timeControl = game.timeControl !== '' ? game.timeControl : timeControlRaw;
  const normalizedTimeControl: TimeControlCategory = normalizeTimeControl(timeControl).category;
  return {
    ...game,
    userColor,
    playedAt: record.playedAtIso ?? game.playedAt,
    timeControl,
    normalizedTimeControl,
    whitePlayer: enrichPlayer(game.whitePlayer, record.whiteName, record.whiteElo),
    blackPlayer: enrichPlayer(game.blackPlayer, record.blackName, record.blackElo),
  };
}

function enrichPlayer(header: Player, recordName: string, recordElo: number | null): Player {
  const name = header.name === '?' ? recordName : header.name;
  const rating = header.rating ?? recordElo;
  return { name, rating };
}
