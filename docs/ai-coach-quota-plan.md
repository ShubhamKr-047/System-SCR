# Fewer cooldowns when explaining consecutive moves

Aim for more usable explanations per minute on the existing Groq free account. Keep generation behind Explain, allow at most one provider request per click, and use cached explanations or verified local feedback whenever possible.

## 1. Measure where explanations are lost

Instrument the production controller, Groq adapter and IndexedDB quota ledger. Distinguish a cache hit, a local answer, a local estimate exceeding available capacity, a busy tab, an HTTP 429, cancellation, timeout, truncation, and rejected prose. Record token estimates, provider-reported prompt and completion usage, cached token counts when available, and the retry window. Collect only numeric measurements and outcome codes locally. Measure valid explanations per click as well as tokens per valid answer.

## 2. Generate only what the card uses

The current card displays the summary and an optional comparison under Show why. Remove the hidden lesson and top-level display line IDs from the response schema and prompt. Preserve claim citations and the line evidence that lets the validator check material gains and conditional mates. Update the validator, mock and cache version together. Keep existing verified local shortcuts ahead of cloud admission.

## 3. Give ordinary moves a smaller measured budget

The current reservation estimates the entire serialized request at one token per three bytes, then adds 2,048 completion tokens for every position. Calibrate the input estimate against actual prompt usage, including structured output overhead. Test a lower reasoning effort and smaller output ceiling for routine moves. Retain a larger allowance for tactical comparisons, sacrifices and conditional mates. Use the chosen ceiling both in the HTTP request and in the local reservation. Keep the smallest budget that reliably returns complete, validated explanations in each group. A truncated response also spends quota.

## 4. Correct the quota ledger and retry time

Use valid provider limit and remaining headers for the dimensions they describe. Keep conservative fallback limits for missing dimensions. Groq documents the request headers in daily requests and token headers in tokens per minute. Respect HTTP 429 Retry-After and never infer that capacity is available solely from a local timer. Account for reported cache hits when calculating rate-limited token use.

Refund unused reservations and restore locally debited header balances when cancelled before submission. Reconcile completed requests from reported usage even if their prose fails validation. For an interrupted submission with unknown usage, retain a bounded estimate. Avoid carrying a full completion reservation forward as known consumption after an explicit rejection. When a local rolling window is full, calculate when enough records expire for this specific request, considering both token and request counts. Use separate status messages for a local wait and a Groq rejection.

Provider reference: [Groq rate limits and response headers](https://console.groq.com/docs/rate-limits).

## 5. Verify the consecutive-click experience

Replay the same ordinary and tactical positions with the old and proposed budgets. Exercise the actual browser ledger in Chromium and Firefox with realistic usage and header fixtures, including absent headers, multiple tabs, cancellation and genuine 429s. Require two consecutive ordinary uncached moves to return valid explanations without waiting when the simulated capacity covers both. Require cached revisits to make zero requests, and a click during a confirmed cooldown to show local feedback without another POST.

Compare local blocks, provider 429s, tokens per valid explanation, truncation, and factual quality on held-out positions. Confirm the selected budgets with a small opt-in live sample before adopting them as defaults. Simulation verifies browser behavior. Actual model usage and human review determine whether the lower budgets preserve explanation quality.


## Implementation and calibration status

Prompt version 9 requests a summary, optional comparison and claims. The initial
completion ceilings are 896 tokens with low reasoning for routine moves and
1,600 with medium reasoning for complex moves. The reservation estimates model
input from the messages and schema rather than the escaped HTTP request. The
local benchmark exercises 240 positions and records the selected ceilings and
estimated prompt tokens. With an opt-in live run it also records the difference
between estimated and reported prompt usage.

The browser ledger distinguishes local and provider waits, uses valid
remaining-capacity headers while they are current, and reconciles reported
usage with a cached-input discount. A retry during an active 429 cooldown
shows local feedback. Uncertain submissions keep their reservation.

The ceilings are provisional. The Groq key was unavailable for the opt-in
pilot, so prompt calibration, live truncation rates and human-rated chess
quality comparison are still open.
