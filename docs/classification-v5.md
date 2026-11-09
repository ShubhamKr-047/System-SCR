# Classification v5

V5 supersedes the corresponding rules in the v3/v4 documents. Review time targets
remain Quick 45s, Thorough 60s, Deep 90s. No 30-second mode is enabled.

## Evidence contract

Position searches attach root FEN plus full history, side-to-move score perspective,
MultiPV, restricted root moves, node limit and target depth. Candidate lines inherit
that identity. Restricted searches must return a move inside their requested set.
Comparisons with mismatched supplied root/perspective are rejected. Historical Miss
reuse requires classification version, completed mode, confirmed comparison, exact
history, mover and played move. Missing historical provenance triggers new searches.

## Best and mate

Best records its route: top-choice (at most two chance points lost), equivalent
(at most 10cp and 0.5 points, same mate status), or preserved-mate. Longer winning
mates remain eligible. Ordinary severity is still calculated independently.

The shared mate-transition policy distinguishes preserved win, existing forced
loss, newly forced loss, missed mate and confirmed-already-losing. Newly allowing
mate receives an automatic Blunder override only with confirmed evidence and more
than ten estimated chances before playing. At ten or fewer, ordinary chance loss
determines severity. Ten is the existing king-danger boundary, retained as an
explicit provisional policy parameter; it is not a claim of a proven game outcome.
A pre-existing losing mate does not become a new blunder when distance changes.

## Brilliant

Material offers still require legal exchange screening; pawn offers, ordinary
equal exchanges, newly promoted offers and previously exposed pieces are excluded.
Acceptance traces now retain captures, squares, material balance, deficits and
checks through up to sixteen PV plies. Sustained investment, forcing recovery on
another square, and confirmed mate can establish a qualifying continuation.
An immediate ordinary recapture alone cannot do so. This is a tactical heuristic,
not an exhaustive exchange solver.

Short legal mate proofs remain bounded and exhaustive over defensive replies.
When that verifier is inconclusive, reliable root, strongest-defense and acceptance
searches can establish engine-confirmed mate. This path supports longer and quiet
combinations without the alternative-below-75 restriction. It never claims a legal
proof. Tests deliberately exhaust the short proof budget and verify the independent
engine route on both supplied games. Non-mating compensation still uses the
ordinary alternative and acceptance requirements.

## Great and Miss

Great requires the existing critical gap in a second complete same-depth comparison.
The alternative must be a distinct legal root move. A shrinking gap refutes the
candidate; incomplete confirmation is explicitly inconclusive. Transpositions do
not receive arbitrary exclusions; equivalent evaluations should remove the gap.

Miss verifies the preceding loss from the opponent's perspective and the current
opportunity from the mover's perspective. White/Black examples protect this
symmetry. A prior label or incompatible cache entry cannot establish the opportunity.

## Validation and limits

Run npm test, npm run build, node scripts/benchmark-mating-sacrifices.mjs,
node scripts/benchmark-classifications.mjs --compare, and the classification,
playback and review-speed Playwright suites. The position benchmark additionally
writes per-label TP/FP/FN, precision and recall for singleton-label fixtures.
Unrepresented labels have no measured accuracy; this small corpus does not
establish population-level calibration. Full-game timing uses benchmark-review.mjs
and records first pass, completion and warm repeat searches separately.

Unresolved checks remain visible. Version 5 invalidates old classification and
completion metadata. Both user-supplied mating sacrifices must remain Brilliant
in every mode; negative fixtures must not gain Brilliant as a result of these changes.

## Local validation, November 9, 2026

111 unit tests, all 32 Chromium/Firefox browser checks, the production build and
the 18 position-benchmark runs passed. Both supplied sacrifices passed the six
mode/position checks and the two deliberately exhausted-proof fallback checks.
Sequential timing on the 81-ply Fischer–Spassky game was Quick 28.4s, Thorough
38.9s and Deep 52.3s. Every warm repeat launched zero new searches. These are
single-machine observations, not latency guarantees or universal label accuracy.
