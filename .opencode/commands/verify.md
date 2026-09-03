---
description: Run ChessRemedy verification checks
---

> **Always follow the `## Dependency policy` and `## Execution policy`
> in `AGENTS.md`.** Any warning, error, or audit finding must be fixed
> or escalated with the user before the verify command reports
> success.

Verify the current ChessRemedy implementation.

Run the project's checks from narrowest to broadest:

- focused unit/domain tests (e.g. `npm run test -- <path>`)
- typecheck
- lint
- full unit/component tests
- production build
- browser tests (`npm run test:browser`) when Chromium is available

Do not spend context reading unrelated documentation. Consult
`.opencode/CONTEXT-MAP.md` or the feature spec only when a failure
appears spec-related.

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
