# Verified mating sacrifices (classification and policy v4)

> See [classification v5](classification-v5.md) for current evidence, mate,
> material-trace, Great and Miss rules.

This supersedes the mating-sacrifice and time-budget rules in review-v3.md.

The reported regressions are Opera 16.Qb8+ and shubham_kr_47–mana1414
27.Rxa6+. Both offer material and force mate, but v3 required a complete MultiPV
comparison and an alternative below 75% estimated winning chances. These gates
blocked Brilliant despite the engine already finding mate.

For detected material offers with a favorable engine mate score, a bounded
AND/OR verifier searches the actual position with full move history. Every legal
defender response must lead to mate; attacker moves are restricted to checks.
That restriction can miss a proof but cannot create a false positive. Search is
limited to five remaining plies, 3,000 visited nodes and at most 150ms within the
remaining candidate and game budgets. Unknown, timeout, terminal draws and
defensive escapes cannot award Brilliant. Chess state is restored on every exit.

A successful proof permits Brilliant in an already winning position and bypasses
the alternatives gate. The existing material-offer detection still excludes
ordinary exchanges, promotions and already exposed pieces. Non-mating sacrifices
retain the existing compensation checks and already-winning restriction. Mate
without a qualifying material offer remains an ordinary best move.

EngineQueue now preserves the deepest complete MultiPV snapshot consistent with
the returned bestmove. It retains the newer partial primary separately as
latestPrimary. Candidate stability uses only iterations up to the chosen depth;
different depths are never combined into one comparison.

Sacrifice status distinguishes verified, refuted, excluded-already-winning and
inconclusive. Unfinished checks remain visible in result feedback. Classification
and policy versions invalidate old completion metadata.

| Mode | Initial allowance | Verification allowance | Startup/UI reserve | Target |
| --- | --- | --- | --- | --- |
| Quick | 15s | 25s | 5s | 45s |
| Thorough | 20s | 35s | 5s | 60s |
| Deep | 30s | 53s | 7s | 90s |

These are shared elapsed-time targets. Short or stable games can finish early;
mandatory initial evaluations, engine overhead and unusually long games can
exceed the target. Depth targets remain adaptive as documented in v3.

Validation: npm test; npm run build; node scripts/benchmark-mating-sacrifices.mjs;
and the classification, review-speed and playback Playwright suites. The new
fixtures preserve both complete game continuations. Browser regressions require
the exact Brilliant label in all three modes in Chromium and Firefox. Isolated
engine checks require both Brilliant and a successful legal mate proof in every
mode. Unit tests cover incomplete MultiPV tails, exhausted proof budgets, defender
escapes, draws and restoration of board/history. These cases do not establish
universal agreement with a proprietary move classifier.

Local validation on November 9, 2026: 103 unit tests and all 32 browser tests
passed, including both reported moves in every mode in Chromium and Firefox.
The production build passed. All six isolated engine checks returned Brilliant
with verified mate proofs (3 visited positions for Qb8+, 10 for Rxa6+).
