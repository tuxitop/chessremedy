---
description: Create or update a feature specification from requirements
agent: architect
---

> **Always follow the `## Dependency policy` and `## Execution policy`
> in `AGENTS.md`.** In particular: use the latest stable versions of
> any dependency referenced in the spec; do not introduce version
> pins unless they represent a hard architectural constraint.

Create or update the ChessRemedy feature specification requested by the user.

Before editing:

1. Read `AGENTS.md`.
2. Read `specs/PRODUCT.md`.
3. Read `specs/ARCHITECTURE.md`.
4. Read relevant ADRs.
5. Read relevant domain specifications.
6. Inspect the existing implementation if the feature already exists.

The feature specification must define:

- purpose
- scope
- user-facing behavior
- domain behavior
- data requirements
- states
- error cases
- edge cases
- accessibility requirements
- responsive/mobile requirements
- performance constraints
- acceptance criteria
- testing requirements
- dependencies

Do not implement application code.

If the requirement conflicts with an existing architectural decision, report the
conflict before changing the specification.

Feature requested:

$ARGUMENTS
