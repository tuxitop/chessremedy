/**
 * Feature 012 — canonical derived puzzle id (domain, pure).
 *
 * Feature-011 minted no public id for a `PuzzleRow` (its plan's R-5 deferred
 * one): the `puzzles` table natural key is `[sourceGameId, sourcePly]` but
 * attempt rows (Feature 012) and training-set membership (Feature 013) need a
 * stable, single-token reference. This module is that reference: the id is a
 * pure projection of the row's provenance — `"<sourceGameId>:<sourcePly>"` —
 * so it is derivable anywhere the row is and never stored redundantly.
 *
 * The projection is intentionally not the inverse of `parsePuzzleId`: a
 * `sourceGameId` may itself contain `:` (the F011 fixture games do), so the
 * parser splits at the **last** colon and treats the final segment as the ply.
 */

/** Result of `parsePuzzleId`: the split provenance, or a descriptive error. */
export type PuzzleIdParseResult =
  | { readonly ok: true; readonly sourceGameId: string; readonly sourcePly: number }
  | { readonly ok: false; readonly message: string };

/**
 * Canonical puzzle id for a `PuzzleRow`'s provenance: `<gameId>:<sourcePly>`.
 *
 * The F011 natural key `[sourceGameId, sourcePly]` stays the authority; this
 * string is the shared reference used by F012 attempt rows and F013 set
 * membership. Additive — no schema or row field is introduced.
 */
export function puzzleIdOf(sourceGameId: string, sourcePly: number): string {
  return `${sourceGameId}:${sourcePly}`;
}

/**
 * Split a `puzzleIdOf` id back into its game id and source ply.
 *
 * The game id is everything before the **last** colon (game ids may contain
 * colons themselves); the final segment must be a non-negative integer.
 * Returns an error result (never throws) for an empty id, an id with no
 * separator, an empty game id, or a non-numeric ply segment.
 */
export function parsePuzzleId(id: string): PuzzleIdParseResult {
  if (id.length === 0) {
    return { ok: false, message: 'Cannot parse an empty puzzle id.' };
  }
  const separator = id.lastIndexOf(':');
  if (separator <= 0 || separator === id.length - 1) {
    return { ok: false, message: `Puzzle id "${id}" is not of the form "<gameId>:<sourcePly>".` };
  }
  const sourceGameId = id.slice(0, separator);
  const plyText = id.slice(separator + 1);
  if (!/^\d+$/.test(plyText)) {
    return { ok: false, message: `Puzzle id "${id}" has a non-numeric source ply segment.` };
  }
  return { ok: true, sourceGameId, sourcePly: Number(plyText) };
}
