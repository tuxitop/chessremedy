# ChessRemedy — Agent Instructions

ChessRemedy is a local-first chess training SPA licensed
**GPL-3.0-or-later** (see [ADR-027](.opencode/specs/decisions/ADR-027-license-gpl.md)).
Product scope: analyze the user's own games, convert mistakes and
missed tactics into personalized puzzles, and train them with
cycle-based tactical training.

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
| 007 | Game Import & Library                      | `007-game-import.md`                  |
| 008 | Game Analysis                              | `008-game-analysis.md`                |
| 009 | Move Classification                        | `009-move-classification.md`          |
| 010 | Tactical Detection                         | `010-tactical-detection.md`           |
| 011 | Tactical Puzzle Generation                 | `011-puzzle-generation.md`            |
| 012 | Puzzle Training                            | `012-puzzle-training.md`              |
| 013 | Tactical Training Cycles                   | `013-tactical-training-cycles.md`     |
| 014 | Game Analysis History & Statistics         | `014-game-history-statistics.md`      |
| 015 | Dashboard                                  | `015-dashboard.md`                    |
| 016 | Synchronization                            | `016-synchronization.md`              |
| 017 | UI/UX Refinements                          | `017-w1-ui-ux-refinements.md`         |
| 018 | Home Page                                  | `018-w6-home-page.md`                 |
| 019 | Timed Training Sessions                    | `019-timed-training-sessions.md`      |

Features should be implemented in this order.

## Post-V1 roadmap (draft)

These specs are **draft / idea-level** and are not approved for
implementation. Each is revised and its ADR(s) written before that
feature is implemented.

| #   | Feature                                       | Spec                                  |
| --- | --------------------------------------------- | ------------------------------------- |
| 020 | Individual Review Scheduling                  | `020-individual-review-scheduling.md` |
| 021 | Opening Repertoire Domain & PGN Import/Export | `021-opening-repertoire-domain.md`    |
| 022 | Opening Identification & ECO Library          | `022-opening-identification-eco.md`   |
| 023 | Repertoire Creator UI                         | `023-repertoire-creator-ui.md`        |
| 024 | Opening Trainer                               | `024-opening-trainer.md`              |
| 025 | Opening Coverage & Gap Detection              | `025-opening-coverage-gaps.md`        |
| 026 | Repertoire Compliance                         | `026-repertoire-compliance.md`        |
| 027 | Opening Statistics & Dashboard                | `027-opening-stats-dashboard.md`      |
| 028 | Opening Model Games                           | `028-opening-model-games.md`          |

---

## Context discipline

**Do not read the entire documentation tree by default.** Initial
context for any task is:

1. This file (`AGENTS.md`).
2. `.opencode/DECISIONS.md` — index of current decisions + critical
   constraints.
3. `.opencode/specs/ARCHITECTURE.md` — current architecture.
4. `.opencode/CONTEXT-MAP.md` — which documents each feature needs.
5. The requested feature specification.
6. Only the documents the feature / context map lists as `Required`.

Progressive disclosure: load a specific ADR, domain spec, or research
doc only when the task needs it. `.opencode/specs/history/`
(superseded decisions) and `.opencode/specs/research/` are **not**
default context; consult them only to answer "why" questions or when a
feature explicitly references them. Do not load unrelated features,
ADRs, research, plans, or README history.

## Output discipline

Keep session context small:

- **Offload exploration and research.** Use the `task` tool (or the
  `explore` / `research` commands, which force `subtask: true`) for
  codebase searches and open research questions. Only the subagent's
  final summary returns to this session — its file reads and searches
  do not.
- **Return deltas, not whole files.** Prefer diffs and `file:line`
  references over pasting full file contents. Summarise tool output
  instead of echoing large results back verbatim.
- **Do not re-read what is already loaded** or in the current diff.
- **Narrow first, gate later.** Run focused tests/documents before the
  full gate so failures are diagnosed on small output.
- **Cut sessions at natural boundaries.** Commit completed work and
  start a fresh session (resume with `--continue`) instead of letting
  one session grow until it must be compacted repeatedly.

## Source of truth

Specifications are the source of truth. Do not infer product
requirements from existing implementation when a specification exists.
If implementation and specification disagree, stop and report the
conflict instead of silently changing behavior.

---

## Implementation rules

Project-wide rules that apply to every coding task:

- Follow the current architecture in `.opencode/specs/ARCHITECTURE.md`
  and the current decisions in `.opencode/DECISIONS.md`. Do not
  silently change an architectural decision.
- Domain logic must not depend on React components, the database, or
  Web Workers.
- External providers are isolated behind adapters/services. Expensive
  chess-engine analysis never runs on the UI thread (Stockfish runs in
  Web Workers).
- Keep chess rules/state on `chessops` (ADR-028) and the chessboard
  wrapped by our own component around Chessground (ADR-014 pin below).
- Reuse existing abstractions; prefer simple, explicit, deterministic
  domain functions; avoid duplicated chess logic and premature
  abstractions.
- Do not add a dependency without checking existing decisions and the
  Dependency policy below. No per-puzzle scheduler/FSRS dependency in
  V1 (ADR-031).
- Chess games are user data: prefer local processing/storage; never
  commit credentials, tokens, or secrets.
- Add appropriate tests with any implementation (domain, chess-rule,
  classification, puzzle, persistence, and component tests where
  behavior is non-trivial).
- Make features independently testable with deterministic fixtures
  separated from production data.
- UI must work on desktop, tablet, and mobile; chess interaction must
  support mouse and touch; keyboard shortcuts must never be the only
  way to perform an essential action; dark and light themes are
  required.

---

## Mandatory chessboard dependency

The chessboard implementation must use `@lichess-org/chessground@10.1.1`
or a higher 10.x version. The installed version must never be lower
than 10.1.1 and must remain within the 10.x major range. Major-version
upgrades require a new ADR. Do not replace it with react-chessboard or
another chessboard library without an explicit architecture decision.
Chessground must be used through a reusable wrapper, not scattered
through the UI. See ADR-002 (library) and ADR-014 (version pin).

---

## Dependency policy

**Latest stable by default.** Every dependency (runtime, dev, peer,
optional) and every version pin in spec/ADR/plan files must point at
the latest stable release at the moment of writing, unless one of the
following applies:

1. A hard architectural constraint is recorded in AGENTS.md or
   `.opencode/DECISIONS.md` Critical Constraints (currently: the
   Chessground version pin in "Mandatory chessboard dependency").
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

**Toolchain exception (ADR-032):** TypeScript is deliberately kept at the
latest stable release within the `peerDependencies` range of the installed
`typescript-eslint` (currently `< 6.1.0`). The TypeScript major and
`typescript-eslint` are reviewed and upgraded together; agents must not bump
TypeScript to a major outside that peer range and must not force-install an
override.

Version pins in ADRs are removed. ADRs identify the **library** and
its **policy**; the exact version lives in the lockfile. ADR-014
(Chessground version pin) is the only ADR that retains a version pin
because the version is an architectural requirement, not a
convenience.

---

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

---

## Verification

Use the narrowest relevant verification first (focused unit/domain
tests), then the project's full gate in `## Execution policy`. Before
considering a feature complete run lint, typecheck, tests, and the
production build.

When you need to actually run the gate, load the `verify-gate` skill
(`.opencode/skills/verify-gate/SKILL.md`) for the narrow-first order, the
exact commands, and the failure/escalation protocol; `.opencode/commands/verify.md`
is the thin command wrapper around it. Do not carry that runbook in
every-session context.

---

## Documentation rule

ChessRemedy uses specification-driven development. If implementation
requires changing an architectural decision, a domain rule, or a
feature's approved scope, **stop implementation** and update the
relevant specification/ADR (or add one) before proceeding. Do not
implement multiple unrelated features in one change.

See `.opencode/specs/README.md` for the document hierarchy and
`.opencode/specs/history/` for superseded decisions.
