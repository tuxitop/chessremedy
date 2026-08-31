# Feature 011 — Tactical Puzzle Generation

## Goal

Generate useful chess training puzzles from analyzed games, especially from
player blunders and missed tactical opportunities.

A puzzle must represent a meaningful tactical objective rather than simply
asking the user to reproduce Stockfish's first engine move.

## Puzzle sources

A puzzle may originate from:

- player's blunder
- player's mistake with a tactical consequence
- missed tactical opportunity
- other approved tactical situations

The source game, move and position must remain traceable.

## Puzzle structure

A puzzle must contain:

- starting position
- side to move
- source game
- source move where applicable
- puzzle objective
- solution sequence
- opponent responses where applicable
- tactical result
- difficulty metadata
- optional tactical motif
- engine verification metadata

## Multi-move solutions

The solution may contain multiple moves.

The puzzle generator must be able to identify a sequence that leads to a
meaningful tactical objective such as:

- checkmate
- winning material
- winning an exchange
- winning a piece
- forcing a decisive advantage
- another explicitly supported tactical objective

The first engine move alone is not sufficient to define a puzzle when the
tactical idea requires continuation.

## Solution validation

A generated puzzle must be verified by the engine.

The generated line must remain valid when analyzed from the starting position.

The generator must distinguish between:

- forced continuation
- acceptable alternative moves
- opponent responses
- final tactical objective

The implementation must avoid requiring the user to reproduce irrelevant
engine moves when multiple moves achieve the same tactical objective.

## Wrong move behavior

The puzzle must retain the original mistake/missed move when available.

After an incorrect user move, the UI can later explain that the move differs
from the intended solution.

The puzzle model itself must not depend on the UI.

## Difficulty

Puzzle difficulty should be represented separately from engine evaluation.

The initial V1 difficulty model may use measurable properties such as:

- solution length
- number of candidate moves
- tactical forcingness
- evaluation swing
- material involved

The exact formula is documented and deterministic. See:

- `specs/research/puzzle-generation.md` §8
- ADR-025 (Puzzle Difficulty Formula)

Difficulty is a single integer in `[0, 100]`, persisted on every
puzzle, and bucketed as Trivial (0–14), Easy (15–34), Medium (35–59),
Hard (60–79), Expert (80–100).

## Duplicate detection

The generator should avoid creating multiple effectively identical puzzles
from the same position unless explicitly allowed.

Equivalent positions/solutions should be deduplicated where practical.

## Fixture puzzles

Provide deterministic puzzle fixtures including:

- mate-in-one
- mate-in-two or short mating sequence
- material-winning combination
- exchange-winning tactic
- missed tactical opportunity
- multi-move combination
- puzzle with more than one acceptable move where supported

These fixtures must be usable without Stockfish for UI tests.

## Acceptance Criteria

The system can generate a puzzle containing a multi-move tactical solution.

A puzzle is not considered complete merely because the first engine move has
been identified.

Every generated puzzle retains its source and can be traced back to the
original game position.

Generated solutions are engine-verified.
