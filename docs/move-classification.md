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
   60 with a loss of at least 8. The preceding move is searched again for proof.
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

Normal searches use the selected 250/500/1000ms budget. Borderline classifications,
serious errors, mate transitions, inconsistent scores and exceptional candidates receive extra
searches (1000–2500ms each). MultiPV=2 is selective, with one stronger retry when
the candidate comparison is incomplete or unstable. Sacrifice acceptance searches
are additional. Thus the speed setting is a per-search budget, not a promise of
total time per move. The selected position remains responsive through the worker
queue; cancellation prevents late results attaching to a new game.

Run `npm test`, `npm run build`, and
`npx playwright test tests/browser/classifications.spec.js tests/browser/playback.spec.js`.
Run `node scripts/benchmark-classifications.mjs --compare` for the packaged engine
at 250ms and 1500ms. It writes per-position labels, confidence, and elapsed time to
`test-results/classification-benchmark.json`. Browser tests use local engine files
and require no provider key. Node benchmark measurements vary with CPU load.

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
