import { test, expect } from "@playwright/test";

for (const provider of ["gemini", "groq"]) {
  test(`${provider}: Stockfish stays independent before, during and after AI explanations`, async ({ page }) => {
    const errors = [];
    let requests = 0;
    page.on("pageerror", error => errors.push(error.message));
    await page.route("https://fonts.googleapis.com/**", route => route.abort());
    await page.route("https://fonts.gstatic.com/**", route => route.abort());
    await page.route(/^https:\/\/(generativelanguage\.googleapis\.com|api\.groq\.com)\//, async route => {
      requests++;
      const request = route.request();
      const url = new URL(request.url());
      const member = url.hostname === "api.groq.com" ? "groq" : "gemini";
      const response = await route.fetch({ url: `http://127.0.0.1:4900/${member}${url.pathname}` });
      await route.fulfill({ response });
    });
    await page.goto("/review.html");
    await page.locator("#pgnFile").setInputFiles({ name: "game.pgn", mimeType: "text/plain", buffer: Buffer.from("1. e4 e5 *") });
    await page.locator('[data-square="f2"]').click();
    await page.locator('[data-square="f3"]').click();
    await expect(page.locator("#askAiCoachingBtn")).toBeVisible();
    await page.locator("#topbarMenuBtn").click();
    await page.locator("#aiProvider").selectOption(provider);
    await page.locator("#aiApiKey").fill("test-delayed");
    await page.locator("#saveAiKey").click();
    await page.locator("#closeHamburgerBtn").click();
    expect(requests).toBe(0);
    const line = await page.locator(".stockfish-continuation .pv-line").innerText();
    await expect(page.locator("#showContinuationBtn")).toBeEnabled();
    await expect(page.locator("#positionFeedback")).toHaveCount(0);
    await page.locator("#askAiCoachingBtn").click();
    await expect(page.locator("#aiCoachStatus")).toContainText("is explaining");
    await expect(page.locator(".stockfish-continuation .pv-line")).toHaveText(line);
    await expect(page.locator("#showContinuationBtn")).toBeEnabled();
    const chips = await page.locator("#moveList .move-chip").count();
    await page.locator("#showContinuationBtn").click();
    await expect(page.locator("#continuationPreviewStatus")).toContainText(line.split(/\s+/)[0]);
    await expect(page.locator(".ai-guidance-card")).toContainText("Explanation for f3");
    await expect(page.locator(".ai-guidance-card .pv-line")).toHaveCount(0);
    await expect(page.locator(".stockfish-continuation")).toHaveCount(1);
    await page.locator("#returnFromPreview").click();
    await expect(page.locator("#moveCounter")).toHaveText("1. f3");
    await expect(page.locator('[data-square="f3"] img')).toHaveAttribute("alt", "White p");
    await expect(page.locator(".ai-guidance-card")).toContainText("Explanation for f3");
    await expect(page.locator(".stockfish-continuation .pv-line")).toHaveText(line);
    await expect(page.locator("#moveList .move-chip")).toHaveCount(chips);
    expect(requests).toBe(1);
    // Provider failures must not hide or duplicate the local engine card.
    await page.locator("#topbarMenuBtn").click();
    await page.locator("#aiApiKey").fill("test-quota");
    await page.locator("#saveAiKey").click();
    await page.locator("#closeHamburgerBtn").click();
    await page.locator("#askAiCoachingBtn").click();
    await expect(page.locator("#aiCoachStatus")).toContainText("quota or rate limit");
    await expect(page.locator(".stockfish-continuation .pv-line")).toHaveText(line);
    await expect(page.locator(".stockfish-continuation")).toHaveCount(1);
    await expect(page.locator("#showContinuationBtn")).toBeEnabled();
    expect(requests).toBe(2);
    expect(errors).toEqual([]);
  });
}
