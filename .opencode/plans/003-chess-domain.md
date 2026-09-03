# Implementation Plan — Feature 003 (Chess/Game Domain & Deterministic Fixtures)

Status: Approved with revisions (reviewer verdict; revisions applied in §17)
Target feature: `.opencode/specs/features/003-chess-domain.md`
Author: planner (no implementation work performed)

---

## 1. Objective

Define the core **domain** models for ChessRemedy — `Game`, `Player`,
`Move`, `Position`, `TimeControl`, `GameSource`, `GameResult`,
`Analysis`, `MoveAnalysis`, and `MoveList` — and provide a set of
**deterministic fixture games** so that every later application feature
(Game Import 007, Game Analysis 008, Classification 009, Tactical
Detection 010, Statistics 014, Dashboard 015, …) can be developed and
tested **without external APIs, IndexedDB, Stockfish, or real user data**.

Key architectural constraints this plan must satisfy:

- Domain logic is framework-agnostic and lives under `src/domain/`
  (`ARCHITECTURE.md` §3). Feature 003 contains *domain models*, not
  UI-specific representations (`003-chess-domain.md` §Goal).
- The `Game` model **wraps a chessops `PgnNode` tree directly**
  (`chessops/pgn`: `Node<PgnNodeData>` / `ChildNode<PgnNodeData>`),
  re-exporting it rather than translating it into a parallel structure
  (`ADR-028` consequences, `003-chess-domain.md` §PGN).
- PGN parsing uses `chessops/pgn` (`parsePgn`), never a custom parser.
- The canonical normalized time-control categories are
  `bullet | blitz | rapid | classical | correspondence | unknown`
  (`ADR-013`, `specs/domain/game-model.md`); the raw provider string is
  preserved verbatim; normalization is deterministic and versioned.
- Provider-specific identifiers/source info are preserved on the model
  without leaking Chess.com/Lichess data formats into domain consumers.
- Fixtures are deterministic, are separated from production data, and
  are never stored as user data.

No UI, storage, engine, or infrastructure behavior changes are part of
this feature.

---

## 2. Scope

### In scope (from `003-chess-domain.md` + `specs/domain/*`)

- Domain type definitions for `Game`, `Player`, `Move`, `Position`,
  `TimeControl`, `GameSource`, `GameResult`, `Analysis`,
  `MoveAnalysis`, `MoveList`, plus supporting unions/constants
  (`GamePhase`, `AnalysisState`, engine/WDL value types).
- A `Game` model whose move tree is a chessops `PgnNode` tree wrapper
  (`MoveList`), with no translation layer into a second move
  representation.
- A deterministic, versioned time-control normalizer over raw PGN
  `TimeControl` strings (`ADR-013`).
- A deterministic, extensible `GameSource` model + source normalizer.
- Domain functions to parse a raw PGN + import context into a domain
  `Game`, to validate legal replay, and to reconstruct per-move and
  per-position data (SAN, UCI, from/to, color, move number, FEN
  before/after) by replaying the chessops tree.
- Deterministic fixture games (raw PGN + descriptors) covering the
  matrix required by the spec, plus scenario fixture arrays
  (no games / one game / multiple games / mixed platforms / mixed time
  controls / multiple weeks) for later statistics & dashboard tests.
- Unit tests for all of the above.

### Out of scope (owned by later features)

- Local storage / IndexedDB schema for games (Feature 004) — the Dexie
  `v1` schema is untouched.
- Stockfish, engine service, analysis profiles runtime (Feature 005).
- Live analysis board, per-game review UI, move-list UI rewiring
  (Features 006/008). Feature 002's UI `MoveList` component and
  `positionTree` are **not modified**.
- Game import adapters for Chess.com/Lichess (Feature 007). The parser
  built here is the domain-facing contract those adapters will call.
- Game analysis pipeline, position extraction, phase tagging
  (Feature 008), move classification (Feature 009), tactical detection
  (Feature 010), statistics (Feature 014).
- Any UI page/route, theme, or board change.

---

## 3. Specification Notes & Open Decisions for Reviewer

This feature's spec and the domain specs are deliberately terse. The
following decisions are **not pinned by any spec or ADR**. They are
proposed here so the reviewer can confirm or override them before
implementation starts. **The plan should not be approved without
explicit acknowledgement of D1–D8.**

| # | Open question | Proposed choice | Rationale |
|---|---------------|-----------------|-----------|
| D1 | Domain module layout | `src/domain/chess/` with small modules: `gameSource.ts`, `timeControl.ts`, `game.ts`, `player` folded into `game.ts`, `position.ts`, `moveList.ts`, `move.ts`, `analysis.ts`, `parseGame.ts`, plus `fixtures/`. Barrel `index.ts`. | `src/domain/chess/` already exists empty (created in anticipation); one module per aggregate keeps types small and testable; mirrors existing `src/components/chessboard/` granularity. |
| D2 | `Game` player field shape | `whitePlayer: Player` and `blackPlayer: Player` where `Player = { name: string; rating: number \| null }`. This folds `whiteRating`/`blackRating` from `specs/domain/game-model.md` into `Player.rating`. **Review revision (M1):** the required follow-up spec edit is a genuine reconciliation of `game-model.md`'s required-property list — the `whiteRating`/`blackRating` bullets must be removed/reworded to point at `Player.rating` (a 2-line deletion + note, §5.3), **not** a one-line annotation, otherwise the list stays contradictory. | The feature spec mandates a `Player` model; a nested value object avoids parallel `white/black` scalar pairs and reads cleanly in statistics/puzzle provenance. Alternative (flat `whitePlayer: string` + `whiteRating`) is acceptable if the reviewer prefers zero spec drift — implementer must then still export a `Player` type. |
| D3 | Relationship to Feature-002 move tree | The domain `MoveList` is **additive**: a wrapper over the chessops `Node<PgnNodeData>` root produced by `parsePgn`. Feature 002's `MoveTree`/`MovePly`/UI `MoveList` and the playground are left untouched in this feature. Domain `Game` objects are the canonical input for later features; convergence of the UI move-list on the domain tree happens when a real review/analysis surface consumes games (Feature 006/008). | `003-chess-domain.md` says the domain contains "models, not UI-specific representations", and its AC is about later features *receiving* domain objects. Rewiring the working Feature-002 UI now would cross feature boundaries and churn accepted behavior. Risk of temporary duplication is recorded in §13. |
| D4 | Time-control normalization (v1) | `normalizeTimeControl(raw)`: (1) empty / `-` / `?` / unparseable → `unknown`; (2) regex `^\d+\/\d+$` (per-move days, e.g. Lichess/Chess.com correspondence `1/172800`, `1/259200`) → `correspondence`; (3) otherwise parse `initial` or `initial+increment` (seconds), compute reference `t = initial + 40*increment` when `increment > 0` else `t = initial`; (4) `t ≤ 179` → `bullet`, `180 ≤ t ≤ 479` → `blitz`, `480 ≤ t ≤ 1499` → `rapid`, `t ≥ 1500` → `classical`. Mapping versioned as `TIME_CONTROL_NORMALIZATION_VERSION = 1`. | ADR-013 fixes the category set but not the string→category mapping. A single platform-independent table keeps statistics comparable (ADR-013: never silently mix time controls). `x/y` correspondence and `-` unknown handling match observed provider exports; boundaries approximate the Lichess 40-move formula (bullet/blitz/rapid/classical) which agrees with Chess.com's rapid/classical split for standard controls. Implementation must verify with real provider exports during Feature 007 and bump the version if a rule changes. |
| D5 | `GameSource` semantics + fixture provenance | `GameSource = 'chesscom' \| 'lichess' \| 'local' \| 'fixture'` (in the spirit of `ARCHITECTURE.md` §12 + feature spec §Game source). `Game.source` is the **platform/origin dimension** that statistics (Feature 014) group by. Deterministic **fixture** games that must look like Chess.com/Lichess/Local imports therefore carry `source: 'chesscom' \| 'lichess' \| 'local'`; `'fixture'` is reserved for self-generated sample content and at least one fixture exercises it. Data provenance ("this Game came from the fixtures module") is expressed by module location under `fixtures/`, never by tagging real-user provenance onto simulated platform games. | Feature-014 fixtures require platform separation for rating history tests; if every fixture game had `source: 'fixture'` the platform dimension could never be tested. |
| D6 | `MoveList` / `Move` / `Position` shape | `MoveList = { startFen: string; root: Node<PgnNodeData> }` plus pure helpers (mainline, node-at-path, legal-replay validation). `Move` is a **derived record** (not stored in the node): SAN, UCI, from/to squares, promotion, color, full-move number, ply, `fenBefore`, `fenAfter`, NAGs, comments, produced deterministically by replaying from `startFen`. `Position` is the chessops `Position` type re-exported from the domain plus `fen↔Position` helpers. Paths through the tree are child-index chains (`NodePath = readonly number[]`). | chessops `PgnNodeData` stores only SAN/comments/NAGs; positions and FENs are contextual and must be replayed. Deriving them on demand (no mutation, no per-node caching) is deterministic and keeps `Game` cheap. Mirrors the replay discipline already proven in `positionTree.ts`. |
| D7 | `Game.id` | `GameId = string`, produced by `makeGameId(source, externalId, pgn)`: `'chesscom:<externalId>'`, `'lichess:<externalId>'`; for `local`/`fixture` a stable FNV-1a hash over the normalized PGN text prefixed by source. | `specs/domain/game-model.md` requires stable identity across repeated imports without defining a scheme. Provider games are uniquely identified by provider id; PGN-hash keeps local/fixture imports dedupe-able. Feature 007/004 own the definitive dedupe policy and may reuse this id as the storage key. |
| D8 | `playedAt` for dateless PGN | `playedAt: string \| null` — ISO-8601 UTC when the PGN carries `UTCDate`/`UTCTime` (or `Date`), `null` when the date is absent/unknown (`????.??.??`). | Real provider exports always have dates; local PGN files may not. Statistics must distinguish missing date from a real value (`014` empty-state rule). The game-model.md required-property list is preserved (`playedAt` present; value may be null). |

---

## 4. Existing Code to Reuse

### Libraries already installed (no new runtime dependencies)

`chessops@0.15.1` (in `package.json`, ADR-028). The implementation
relies on:

- `chessops/pgn`: `parsePgn`, `makePgn`, `startingPosition`,
  `setStartingPosition`, types `Node`, `ChildNode`, `PgnNodeData`,
  `Game` (chessops' own parsed-game type — imported under an alias to
  avoid clashing with the domain `Game`).
- `chessops/fen`: `parseFen`, `makeFen`.
- `chessops/chess`: `Chess`, `Position` (re-exported as the domain
  `Position` concept).
- `chessops/san`: `parseSan`, `makeSan`.
- `chessops/util`: `makeSquare`, `parseSquare`, `makeUci`, `parseUci`.
- `chessops/types`: `Color`, `Role`, `Move`/`NormalMove` (internal use).

### Existing code to reuse (patterns, not imports)

| Artifact | What to take |
|---|---|
| `src/components/chessboard/positionTree.ts` | Proven chessops idioms: parse PGN → resolve start position from headers (`pgnStartingPosition`) → recursively replay `child.data.san` with `parseSan`/`position.isLegal`/`position.play`; error-surfacing `BuildResult`-style results (`{ ok }` / `{ error }`). The domain layer **must not import** this UI module; it reuses the same idiom in a UI-independent module. |
| `src/domain/chess/` (empty directory) | Intended home for the new domain modules. |
| `src/components/chessboard/playgroundFixtures.ts` | Pattern for deterministic fixture modules (typed `as const` arrays, `findFixture`, no IndexedDB access). Domain fixtures follow the same discipline but produce full `Game` objects. |
| `src/infrastructure/db/database.ts` + `schema/` | **Reference only** — must remain untouched (v1 `settings` table). |
| `.opencode/plans/001-foundation.md` | Plan structure/format precedent (open-decision table, acceptance mapping, verification commands). |

### Existing code explicitly NOT reused / NOT touched

- `src/components/chessboard/MoveList.tsx`, `MoveList.module.css`,
  `positionTree.ts`, `Navigation.tsx`, playground pages — Feature 002
  UI, unchanged by this plan (D3).
- `pgnAnnotations.ts` (NAG glyph → colour map) is a UI concern; domain
  keeps NAGs as raw `number[]` from chessops.
- Any Dexie schema, route, page, or hook.

---

## 5. Files / Modules to Create or Modify

All paths relative to repository root. **No existing application file
is modified.** The only non-`src` change is an optional spec-doc edit
(§5.3) gated on D2.

### 5.1 Domain modules (new)

```
src/domain/chess/
├── index.ts                  # Public barrel for all domain models & fixture exports
├── gameSource.ts             # GameSource union, labels, normalizeGameSource()
├── timeControl.ts            # TimeControlCategory, TIME_CONTROL_CATEGORIES,
│                             #   TIME_CONTROL_NORMALIZATION_VERSION,
│                             #   NormalizedTimeControl, normalizeTimeControl()
├── game.ts                   # GameId, GameResult, GameOutcome, Player, Game,
│                             #   outcomeOf(), makeGameId()
├── position.ts               # Re-export chessops Position; parsePositionFen(),
│                             #   fenOf(), positionToFen(), resolveStartPosition()
├── moveList.ts               # MoveList { startFen; root: Node<PgnNodeData> },
│                             #   NodePath, PgnNode alias; createMoveList(),
│                             #   mainlineNodes(), nodeAtPath(), validateReplay()
├── move.ts                   # Move record + mainlineMoves(), movesToPath(),
│                             #   positionAtPath()
├── analysis.ts               # GamePhase, AnalysisState, AnalysisProfile, Wdl,
│                             #   EngineMetadata, MoveAnalysis, Analysis
├── parseGame.ts              # ImportContext, GameParseError, gameFromPgn()
│
└── fixtures/
    ├── defs.ts               # GameFixtureDef descriptors + raw PGN constants
    ├── games.ts              # FIXTURE_GAMES (built Game[]), fixtureGame(id),
    │                         #   fixtureGamesByTag(tag)
    ├── scenarios.ts          # Fixture scenario arrays (empty/single/multi/
    │                         #   mixedPlatforms/mixedTimeControls/multiWeek)
    └── index.ts              # Fixture barrel
```

### 5.2 Tests (new, colocated)

```
src/domain/chess/
├── gameSource.test.ts
├── timeControl.test.ts
├── game.test.ts              # Game/result/outcome/id helpers
├── position.test.ts          # FEN↔Position helpers, start-position resolution
├── moveList.test.ts          # tree wrapper, paths, mainline, replay legality,
│                             #   comment/NAG retention, PGN round-trip
├── move.test.ts              # move reconstruction (SAN/UCI/FEN before+after)
├── parseGame.test.ts         # PGN → Game, header mapping, errors, determinism
├── analysis.test.ts          # Model construction invariants (types behave)
└── fixtures/
    └── fixtures.test.ts      # Fixture integrity + coverage matrix (§10)
```

### 5.3 Documentation (optional, gated on D2)

| Path | Change |
|---|---|
| `.opencode/specs/domain/game-model.md` | If D2's nested `Player` shape is approved: **reconcile** the required-property list — remove/reword the `whiteRating`/`blackRating` bullets to state ratings live on `Player.rating`. A one-line annotation is insufficient (reviewer M1). Otherwise no change. |

No other spec/ADR files change. ADR-013's "mapping is versioned" is
implemented by `timeControl.ts` constants rather than a spec edit; if
the reviewer prefers the mapping documented in ADR-013, that becomes a
tiny follow-up edit and must be called out at review time.

---

## 6. Domain / Data Changes

### 6.1 Types (proposed shape)

`gameSource.ts`

```ts
export const GAME_SOURCES = ['chesscom', 'lichess', 'local', 'fixture'] as const;
export type GameSource = (typeof GAME_SOURCES)[number];
export function normalizeGameSource(input: string): GameSource | null;
// Accepts, case-insensitively:
//   chess.com | chesscom | chess-com → 'chesscom'
//   lichess | lichess.org            → 'lichess'
//   local | pgn | imported           → 'local'
//   fixture                          → 'fixture'
// Anything else → null (parser rejects with an error).
```

`timeControl.ts`

```ts
export const TIME_CONTROL_CATEGORIES = [
  'bullet', 'blitz', 'rapid', 'classical', 'correspondence', 'unknown',
] as const;
export type TimeControlCategory = (typeof TIME_CONTROL_CATEGORIES)[number];
export const TIME_CONTROL_NORMALIZATION_VERSION = 1;
export interface NormalizedTimeControl {
  readonly category: TimeControlCategory;
  readonly version: number;            // always 1 until the mapping changes
}
export function normalizeTimeControl(raw: string): NormalizedTimeControl;
```

`game.ts`

```ts
export type GameId = string;
export type GameResult = '1-0' | '0-1' | '1/2-1/2' | '*';
export type GameOutcome = 'whiteWins' | 'blackWins' | 'draw' | 'unknown';

export interface Player {
  readonly name: string;
  readonly rating: number | null;      // provider Elo at game time
}

export interface Game {
  readonly id: GameId;                 // D7
  readonly source: GameSource;         // platform dimension for statistics
  readonly externalId: string | null;  // provider game id (null for local/fixture)
  readonly playedAt: string | null;    // ISO-8601 UTC or null (D8)
  readonly whitePlayer: Player;        // D2
  readonly blackPlayer: Player;        // D2
  readonly result: GameResult;
  readonly timeControl: string;        // raw provider string, verbatim
  readonly normalizedTimeControl: TimeControlCategory;
  readonly userColor: Color;           // 'white' | 'black'
  readonly pgn: string;                // original raw PGN text
  readonly moves: MoveList;            // chessops PgnNode wrapper (§6.2)
}

export function outcomeOf(result: GameResult): GameOutcome;
export function makeGameId(source: GameSource, externalId: string | null, pgn: string): GameId;
```

`analysis.ts`

```ts
export type GamePhase = 'opening' | 'middlegame' | 'endgame';
export type AnalysisState = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type AnalysisProfile = 'fast' | 'normal' | 'tactical' | 'deep'; // ADR-012 table

export interface Wdl { readonly w: number; readonly d: number; readonly l: number; } // per-mille, ADR-019

export interface EngineMetadata {
  readonly engineName: string;      // e.g. 'stockfish'
  readonly engineVersion: string;   // engine release (ADR-020)
  readonly engineBuild: string;     // e.g. 'stockfish-18-lite-single'
  readonly profile: AnalysisProfile;
}

export interface MoveAnalysis {
  readonly id: string;
  readonly gameId: string;
  readonly ply: number;                     // ply of the analyzed position (0 = start)
  readonly fen: string;                     // FEN of the analyzed position
  readonly playedMove: { san: string; uci: string } | null; // null at terminal position
  readonly bestMove: { san: string; uci: string } | null;
  readonly evalCp: number | null;           // side-to-move perspective (ADR-019)
  readonly evalMate: number | null;
  readonly wdl: Wdl | null;                 // null for the fast profile
  readonly principalVariation: readonly string[];  // UCI moves
  readonly legalMovesCount: number | null;
  readonly phase: GamePhase;
  readonly engine: EngineMetadata | null;
  readonly analysisVersion: number;
  readonly analyzedAt: number | null;       // epoch millis
  // Feature 009/010 add classificationVersion/classification/missedTactic/puzzleId later.
}

export interface Analysis {
  readonly id: string;
  readonly gameId: string;
  readonly state: AnalysisState;
  readonly moves: readonly MoveAnalysis[];
  readonly analysisVersion: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}
```

> These two are **model definitions only**. Nothing in this feature
> produces engine data. The shapes follow `specs/domain/analysis-model.md`
> (concept list, with one caveat — see below), ADR-018 (engine/cache
> fields), ADR-019 (`evalCp` / `evalMate` / `wdl`), and ARCHITECTURE.md §9
> (versioning). Profile tokens come from the ADR-012 table. Later
> features add fields via `// Feature NN …` extension points.
>
> **Caveat (reviewer L4):** the shape above does **not** yet cover the
> `analysis-model.md` "evaluation before / evaluation after / evaluation
> delta" concepts — it carries only the position's own
> `evalCp/evalMate/wdl` and `bestMove`. Those resulting-position
> evaluations are the ADR-023/024 `wpLoss` inputs and arrive with
> Features 008/009 (either as eval-delta fields on `MoveAnalysis` or
> computed across adjacent records + cache lookups). Until then the
> shape is a minimal-but-stable base, not the complete analysis-model
> surface.

### 6.2 `MoveList` — chessops PgnNode wrapper (ADR-028)

```ts
// moveList.ts
import type { Node, ChildNode, PgnNodeData } from 'chessops/pgn';

export type PgnNode = ChildNode<PgnNodeData>;
export type NodePath = readonly number[];   // child-index chain; [] = start position

export interface MoveList {
  readonly startFen: string;                // canonical FEN before any move
  readonly root: Node<PgnNodeData>;         // the chessops tree itself (no copy)
}

export function createMoveList(root: Node<PgnNodeData>, startFen: string): MoveList;
export function mainlineNodes(list: MoveList): readonly PgnNode[];      // first-child chain
export function nodeAtPath(list: MoveList, path: NodePath): Node<PgnNodeData> | null;
export function validateReplay(list: MoveList): readonly string[];      // illegal-SAN messages, all branches
```

- The `Game.moves` value **is** a `MoveList` whose `root` is the
  `Node<PgnNodeData>` returned by `parsePgn` — no per-node copying, no
  translation layer (D6). NAGs and comments stay on the nodes as
  `number[]` / `string[]` and are round-trippable via `makePgn`
  (semantic round-trip test — see L1 note below).
- `NodePath` (child-index chain) is the stable addressing scheme the
  move-list UI and analysis pipeline will later use to seek/annotate.

**Comment-representability scope (reviewer L2):** comments in a PGN
live in two places — the game-level intro comment (before `1.`) is
stored by chessops on the parsed `Game`'s `comments`, **not** on any
`PgnNodeData`; per-node `PgnNodeData.startingComments` (comments
preceding that node's move, incl. the first move) and `comments` live
on the node. The domain `MoveList = { startFen; root }` therefore
cannot carry a game-level intro comment — that text is preserved only
in `Game.pgn` (no information is lost at the `Game` level). Move
reconstruction (§6.3) folds `startingComments` + `comments` of a node
into the derived `Move.comments` so they are not silently dropped.
"Comment retention" claims in §10 are scoped to move-attached
comments.

### 6.3 `Position`, `Move` — replay-derived values

```ts
// position.ts — re-export + helpers (all deterministic, error-surfacing)
export type { Position } from 'chessops/chess';
export type FenResult =
  | { ok: true; position: Position }
  | { ok: false; message: string };
export function parsePositionFen(fen: string): FenResult;
export function fenOf(position: Position): string;
export function resolveStartPosition(headers: ReadonlyMap<string, string>): FenResult;
// wraps chessops/pgn startingPosition; honours [SetUp "1"] + [FEN "…"] headers
```

```ts
// move.ts
export interface Move {
  readonly san: string;
  readonly uci: string;                    // via chessops makeUci
  readonly from: string;                   // square name e.g. 'e2'
  readonly to: string;
  readonly promotion: Role | undefined;
  readonly color: Color;                   // mover == side to move at fenBefore
  readonly fullMove: number;               // 1-based (white/black pairs)
  readonly ply: number;                    // 0-based ply within the traversed line
  readonly fenBefore: string;
  readonly fenAfter: string;
  readonly nags: readonly number[];
  readonly comments: readonly string[];
}
export function mainlineMoves(list: MoveList): readonly Move[];   // validation first
export function movesToPath(list: MoveList, path: NodePath): readonly Move[];
export function positionAtPath(list: MoveList, path: NodePath): Position;
```

The spec's move-reconstruction contract (`position before`, `move
played`, `position after`, `move number`, `side to move`, `SAN`, `UCI
where available`) maps 1:1 onto `Move`.

### 6.4 `parseGame.ts` — PGN → domain `Game`

```ts
export interface ImportContext {
  readonly source: GameSource;
  readonly externalId?: string;    // required for chesscom/lichess
  readonly userColor?: Color;      // explicit side (local imports)
  readonly username?: string;      // else derive side by matching White/Black
}

export type GameParseResult =
  | { ok: true; game: Game }
  | { ok: false; error: { code: GameParseErrorCode; message: string; ply?: number } };

export type GameParseErrorCode =
  | 'parseError'      // defensive: chessops does not currently throw on
                      //   malformed input (it skips invalid tokens), so this
                      //   branch is effectively unreachable but kept as a guard
  | 'noGame'          // zero games parsed from the text (empty/whitespace-only)
  | 'noMoves'         // first parsed game has zero moves AND Result '*' — i.e.
                      //   arbitrary non-PGN text that parses to a placeholder
                      //   game, or a header-less movetext-less body
  | 'invalidSource'   // normalizeGameSource returned null
  | 'missingExternalId'
  | 'ambiguousColor'  // username matched neither header, and no userColor
  | 'illegalMove';    // SAN in tree (any variation) is not playable from start

export function gameFromPgn(rawPgn: string, ctx: ImportContext): GameParseResult;
```

**Empty / garbage-PGN contract (reviewer M2), pinned against verified
`chessops@0.15.1` behavior:** `parsePgn('')` yields 0 games → `noGame`.
Arbitrary non-PGN text yields **1 game with 0 children** and
synthesized placeholder headers (`White "?"`, `Result "*"`). To avoid
accepting garbage as a domain `Game`, `gameFromPgn` inspects the first
parsed game: if it has **no moves and `Result` is `*`** → `noMoves`
(rejects placeholder content). A genuinely zero-move game carrying a
real result header (e.g. a forfeit/abandoned game ending `1-0`) has no
movetext by nature but is a legitimate import and **is accepted** as a
`Game` with an empty `MoveList` — blanket rejection would be wrong.
Header-less movetext-only bodies are accepted like any other game.

Header mapping: `White`/`Black`/`WhiteElo`/`BlackElo`/`Result`/
`TimeControl`/`UTCDate`/`UTCTime` (fallback `Date`/`Time`)/`Link`/…;
`playedAt` per D8; `externalId` from context (never guessed from text);
`startFen` from `[SetUp]+[FEN]` headers else the standard start;
full-tree legality enforced via `validateReplay` before a `Game` is
returned (matching the "inconsistent PGN surfaces an error instead of
being silently fixed" rule from Feature 002's fixture tests).

### 6.5 Fixtures (`fixtures/`)

`GameFixtureDef` (in `defs.ts`):

```ts
export const FIXTURE_TAGS = [
  'userBlunder', 'opponentBlunder', 'missedTactic', 'clean',
  'short', 'long', 'opening', 'middlegame', 'endgame',
] as const;
export type FixtureTag = (typeof FIXTURE_TAGS)[number];

export interface GameFixtureDef {
  readonly id: string;            // e.g. 'cc-bullet-blunder'
  readonly label: string;         // human description
  readonly source: GameSource;    // simulated platform (D5); incl. one 'fixture'
  readonly externalId: string | null;
  readonly userColor: Color;
  readonly pgn: string;           // complete, provider-style PGN text
  readonly tags: readonly FixtureTag[];
  readonly note?: string;         // e.g. 'ply 7: White hangs the queen (Nf6?? allows Qxf7#)'
}
```

The **proposed fixture set** (13 games; raw PGN content is authored
during implementation and must replay legally; every PGN is checked by
`fixtures.test.ts`):

| id | source | TC (raw) | result (user) | length | tags / purpose |
|----|--------|----------|---------------|--------|----------------|
| `cc-bullet-blunder` | chesscom | `60` | loss | short | user (White) blunders → `0-1`; `userBlunder` |
| `cc-blitz-clean` | chesscom | `300+0` | win | mid | user (Black) clean win; `clean`, `middlegame` |
| `cc-rapid-missed-tactic` | chesscom | `600+5` | draw | mid | user (White) misses a fork, still draws; `missedTactic` |
| `cc-classical-endgame` | chesscom | `1800` | win | long | user (White) long endgame win; `long`, `endgame`, `opponentBlunder` |
| `li-bullet-missed-mate` | lichess | `60` | win | short | user (White) misses mate-in-1, still wins; `missedTactic` |
| `li-blitz-blunder` | lichess | `300+2` | loss | short | user (Black) drops a rook; `userBlunder` |
| `li-rapid-clean` | lichess | `600+5` | draw | mid | user (Black) clean draw; `clean` |
| `li-classical-clean-win` | lichess | `1800` | win | long | user (White) long clean win; `clean`, `long`, `opening` |
| `li-correspondence` | lichess | `1/259200` | win | long | user (Black) correspondence win; `correspondence` |
| `local-short-unknown-tc` | local | *(absent)* | loss | short | no `TimeControl` header → `unknown`; `short`, `userBlunder` |
| `local-fen-endgame` | local | `900+10` | draw | mid | `[SetUp "1"] [FEN "…"]` start; endgame example; exercises FEN start |
| `local-missing-rating` | local | `300` | win | short | `WhiteElo "?"` → null rating; rating-missing edge case |
| `fx-sample-mate` | fixture | `1800` | win | short | source `'fixture'`; mating endgame; exercises `'fixture'` branch |

Coverage guarantees the fixture-integrity test asserts:

- both providers (≥2 each), ≥1 `local`, ≥1 `fixture`;
- every normalized TC category: bullet, blitz, rapid, classical,
  correspondence, unknown;
- game results cover a user win, a user loss, and a draw;
- tags `userBlunder`, `missedTactic`, `clean`, `short`, `long`,
  `opening`, `middlegame`, `endgame` each occur on ≥1 game;
- `userColor` both sides occur;
- game dates span ≥ 4 distinct ISO weeks (for Feature-014 weekly
  trend tests) using fixed past dates, e.g. 2026-05-25 … 2026-06-22
  (W22–W26), authored as `UTCDate`/`UTCTime` headers;
- games that carry blunder intent mark the blunder move with a `??`
  / `$4` NAG so the intent is machine-checkable and NAG round-trip is
  exercised on real content.

`games.ts` builds `FIXTURE_GAMES: readonly Game[]` at module load by
calling `gameFromPgn` on each def (throws on parse failure so a bad
fixture fails fast at import).

> **Fixture-id note (reviewer L3):** a fixture simulating Chess.com
> carries `id = 'chesscom:<externalId>'` — indistinguishable from a real
> import at the data level. That is acceptable **only** because the spec
> forbids persisting fixtures as user data; fixture `Game`s are never
> written to IndexedDB and live solely under `fixtures/`.
>
> `scenarios.ts` exports:

```ts
export const fixtureScenarios = {
  noGames: [] as const,
  singleGame: [/* cc-blitz-clean */] as const,
  multipleGames: [/* 3–4 games */] as const,
  mixedPlatforms: [/* chesscom + lichess + local */] as const,
  mixedTimeControls: [/* bullet + blitz + rapid + classical + correspondence */] as const,
  multipleWeeks: [/* ≥ 4 distinct ISO weeks */] as const,
} as const;
```

### 6.6 Data model (Dexie)

**None.** `database.ts`, `schema/v1.ts`, `PERSISTENCE_SCHEMA_VERSION`
(remains `1`), and `SETTINGS_KEYS` are untouched. Game persistence is
Feature 004.

---

## 7. UI Changes

**None.** No React component, page, route, CSS module, or hook changes.
The playground, its fixtures, and the Feature-002 `MoveList` component
keep working unchanged. This feature is verifiable entirely through
unit tests (no DOM needed).

---

## 8. Infrastructure Changes

**None.**

- No Vite/TS/ESLint/Prettier/Playwright config changes.
- No `public/`, worker, or PWA changes.
- No database/version changes.
- No network/service/adapter code (Chess.com/Lichess adapters are
  Feature 007).

The domain folder is pure TypeScript with no browser-only APIs, so it
runs identically under `happy-dom`, `node`, and browsers.

---

## 9. Dependencies

**No new dependencies** (runtime, dev, peer, or optional) are added.

- `chessops@0.15.1` is already a runtime dependency (ADR-028) and is
  the only chess library used.
- No `@badrap/result` import: chessops returns its own `Result`
  objects, and all domain-facing helpers wrap them into the project's
  own small discriminated unions (`{ ok: true; … } | { ok: false; … }`)
  so `@badrap/result` stays an undeclared transitive detail.
- No hashing library: `makeGameId` uses an inline FNV-1a
  implementation (≈15 lines, no dependency).
- `msw`, `stockfish`, `recharts`, FSRS, and sync packages remain with
  their owning features.

---

## 10. Tests

Mapped from the spec's test list (`003-chess-domain.md` §Tests). All
tests are pure Vitest unit tests (no DOM, no IndexedDB, no network).

| Spec requirement | Test file(s) | What is asserted |
|------------------|--------------|------------------|
| PGN parsing | `parseGame.test.ts`, `moveList.test.ts` | `gameFromPgn` parses provider-style PGNs (Chess.com + Lichess header shapes); `mainlineNodes` matches the authored move list; **empty/whitespace-only text → `noGame`; arbitrary non-PGN text → `noMoves` (zero moves + `Result '*'`); zero-move forfeit with a real result header → accepted empty `MoveList`** (M2); header-less movetext-only accepted; multi-game text → first game (M2). |
| Nested variations (PgnNode tree) | `moveList.test.ts` | A PGN with RAV variations (`( … )`) keeps the variation as sibling nodes under the correct parent; `nodeAtPath` reaches mainline and variation nodes; SAN counts per node correct. |
| Comment / NAG round-trip | `moveList.test.ts` | **Semantic** (not byte) equality through parse → `makePgn` → re-parse (L1): NAGs stay equal as `number[]`, comment text equal after trimming (`makePgn` normalizes surrounding whitespace and reformats move numbers, so string equality is wrong); scope is **move-attached** comments + `startingComments` folded into the first derived `Move.comments` (L2). |
| Game reconstruction | `parseGame.test.ts` | Headers map to `whitePlayer.name/.rating`, `blackPlayer.*`, `result`, `timeControl`, `normalizedTimeControl`, `playedAt`, `externalId`, `source`, `userColor`; `[SetUp]/[FEN]` start positions; illegal SAN anywhere → `illegalMove` error; identical input → byte-identical `Game` fields (determinism), incl. an explicit assertion that `makeGameId` is identical across two parses of the same PGN. |
| Move reconstruction | `move.test.ts` | For known games: SAN, UCI, from/to, color, `fullMove`, `ply`, `fenBefore`/`fenAfter` match a precomputed expectation table (spot-check several plies incl. castling/promotion/capture); **`mainlineMoves`/`movesToPath` reject an illegal SAN before returning derived `Move`s** (explicit case, L5b). |
| Time-control normalization | `timeControl.test.ts` | Table-driven: `60`→bullet, `180`→blitz boundary, `300`/`300+0`→blitz, `600+5`→rapid, `1800`→classical, `1/172800`/`1/259200`→correspondence, ``/`-`/`?`/garbage→unknown; version `1` on every result; determinism. |
| Source normalization | `gameSource.test.ts` | `chess.com`, `CHESSCOM`, `lichess.org` etc. normalize correctly; unknown → `null`; label map covers all four sources. |
| FEN reconstruction | `position.test.ts`, `move.test.ts` | `parsePositionFen`/`fenOf` round-trip; replay FENs along a mainline equal independent `parseFen`-verified FENs; `[FEN]`-header games start from the header position. |
| Fixture integrity | `fixtures/fixtures.test.ts` | Every def parses and replays legally (mainline + variations); `Game` fields match the def (source, TC + category, result, userColor, externalId); ids unique and stable across repeated module loads; coverage matrix of §6.5 (sources, TC categories incl. `unknown`, results, tags, both colors, ≥4 ISO weeks); NAG-intent assertions — `userBlunder` games contain a `??`/`$4` on a user-colored ply, and **`clean` games contain no `??`/`$4` on any ply, user- or opponent-colored** (L5a); scenario arrays reference only fixture games, `noGames` is empty, and the `multipleWeeks` scenario asserts **its own** ≥4-distinct-ISO-week spread; fixture objects are frozen/never written to IndexedDB. |
| Analysis model | `analysis.test.ts` | Constructing typed `Analysis`/`MoveAnalysis` fixtures (incl. `wdl: null` fast-profile and populated-WDL variants) type-checks and preserves invariants (e.g. mate/cp exclusivity is **documented as unenforced by the type system** — both fields are nullable independently, so the invariant is a stated runtime convention, L5c; `GamePhase` and `AnalysisState` literal sets). |
| Chess-rule conformance | `moveList.test.ts`, `fixtures/fixtures.test.ts` | Legal-replay enforcement: a fixture/edit that introduces an illegal SAN in any branch makes `gameFromPgn`/`validateReplay` fail rather than silently "fix" the move. |

Existing Feature 001/002 tests must continue to pass untouched
(regression gate for the D3 "no UI rewiring" decision).

---

## 11. Migration Considerations

### 11.1 Database / storage

No Dexie migration. `PERSISTENCE_SCHEMA_VERSION` stays `1`. Feature 004
will introduce the `games`/`moves`/`analyses` tables via `v2` and may
adopt `Game.id` (`makeGameId`) as the storage key; this plan's id
scheme is the forward-compatible contract for that. **Caveat (reviewer
L3):** FNV-1a is a 32-bit hash; Feature 004/007 dedupe must not rely
solely on this id for large local libraries (compare full PGN or
normalized movetext as the authoritative check).

### 11.2 Feature-002 position tree coexistence

Feature 002's `MoveTree`/`MovePly` (UI) and the new domain `MoveList`
(chessops `Node<PgnNodeData>` wrapper) coexist during 003. The
convergence task is deliberately handed to the first feature that
renders a real **stored** game. Feature 006 (live analysis board) is
free-form play over a FEN and does not consume stored games; the first
stored-game renderer is **Feature 008** (game analysis / review),
which becomes the convergence point (reviewer L5d). Until then, the
domain must not import `positionTree.ts` and the UI must not import the
domain fixtures into the playground.

### 11.3 Versioned normalization

`normalizeTimeControl` output carries `version: 1`. When Feature 007
confirms provider time-control edge cases (e.g. Lichess
correspondence `-`), the mapping table changes are additive, the
constant bumps to `2`, and the plan/spec note is updated — stored games
retain the category they were normalized with (ADR-013 consequence).

### 11.4 Analysis model evolution

`MoveAnalysis`/`Analysis` are declared now as stable base shapes;
Features 008–010 extend them at documented extension points
(`classification`, `missedTactic`, `puzzleId`, `classificationVersion`)
without breaking 003 consumers. Analysis *version constants* are
introduced by the feature that first writes records (008) per
ARCHITECTURE.md §9.

---

## 12. Implementation Phases (incremental order)

Each phase ends green (`lint`, `typecheck`, `test`).

1. **Phase 1 — Primitive domain types**
   `gameSource.ts`, `timeControl.ts`, `game.ts` (+ `game.test.ts`,
   `gameSource.test.ts`, `timeControl.test.ts`).

2. **Phase 2 — Position & tree wrapper**
   `position.ts`, `moveList.ts` (+ tests): re-export, FEN helpers,
   `MoveList`, `NodePath`, mainline/path navigation, `validateReplay`,
   comment/NAG retention & PGN round-trip.

3. **Phase 3 — Move reconstruction**
   `move.ts` (+ tests): replay-based `mainlineMoves`/`movesToPath`/
   `positionAtPath` with full `Move` derivation; legal replay
   enforcement.

4. **Phase 4 — Game parser**
   `parseGame.ts` (+ tests): `ImportContext`, header mapping,
   `makeGameId`, result/error union, determinism.

5. **Phase 5 — Analysis model**
   `analysis.ts` (+ small invariant test).

6. **Phase 6 — Fixtures**
   `fixtures/defs.ts`, `games.ts`, `scenarios.ts`, `index.ts` (+
   `fixtures/fixtures.test.ts`). Author and validate the 13 PGN
   fixtures; verify the coverage matrix and multi-week spread.

7. **Phase 7 — Barrel + full gate**
   `src/domain/chess/index.ts`; run the entire Execution policy gate
   (§15) and record output as acceptance evidence. If D2 nested shape
   is approved, apply the `game-model.md` doc tweak in this phase.

---

## 13. Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|------------|--------|------------|
| R1 | Reviewer rejects one of D1–D8 | Medium | Medium | §3 lists every decision explicitly so each can be approved or replaced before code is written. |
| R2 | Fixture PGN authoring errors (illegal move, inconsistent headers, wrong result) | High | Medium | Every fixture is replayed and validated by `fixtures.test.ts` at module load + test time; small set (13) keeps rework cheap; NAG intent is machine-checked. |
| R3 | Two move-tree representations (Feature-002 UI `MoveTree` vs domain `MoveList`) drift or duplicate logic | Medium | Medium | Domain never imports `positionTree.ts`; convergence is explicitly assigned to the first stored-game renderer, Feature 008 (D3, reviewer L5d); AGENTS "avoid duplicated chess logic" noted for the reviewer. |
| R4 | Time-control normalization boundary disagreement across providers (e.g. 8+0, 3+2) | Medium | Medium | Single platform-independent versioned table (D4); boundaries documented in tests; Feature 007 re-verification bumps version rather than silently changing behavior. |
| R5 | Over-specifying `Analysis`/`MoveAnalysis` before engine work | Medium | Low | Shapes stay minimal but complete vs `analysis-model.md`/ADR-018/019; extension points marked for 008–010; changes are additive type-only edits. |
| R6 | `playedAt` null + missing-rating fixtures complicate later stats tests | Low | Low | Explicit `null` semantics (D8) match Feature-014 empty-state requirements; edge-case fixtures included deliberately. |
| R7 | Fixture "clean / blunder / missedTactic" labels are unverified by an engine today | Medium | Low | Labels are *intent* metadata (descriptor `tags` + NAGs + `note`) for later features; integrity tests only assert self-consistency, and engine verification arrives with Features 008/010. |
| R8 | Module-load parsing of fixtures slows test boot | Low | Low | 13 short PGNs; parsePgn cost is negligible. |
| R9 | Name collision: domain `MoveList` vs Feature-002 UI `MoveList.tsx` | Medium | Low | Different directories; later UI consumers must alias the import. Noted in D3/§13 so no silent confusion. |

---

## 14. Acceptance Criteria

Feature-003 spec AC: *All later application features can receive
deterministic domain objects without requiring external APIs,
IndexedDB, Stockfish or real user data.*

| Spec / model requirement | Concrete, runnable check |
|--------------------------|--------------------------|
| Core models exist and are UI-free | `src/domain/chess/` exports `Game`, `Player`, `Move`, `Position`, `TimeControl` (category + normalizer), `GameSource`, `GameResult`, `Analysis`, `MoveAnalysis`, `MoveList`; no file under `src/domain/` imports React, Dexie, or a worker. |
| `Game` wraps a chessops `PgnNode` tree | `Game.moves.root` is typed as chessops `Node<PgnNodeData>`; no parallel ply-copying structure exists in the domain; verified by `moveList.test.ts`. |
| Provider identifiers/source preserved without provider formats leaking | `Game.source` + `Game.externalId`; `parseGame.test.ts` covers both provider header shapes; nothing outside `fixtures`/parse code refers to provider JSON formats. |
| Time-control categories canonical + versioned | `timeControl.test.ts` covers all six categories incl. boundaries and `unknown`; `TIME_CONTROL_NORMALIZATION_VERSION === 1`. |
| Original TC string preserved | `Game.timeControl` retains verbatim raw string in parse tests; normalized value separate. |
| PGN parsed by chessops, comments/NAGs round-trip | `parsePgn` used in `parseGame.ts`; `moveList.test.ts` round-trips comments + NAGs through `makePgn`. |
| Move reconstruction contract | `move.test.ts` spot-checks SAN/UCI/from/to/move-number/color/`fenBefore`/`fenAfter` for castling, capture, and promotion plies. |
| Deterministic fixtures for later features | `fixtures/fixtures.test.ts` matrix (§6.5) + `fixtureScenarios` (no games, single, multiple, mixed platforms, mixed TCs, ≥4 weeks); fixtures live under `fixtures/` and never touch IndexedDB. |
| All listed spec tests pass | §10 test table is green. |
| Existing features unaffected | `npm run test` passes with Feature-001/002 suites unchanged (no source edits outside `src/domain/chess/` + optional spec-doc line). |

---

## 15. Verification Commands

Run from the repository root after implementation completes (Execution
policy in `AGENTS.md`):

```bash
# 1. Static checks
npm run lint
npm run typecheck
npm run format:check

# 2. Unit / component tests
npm run test

# 3. Domain feature tests only (quick focus)
npm run test -- src/domain/chess

# 4. Production build
npm run build

# 5. Browser integration tests (regression — Feature 002 unchanged)
npm run preview &        # vite preview serves the built app
npm run test:browser
# stop the preview server after tests complete

# 6. Dev-server smoke test (manual)
npm run dev
# open http://localhost:5173 — playground still works, no console errors

# 7. Dependency audit
npm audit
```

If every command exits 0, the preview/browser run passes, and the dev
smoke shows no console errors, Feature 003 is complete.

---

## 16. Notes for the Reviewer

- **No application source code was modified while producing this
  plan.** Only this plan file is new.
- The single most consequential decision is **D3**: this plan
  deliberately does *not* rewire Feature 002's UI `MoveList`/tree onto
  the new domain `MoveList`. If the reviewer reads `003-chess-domain.md`
  §"MoveList" as requiring the move-list *UI* to consume the domain
  wrapper *in this feature*, D3 must be rejected and a UI-migration
  phase (porting `positionTree` consumers to `MoveList` + `Move`) added
  to §12 — that is a larger, cross-feature change.
- **D4** (time-control boundaries) and **D5** (fixture `source`
  semantics) resolve genuine gaps in the specs; both are documented in
  tests so later features cannot silently change behavior (ADR-013
  versioning, AGENTS "stop and report" rule).
- If any decision in §3 is rejected, the affected sections (§6, §10,
  §12) must be revised before implementation begins.
- `specs/domain/game-model.md` gains a property-list reconciliation
  (D2/M1) and only after the design is approved.

---

## 17. Review Outcome & Revision Log

Reviewer verdict (reviewer agent, task `ses_f9c12771fffeIMdZMrFfgjdp2c`):
**Approve with revisions.** No CRITICAL or HIGH findings; no
dependency-policy or execution-policy deviations. **D1–D8 all
confirmed** (D2 and D4 with noted adjustments).

Revisions applied to this plan after review:

| # | Severity | Change |
|---|----------|--------|
| M1 | MEDIUM | D2 + §5.3: the `game-model.md` doc edit must *reconcile* the required-property list (remove/reword the `whiteRating`/`blackRating` bullets), not append a one-line annotation. |
| M2 | MEDIUM | §6.4 + §10: pinned the empty/garbage-PGN contract against verified `parsePgn` behavior — new `noMoves` error code for zero-move + `Result '*'` placeholder games; genuine zero-move forfeits with a real result header are accepted; `parseError` documented as a defensive, effectively-unreachable guard. |
| L1 | LOW | §10: NAG/comment round-trip asserted as **semantic** equality, not byte equality (`makePgn` normalizes whitespace/reformats). |
| L2 | LOW | §6.2 + §10: scoped comment retention to move-attached comments + `startingComments`; game-level intro comments live on chessops `Game.comments` and are preserved only via `Game.pgn`. |
| L3 | LOW | §6.5 + §11.1: noted fixture-vs-real id indistinguishability (acceptable only because fixtures are never persisted) and the FNV-1a 32-bit caveat for Feature 004/007 dedupe. |
| L4 | LOW | §6.1: softened the "follows analysis-model.md" claim; eval-before/after/delta fields (`wpLoss` inputs, ADR-023/024) are deferred to Features 008/009. |
| L5a | LOW | §10: `clean` games carry no `??`/`$4` on **any** ply (user- or opponent-colored). |
| L5b | LOW | §10: explicit `mainlineMoves` illegal-SAN rejection test case added. |
| L5c | LOW | §10: mate/cp exclusivity documented as unenforced-by-types (runtime convention). |
| L5d | LOW | §11.2 + §13 R3: convergence point corrected from Feature 006 to **Feature 008** (first stored-game renderer). |

Optional reviewer clarifications L3/L5a–e were folded in without
re-review. Items L3's remaining caveat and L5e are context-only and
require no plan change.
