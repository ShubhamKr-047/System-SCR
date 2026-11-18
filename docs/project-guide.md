# System SCR project guide

System SCR reviews completed chess games in the browser with bundled Stockfish. It imports PGN files and completed games from Chess.com and Lichess. The optional Groq coach explains individual moves on request. See the [README](../README.md) for installation, controls, and troubleshooting.

## How a game review works

The [game tree](../src/game-tree.js) keeps the imported main line and user variations separate. [Position analysis](../src/position-analysis.js) reconstructs the starting position and full move history for Stockfish. A search can be reused when its history, restrictions, and search settings match. Engine results must contain a legal best move before the app uses them as suggestions.

The [review policy](../src/review-policy.js) first covers the full main line and then prioritizes unresolved moves for additional checks within a shared budget. It prioritizes the selected move during refinement. Stopping keeps completed work and restarting can reuse it. Changing the review mode or a policy version can require further analysis.

| Mode | Whole-game target | Depth targets for initial search, alternatives, and verification |
| --- | ---: | --- |
| Quick | 45 s | 14 / 17 / 18 |
| Balanced | 60 s | 16 / 19 / 20 |
| Deep | 90 s | 18 / 21 / 22 |

These are adaptive targets. Game length, hardware, cached positions, and remaining time affect how much checking actually finishes.

**Show Move** previews the recommended continuation from the position before the reviewed move. The preview follows up with an engine arrow on its final position when a legal recommendation is available. **Go back** restores the selected move. Playing a legal continuation after the preview saves the line as a variation. See the [playback code](../src/playback.js) and [review interface](../src/main.js).

## How moves are classified

Ordinary quality follows the change in estimated winning chances from the mover's perspective. The [classification code](../src/move-quality.js) defines the thresholds and handles equivalent best moves, mate transitions, opening matches, and positions with one legal move. An existing forced loss does not become a new blunder just because the mate distance changes.

Exceptional labels need additional evidence. [Classification analysis](../src/classification-analysis.js) checks root history, the mover, and whether the relevant searches are comparable before promoting a candidate.

| Label | Evidence required |
| --- | --- |
| Great | A critical resource with a verified gap to a distinct, legal alternative. A second complete same-depth comparison must support the gap. Routine equal recaptures are excluded. |
| Brilliant | A near-best piece sacrifice with verified compensation or a supported mating outcome. The review checks what happens if the offer is accepted. The bounded delayed-sacrifice check follows forcing replies and requires the initiating piece to continue the combination. |
| Miss | A verified opportunity created by the opponent's preceding mistake, followed by a move that gives up that opportunity. The two moves are checked from the relevant player's perspective. |

The [exceptional-move policy](../src/classification-policy.js) holds the numeric thresholds. A [short mate proof](../src/mate-proof.js) checks legal defenses within its search budget. Engine-supported mate is also possible when the short proof is inconclusive, with a different level of certainty. When a check cannot establish the exceptional label, the review keeps the supported ordinary label. These are System SCR's heuristics, and the regression fixtures cover only a sample of positions.

The opening index comes from the CC0 Lichess opening dataset. [The generator](../scripts/build-openings.mjs) accepts an upstream revision, and [the bundled index](../src/data/openings.json) records the revision it used.

## How the AI Coach works

The coach uses a fixed Intermediate explanation style. **Explain** checks the local cache first, reuses compatible review evidence, and may run bounded Stockfish searches for the selected move. Some terminal situations and clear material losses can be explained entirely locally.

If a cloud explanation is needed, the [Groq adapter](../src/coaching/groq.js) sends a compact report to `openai/gpt-oss-120b`. The report contains the played move, position, relevant board facts, legal continuations, and the uncertainty of the engine comparisons. Groq returns a summary, an optional comparison for **Show why**, and citations to the supplied evidence. The [local validator](../src/coaching/validation.js) checks the response structure, referenced evidence, and several kinds of unsupported chess claims. Arbitrary prose can still contain mistakes.

The completion ceilings are 896 tokens for routine moves and 1,600 for complex positions. The [quota ledger](../src/coaching/quota-browser.js) uses provider headers when available, reconciles reservations with reported usage, and prevents concurrent submissions across review tabs. The card shows loading while a request is pending. A failure or cooldown shows local feedback. Each explicit Explain or Retry action can submit at most one request. A compatible cache hit uses none.

## Verification and release material

- Run `npm test` for unit tests and `npm run test:browser` for the Chromium and Firefox regression suite.
- Run `npm run test:coaching` and `npm run test:lichess` for the service simulations. The [simulation README](../postman/README.md) explains the setup and fixture limits.
- Run `node scripts/benchmark-classifications.mjs --compare` and `node scripts/benchmark-mating-sacrifices.mjs` for the local Stockfish position corpora. Use `node scripts/benchmark-review.mjs --time=125` for a Quick whole-game benchmark, or pass 500 or 1000 for Balanced or Deep. [The comparison script](../scripts/compare-review.mjs) compares saved benchmark runs.
- Run `npm run benchmark:coaching` for the offline 240-position sample. The separate opt-in live pilot and [human scoring tool](../scripts/score-coaching.mjs) address model behavior, token usage, and explanation quality. Simulation and local fixtures do not establish those live results.
- Build the Firefox upload from the contents of `dist/` with `manifest.json` at the archive root. Provide the source and build instructions separately when submitting a bundled extension. See the [build and installation steps](../README.md#build-and-install).

Earlier design documents and benchmark snapshots remain available in Git history.
