# ChessRemedy — Agent Instructions

## Project

ChessRemedy is a local-first chess training SPA.

V1 focuses on:

1. Importing games from Chess.com and Lichess.
2. Local Stockfish analysis.
3. Move classification.
4. Missed-tactic detection.
5. Personalized tactical puzzle generation.
6. Puzzle training.
7. FSRS spaced repetition.
8. Progress analytics.
9. Optional cloud synchronization.

Future versions may add opening repertoires, opening training, endgame
training and additional chess-training features.

---

## Source of truth

Before modifying code, read the relevant:

- `.opencode/specs/PRODUCT.md`
- `.opencode/specs/ARCHITECTURE.md`
- relevant ADRs in `.opencode/specs/decisions/`
- relevant domain specifications in `.opencode/specs/domain/`
- relevant feature specification in `.opencode/specs/features/`

Do not infer product requirements from existing implementation when a
specification exists.

If implementation and specification disagree, stop and report the conflict
instead of silently changing behavior.

---

## Development methodology

ChessRemedy uses specification-driven development.

For each feature:

1. Understand the specification.
2. Research unresolved technical questions.
3. Create an implementation plan.
4. Review the plan.
5. Implement only the approved scope.
6. Test the implementation.
7. Review implementation against the specification.
8. Update documentation/specifications when the approved design changes.
9. Commit the completed vertical slice.

Do not implement multiple unrelated features in one change.

---

## Architecture principles

- React + TypeScript + Vite.
- SPA/PWA.
- Local-first architecture.
- IndexedDB is the primary persistent store.
- Dexie is used to access IndexedDB.
- The application must remain useful offline.
- Domain logic must not depend on React components.
- External providers must be isolated behind adapters/services.
- Expensive chess-engine analysis must not block the UI.
- Stockfish runs in Web Workers.
- Chessground is wrapped by our own chessboard component.
- Chess rules/state are handled by `chess.js`.
- Spaced repetition uses FSRS.
- Synchronization is an infrastructure concern, not a domain concern.

---

## Mandatory chessboard dependency

The chessboard implementation must use `@lichess-org/chessground@10.1.1` or
a higher 10.x version. The installed version must never be lower than
10.1.1.

Do not replace it with react-chessboard or another chessboard library
without an explicit architecture decision.

The application must provide a reusable abstraction around Chessground rather
than scattering direct Chessground integration throughout the UI.

---

## Chess analysis

ChessRemedy must distinguish:

- accuracy
- inaccuracy
- mistake
- blunder
- missed tactical opportunity

A large centipawn loss alone is not automatically equivalent to a tactical
blunder.

Analysis must consider position context, forcing moves, evaluation changes,
WDL where appropriate, and tactical verification.

Do not invent new classification thresholds without documenting the decision.

---

## Time control

Time control is a first-class analytical dimension.

Do not combine:

- Bullet
- Blitz
- Rapid
- Classical

when producing performance statistics unless the user explicitly requests
an aggregate view.

Rating, accuracy, blunders and other relevant metrics should retain their
platform and time-control dimensions.

---

## Puzzle generation

A puzzle is not necessarily "find Stockfish's best move."

A puzzle may contain a multi-move tactical sequence.

The generated solution should continue until the tactical objective is
resolved, such as:

- winning material
- forcing mate
- obtaining a decisive advantage
- neutralizing a tactical threat

Candidate puzzles must be verified and checked for meaningful alternative
solutions.

The original mistake must be retained as part of the puzzle provenance.

---

## UI principles

The application must work on:

- desktop
- tablet
- mobile

Chess interaction must support mouse and touch.

Do not introduce desktop-only interactions for essential puzzle functionality.

Dark and light themes are required.

Keyboard shortcuts must never be the only way to perform an essential action.

---

## Testing

Every feature must have appropriate tests.

At minimum:

- domain logic tests
- chess-rule tests
- analysis/classification tests
- puzzle-generation tests
- persistence tests
- component tests where behavior is non-trivial

Before considering a feature complete, run:

- lint
- typecheck
- tests
- production build

---

## Scope control

Do not implement future features unless they are required by the current
feature or explicitly requested.

Future features include:

- opening repertoire
- opening training
- repertoire compliance
- endgame training
- advanced tactical motif training
- AI coaching

---

## Security and privacy

Chess games are user data.

Prefer local processing and local storage.

Do not send game data or analysis to third-party services unless explicitly
required by the feature and documented in an architecture decision.

Never commit credentials, tokens or secrets.

---

## Code quality

Prefer:

- simple designs
- explicit types
- small domain functions
- deterministic logic
- dependency isolation
- testable services

Avoid:

- premature abstractions
- global mutable state
- hidden side effects
- UI components containing domain algorithms
- duplicated chess logic
- unnecessary dependencies

## Feature testability

Every feature should be independently testable whenever practical.

Features must not require the completion of unrelated future features merely
to demonstrate or validate their core behavior.

When a feature depends on data that is not yet produced by the application,
provide deterministic development/test fixtures.

Examples:

- Chessboard features use predefined FEN positions.
- Puzzle UI uses predefined puzzle fixtures.
- Game analysis uses predefined PGN games.
- Dashboard uses deterministic statistics fixtures.
- Synchronization uses local mock providers.

Fixtures must be separated from production data and must not be presented as
real user data.
