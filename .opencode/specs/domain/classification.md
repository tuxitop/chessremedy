# Move Classification

## Purpose

Classify meaningful deviations from expected play.

In V1 every analyzed move carries exactly one classification label from
the five ADR-023 states: `best`, `good`, `inaccuracy`, `mistake`,
`blunder`. `null`/unclassified is **not** a produced data state. Visual
emphasis (glyph/highlight) is a *presentation* concern applied only when
a move's quality warrants it: ordinary moves are the `good` bucket and
are presented without emphasis.

## Classification States

Every analyzed `MoveAnalysis` in V1 carries exactly one of:

- `best`
- `good`
- `inaccuracy`
- `mistake`
- `blunder`

(ADR-023). The `null` state is reserved for the concept of *no
classification* and is not produced by the V1 classifier.

`best` is assigned only when the played move matches the engine's top
choice (or the ADR-023 best-move-tie rule holds); `good` is the ordinary
bucket for every other move whose `wpLoss` stays below the inaccuracy
threshold. A merely legal or reasonable move is `good`, never `best`. At
the **presentation** layer the absence of emphasis on ordinary `good`
moves is the valid, expected result.

## Default Behavior

The classifier is total over the five ADR-023 states, but its
*presentation* must be conservative: most ordinary moves are classified
`good` and are displayed without any classification glyph or emphasis.

For example, an opening move such as `e4` is normally `good` when it is
simply a normal move, even though it may have a very good engine
evaluation; it is presented without emphasis.

Do not visually emphasize every move simply because every move carries an
engine evaluation and a classification label.

The following are separate concepts:

- engine evaluation;
- move quality;
- the persisted five-state classification label;
- presentation emphasis.

Every analyzed move has an evaluation and a classification label;
ordinary (`good`) moves carry no visual emphasis.

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
a visually emphasized classification; they remain ordinary `good` moves.

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
    Classification: good (no visual emphasis)

or:

    Move: Qxe5??
    Evaluation loss: 3.8
    Classification: blunder

Both are valid analyzed moves.

## Future Extensions

Additional attributes such as `missedTactic` and tactical motifs are
separate from the primary move classification.

They must not force every move to receive a classification.

A future classifier that intentionally abstains may introduce a `null`
state; that is a new decision requiring a new ADR and a
classification-version bump, not a V1 behavior.

## Important Constraint

The V1 data model is intentionally total (ADR-023): every analyzed move
receives one of the five states. The constraint therefore applies to
**presentation**: do not render every analyzed move as if it were
`best`, `inaccuracy`, `mistake` or `blunder`. The expected *presentation*
distribution contains many ordinary (`good`, unemphasized) moves and
relatively few visually emphasized moves.

Fixtures must validate that the classifier and its presentation behave
this way.