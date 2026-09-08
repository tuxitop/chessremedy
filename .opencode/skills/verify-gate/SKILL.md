---
name: verify-gate
description: How to run the full ChessRemedy verification gate — narrow-first test order, every required command, the failure/escalation protocol, and the final report shape. Load before declaring a feature complete or reporting "gate green".
---

# ChessRemedy verify-gate

The project's `## Execution policy` in `AGENTS.md` is the authority; this
skill is the runbook for actually running the gate and reporting on it.

## 1. Narrow first, gate later

Run the narrowest relevant checks before the full gate, so failures are
diagnosed on small output:

1. Focused unit/domain tests for the touched area, e.g.
   `npx vitest run src/domain/tactics src/infrastructure/tactics`.
2. Then the project-wide checks below.

## 2. The full gate

Code must complete all of the following **without warnings or errors**:

- `npm run lint`
- `npm run typecheck`
- `npm run format:check`
- `npm run test`
- `npm run build`
- `npm run dev` (no browser-console errors during a smoke run)
- `npm run test:browser` (when Chromium is available)
- `npm audit`

## 3. When a warning or error appears

1. **Fix the underlying cause** first.
2. If the fix is not possible (upstream bug, peer-dep dead end, intentional
   upstream deprecation, etc.), **consult the user** with: the warning text,
   the underlying cause, the alternatives considered, and a recommendation.
3. **Apply a workaround** (suppression, escape hatch, alternative) only after
   the user confirms. The approval and rationale are recorded in the commit
   message.

## 4. Real-engine / browser probes

- Playwright e2e runs preview the built `dist`, so run `npm run build` first
  when a probe depends on current source.
- Throwaway probes (`tests/e2e/zz-*`) must be deleted before any commit.
- `npm run test:browser` requires Chromium; if it is unavailable, say so
  rather than silently skipping.

## 5. Report shape

Report: commands executed, passed checks, failed checks, warnings, likely
causes, and whether the change is ready for review. Do not make unrelated
changes while verifying.

## 6. Context discipline while verifying

Do not spend context reading unrelated documentation. Consult
`.opencode/CONTEXT-MAP.md` or the feature spec only when a failure appears
spec-related.
