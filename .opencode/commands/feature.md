---
description: Implement a specific ChessRemedy feature end-to-end
---

Implement the requested ChessRemedy feature:

$ARGUMENTS

Load context per `AGENTS.md` "Context discipline":

1. Read `AGENTS.md`.
2. Read `.opencode/DECISIONS.md`.
3. Read `.opencode/specs/ARCHITECTURE.md`.
4. Read `.opencode/CONTEXT-MAP.md` and the requested feature
   specification (its `## Context` block lists the ADR/domain/research
   docs to load).
5. Do not read unrelated features, ADRs, research, plans, or history.

Steps:

1. Identify the feature's dependencies and acceptance criteria from the
   spec.
2. If unresolved technical questions exist, research them (see
   `.opencode/CONTEXT-MAP.md` research column) before planning.
3. Create an implementation plan (see `.opencode/commands/plan.md`) and
   save it under `.opencode/plans/`.
4. Implement the approved scope incrementally (see
   `.opencode/commands/implement.md`), reusing existing abstractions and
   adding tests.
5. Run focused verification first, then the full verification gate
   (see `.opencode/commands/verify.md` and `AGENTS.md` Execution
   policy).
6. Report which acceptance criteria were verified and any unresolved
   issues. Do not commit unless asked.
