# Feature 015 — Dashboard

## Goal

Show meaningful improvement and weaknesses.

## Requirements

Charts for:

- rating
- accuracy
- blunders
- mistakes
- missed tactics
- game phase
- training progress

Training progress charts (presentation only; values are computed by
Feature 014 statistics and rendered read-only) cover:

- active tactical training sets
- current cycle and cycle progress (completed vs. total puzzles)
- previous and current cycle first-try accuracy
- cycle solving time (per-puzzle average/median and total)
- hints and retries by cycle
- completion rate by cycle
- improvement over previous cycles (raw deltas)
- weakest tactical categories
- puzzles repeatedly failed across cycles

Terminology and metric definitions come from
`specs/domain/tactical-training.md` (sets, cycles, attempts, cycle
accuracy/time); there is no "due puzzle" or "next review" concept in
V1.

Filters:

- platform
- time control
- date range

## Acceptance Criteria

Rapid and Blitz are never silently combined.

Charts expose sample size using the rule in `specs/domain/statistics.md`
(V1 minimum sample size is 5; aggregates below that threshold are
replaced with an "insufficient data" placeholder). Per-cycle aggregates
carry the number of puzzles they are based on.

Empty states are handled.

The dashboard performs no statistical calculations: every training or
game value is produced by Feature 014 and consumed read-only.
