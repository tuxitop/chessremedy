---
description: Review an implementation against its specification
agent: reviewer
---

> **Always follow the `## Dependency policy` and `## Execution policy`
> in `AGENTS.md`.** A review that finds a new dependency that should
> be on the latest stable, a new warning emitted by `npm run
> typecheck` / `npm run lint` / `npm run test` / `npm run build`, or
> any other deviation from the policies must flag it explicitly.

Review the implementation for:

$ARGUMENTS

Load context per `AGENTS.md` "Context discipline": read `AGENTS.md`,
`.opencode/DECISIONS.md`, the feature specification and the ADR/domain
docs its Context block lists, the implementation plan, and the actual
git diff. Load further ADRs/research/history only when the diff raises
a question they answer. Do not read unrelated documents.

Do not modify code.

Report:

1. CRITICAL findings
2. HIGH findings
3. MEDIUM findings
4. LOW findings
5. Missing tests
6. Specification deviations
7. Scope creep
8. Final verdict

The review must distinguish actual defects from optional improvements.
