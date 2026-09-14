# Feature 021 — Opening Repertoire Domain & PGN Import/Export

> **Status: post-V1, specification complete; implementation is gated.**
> Not implementable until an approved implementation plan exists. The
> required ADR (**ADR-036 — Opening Repertoire Model**, Accepted) and the
> canonical `domain/opening-repertoire.md` are authored. This feature
> introduces the opening-repertoire domain model and the PGN import/export
> path that Features 022–028 build on.
>
> No existing decision is contradicted. Feature 021 is **scheduling-free**:
> training/review is Feature 024 and must not change ADR-031/ADR-035. Sync
> of repertoire data is deliberately deferred (see "Synchronization
> posture").

## Purpose

Opening repertoires are future scope (`PRODUCT.md` §1/§17) and are
anticipated by `ARCHITECTURE.md` §12 ("future opening training reuses the
chessboard, game-state and training infrastructure"). This feature is the
foundation every later opening feature needs:

- a **repertoire graph** that survives transpositions, because the same
  position arises from different move orders (`research/opening-repertoire.md`
  §5);
- a **canonical position key** so two paths to the same position are one
  node;
- **PGN import/export** so repertoires can be created from, and moved to,
  any chess tool without lock-in.

It is deliberately a **domain + persistence + import/export** feature. It
ships no creator/editor (Feature 023), no opening names (Feature 022), no
training (Feature 024), no coverage (Feature 025), and no compliance
(Feature 026).

## Scope

### In scope

1. The pure domain **repertoire model**: repertoires, position-keyed nodes,
   move-labelled edges, side selection, edge roles, annotations.
2. The canonical **position key** (EPD: piece placement, side to move,
   castling rights, en-passant only when a legal capture exists; move
   counters excluded) built on `chessops/fen` (ADR-028).
3. **Transposition de-duplication**: node identity is the position key;
   edges are keyed by `(repertoireId, fromKey, moveUci)`.
4. **PGN import** via `chessops/pgn` RAV trees (ADR-028/ADR-030): parse,
   validate legality, flatten to the DAG, preserve comments/NAGs and
   per-parent ordering.
5. **PGN export**: walk the DAG back into a canonical mainline plus
   variations, bounded, with a documented round-trip guarantee.
6. **Storage**: an additive Dexie schema **v14** (`repertoires`,
   `repertoireNodes`, `repertoireEdges`), repositories, and a
   repertoire-scoped deletion cascade.
7. A minimal, accessible **Repertoires management surface** limited to
   import, export, rename and delete (no board, no move editing).
8. A bounded, idempotent **reconcile** for referential integrity.
9. Deterministic domain/repository tests and fixtures, plus the full gate.

### Out of scope

- **Creator/editor UI** — browsing the DAG on a board, adding/removing
  moves, transposition UX, undo (Feature 023).
- **Opening identification / ECO / names** — the `chess-openings` dataset
  (Feature 022).
- **Training, review and scheduling** — the `Scheduler` from Feature 020 is
  not used here; opening attempts/schedules are Feature 024's concern.
- **Coverage/gap detection** (Feature 025), including the Lichess Explorer
  and its OAuth2 dependency.
- **Compliance over imported games** (Feature 026).
- **Engine evaluation** of repertoire moves (opening positions are
  engine-noisy; ADR-024 already excludes book/first-8-ply moves).
- **Sync wiring** — repertoire collections are not added to the ADR-016
  envelope in this feature (see "Synchronization posture").
- **Chess960 / variants** — standard chess only; the key still includes
  castling rights so a future variant scope needs no key migration.
- **Model games** (Feature 028).

## User-facing behavior

The primary deliverable is headless (domain, persistence, service). The
only user-facing surface is a minimal **Repertoires** page whose sole
functions are import, export, rename and delete. It is intentionally not
the creator: it renders no board and allows no move editing (Feature 023).

### 1. Repertoire list (minimal)

- Lists each stored repertoire with **name**, **side** (White/Black), node
  and edge counts, and last-updated time.
- Empty state is explicit text: **"No repertoires yet. Import a PGN to
  create one."** — never a bare zero.
- Per-repertoire actions: **Export**, **Rename**, **Delete**.
- Page action: **Import PGN**.
- The list is read-only with respect to moves; there is no board here.

### 2. Import PGN

- Import accepts a `.pgn` file (file picker) **or** pasted PGN text; the
  paste path is always available, so import never depends on a file dialog
  (keyboard/touch safe).
- Before importing the user chooses:
  - **Side** — White or Black (required; default none/undecided). This
    labels which moves are the user's to recall; the stored graph itself is
    side-agnostic.
  - **Name** — prefilled from the PGN `[White]`/`[Black]` headers or the
    filename; editable.
  - **Target** — create a new repertoire, or merge into an existing one of
    the same side.
- Import runs as a job with visible progress and is **cancellable**.
- On success the surface reports a summary: games parsed, nodes and edges
  added/merged, and any warnings (duplicate edges, transposition comments
  dropped, etc.). Warnings are text, not colour-only.
- On failure the surface shows a specific, actionable message (see "Error
  cases") and the repertoire is left unchanged — import is atomic.

### 3. Export PGN

- Export produces a single `.pgn` download and an equivalent
  **copy-to-clipboard** action (clipboard is a fallback, never the only
  path).
- The file name is derived from the repertoire name (sanitised).
- If the export hit the node budget and was truncated, the surface says so
  explicitly and the exported PGN is still valid.
- Export never mutates the repertoire.

### 4. Rename / delete

- Rename edits only the repertoire `name`.
- Delete requires an explicit **confirmation dialog** naming the repertoire,
  and cascades to its nodes and edges. The confirmation is a labelled
  dialog with focus management (not a hover-only affordance).

## Domain behavior

All of the following is **pure, deterministic domain code** — no React,
Dexie, engine, network, or hidden clock. The repositories are the only
place Dexie is touched.

### Canonical position key

```ts
type PositionKey = string; // canonical EPD

// chessops/fen: position.toSetup() emits a legal en-passant square only
// (chessops validEpSquare/legalEpSquare), so an ep square is present
// exactly when a legal en-passant capture exists.
function positionKeyOf(position: Position): PositionKey {
  return makeFen(position.toSetup(), { epd: true });
}
```

- The key contains **piece placement, side to move, castling rights, and
  en-passant only when legal**. Halfmove and fullmove counters are
  excluded (they differ across transpositions and are not position
  identity).
- The key is an EPD; `chessops/fen` `parseFen` accepts a four-field EPD
  (missing counters default to `0`/`1`), so a key round-trips through
  `parseFen` → `Chess.fromSetup`.
- Castling rights are part of the key (standard chess here; the field
  generalizes to Chess960 file-letters without a key change).
- `positionKeyOf` is **idempotent**: `positionKeyOf(parse(positionKey)) ===
  positionKey`.
- `POSITION_KEY_VERSION` versions the normalization. Changing it requires
  an explicit migration that recomputes stored keys and edges; it is never
  a silent rebuild (repertoire data is user data, not derived).

### Repertoire graph (DAG)

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

### Side selection and edge roles

- The graph is **side-agnostic**; `side` is repertoire metadata.
- `roleOf(edge, side) = turnOf(edge.fromKey) === side ? 'user' : 'opponent'`.
  `turnOf` reads the side-to-move field of the EPD key.
- Only `'user'` edges are recall targets (Feature 024); `'opponent'` edges
  are prompts/branches (Features 025/026).
- A repertoire whose `side` has no user edge is valid but reports a warning
  on import ("no moves for the selected side").
- Side is never used to prune the graph; changing it is a metadata edit.

### PGN import

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
     are **never silently dropped** (mirrors Feature 003 `validateReplay`).
   - compute `fromKey`, `toKey`, `moveUci`;
   - upsert the node(s) and the edge.
4. **Ordering**: children are visited in `node.children` order (mainline is
   `children[0]`, then variations). A new edge for a parent receives the
   next free `order`; an edge already present **keeps its order**.
5. **Annotations**: `[...startingComments, ...comments]` are appended to the
   edge's `comments` (exact duplicates removed, first-seen order kept);
   `nags` are unioned and sorted ascending. The game-level intro comment
   (`Game.comments`) seeds `Repertoire.comment` when the repertoire has
   none; headers seed `Repertoire.headers` on creation.
6. **Persistence** happens in a single Dexie transaction (atomic): either
   the whole import applies or none of it does.

Import is **idempotent**: importing the same PGN again adds no rows and
changes no annotations; merging a PGN whose root differs from the target
repertoire is rejected (`startMismatch`).

### PGN export

`exportRepertoirePgn(repertoire, nodes, edges) → { pgn, warnings }` (pure).

1. Group edges by `fromKey`; sort each group by `order` ascending (ties by
   `moveUci` for determinism).
2. Walk from `startKey`, building a `chessops` `Node<PgnNodeData>` tree
   **iteratively**. The first child is the mainline; the rest are RAV
   variations.
3. **Transposition handling**: export expands every occurrence of a
   position (duplicating shared continuations), so the full DAG content is
   preserved. When a position key has already been visited in this export,
   an informational `{transposes to <key>}` comment is attached to the edge
   that re-enters it.
4. **Bounds**: expansion stops at `MAX_EXPORT_NODES` and `MAX_EXPORT_PLIES`;
   a `truncated` warning is recorded and the branch ends as a leaf. The
   exported PGN is always syntactically valid.
5. Wrap in a `Game<PgnNodeData>`: stored headers plus the seven-tag roster
   and `[ChessRemedyRepertoire "<modelVersion>"]`,
   `[ChessRemedySide "<side>"]`; `makePgn` serialises it.
6. **Round-trip guarantee**: `import(export(r))` reproduces the same node
   set, edge set, per-parent ordering and annotations as `r`, provided the
   export was not truncated. Duplicated transposed continuations re-merge
   by position key on import.

### Merge, idempotence and reconcile

- `mergeGraphs(a, b)` is set-union with the deterministic annotation merge
  above and stable ordering. It is associative and idempotent, so repeated
  imports of overlapping lines converge.
- `reconcileRepertoire(repertoireId)` repairs referential integrity only:
  - a missing endpoint node is re-created when its position is derivable
    from the edge (`fromKey` + UCI → `toKey`, or a parseable key);
  - an edge whose `toKey` disagrees with `apply(fromKey, moveUci)` is
    dropped with a warning;
  - it never re-derives repertoire content from any source.
- Reconcile is bounded, idempotent and may run lazily on read or as a
  batched non-blocking step.

### Versioning

- `REPERTOIRE_MODEL_VERSION` covers graph/import-export semantics;
  `POSITION_KEY_VERSION` covers key normalization. Both are recorded on the
  repertoire (`modelVersion`; the key version is folded into the model
  version constant).
- An incompatible model change requires an explicit additive migration.
  Repertoire content is **authoritative user data**: it is never silently
  rebuilt or re-imported.
- Export stamps the model version in a PGN header for reproducibility
  (`ARCHITECTURE.md` §9 pattern).

## Data requirements

### New stores (schema v14)

`PERSISTENCE_SCHEMA_VERSION` becomes **14** (currently 13); a new `v14.ts`
migration creates the three stores additively with no backfill.
`database.ts`, the schema index, and the version-guard test are updated.

```ts
db.version(14).stores({
  repertoires: '&id, side, updatedAt',
  repertoireNodes: '&[repertoireId+positionKey], repertoireId',
  repertoireEdges: '&[repertoireId+fromKey+moveUci], [repertoireId+fromKey], repertoireId',
});
```

| Store | Key path | Indexes | Purpose |
| --- | --- | --- | --- |
| `repertoires` | `id` | `side`, `updatedAt` | Repertoire metadata and root |
| `repertoireNodes` | `[repertoireId, positionKey]` | `repertoireId` | Position set (transposition identity) |
| `repertoireEdges` | `[repertoireId, fromKey, moveUci]` | `[repertoireId+fromKey]`, `repertoireId` | Moves, ordering, annotations |

- Traversal by parent uses `[repertoireId+fromKey]`; per-repertoire counts
  use the `repertoireId` index. No reverse (`toKey`) index is required by
  this feature; add one only if a measured Feature 025/026 query needs it.
- Row shapes are the domain types above (timestamps as epoch millis;
  `comments`/`nags` as plain arrays).
- Rows carry `createdAt`/`updatedAt` following the schema-v12 merge
  convention, so a future sync merge has timestamps available.

### Invariants

- No edge may reference a missing node; no node may exist without a
  repertoire.
- Edge `toKey` must equal `apply(fromKey, moveUci)`.
- Every edge endpoint is reachable from `startKey` after reconcile (unused
  nodes are dropped).
- The root node always exists.

### Deletion and ownership

- Repertoire data is **user-authored**, not derived from a game or puzzle.
  Deleting a game (Features 007/008 cascade) must **not** delete or alter a
  repertoire.
- Deleting a repertoire cascades to its nodes and edges in one transaction
  (`deleteRepertoire(id)`); no orphan rows may remain.
- A future "repertoire from game" action (Feature 025/026) must not make
  the repertoire game-owned.

### Synchronization posture

- Repertoires are **local-only** in this feature. They are not added to the
  ADR-016 envelope.
- Consequence (documented, not a conflict): enabling repertoire sync later
  requires a new ADR-016 payload version with an `ENVELOPE_MIGRATIONS`
  transform, new `SyncCollectionName`/`SyncCollectionGroup` entries, and a
  new `TombstoneKind` (`'repertoire'`). The row timestamps required for the
  ADR-017 merge are already stored.
- Until then, **PGN export/import is the manual backup path** required by
  ADR-001's export/import posture.
- The ADR-018 engine cache is untouched (this feature performs no engine
  analysis).

### Settings

- No new settings are required. Import/export defaults (file name, last
  side) are presentation state and are not persisted as settings.

## States

- **Import job**: idle → reading → parsing → validating → persisting →
  completed | failed | cancelled.
- **Repertoire read**: loading → ready | empty (root only) | error |
  model-version unsupported (read-only; no mutation).
- **Repertoire integrity**: consistent | needs-reconcile | repaired |
  reconcile-failed (non-blocking notice).
- **Export**: idle → building → ready → downloaded | copied |
  truncated-warning | failed.
- **Storage**: available | quota-warning | quota-exceeded | blocked.
- **List**: loading | populated | empty | error.
- **Concurrent write**: clean | row-superseded (newer `updatedAt` observed;
  last-write-wins, reconcile may run).

## Error cases

The feature must never crash, fabricate content, or partially apply an
import.

- **Empty PGN** → `emptyPgn`; no rows written.
- **Parse failure** → `parseError` with the parser message.
- **Illegal move** → `illegalMove` with ply and SAN; the whole import is
  rejected (never silently dropped).
- **Unsupported variant** → `unsupportedVariant`; standard chess only.
- **Invalid/missing start FEN** → `invalidStartPosition`.
- **Multiple games with different roots** → `multipleStartPositions`.
- **Merge root mismatch** → `startMismatch`.
- **Oversized input** (node/ply/file budget exceeded) → `tooLarge`; no
  partial write.
- **File read failure / undecodable text** → `fileReadError`.
- **Storage quota exceeded / write blocked** → `storageError`; the
  transaction rolls back, no partial repertoire.
- **Duplicate edge with conflicting SAN** (same UCI, different SAN) → keep
  the existing SAN, record a warning.
- **Export of a missing repertoire** → `notFound`.
- **Export build failure** → `exportError`; the stored repertoire is
  unchanged.
- **Corrupt rows** (edge endpoint missing, `toKey` mismatch) → dropped or
  repaired by reconcile with a warning; never surfaced as a crash.
- **Two tabs importing/editing concurrently** → per-row last-write-wins by
  `updatedAt`; merges are idempotent, so no data is lost or duplicated.
- **Cancel mid-import** → the transaction never commits; no rows.

## Edge cases

- **Transposition** — two move orders reach the same position; one node,
  two inbound edges, one shared continuation.
- **En-passant normalization** — a FEN carrying an ep square no pawn can
  legally capture keys identically to the same position without it.
- **Castling rights** — identical boards with different rights are
  different keys (no false transposition).
- **Move counters** — positions differing only in halfmove/fullmove
  counters are one node.
- **Promotion** — the UCI carries the promotion piece (`e7e8q`); two
  promotions to different pieces are different edges.
- **Shared edge annotations** — the same edge discovered in several lines
  merges comments/NAGs deterministically; a re-import changes nothing.
- **Leaf position** — a node with no outgoing edges is valid and exported
  as a terminal.
- **Root-only repertoire** — valid; exports headers only.
- **Non-initial start position** — `[SetUp "1"]`/`[FEN]` roots are
  supported and preserved in `startFen`/`startKey`.
- **Side with no user moves** — valid with a warning; recall set is empty.
- **Very deep line** — traversal is iterative; no stack overflow.
- **Multi-game PGN with a shared root** — all games merge into one graph.
- **Re-import after edits** — merge is idempotent; existing `order` and
  annotations are preserved.
- **Export transposition duplication** — shared continuations repeat; a
  `transposes` comment marks re-entry; re-import re-merges.
- **Export truncation** — the PGN is valid and the warning is explicit.
- **Deleting a game** — leaves repertoires untouched.
- **Deleting a repertoire** — removes all its nodes/edges.
- **Model-version mismatch** — the repertoire is read-only until an
  explicit migration; it is never silently re-imported.

## Accessibility requirements

- The import file picker is a real labelled `<input type="file">`; pasted
  PGN is an equally discoverable labelled textarea. Import never depends on
  drag-and-drop or on a file dialog alone.
- Side selection is a labelled radio group (White/Black), keyboard- and
  touch-operable.
- Import progress and the result summary are announced via a polite live
  region; errors use `role="alert"`.
- Warnings (duplicate edge, truncation, no user moves) are **text**, never
  colour-only.
- The delete confirmation is a labelled dialog with initial focus on the
  safe action, focus trapped while open, and focus restored on close.
- **Export** and **copy to clipboard** are real labelled buttons;
  clipboard failure falls back to the download with an explanatory message.
- The empty state and all counts are explicit words/numbers, never a bare
  `0` standing in for "unknown".
- Light and dark themes meet contrast requirements; `prefers-reduced-motion`
  disables non-essential animation.

## Responsive / mobile requirements

- The repertoire list stacks on small viewports; rows expose their actions
  as touch targets ≥ ~44 px without hover.
- The import dialog is full-screen/scrollable on mobile; the paste path is
  primary there.
- Long names and counts wrap; no horizontal scrolling is introduced.
- Export/copy/delete controls stay reachable without precision pointing.
- The surface works on desktop, tablet and mobile in both themes.

## Performance constraints

- Import uses the **streaming/iterative** path and batched Dexie writes in
  one transaction; it must not freeze the UI for a large PGN. Processing
  yields to the event loop between batches (a worker is an acceptable
  implementation; it must not be required for correctness).
- Traversal is iterative (no recursion) and bounded by `MAX_IMPORT_NODES` /
  `MAX_IMPORT_PLIES`; exceeding the budget fails atomically.
- Position-key computation is O(1) per position; transposition de-dup uses
  the `[repertoireId+positionKey]` index, not a full scan.
- Traversal-by-parent uses the `[repertoireId+fromKey]` index; counting uses
  the `repertoireId` index.
- Export is bounded by `MAX_EXPORT_NODES` / `MAX_EXPORT_PLIES` so a heavily
  transposed repertoire cannot blow up; truncation is reported.
- The list page loads summaries (no graph) and computes counts with indexed
  `count()` queries; it never loads the whole graph to render.
- No engine, no network, no new bundle dependency; only `chessops` (already
  present) and browser file/clipboard APIs are used.

## Acceptance criteria

1. `positionKeyOf` produces a canonical EPD that includes castling rights
   and en-passant only when legal, excludes move counters, and is
   idempotent through `parseFen`/`Chess.fromSetup`.
2. The domain exposes repertoires, position-keyed nodes, and
   `(fromKey, moveUci)`-keyed edges with stored `toKey` and per-parent
   `order`; transpositions merge to one node.
3. `roleOf` derives `user`/`opponent` from the position's side to move and
   the repertoire side; the graph is never pruned by side.
4. PGN import parses via `chessops/pgn`, validates every SAN's legality,
   rejects unsupported variants/start positions/multi-root PGNs, preserves
   comments/NAGs and per-parent ordering, and is atomic and idempotent.
5. PGN export produces a valid mainline-plus-variations PGN with headers,
   is bounded, warns on truncation, and round-trips node set, edge set,
   ordering and annotations when not truncated.
6. Merge is associative and idempotent with a deterministic annotation
   merge; reconcile repairs referential integrity without re-deriving
   repertoire content.
7. Dexie schema **v14** adds `repertoires`, `repertoireNodes` and
   `repertoireEdges` additively; `PERSISTENCE_SCHEMA_VERSION` is 14 and the
   version guard/migration test pass.
8. Deleting a repertoire cascades to its nodes and edges in one
   transaction; deleting a game leaves repertoires untouched.
9. Repertoire data is local-only and absent from the ADR-016 envelope;
   PGN export/import provides the manual backup path.
10. The minimal Repertoires surface supports import (file or paste, side,
    name, target), export (download and copy), rename and delete with an
    explicit confirmation, plus explicit empty/warning/error states.
11. Accessibility and responsive requirements are met (labelled controls,
    live-region progress, text warnings, dialog focus management, mobile
    layout, both themes).
12. No new external dependency is introduced; only `chessops` and browser
    APIs are used.
13. ADR-036 is accepted and `domain/opening-repertoire.md` carries the
    canonical domain rules.
14. All changes are covered by automated tests and the full gate passes.

## Testing requirements

### Focused tests first

- **Position key**: en-passant legality normalization; castling-rights
  differences; move counters excluded; idempotence; promotion positions;
  non-initial FEN/EPD.
- **Graph**: node/edge identity; transposition de-dup; `toKey` invariant;
  `order` assignment and stability across merges; `roleOf`.
- **Import**: RAV flattening (mainline + nested variations); comments/NAGs
  merge; multi-game same-root merge; idempotent re-import; every error case
  (`emptyPgn`, `illegalMove`, `unsupportedVariant`, `invalidStartPosition`,
  `multipleStartPositions`, `startMismatch`, `tooLarge`).
- **Export**: mainline/variation reconstruction; deterministic ordering;
  transposition duplication + `transposes` comment; truncation warning;
  round-trip identity (`import(export(g)) ≡ g`) on non-truncated fixtures.
- **Merge/reconcile**: associativity/idempotence; missing endpoint repair;
  `toKey` mismatch drop; no content re-derivation.
- **Repository**: CRUD; indexed traversal/count; `deleteRepertoire`
  cascade; concurrent last-write-wins.
- **Migration**: v13 → v14 creates the stores additively with no data loss;
  the schema version guard.
- **Component**: import (file + paste), side/name/target, progress,
  success summary, error/warning text, export download/copy, rename,
  delete confirmation, empty state.

### Accessibility / responsive

- File input and paste textarea labels; radio group keyboard operation;
  live-region progress; `role="alert"` errors; dialog focus management;
  reduced motion; mobile list/dialog layout (Playwright where Chromium is
  available).

### Deterministic fixtures

- Repertoire PGN fixtures with: transpositions, multiple move orders,
  en-passant, castling-rights variants, promotions, comments/NAGs, nested
  variations, a non-initial start position, a root-only repertoire, a
  side with no user moves, a heavily transposed graph for the export
  budget, and a malformed/illegal PGN. Fixtures are deterministic and are
  not stored as user data.

### Narrow-first order

Run the focused domain/repository/component tests first, then the full gate
(`npm run lint`, `typecheck`, `format:check`, `test`, `build`, `dev`,
`test:browser` when Chromium is available, `npm audit`) per `AGENTS.md`.

## Dependencies

- Feature 003 — chess domain: `chessops` wrappers, `MoveList`/`PgnNode`,
  `resolveStartPosition`, `fenOf`, deterministic fixtures.
- Feature 001/004 — Dexie database, schema versioning/migration pattern,
  repository conventions.
- ADR-028 — chess rules/state/PGN via `chessops`.
- ADR-030 — `chessops/pgn` usage precedent (custom tree handling).
- ADR-001 — local-first; PGN export/import is the backup path.
- ADR-009 — testing stack.
- **ADR-036** — the opening-repertoire model (position-keyed DAG,
  canonical key, PGN round-trip semantics, storage/sync posture),
  accepted.
- **Domain specification** — `domain/opening-repertoire.md` carries the
  canonical rules above.
- **Schema change** — additive Dexie v14 (`repertoires`,
  `repertoireNodes`, `repertoireEdges`).
- **No new external dependency.** `chessops` and browser file/clipboard
  APIs only; the version follows the lockfile (Dependency policy — no pins
  in this spec).

## Conflicts, ambiguities & ADR assessment

### Conflict check (reported before any decision change)

- No current ADR is contradicted. The feature is explicitly future scope
  (`PRODUCT.md` §17) and anticipated by `ARCHITECTURE.md` §12.
- **ADR-031 / ADR-035 (scheduling)** are untouched: this feature has no
  scheduler and no attempts; opening training/review is Feature 024.
- **ADR-028 (chessops)** is followed (no chess logic is re-implemented).
- **ADR-001 (local-first)** is preserved; PGN export/import is the manual
  backup path.
- **ADR-016 (sync envelope)** is a closed, versioned collection list.
  Deferring repertoire sync is a documented migration implication, not a
  conflict: a later feature must bump the payload version with an
  `ENVELOPE_MIGRATIONS` transform and extend `SyncCollectionName` /
  `TombstoneKind`.
- **Documentation drift (resolved):** `ARCHITECTURE.md` §7 now records the
  current schema version (v13, Feature 020). This feature makes it v14 and
  updates that sentence accordingly.

### ADR-036 (accepted)

**ADR-036 — Opening Repertoire Model** is accepted and covers:

1. the **position-keyed DAG** repertoire model and node/edge identity;
2. the **canonical position key** (EPD; en-passant legal-only; castling
   rights included; move counters excluded) and its versioning;
3. the **PGN import/export round-trip** semantics (RAV flatten, canonical
   mainline + variations, bounded transposition expansion, idempotent
   merge);
4. the additive **schema v14** storage model and the local-only sync
   posture with the documented envelope-extension path.

The canonical rules live in `domain/opening-repertoire.md`.

### Ambiguities resolved with a recommended default

1. **Table shape** — normalized `repertoires` + `repertoireNodes` +
   `repertoireEdges` (not a document blob), so traversal is indexed, merges
   are record-level and a future sync merge is granular.
2. **Line snapshots** — none. Annotations live on edges, so the DAG is the
   single source of truth and export is derived; raw PGN snapshots are not
   stored.
3. **Multiple repertoires per side** — allowed; `side` is metadata.
4. **Metadata preservation** — per-edge comments (order-preserving,
   deduped) and NAGs (sorted union); game headers stored on the repertoire;
   game intro comment stored on the repertoire.
5. **Chess960** — out of scope; the key still includes castling rights so a
   future scope needs no key migration.
6. **Export transpositions** — expand every occurrence (content-preserving)
   with a `transposes` comment and a node/ply budget; a bounded tree beats a
   lossy single-expansion.
7. **Sync** — deferred; the row timestamps and documented envelope path
   keep it possible without a data migration.
8. **Minimal UI boundary** — import/export/rename/delete only; the
   board/editor is Feature 023.

## Context

Required reading (paths only; see `.opencode/CONTEXT-MAP.md`):

- `AGENTS.md`
- `.opencode/DECISIONS.md`
- `.opencode/specs/ARCHITECTURE.md` (§3 layers, §7 storage, §9 versioning,
  §10 performance, §12 future extensions)
- `.opencode/specs/PRODUCT.md` (§1, §17)
- `.opencode/specs/features/003-chess-domain.md`
- `.opencode/specs/domain/game-model.md`
- `.opencode/specs/decisions/ADR-001-local-first.md`
- `.opencode/specs/decisions/ADR-009-testing-stack.md`
- `.opencode/specs/decisions/ADR-028-chessops.md`
- `.opencode/specs/decisions/ADR-030-drop-pgn-viewer.md`
- `.opencode/specs/decisions/ADR-016-sync-file-format.md` (envelope posture)
- `.opencode/specs/decisions/ADR-036-opening-repertoire-model.md` (accepted)
- `.opencode/specs/domain/opening-repertoire.md`
- `.opencode/specs/research/opening-repertoire.md`

Feature dependencies: Feature 003 (chess domain/`chessops`), Feature 001/004
(Dexie schema/migration and repository conventions). Consumers: Features
022–028.
