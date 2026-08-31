# Feature 009 — Tactical Detection

## Goal

Identify meaningful missed tactical opportunities.

## Pipeline

Candidate generation
→ engine verification
→ tactical objective
→ candidate quality

## Requirements

Avoid simple "best move" extraction.

Support multi-move tactical sequences.

Reject weak/ambiguous candidates.

Tactical-motif labeling (forks, pins, skewers, etc.) is **not** a V1
requirement. See `specs/domain/tactics.md`.

The two-stage candidate-generation + verification pipeline is
defined in:

- `specs/research/tactical-detection.md`
- ADR-026 (Tactical Verification Pipeline)

## Acceptance Criteria

Verified candidates contain:

- starting position
- original move
- solution
- tactical objective
- verification metadata
- `detectionVersion`
