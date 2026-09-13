import type { GameSource } from '@/domain/chess/gameSource';

/** First `Link`/`Site` PGN header whose value is an absolute http(s) URL. */
const URL_HEADER_PATTERN = /^\[(?:Link|Site)\s+"(https?:\/\/[^"]+)"\]/im;

/**
 * Best-effort canonical URL of an imported game on its source platform.
 *
 * Prefers a real URL from the stored PGN (`Link`/`Site` header, as Chess.com
 * and Lichess emit) and otherwise derives the provider page from the source and
 * external id. Returns `null` for local/fixture games or when no external id
 * exists, so callers can simply hide the link.
 */
export function platformGameUrl(
  source: GameSource,
  externalId: string | null,
  pgn?: string,
): string | null {
  if (pgn !== undefined) {
    const fromPgn = URL_HEADER_PATTERN.exec(pgn)?.[1];
    if (fromPgn !== undefined) {
      return fromPgn;
    }
  }
  if (externalId === null || externalId.trim() === '') {
    return null;
  }
  switch (source) {
    case 'chesscom':
      return `https://www.chess.com/game/live/${externalId}`;
    case 'lichess':
      return `https://lichess.org/${externalId}`;
    default:
      return null;
  }
}
