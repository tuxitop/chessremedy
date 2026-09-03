---
description: Show ChessRemedy specification and implementation status
---

> **Always follow the `## Dependency policy` and `## Execution policy`
> in `AGENTS.md`.** Include any dependency or verification warning /
> error in the "Verification Problems" section so it is not lost.

Review the ChessRemedy specification workspace and current repository.

**Start from the current source-of-truth documents only:**

- `AGENTS.md` (roadmap table)
- `.opencode/DECISIONS.md` (current decisions index)
- `.opencode/specs/ARCHITECTURE.md` (current architecture)
- `.opencode/CONTEXT-MAP.md` (feature → document map)
- `.opencode/specs/README.md`
- `git log` / `git status` (implemented features)

Do not read all ADRs, all feature specs, research, or history up front.
Open deeper documents only when the entry points indicate a problem.

Determine and report:

- completed features
- active feature
- next feature
- specifications without implementation
- implementation without corresponding specification
- contradictory decisions visible from DECISIONS.md/ARCHITECTURE.md
- unresolved ADRs / missing decisions (a spec references a decision
  with no ADR)
- stale references visible from CONTEXT-MAP.md (wrong feature numbers,
  references to non-existent files, `history/`-resident ADRs treated as
  current, leftover FSRS/spaced-repetition phrasing presented as V1)
- features without a Context block or without a verification surface
- failing verification checks if discoverable

Do not modify files.

Present the result as:

## Completed

## In Progress

## Next

## Specification Problems

## Architecture Decisions Needed

## Verification Problems
