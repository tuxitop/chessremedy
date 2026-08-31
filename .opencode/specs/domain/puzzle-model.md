# Puzzle Model

A Puzzle contains:

- id
- source game
- source ply
- starting FEN
- user's original move
- expected solution
- solution tree/sequence
- tactical objective
- tactical motifs *(reserved for future scope; must not be populated in V1)*
- difficulty metadata
- engine verification metadata
- generation version

A solution may contain multiple moves.

The puzzle is complete when its tactical objective is resolved.

The puzzle should preserve enough provenance to explain:

- what the user played
- what opportunity existed
- what the solution was
- why the sequence mattered
