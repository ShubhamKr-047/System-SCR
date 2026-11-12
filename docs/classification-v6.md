# Classification v6

V6 supersedes v5 where rules differ. Both classification and review-policy
versions are bumped, invalidating old labels and completion metadata.

## Recaptures and Great

A recapture requires the preceding move to have captured a piece, followed by a
capture on its destination. Recapture status is recorded for diagnostics. The
routine-exchange exclusion applies only when the captured piece types match,
neither the starting nor resulting position is check, and there is no promotion.
Other recaptures remain eligible for the reliable critical-gap comparisons.

Great retains two complete same-depth alternative comparisons and the prior
survival/winning conditions. An additional conversion route requires at least
85 estimated chances, an alternative at most 70, and a gap of at least 15 points.
No apparent improvement between independent searches can by itself award Great.

## Brilliant

Immediate offers retain v5 exchange screening and acceptance verification.
Delayed discovery inspects up to six PV plies from a reliable after-position
search. Every defensive step before the offer must have exactly one legal reply;
the mover must continue with the piece that initiated the combination. All
detected acceptances at the first qualifying offer are passed through the same
compensation and material-trace checks as immediate offers. History is preserved.
The short legal mate proof applies only to immediate offers; delayed offers use
engine verification. A later sacrifice by an unrelated piece cannot qualify.

This intentionally does not cover quiet or branching delayed combinations.
Discovery follows a bounded continuation, not an exhaustive tactical solver.
Pawn sacrifices remain outside this release.

The non-mating alternative rule retains the below-75 route and additionally
allows alternatives below 90 when the played move preserves at least ten more
chance points. Compensation, near-best quality, strongest-defense and acceptance
checks still apply. Existing confirmed-mate exceptions are retained.

These thresholds are provisional policy values centralized in
`src/classification-policy.js`. Unit tests cover their boundaries and the small
engine corpus checks regressions; they are not population-level calibration.

## Runtime and uncertainty

Quick/Balanced/Deep retain targets of 45/60/90 seconds and existing depth targets.
Delayed discovery adds no engine search itself. Candidate verification uses the
existing per-candidate and whole-game allowances. Tactical recaptures receive the
same short alternative screen as other candidates. Unresolved candidates retain their
supported ordinary labels. Diagnostics distinguish refuted, policy-excluded and
inconclusive sacrifices, and record delayed discovery and recapture status.

## Verification

Run `npm test`, `npm run build`, the classification/playback/review-speed browser
suites, `benchmark-mating-sacrifices.mjs`, `benchmark-classifications.mjs --compare`,
and whole-game `benchmark-review.mjs` at 125/500/1000. New tests exercise incorrect
recapture detection, delayed attribution and branching rejection, sound versus
unsound acceptance evidence, and conversion threshold boundaries. Mocked engine
tests establish decision flow; they do not establish tactical truth for new games.

### Local results, November 12, 2026

131 unit tests, 34 Chromium/Firefox classification, playback and review-progress
checks, and the production build passed. The engine position corpus passed
all 18 runs. Both supplied mating sacrifices remained Brilliant at all three
mode settings and on the deliberately exhausted-short-proof fallback path.

On the 81-ply Fischer-Spassky fixture, Quick took 41.1s, Balanced 46.8s and Deep
63.4s. Every warm repeat launched zero searches. Browser tests overlapped these
measurements, so these are observations under load, not latency guarantees.
The small corpus does not calibrate the new thresholds against a broad human
annotation set; that remains future validation work.
