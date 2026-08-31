# ChessRemedy — Agent Instructions

ChessRemedy is licensed under **GPL-3.0-or-later** (see
`LICENSE` and [ADR-027](.opencode/specs/decisions/ADR-027-license-gpl.md)).

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
8. Progress analytics (statistics + dashboard).
9. Optional cloud synchronization.

Future versions may add opening repertoires, opening training, endgame
training and additional chess-training features.

---

## V1 feature roadmap

The canonical feature list is in `.opencode/specs/features/`. The
shipping order is:

| #   | Feature                                    | Spec                                  |
| --- | ------------------------------------------ | ------------------------------------- |
| 001 | Foundation                                 | `001-foundation.md`                   |
| 002 | Chessboard & Chess Interaction             | `002-chessboard-chess-interaction.md` |
| 003 | Chess/Game Domain & Deterministic Fixtures | `003-chess-domain.md`                 |
| 004 | Local Game Storage                         | `004-local-storage.md`                |
| 005 | Stockfish                                  | `005-stockfish.md`                    |
| 006 | Live Analysis Board                        | `006-live-analysis-board.md`          |
| 007 | Game Import                                | `007-game-import.md`                  |
| 008 | Game Analysis                              | `008-game-analysis.md`                |
| 009 | Move Classification                        | `009-move-classification.md`          |
| 010 | Tactical Detection                         | `010-tactical-detection.md`           |
| 011 | Tactical Puzzle Generation                 | `011-puzzle-generation.md`            |
| 012 | Puzzle Training                            | `012-puzzle-training.md`              |
| 013 | Spaced Repetition                          | `013-spaced-repetition.md`            |
| 014 | Game Analysis History & Statistics         | `014-game-history-statistics.md`      |
| 015 | Dashboard                                  | `015-dashboard.md`                    |
| 016 | Synchronization                            | `016-synchronization.md`              |

Features should be implemented in this order. The current active and
next feature are tracked by `.opencode/commands/status.md` and should
not be inferred from implementation alone.

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
- Chess rules/state are handled by `chessops` (ADR-028).
- Spaced repetition uses FSRS.
- Synchronization is an infrastructure concern, not a domain concern.

---

## Mandatory chessboard dependency

The chessboard implementation must use `@lichess-org/chessground@10.1.1` or
a higher 10.x version. The installed version must never be lower than
10.1.1 and must remain within the 10.x major range. Major-version
upgrades require a new ADR.

See ADR-002 (chessboard library) and ADR-014 (version pin).

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

## Analytics split

Statistics calculation belongs to Feature 014 (Game Analysis History
& Statistics). The dashboard (Feature 015) is a presentation layer
that consumes the statistics service read-only; it must not perform
domain or statistical calculations itself.

Per-move accuracy uses the Lichess accuracy formula (ADR-024).
Move classification uses the WDL-derived `wpLoss` thresholds
(ADR-023). Puzzle difficulty uses the formula in ADR-025. Tactical
detection runs the two-stage pipeline in ADR-026.

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

## Dependency policy

**Latest stable by default.** Every dependency (runtime, dev, peer,
optional) and every version pin in spec/ADR/plan files must point at
the latest stable release at the moment of writing, unless one of the
following applies:

1. A hard architectural constraint is recorded in AGENTS.md
   (currently: the Chessground version pin in "Mandatory chessboard
   dependency").
2. The user has explicitly pinned a version for a specific reason.
3. The latest stable is incompatible with another required
   dependency and no alternative exists.

**License compatibility.** Dependencies must use a license compatible
with ChessRemedy's GPL-3.0-or-later posture (ADR-027). Acceptable:
MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0, ISC, MPL-2.0,
GPL-2.0-or-later, GPL-3.0-or-later. Forbidden: LGPL-3.0-or-later
(imposes source-distribution obligations that the project does not
intend to take on), AGPL-3.0-or-later (network-copyleft reaches end
users, incompatible with the local-first / private-game-data
posture), and any proprietary / source-available license. Any new
copyleft dependency requires an ADR.

When (3) applies, the agent must stop, surface the blocker, list the
alternatives considered (pin, replace, drop, force-install with
documented justification), and ask the user before applying any
workaround.

Version pins in ADRs are removed. ADRs identify the **library** and
its **policy**; the exact version lives in the lockfile. ADR-014
(Chessground version pin) is the only ADR that retains a version pin
because the version is an architectural requirement, not a
convenience.

## Execution policy

Code must complete all of the following without warnings or errors:

- `npm run lint`
- `npm run typecheck`
- `npm run format:check`
- `npm run test`
- `npm run build`
- `npm run dev` (no browser-console errors during a smoke run)
- `npm run test:browser` (when Chromium is available)
- `npm audit`

When a warning or error appears, the agent must:

1. **Fix the underlying cause** first.
2. If the fix is not possible (upstream bug, peer-dep dead end,
   intentional upstream deprecation, etc.), **consult the user** with:
   the warning text, the underlying cause, the alternatives
   considered, and a recommendation.
3. **Apply a workaround** (suppression, escape hatch, alternative)
   only after the user confirms. The approval and rationale are
   recorded in the commit message.

This rule is inherited by every `.opencode/commands/*.md` and every
`.opencode/plans/*.md` generated after this change.

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
