import { test, expect } from "@playwright/test";

for (const provider of ["gemini", "groq"]) {
test.describe(provider, () => {
const name = provider === "groq" ? "Groq" : "Gemini";
const PGN = '1. e4 e5 2. Nf3 Nc6 *';
const requests = new WeakMap();
const errors = new WeakMap();
async function play(page, from, to) {
  await page.locator(`[data-square="${from}"]`).click();
  await page.locator(`[data-square="${to}"]`).click();
}
async function key(page, value) {
  await page.locator("#openAiSettingsBtn").click();
  await page.locator("#aiApiKey").fill(value);
  await page.locator("#saveAiKey").click();
  await page.locator("#hamburgerBtn").click();
}
async function askAi(page) {
  await page.locator("#askAiCoachingBtn").click();
}
const local = page => page.locator('#positionFeedback[data-source="local"]');
const ai = page => page.locator(`#positionFeedback[data-source="${provider}"]`);

test.beforeEach(async ({ page }) => {
  requests.set(page, []);
  errors.set(page, []);
  page.on("pageerror", error => errors.get(page).push(error.message));
  await page.route("https://fonts.googleapis.com/**", route => route.abort());
  await page.route("https://fonts.gstatic.com/**", route => route.abort());
  // Proxy the production fetch over real HTTP to the contract simulation.
  await page.route(/^https:\/\/(generativelanguage\.googleapis\.com|api\.groq\.com)\//, async route => {
    const request = route.request();
    requests.get(page).push({ url: request.url(), headers: request.headers(), body: request.postDataJSON() });
    const url = new URL(request.url());
    const routeKey = url.hostname === "api.groq.com" ? "groq" : "gemini";
    const response = await route.fetch({ url: `http://127.0.0.1:4900/${routeKey}${url.pathname}`, timeout: 35000 });
    await route.fulfill({ response }).catch(() => {}); // Navigation may have cancelled the browser request.
  });
  await page.goto("/review.html");
  await page.locator("#pgnFile").setInputFiles({ name: "game.pgn", mimeType: "text/plain", buffer: Buffer.from(PGN) });
  await play(page, "e2", "e3");
  await expect(local(page)).toBeVisible();
  await page.locator("#openAiSettingsBtn").click();
  await page.locator("#aiProvider").selectOption(provider);
  await page.locator("#hamburgerBtn").click();
});

test.afterEach(async ({ page }) => {
  // A timed-out browser fetch can leave its HTTP proxy request finishing on the server.
  await page.unrouteAll({ behavior: "wait" });
  expect(errors.get(page)).toEqual([]);
});

test("no key preserves local feedback, explains setup, and sends no requests", async ({ page }) => {
  await expect(page.locator("#feedbackContent")).toContainText("About move explanations");
  await expect(local(page)).toContainText("Feedback");
  await expect(page.locator("#feedbackContent")).not.toContainText("Unlock Grandmaster");
  expect(requests.get(page)).toHaveLength(0);
});

test("AI replaces generic feedback with engine-grounded breakdown and caches each variation", async ({ page }) => {
  await key(page, "test-success");
  expect(requests.get(page)).toHaveLength(0);
  await expect(page.locator("#askAiCoachingBtn")).toBeVisible();
  await expect(page.locator(".ai-prompt-question")).toContainText("Want to know why this move was");
  await askAi(page);
  await expect(ai(page)).toContainText("Explanation for e3");
  await page.locator("#feedbackContainer").focus();
  await page.locator("#feedbackContainer").press("ArrowDown");
  await expect(page.locator("#moveCounter")).toHaveText("1. e3");
  for (const title of ["Tactical breakdown", "Positional breakdown", "Why Stockfish recommends this", "Practical takeaway"]) {
    await expect(ai(page)).toContainText(title);
  }
  const sent = requests.get(page)[0];
  expect(sent.url).not.toContain("key=");
  if (provider === "groq") {
    expect(sent.headers.authorization).toBe("Bearer test-success");
    expect(sent.headers["x-goog-api-key"]).toBeUndefined();
    expect(sent.body.model).toBe("openai/gpt-oss-120b");
    expect(sent.body.response_format.json_schema.strict).toBe(true);
  } else {
    expect(sent.headers["x-goog-api-key"]).toBe("test-success");
    expect(sent.headers.authorization).toBeUndefined();
  }
  const context = JSON.parse(provider === "groq" ? sent.body.messages[1].content : sent.body.contents[0].parts[0].text);
  expect(context.before.sideToMove).toBe("White");
  expect(context.after.sideToMove).toBe("Black");
  expect(context.after.pieces.White).toContain("pawn on e3");
  expect(context.stockfish.recommendedLine.length).toBeGreaterThan(0);
  expect(context.stockfish.opponentLine.length).toBeGreaterThan(0);
  await expect(page.locator("#aiStatus")).toHaveAttribute("title", `${name} connection verified`);
  await play(page, "c7", "c5");
  await expect(page.locator("#askAiCoachingBtn")).toBeVisible();
  await askAi(page);
  await expect(ai(page)).toContainText("Explanation for c5");
  const count = requests.get(page).length;
  await page.locator('.move-chip[title="1. e3"]').click();
  await expect(ai(page)).toContainText("Explanation for e3");
  expect(requests.get(page)).toHaveLength(count);
  await page.locator("#openAiSettingsBtn").click();
  await page.locator("#moveTime").selectOption("1000");
  await page.locator("#hamburgerBtn").click();
  await expect(page.locator("#askAiCoachingBtn")).toBeVisible();
  await askAi(page);
  await expect.poll(() => requests.get(page).length).toBe(count + 1);
  await expect(ai(page)).toContainText("Explanation for e3");
  const body = requests.get(page).at(-1).body;
  const refreshed = JSON.parse(provider === "groq" ? body.messages[1].content : body.contents[0].parts[0].text);
  expect(refreshed.stockfish.search.before.moveTime).toBe(1000);
});

for (const [value, message] of [
  ["test-invalid", provider === "groq" ? "could not authenticate" : "access was denied"],
  ["test-quota", "quota or rate limit"],
  ["test-unavailable", "temporarily unavailable"],
  ["test-malformed", "incomplete or invalid"],
  ["test-blocked", "incomplete or invalid"]
]) {
  test(`${value} retains local feedback and offers explicit retry`, async ({ page }) => {
    await key(page, value);
    await askAi(page);
    await expect(page.locator("#aiCoachStatus")).toContainText(message);
    await expect(local(page)).toBeVisible();
    const count = requests.get(page).length;
    await page.locator("#retryAiCoaching").click();
    await expect.poll(() => requests.get(page).length).toBe(count + 1);
    await expect(page.locator("#aiCoachStatus")).toContainText(message);
    await expect(page.locator("#aiStatus")).toHaveClass(/error/);
  });
}

test("local feedback stays while loading and an old response cannot replace another move", async ({ page }) => {
  await key(page, "test-delayed");
  await askAi(page);
  await expect(page.locator("#aiCoachStatus")).toContainText(`${name} is explaining`);
  await expect(local(page)).toBeVisible();
  await page.locator("body").press("f");
  expect(requests.get(page)).toHaveLength(1);
  await play(page, "c7", "c5");
  await askAi(page);
  await expect(ai(page)).toContainText("Explanation for c5");
  await expect(ai(page)).not.toContainText("Explanation for e3");
});

test("removing a key during a request keeps local feedback and discards the response", async ({ page }) => {
  await key(page, "test-delayed");
  await askAi(page);
  await expect.poll(() => requests.get(page).length).toBe(1);
  await page.locator("#openAiSettingsBtn").click();
  await page.locator("#clearAiKey").click();
  await expect(page.locator("#aiConnectionStatus")).toContainText(`no ${name} API key`);
  await expect(local(page)).toBeVisible();
  await expect(page.locator("#aiCoachStatus")).toHaveCount(0);
  // Let the HTTP simulation finish to exercise the late-result guard.
  await expect.poll(() => page.evaluate(id => localStorage.getItem(`zen-chess-${id}-key`), provider) ).toBeNull();
  await page.waitForTimeout(2300);
  await expect(local(page)).toBeVisible();
  await expect(ai(page)).toHaveCount(0);
});

test("AI text is rendered as text, never executable HTML", async ({ page }) => {
  await key(page, "test-html");
  await askAi(page);
  await expect(ai(page)).toContainText("<img src=x");
  await expect(ai(page).locator("img")).toHaveCount(0);
  expect(await page.evaluate(() => window.aiInjected)).toBeUndefined();
});

test("timeout ends loading and preserves local feedback", async ({ page }) => {
  await key(page, "test-timeout");
  await askAi(page);
  await expect(page.locator("#aiCoachStatus")).toContainText("took too long", { timeout: 30000 });
  await expect(local(page)).toBeVisible();
  await expect(page.locator("#retryAiCoaching")).toBeVisible();
});

test("original game and nested variations each retain their own explanation", async ({ page }) => {
  await key(page, "test-success");
  await askAi(page);
  await expect(ai(page)).toContainText("Explanation for e3");
  await play(page, "c7", "c5");
  await askAi(page);
  await expect(ai(page)).toContainText("Explanation for c5");
  await page.locator('.move-chip[title="1. e3"]').click();
  await play(page, "d7", "d5");
  await askAi(page);
  await expect(ai(page)).toContainText("Explanation for d5");
  await page.locator("#parentVariationBtn").click();
  await expect(ai(page)).toContainText("Explanation for e3");
  await page.locator("#startReview").click();
  await expect(page.locator("#startReviewText")).toHaveText("Start", { timeout: 30000 });
  await page.locator("#tabMoves").click();
  await page.locator('.move-chip[title="1. e4"]').click();
  // 1. e4 is a book move: no prompt question and no AI coaching requested
  await expect(page.locator("#askAiCoachingBtn")).toHaveCount(0);
  await expect(page.locator(".ai-prompt-card")).toHaveCount(0);
});

test("importing another game while AI is pending cannot attach the old explanation", async ({ page }) => {
  await key(page, "test-delayed");
  await askAi(page);
  await expect.poll(() => requests.get(page).length).toBe(1);
  await page.locator("#pgnFile").setInputFiles({ name: "next.pgn", mimeType: "text/plain", buffer: Buffer.from("1. d4 d5 *") });
  await expect(page.locator("#moveCounter")).toHaveText("Start");
  await play(page, "c2", "c4");
  await askAi(page);
  await expect(ai(page)).toContainText("Explanation for c4");
  await expect(ai(page)).not.toContainText("Explanation for e3");
});

test("switching providers isolates keys, cancels late results, restores caches, and remembers selection", async ({ page }) => {
  const other = provider === "gemini" ? "groq" : "gemini";
  const otherName = other === "groq" ? "Groq" : "Gemini";
  await key(page, "test-delayed");
  await askAi(page);
  await expect.poll(() => requests.get(page).length).toBe(1);
  await page.locator("#openAiSettingsBtn").click();
  await page.locator("#aiProvider").selectOption(other);
  await expect(page.locator("#aiApiKey")).toHaveValue("");
  await expect(local(page)).toBeVisible();
  expect(requests.get(page)).toHaveLength(1);
  await page.locator("#aiApiKey").fill("test-success");
  await page.locator("#saveAiKey").click();
  await page.locator("#hamburgerBtn").click();
  await askAi(page);
  await expect(page.locator(`#positionFeedback[data-source="${other}"]`)).toContainText("Explanation for e3");
  await page.locator("#openAiSettingsBtn").click();
  await page.locator("#aiProvider").selectOption(provider);
  await expect(page.locator("#aiApiKey")).toHaveValue("test-delayed");
  await page.locator("#hamburgerBtn").click();
  await expect(ai(page)).toContainText("Explanation for e3");
  const count = requests.get(page).length;
  await page.locator("#openAiSettingsBtn").click();
  await page.locator("#aiProvider").selectOption(other);
  await expect(page.locator("#aiApiKey")).toHaveValue("test-success");
  await expect(page.locator(`#positionFeedback[data-source="${other}"]`)).toBeVisible();
  expect(requests.get(page)).toHaveLength(count);
  await page.locator("#clearAiKey").click();
  await expect(local(page)).toBeVisible();
  expect(await page.evaluate(id => localStorage.getItem(`zen-chess-${id}-key`), provider)).toBe("test-delayed");
  await page.reload();
  await page.locator("#hamburgerBtn").click();
  await expect(page.locator("#aiProvider")).toHaveValue(other);
  await expect(page.locator("#aiApiKey")).toHaveValue("");
  await expect(page.locator("#aiConnectionStatus")).toContainText(`no ${otherName} API key`);
});

test("book moves and forced moves do not ask for AI coaching or send requests", async ({ page }) => {
  await key(page, "test-success");
  await page.locator("#startReview").click();
  await expect(page.locator("#startReviewText")).toHaveText("Start", { timeout: 30000 });
  await page.locator("#tabMoves").click();
  await page.locator('.move-chip[title="1. e4"]').click();
  await expect(page.locator("#askAiCoachingBtn")).toHaveCount(0);
  await expect(page.locator(".ai-prompt-card")).toHaveCount(0);
  expect(requests.get(page)).toHaveLength(0);
});

});
}
