---
description: Create an implementation plan for an approved feature
agent: planner
---

> **Always follow the `## Dependency policy` and `## Execution policy`
> in `AGENTS.md`.** In particular: use the latest stable versions of
> any dependency referenced in the plan; do not introduce version
> pins unless they represent a hard architectural constraint.

Create an implementation plan for:

$ARGUMENTS

Load context per `AGENTS.md` "Context discipline": read `AGENTS.md`,
`.opencode/DECISIONS.md`, `.opencode/specs/ARCHITECTURE.md`,
`.opencode/CONTEXT-MAP.md`, the requested feature specification, and
only the ADR/domain/research documents the feature's Context block
lists. Inspect the existing codebase before proposing new abstractions.
Do not read unrelated features, ADRs, research, plans, or history.

The plan must identify:

- exact files/modules affected
- domain changes
- data-model changes
- UI changes
- infrastructure changes
- dependencies
- tests
- migrations
- risks
- acceptance criteria
- verification commands

Do not modify application source code.

Save the plan under `.opencode/plans/`.

If the specification is incomplete or contradictory, stop and report the
problem rather than guessing.
