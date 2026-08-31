---
description: Implement an approved ChessRemedy implementation plan
agent: build
---

Implement the requested approved plan:

$ARGUMENTS

Before editing:

1. Read AGENTS.md.
2. Read the feature specification.
3. Read the implementation plan.
4. Read relevant architecture and ADRs.
5. Inspect existing code.

Rules:

- Implement only the approved scope.
- Reuse existing abstractions.
- Do not silently change architectural decisions.
- Do not add dependencies without justification.
- Add or update tests with the implementation.
- Preserve backward compatibility where applicable.
- Keep domain logic independent from UI.
- Keep expensive operations off the UI thread.
- Follow the Chessground version requirement exactly.

After implementation:

1. Run focused tests.
2. Run typecheck.
3. Run lint.
4. Run the production build if practical.
5. Report what changed and any unresolved issues.

Feature/plan:

$ARGUMENTS
