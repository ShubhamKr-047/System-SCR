# Move classification v2

SCR classifies moves locally using Stockfish 19 lite single-threaded WASM. Gemini
and Groq explain a completed analysis only when requested; neither chooses labels.
These are SCR's documented rules, not a reproduction of a proprietary classifier.

## Ordinary quality

The played move is compared with the best continuation from the same starting
position. If it is not the best move, a `searchmoves` search explicitly evaluates
it with the same time budget. Displayed position analysis remains independent of
restricted searches. A completed MultiPV result can supply both scores instead.

Scores are normalized to the mover's perspective. The human-game winning-chance
curve is `100 / (1 + exp(-0.368208 * pawnScore))`. Changes are percentage points,
not relative percentages or centipawns. This is an estimate, not an individual
player's probability. Engine self-play WDL is retained as separate evidence.

| Chance loss | Ordinary classification |
| --- | --- |
| 0–2 | Excellent |
| Greater than 2, less than 5 | Good |
| 5–less than 10 | Inaccuracy |
| 10–less than 20 | Mistake |
| 20 or more | Blunder |

Best overrides the ordinary label for the engine's top move (at most 2 points
lost), or an equivalent move within 10 centipawns and 0.5 percentage points.
Both score signs are checked, so a noisy apparent improvement cannot manufacture
an equivalent move. Saturated chance estimates alone do not make a move Best.

These initial thresholds are transparent, independently tunable SCR policy.
The small regression corpus protects known behaviors; it is not evidence of
agreement with every expert annotation or a statistically calibrated rating model.

## Exceptional labels and precedence

1. **Forced:** exactly one legal move, regardless of its outcome. Excluded from
   player accuracy and included in summary counts.
2. **Blunder:** severe chance loss or newly allowing forced mate. A concurrent
   missed opportunity never hides this label.
3. **Miss:** confirmed loss of an opportunity after the opponent's error. Requires
   the opponent's preceding move to lose at least 8 points, the current best
   continuation to score at least 70, and the played continuation to score at most
   60 with a loss of at least 8. The preceding move needs verified same-root
   evidence, reused from a completed review when available or searched again.
   Underlying ordinary severity is retained in the result.
4. **Mistake/Inaccuracy:** ordinary thresholds above.
5. **Book:** exact position-plus-move match in the bundled opening index, at most
   30 centipawns and 2 points lost, no terminal outcome or missed forced mate.
   Recognition of a dubious named line does not protect it from an error label.
6. **Brilliant:** best or equivalent move, a newly offered minor/major piece,
   verified compensation against the strongest reply and legal acceptance moves,
   and at least 48 estimated chances after playing and accepting. The strongest
   alternative must score below 75; routine wins in already won positions are
   excluded. No early-ply restriction is used.
7. **Great:** best/equivalent critical resource with a gap of at least 12 points
   to the strongest alternative. Either it preserves at least 48 where the
   alternative scores at most 35, or preserves at least 70 where the alternative
   scores at most 55. Routine recaptures do not qualify.
8. **Best/Excellent/Good:** ordinary rules.

Great and Brilliant require complete candidate lines from one depth, at least
depth 14, and stability across recent completed iterations. Acceptance searches
also need stable evidence. Search uncertainty falls back to ordinary quality.
The engine's bounded scores never become completed classification evidence.

Sacrifice detection uses legal exchange minimax, compares with existing exposure
before the move, and requires at least 1.5 pawns of net material offered after
recaptures. Promotions and ordinary exchanges are excluded. Acceptance lines are
checked for an ongoing deficit through four plies or a verified mate. Immediate
material recovery invalidates that particular offer. All candidate captures must
retain compensation; at least one must be a genuine sacrifice. More than four
ambiguous acceptance candidates falls back to ordinary quality. This conservative
finite search can miss long or unusual sacrifices; a label is not a proof of all
possible chess continuations.

## Mate, history, and accuracy

Mate sign and distance are stored separately from centipawn/display scores.
Preserving mate through a longer line is still Best. Losing a mate while keeping
a winning position is evaluated by its resulting chances rather than a blanket
error rule. A pre-existing forced loss is not a new blunder. Delivered mate is
100, checkmated is 0, and draws are 50.

Searches replay moves from the root FEN, including custom PGN roots and variation
parents. Repetition, fifty-move draws, stalemate and insufficient material are
handled by the existing chess.js game-over semantics. History, search restrictions,
MultiPV and analysis budget are separate cache identities. Restricted searches
never overwrite a node's displayed evaluation. Classification version and search
evidence invalidate stale labels and cached explanations without making AI calls.

Move accuracy uses `103.1668 * exp(-0.04354 * chanceLoss) - 3.1669`, clamped to
0–100. Game accuracy averages the harmonic mean with a weighted mean using local
five-move chance volatility. This is inspired by Lichess; it does not claim exact
Lichess or Chess.com game accuracy. The existing performance-rating estimate is
still a heuristic and is not an official playing strength.

## Runtime cost and verification

The default **Quick review** uses 125ms normal searches; Thorough uses 500ms and
Deep uses 1000ms. A first pass labels every move before a second pass checks
critical candidates. Initial labels can change during the second pass. The UI
shows these phases separately. Selecting a position prioritizes its queued work.

| Policy | Alternatives screen | Confirmation search | Extra time per candidate | Shared extra game budget |
| --- | --- | --- | --- | --- |
| Quick | 100ms | up to 600ms | up to 2500ms | max(2500ms, 100ms × plies) |
| Thorough | 250ms | up to 600ms | up to 2500ms | max(2500ms, 400ms × plies) |
| Deep | 250ms | up to 1000ms | up to 4000ms | max(2500ms, 400ms × plies) |

Budgets cover extra searches, including acceptance lines; the normal first-pass
searches are separate. Search requests are charged conservatively against the
budget even if an internal engine-cache hit makes them free. Compatible normal
node-cache hits are free. These are requested engine-time limits, not hard
wall-clock deadlines: engine initialization, chess logic, rendering and UCI
completion add overhead. The policy is versioned independently of label rules.
King moves/check evasions with less than 10 estimated chances and a small apparent
loss, or disagreement between the two searches about mate, can use a 1000ms
confirmation. These checks get mate priority and share the same extra budgets.

An ordinary near-best move gets one short MultiPV screen. Deeper alternatives
are requested only for a plausible critical gap or a real sacrifice candidate;
incomplete ordinary comparisons do not cause repeated long retries. A short
screen cannot replace the ordinary comparison unless its played and best lines
are reliable. Mate transitions, inconsistent scores, possible misses and unstable
error/boundary evaluations can receive confirmation. A clear stable blunder does
not automatically trigger another pair of searches. Sacrifice exchange analysis
is restricted to plausible exceptional moves. Acceptance searches share the
remaining per-move budget; partial verification cannot award Brilliant.

Refinement prioritizes the selected move, mate transitions and disputed errors,
then sacrifices and ordinary alternative checks. When the shared budget expires,
supported ordinary labels are retained. This deliberately favors conservative
Best/Excellent labels over uncertain Great/Brilliant awards; finite time budgets
can miss exceptional moves. Deep review gives the initial engine more time but
still does not claim perfect classification.

Completed results, including initial-pass labels, survive stop/resume. Repeating
an adequate completed review needs no new searches. Increasing the policy's base
time invalidates completion without deleting old visible results. Stronger cached
searches can serve weaker requests only with identical position history,
restrictions, MultiPV and node limits. Restricted or multi-line searches never
replace the displayed single-line node evaluation. Background updates patch the
affected move badge and batch graph/summary rendering per animation frame.

Run `npm test`, `npm run build`, and
`npx playwright test tests/browser/classifications.spec.js tests/browser/playback.spec.js`.
Run `node scripts/benchmark-classifications.mjs --compare` for the packaged engine
at 125ms and 1500ms. It writes per-position labels, confidence, and elapsed time to
`test-results/classification-benchmark.json`. Browser tests use local engine files
and require no provider key. Node benchmark measurements vary with CPU load.

For complete-game timing and classification comparison, run sequentially:

```sh
node scripts/benchmark-review.mjs --baseline=da76f93 --time=250
node scripts/benchmark-review.mjs
node scripts/benchmark-review.mjs --time=1000
node scripts/compare-review.mjs
```

The baseline snapshots local modules from the chosen Git revision without a
checkout or network request. Reports in `logs/review-benchmarks/review-*.json` include
first-pass time, final time, searches, classifications and repeat-review cost.
The corpus covers the Opera game, Fischer–Spassky game 6, a quiet Ruy Lopez and
a promotion ending. `review-comparison.json` lists differences against the deeper
reference, including reference blunders and extra Brilliant labels requiring
inspection (the comparison command exits nonzero for either). The deeper
lite-engine review is a useful comparison, not ground
truth. Run `npx playwright test tests/browser/review-speed.spec.js` for browser
stop/resume and cache behavior, including Chromium at 4× CPU slowdown.

### Faster Quick policy (version 2)

Quick's base budget was reduced from 250ms to 125ms, its alternatives screen from
200ms to 100ms, and its shared extra budget from 200ms to 100ms per ply (minimum
2500ms). Targeted mate checks still receive up to 1000ms per search, and the
depth/stability requirements for Great and Brilliant remain strict. Thorough and
Deep budgets are unchanged. The policy version invalidates stale completion
metadata when the algorithm changes.

One follow-up run on the same Windows/Node setup:

| Game | Previous Quick | New initial labels | New completed Quick |
| --- | --- | --- | --- |
| Opera game (33 plies) | 18.1s | 5.9s | 8.8s |
| Fischer–Spassky game 6 (81 plies) | 51.6s | 17.0s | 25.9s |
| Quiet Ruy Lopez (40 plies) | 16.2s | 7.8s | 11.1s |
| Promotion ending (11 plies) | 6.9s | 2.3s | 4.3s |

The corpus completed in 50.0s versus 92.7s for the preceding Quick policy, about
46% less time. Repeat reviews still launched zero engine searches. The new run
matched 122/165 exact labels (73.9%) against the finite 1000ms reference, versus
131/165 (79.4%) previously. No reference Blunders were missed and no extra
Brilliant labels appeared in these four games. This is the explicit tradeoff:
Quick prioritizes review speed; Thorough and Deep offer closer move distinctions.
Measurements and finite engine labels vary between runs.

To compare retained reports from different runs, use
`node scripts/compare-review.mjs --previous=quick-previous --quick=quick`.
`--time=250` now writes `review-quick-250.json`; the default writes
`review-quick.json`. Git snapshots support both the old serial classifier and
the subsequent two-pass review, so a baseline uses its own review runner.

### Earlier adaptive review measurements (version 1)

One Windows/Node 25 run of the packaged engine, comparing Quick review with
`d2714b2` at the same 250ms base budget:

| Game | Plies | Previous review | Initial labels | Completed Quick review |
| --- | --- | --- | --- | --- |
| Opera game | 33 | 45.6s | 11.6s | 18.1s |
| Fischer–Spassky game 6 | 81 | 115.0s | 34.2s | 51.6s |
| Quiet Ruy Lopez | 40 | 34.4s | 13.6s | 16.2s |
| Promotion ending | 11 | 20.9s | 4.3s | 6.9s |

The complete corpus took 92.7s versus 215.9s, about **2.3× faster**. Repeating
each completed review launched zero engine searches. These measurements vary
with CPU load and engine search timing; they are not a browser completion SLA.

Against a 1000ms base reference, this run matched 131/165 exact labels (79.4%).
Most differences were Best/Excellent/Good/Book or Inaccuracy boundary decisions.
One reference Mistake was an Inaccuracy in Quick, and one reference Great was
Best. No reference Blunders were missed and no extra Brilliant labels appeared.
The discovered late-game king-move mate regression is covered by targeted mate
confirmation and unit tests. This small corpus supports the speed/quality
tradeoff, not an assertion of universal chess accuracy. Use Thorough or Deep
when finer distinctions matter more than review time.

## Opening data and sources

The bundled 3,865 named lines generate 8,192 position/move entries. Source revision,
combined source SHA-256 and CC0-1.0 provenance are embedded in `src/data/openings.json`.
Transpositions use the position's board, turn, castling and legal en-passant fields;
move counters are excluded. Prefixes use the shortest applicable opening line.
This is a named-opening corpus, not an exhaustive master-game repertoire.

Regenerate explicitly with:
`node scripts/build-openings.mjs a6189a30dc273ccb21fc2536a9a2fefd5592a67a`.
Normal builds do not download data.

- Human-game curve and accuracy: https://lichess.org/page/accuracy
- Opening data and public-domain dedication: https://github.com/lichess-org/chess-openings
- Engine evaluations, WDL and MultiPV tradeoffs: https://official-stockfish.github.io/docs/stockfish-wiki/Stockfish-FAQ.html
- Public definitions inspiring exceptional labels: https://support.chess.com/en/articles/8572705-how-are-moves-classified-what-is-a-blunder-or-brilliant-etc
