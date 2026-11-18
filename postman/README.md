# Groq coaching simulation

The active simulation serves the repository-owned Groq mock at `/groq`. It verifies POST `/openai/v1/chat/completions`, Bearer authentication, model `openai/gpt-oss-120b`, system/user messages, and strict JSON schema. The report contains positions, facts, comparisons and legal supporting lines, without explanation options. Responses contain natural `summary`, nullable `comparison`/`lesson`, `lineIds`, and structured `claims`. JSON shape does not prove chess correctness.

Run `npm run test:coaching` with Postman CLI 1.75+. Playwright starts the built review page on 4173 and `postman simulation` on 4900, forwards production Groq fetches to the local mock, and checks request counts and UI results in Chromium and Firefox. Simulation request events establish that the caller exercised the POST path. No live keys, remote resources, or deployments are used. The historical Gemini mock is retired and absent from the active simulation.

Test-only credentials select success, delayed response, 401, 429 with Retry-After, 503, malformed output, refusal, unsupported prose, HTML, verbosity, and token truncation. Unknown routes return 501; `/health` is readiness only. No fixture key should be used against the live API.

Browser coverage includes manual requests, natural prose, report privacy, persistent storage, local playback, duplicate clicks, cross-tab admission, disabled coaching, and no automatic retries. Local unit tests cover legal replay, known sacrifice/exchange regressions, response checks and conservative quota reservations. The original owner-maintained mock discovery required login; the existing repository mock is retained and updated against Groq's documented contract. Stand-ins do not establish live model access, account quotas, natural explanation quality, or human usefulness scores.

Sources: [chat API](https://console.groq.com/docs/api-reference), [structured output](https://console.groq.com/docs/structured-outputs), [rate limits](https://console.groq.com/docs/rate-limits).
