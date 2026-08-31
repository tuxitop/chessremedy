# Analysis Domain Model

Each analyzed position produces MoveAnalysis.

Required concepts:

- game
- ply
- position/FEN
- played move
- engine best move
- evaluation before
- evaluation after
- evaluation delta
- WDL where available
- principal variation
- engine metadata
- analysis version
- game phase

Analysis must be reproducible and versioned.

Analysis states:

- pending
- running
- completed
- failed
- cancelled
