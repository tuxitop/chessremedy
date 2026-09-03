---
description: Create or update a feature specification from requirements
agent: architect
---

> **Always follow the `## Dependency policy` and `## Execution policy`
> in `AGENTS.md`.** In particular: use the latest stable versions of
> any dependency referenced in the spec; do not introduce version
> pins unless they represent a hard architectural constraint.

Create or update the ChessRemedy feature specification requested by the user.

Load context per `AGENTS.md` "Context discipline": read `AGENTS.md`,
`.opencode/DECISIONS.md`, `.opencode/specs/PRODUCT.md`,
`.opencode/specs/ARCHITECTURE.md`, `.opencode/CONTEXT-MAP.md`, and only
the ADR/domain docs relevant to the feature. Inspect the existing
implementation if the feature already exists.

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

Every feature specification must end with a `## Context` block listing
its required architecture/ADR, domain, research, and feature
dependencies (paths only, no copied content); keep `.opencode/CONTEXT-MAP.md`
in sync when the set changes.

Do not implement application code.

If the requirement conflicts with an existing architectural decision, report the
conflict before changing the specification.

Feature requested:

$ARGUMENTS
