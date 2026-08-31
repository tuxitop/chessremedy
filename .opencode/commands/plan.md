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

Read all relevant specifications before planning.

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

Inspect the existing codebase before proposing new abstractions.

Do not modify application source code.

Save the plan under `.opencode/plans/`.

If the specification is incomplete or contradictory, stop and report the
problem rather than guessing.
