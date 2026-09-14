# Opening Repertoire

The domain rules for the **opening repertoire model** (post-V1): the
canonical position key, the position-keyed DAG, side selection, and the PGN
import/export round-trip. Introduced by ADR-036 and realized by Feature 021.

This document is authoritative for the repertoire-domain rules; Feature 021
defines the user-facing behaviour and persistence. It is **scheduling-free**:
training/review is Feature 024 and is not part of this model.

## Canonical position key

```ts
type PositionKey = string; // canonical EPD

function positionKeyOf(position: Position): PositionKey {
  return makeFen(position.toSetup(), { epd: true });
}
```

- The key contains **piece placement, side to move and castling rights**,
  with an **en-passant square only when a legal en-passant capture exists**
  (`chessops` `toSetup()` emits `legalEpSquare`), and **no halfmove/fullmove
  counters** — counters differ across transpositions and are not position
  identity.
- The key is an EPD; `parseFen` accepts a four-field EPD (missing counters
  default to `0`/`1`), so a key round-trips through `parseFen` →
  `Chess.fromSetup`.
- `positionKeyOf` is **idempotent**: `positionKeyOf(parse(positionKey)) ===
  positionKey`.
- Castling rights are part of the key (standard chess here; the field
  generalizes to Chess960 file-letters without a key change).
- `POSITION_KEY_VERSION` versions the normalization. Changing it requires an
  explicit migration that recomputes stored keys and edges; it is **never a
  silent rebuild** (repertoire data is user data, not derived).

## Graph model (DAG)

```ts
type RepertoireSide = 'white' | 'black';
type EdgeRole = 'user' | 'opponent';

interface Repertoire {
  id: string;
  name: string;
  side: RepertoireSide;
  startFen: string;       // full FEN of the root (honours [SetUp]/[FEN])
  startKey: PositionKey;  // canonical key of the root
  comment?: string;       // game-level intro comment, when present
  headers?: Record<string, string>;
  modelVersion: number;
  createdAt: number;
  updatedAt: number;
}

interface RepertoireNode {
  repertoireId: string;
  positionKey: PositionKey;
  createdAt: number;
  updatedAt: number;
}

interface RepertoireEdge {
  repertoireId: string;
  fromKey: PositionKey;
  moveUci: string;        // e.g. "e2e4", "e7e8q"
  moveSan: string;
  toKey: PositionKey;
  order: number;          // per (repertoireId, fromKey); 0 = mainline
  comments?: string[];
  nags?: number[];
  createdAt: number;
  updatedAt: number;
}
```

- **Node identity** is `(repertoireId, positionKey)`: transpositions merge
  automatically.
- **Edge identity** is `(repertoireId, fromKey, moveUci)`.
- Invariants:
  - every edge endpoint (`fromKey`, `toKey`) is a stored node;
  - `apply(fromKey, moveUci) → toKey` (verified on import; repaired or
    dropped by reconcile, never silently trusted);
  - `order` values for one parent are unique and gap-free after merge;
  - the root (`startKey`) always exists as a node.
- A repertoire with only the root node (no edges) is valid and exports as
  headers only.

## Side selection and edge roles

- The graph is **side-agnostic**; `side` is repertoire metadata.
- `roleOf(edge, side) = turnOf(edge.fromKey) === side ? 'user' : 'opponent'`.
  `turnOf` reads the side-to-move field of the EPD key.
- Only `'user'` edges are recall targets (Feature 024); `'opponent'` edges
  are prompts/branches (Features 025/026).
- A repertoire whose `side` has no user edge is valid but reports a warning
  on import ("no moves for the selected side").
- Side is never used to prune the graph; changing it is a metadata edit.

## PGN import

`importRepertoirePgn({ pgn, side, name }) → ImportResult` (pure), and
`mergeRepertoirePgn(repertoireId, pgn) → ImportResult`.

1. **Parse** with `chessops/pgn` `parsePgn`. A PGN with zero games is
   rejected (`emptyPgn`).
2. **Variant / start guard**: reject non-standard `Variant`/`Rules` headers
   (`unsupportedVariant`) and invalid `[SetUp "1"]`/`[FEN]` start positions
   (`invalidStartPosition`) via `resolveStartPosition`. All games in one
   import must share the same root; otherwise `multipleStartPositions`.
3. **Walk the RAV tree iteratively** (explicit stack, never recursion) with
   the position as context. For every node:
   - parse SAN and require legality (`parseSan` + `isLegal`); an illegal
     move rejects the import with `illegalMove` (ply + SAN). Illegal lines
     are **never silently dropped** (mirrors Feature 003 `validateReplay`);
   - compute `fromKey`, `toKey`, `moveUci`;
   - upsert the node(s) and the edge.
4. **Ordering**: children are visited in `node.children` order (mainline is
   `children[0]`, then variations). A new edge for a parent receives the next
   free `order`; an edge already present **keeps its order**.
5. **Annotations**: `[...startingComments, ...comments]` are appended to the
   edge's `comments` (exact duplicates removed, first-seen order kept);
   `nags` are unioned and sorted ascending. The game-level intro comment
   (`Game.comments`) seeds `Repertoire.comment` when the repertoire has none;
   headers seed `Repertoire.headers` on creation.
6. **Persistence** happens in a single Dexie transaction (atomic): either
   the whole import applies or none of it does.

Import is **idempotent**: importing the same PGN again adds no rows and
changes no annotations; merging a PGN whose root differs from the target
repertoire is rejected (`startMismatch`).

## PGN export

`exportRepertoirePgn(repertoire, nodes, edges) → { pgn, warnings }` (pure).

1. Group edges by `fromKey`; sort each group by `order` ascending (ties by
   `moveUci` for determinism).
2. Walk from `startKey`, building a `chessops` `Node<PgnNodeData>` tree
   **iteratively**. The first child is the mainline; the rest are RAV
   variations.
3. **Transposition handling**: export expands every occurrence of a position
   (duplicating shared continuations), so the full DAG content is preserved.
   When a position key has already been visited in this export, an
   informational `{transposes to <key>}` comment is attached to the edge
   that re-enters it.
4. **Bounds**: expansion stops at `MAX_EXPORT_NODES` and `MAX_EXPORT_PLIES`;
   a `truncated` warning is recorded and the branch ends as a leaf. The
   exported PGN is always syntactically valid.
5. Wrap in a `Game<PgnNodeData>`: stored headers plus the seven-tag roster
   and `[ChessRemedyRepertoire "<modelVersion>"]`,
   `[ChessRemedySide "<side>"]`; `makePgn` serialises it.
6. **Round-trip guarantee**: `import(export(r))` reproduces the same node
   set, edge set, per-parent ordering and annotations as `r`, provided the
   export was not truncated. Duplicated transposed continuations re-merge by
   position key on import.

## Merge, idempotence and reconcile

- `mergeGraphs(a, b)` is set-union with the deterministic annotation merge
  above and stable ordering. It is associative and idempotent, so repeated
  imports of overlapping lines converge.
- `reconcileRepertoire(repertoireId)` repairs referential integrity only:
  - a missing endpoint node is re-created when its position is derivable
    from the edge (`fromKey` + UCI → `toKey`, or a parseable key);
  - an edge whose `toKey` disagrees with `apply(fromKey, moveUci)` is dropped
    with a warning;
  - it never re-derives repertoire content from any source.
- Reconcile is bounded, idempotent and may run lazily on read or as a batched
  non-blocking step.

## Versioning

- `REPERTOIRE_MODEL_VERSION` covers graph/import-export semantics;
  `POSITION_KEY_VERSION` covers key normalization. Both are recorded on the
  repertoire (`modelVersion`; the key version is folded into the model
  version constant).
- An incompatible model change requires an explicit additive migration.
  Repertoire content is **authoritative user data**: it is never silently
  rebuilt or re-imported.
- Export stamps the model version in a PGN header for reproducibility
  (`ARCHITECTURE.md` §9 pattern).

## Invariants

1. Node identity is the canonical position key; transpositions are one node.
2. Edge identity is `(repertoireId, fromKey, moveUci)` and `toKey` equals
   `apply(fromKey, moveUci)`.
3. The graph is side-agnostic; role is derived from the key's side to move.
4. Import is atomic, legality-checked and idempotent; export is bounded and
   round-trips when not truncated.
5. Repertoire content is authoritative user data and is never derived from a
   game, never silently rebuilt, and never deleted by a game deletion.
6. Repertoire data is local-only and absent from the ADR-016 sync envelope in
   this feature.

## Sources

- `specs/decisions/ADR-036-opening-repertoire-model.md`
- `specs/features/021-opening-repertoire-domain.md`
- `specs/domain/game-model.md`
- `specs/decisions/ADR-001`, `ADR-016`, `ADR-028`, `ADR-030`,
  `ADR-031`/`ADR-035`
- `specs/research/opening-repertoire.md`
