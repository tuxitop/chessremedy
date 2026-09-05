# Move Classification

## Purpose

Classify meaningful deviations from expected play.

Classification is an annotation applied to a move when the move's
quality warrants highlighting. It is NOT a mandatory label for every
analyzed move.

## Classification States

A move may have:

- `null` — no classification
- `inaccuracy`
- `mistake`
- `blunder`
- `best`
- `good`

`best` and `good` are optional positive classifications and should not
be assigned merely because a move is legal or reasonable.

The absence of a classification is a valid and expected result.

## Default Behavior

The classifier should be conservative.

Most ordinary moves should remain unclassified.

For example, an opening move such as `e4` should normally have no
classification when it is simply a normal move, even though it may have
a very good engine evaluation.

Do not classify every move simply because every move has an engine
evaluation.

The following are separate concepts:

- engine evaluation;
- move quality;
- move classification.

An analyzed move may have an evaluation but no classification.

## Classification Purpose

Classification exists primarily to identify moves that are useful for
human review and future training.

The classifier should therefore prioritize meaningful events such as:

- significant evaluation loss;
- clear mistakes;
- serious blunders;
- tactically important errors;
- unusually strong moves when positive classification is warranted.

Minor or normal evaluation differences should not automatically produce
a classification.

## Classification Priority

At most one primary classification is assigned to a move.

The classifier must apply the canonical thresholds and precedence defined
by the classification research and implementation.

The final classification algorithm must remain deterministic for a fixed:

- position;
- played move;
- engine analysis;
- classification configuration/version.

## Engine Evaluation vs Classification

Engine evaluation must be persisted independently from classification.

For example:

    Move: e4
    Evaluation: +0.25
    Classification: null

or:

    Move: Qxe5??
    Evaluation loss: 3.8
    Classification: blunder

Both are valid analyzed moves.

## Future Extensions

Additional attributes such as `missedTactic` and tactical motifs are
separate from the primary move classification.

They must not force every move to receive a classification.

## Important Constraint

Do NOT implement a classifier equivalent to:

    every analyzed move → best/good/inaccuracy/mistake/blunder

The expected distribution should contain many unclassified moves and
relatively few classified moves.

Research and fixtures should be used to validate that the classifier
behaves this way.