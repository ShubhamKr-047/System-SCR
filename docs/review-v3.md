# Review and classification v3

> See [mating-sacrifice fixes v4](mating-sacrifices-v4.md) for current timing,
> mate verification and MultiPV snapshot handling.

V3 supersedes the decision rules and runtime policy in move-classification.md.
Stockfish 19 lite remains local and single-threaded. AI explanations never choose labels.

## Evidence and labels

The scheduler in review-policy.js allocates game time. Evidence collection in
classification-analysis.js establishes root comparisons, alternatives, sacrifice
acceptances and previous-move opportunities. The pure classifyEvidence function
in move-quality.js chooses a label. Display adaptation remains in analysis.js.

Forced takes precedence. A confirmed opponent-created missed win becomes Miss,
even when the underlying severity is Blunder; severity and chance loss remain
available for accuracy. Without that historical evidence, ordinary error severity
applies. Newly allowing mate remains Blunder unless a confirmed Miss applies.
Merely losing a previously held advantage is not sufficient for Miss.

Verified Brilliant precedes Great, Book and Best. Great requires a significant
gap to the strongest alternative. A pending sacrifice cannot silently become
Great. Opening recognition does not suppress sacrifice investigation.

Ordinary loss thresholds remain 2/5/10/20 percentage points. Best additionally
requires the top move or close centipawn equivalence, preventing saturated chance
estimates from making every move in a decided position Best.

Sacrifices are screened within five points of the initial best evaluation and
then must meet the stricter final near-best criteria. Legal exchange minimax
excludes routine exchanges, already exposed pieces and promotions. Verification
checks the strongest reply and every detected acceptance (up to four). A sound
offer must demonstrate compensation, sustained material investment beyond an
immediate recapture or a mating continuation. Up to ten PV plies are inspected;
later material recovery no longer disqualifies a previously sustained sacrifice.
This remains a finite tactical heuristic, not a complete sacrifice solver.

Search reliability requires unbounded completed evidence, depth at least 12,
and stable recent iterations. Alternative comparisons require complete lines
at the same depth. Time or depth alone cannot certify an exceptional label.

## Scheduling

| Mode | Total target | Initial allowance | UI/startup reserve | Depth targets: initial / alternatives / verification |
| --- | --- | --- | --- | --- |
| Quick | 30s | 12s | 3s | 14 / 17 / 18 |
| Thorough | 45s | 18s | 4s | 16 / 19 / 20 |
| Deep | 75s | 25s | 5s | 18 / 21 / 22 |

The initial allowance is distributed by game length, retaining a 40ms search
floor. Compatible neighboring evaluations are reused. Refinement uses the
remaining game allowance and checks actual elapsed time before each optional
search. Selection, mates, misses and sacrifices receive priority over ordinary
alternative screens. Each candidate also has a bounded allowance. Sacrifices
can use up to six seconds of the shared allowance, with a longer alternatives
confirmation and focused acceptance searches to accommodate slower browsers.

One principal variation is used normally and for restricted played-move and
acceptance searches. Two are used for alternative comparisons. Three are not
requested because current decisions need only the strongest alternative; a played
move outside the top two receives its own restricted search.

Targets are adaptive early exits after stable completed iterations. Searches may
finish below them when time expires. Engine cache identity includes target depth,
history, restrictions and MultiPV. Restricted results never replace display scores.

These are whole-game targets, not hard guarantees: mandatory initial evidence,
long games, engine initialization, retries and CPU load can exceed the deadline.
No position receives invented evidence to force a deadline. Optional searches
stop launching when the deadline expires. Reviews can finish early.

Budget completion and verification completion are separate. The label tooltip
and feedback explanation identify unfinished checks. Stop/resume retains results;
a repeated completed review launches no searches. Version 3 invalidates old labels
and old completion metadata. Upgrading modes triggers a new review.

## Validation

Run npm test, npm run build, and the classification, playback and review-speed
Playwright suites. Run benchmark-classifications.mjs --compare for position checks
and benchmark-review.mjs with --time=125, --time=500 and --time=1000 for timing.
The queen-sacrifice fixture requires Brilliant exactly; Best/Book no longer pass.
Longer engine runs are comparison evidence, not ground truth. The corpus remains
small; broad per-label precision and recall require more reviewed positions.

### Local verification, November 9, 2026

100 unit tests and the production build passed. The existing 18 Chromium/Firefox
classification, playback and stop/resume checks passed. A dedicated whole-game
queen-sacrifice browser regression passed in both browsers and requires Brilliant,
not Best (20 browser checks in total).
The nine-position engine corpus passed at 125ms and 1500ms, including the now
strict Brilliant expectation.

One Windows/Node run of the 81-ply Fischer–Spassky game completed in 24.8s Quick,
41.4s Thorough and 49.9s Deep. All repeated reviews launched zero searches.
Quick also completed Opera in 8.7s, the quiet opening game in 10.0s and the
promotion ending in 2.0s. Some runs overlapped browser checks; these are local
observations before the final sacrifice-allowance tuning, not percentile latency
guarantees. Short games and stable evidence
can finish well before the mode's deadline. Unresolved checks remain visible;
these measurements do not establish universal classification accuracy.
