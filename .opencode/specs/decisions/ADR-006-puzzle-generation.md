# ADR-006: Tactical Puzzle Generation

## Status

Accepted

## Decision

Generate puzzles from verified tactical opportunities rather than simply
using the engine's first principal variation move.

Puzzles may contain multiple moves.

## Requirements

Candidate puzzles must be:

- legal
- tactically meaningful
- engine verified
- checked for alternative solutions
- connected to the user's original mistake

## Reason

The training objective is to teach the tactical idea, not merely reproduce
an engine move.
