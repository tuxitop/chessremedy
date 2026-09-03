/**
 * Game origin model (Feature 003).
 *
 * `GameSource` is the platform/origin dimension that later statistics
 * (Feature 014) group by. Provider identifiers stay on the model as
 * opaque strings so no consumer depends on Chess.com/Lichess formats.
 */

export const GAME_SOURCES = ['chesscom', 'lichess', 'local', 'fixture'] as const;

export type GameSource = (typeof GAME_SOURCES)[number];

export const GAME_SOURCE_LABELS: Readonly<Record<GameSource, string>> = {
  chesscom: 'Chess.com',
  lichess: 'Lichess',
  local: 'Local',
  fixture: 'Fixture',
};

const GAME_SOURCE_ALIASES: ReadonlyArray<readonly [alias: string, source: GameSource]> = [
  ['chess.com', 'chesscom'],
  ['chesscom', 'chesscom'],
  ['chess-com', 'chesscom'],
  ['lichess', 'lichess'],
  ['lichess.org', 'lichess'],
  ['local', 'local'],
  ['pgn', 'local'],
  ['imported', 'local'],
  ['fixture', 'fixture'],
];

/**
 * Normalize a free-form source string to a `GameSource`. Case-insensitive.
 * Returns `null` for anything unrecognized.
 */
export function normalizeGameSource(input: string): GameSource | null {
  const key = input.trim().toLowerCase();
  for (const [alias, source] of GAME_SOURCE_ALIASES) {
    if (key === alias) {
      return source;
    }
  }
  return null;
}

export function isGameSource(value: unknown): value is GameSource {
  return typeof value === 'string' && (GAME_SOURCES as readonly string[]).includes(value);
}
