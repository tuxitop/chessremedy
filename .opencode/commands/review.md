---
description: Review an implementation against its specification
agent: reviewer
---

Review the implementation for:

$ARGUMENTS

Read:

- AGENTS.md
- feature specification
- implementation plan
- relevant architecture
- relevant ADRs
- relevant domain specifications

Inspect the actual git diff and relevant source files.

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
