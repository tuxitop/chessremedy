---
description: Implement an approved ChessRemedy implementation plan
---

> **Always follow the `## Dependency policy` and `## Execution policy`
> in `AGENTS.md`.** In particular: bump every dependency to its
> latest stable release as part of the implementation; fix any
> warnings or errors that arise during `npm run lint`,
> `npm run typecheck`, `npm run test`, `npm run build`, or
> `npm run dev`; consult the user with the blocker and the
> alternatives considered before applying any suppression.

Implement the requested approved plan:

$ARGUMENTS

Load context per `AGENTS.md` "Context discipline":

1. Read `AGENTS.md`.
2. Read `.opencode/DECISIONS.md`.
3. Read `.opencode/specs/ARCHITECTURE.md`.
4. Read the feature specification (its `## Context` block lists the
   ADR/domain/research docs to load).
5. Read the implementation plan.
6. Inspect existing code.

Rules:

- Implement only the approved scope.
- Reuse existing abstractions.
- Do not silently change architectural decisions.
- Do not add dependencies without justification.
- Add or update tests with the implementation.
- Preserve backward compatibility where applicable.
- Keep domain logic independent from UI.
- Keep expensive operations off the UI thread.
- Follow the Chessground version requirement exactly (AGENTS.md /
  DECISIONS.md Critical Constraints).

After implementation:

1. Run focused tests.
2. Run typecheck.
3. Run lint.
4. Run the production build if practical.
5. Report what changed and any unresolved issues.

Feature/plan:

$ARGUMENTS
