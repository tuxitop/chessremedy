---
description: Run ChessRemedy verification checks
agent: build
---

> **Always follow the `## Dependency policy` and `## Execution policy`
> in `AGENTS.md`.** Any warning, error, or audit finding must be fixed
> or escalated with the user before the verify command reports
> success.

Verify the current ChessRemedy implementation.

Run the project's:

- lint
- typecheck
- unit tests
- integration/component tests where available
- production build

Then inspect the git diff.

Report:

- commands executed
- passed checks
- failed checks
- warnings
- likely causes
- whether the current feature appears ready for review

Do not make unrelated changes.

If a check fails, investigate the failure and explain it clearly.
