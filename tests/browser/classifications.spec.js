import { test, expect } from "@playwright/test";

test("local review classifies mate threats and preserves game labels while exploring", async ({ page }) => {
  const errors = [];
  const aiRequests = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (/generativelanguage|api\.groq/.test(request.url())) aiRequests.push(request.url()); });
  await page.route("https://fonts.googleapis.com/**", route => route.abort());
  await page.route("https://fonts.gstatic.com/**", route => route.abort());
  await page.goto("/review.html");
  await page.locator("#pgnFile").setInputFiles({ name: "mate.pgn", mimeType: "text/plain",
    buffer: Buffer.from("1. f3 e5 2. g4 Qh4# 0-1") });
  await page.locator("#summaryReviewBtn").click();
  await expect(page.locator("#summaryStartBtn")).toBeVisible({ timeout: 30000 });
  await expect(page.locator(".breakdown-name").filter({ hasText: /^Forced$/ })).toHaveCount(1);
  const white = await page.locator("#summaryWhiteAcc").textContent();
  const black = await page.locator("#summaryBlackAcc").textContent();
  await page.locator("#summaryStartBtn").click();
  await page.locator('.move-chip[title="2. g4"]').click();
  await expect(page.locator(".feedback-header-box")).toHaveClass(/blunder/);
  await expect(page.locator(".feedback-header-box")).toHaveAttribute("title", /forced checkmate/);
  await expect(page.locator(".stockfish-continuation")).toBeVisible();
  await page.locator('.move-chip[title="2... Qh4#"]').click();
  await expect(page.locator(".feedback-header-box")).toHaveClass(/best/);
  await expect(page.locator("#evalBarScore")).toHaveText("M0");
  await page.locator('.move-chip[title="1... e5"]').click();
  await page.locator('[data-square="g2"]').click();
  await page.locator('[data-square="g3"]').click();
  await expect(page.locator(".feedback-header-box")).toBeVisible();
  await expect(page.locator("#summaryWhiteAcc")).toHaveText(white);
  await expect(page.locator("#summaryBlackAcc")).toHaveText(black);
  await page.locator("#resetVariationBtn").click();
  await page.locator('.move-chip[title="2. g4"]').click();
  await expect(page.locator(".feedback-header-box")).toHaveClass(/blunder/);
  expect(aiRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test("deep opening recognition reports the recognized opening line", async ({ page }) => {
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.route("https://fonts.googleapis.com/**", route => route.abort());
  await page.route("https://fonts.gstatic.com/**", route => route.abort());
  await page.goto("/review.html");
  await page.locator("#pgnFile").setInputFiles({ name: "opening.pgn", mimeType: "text/plain",
    buffer: Buffer.from("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O *") });
  await page.keyboard.press("ArrowRight");
  // Imported moves are reviewed explicitly; a variation move is reviewed immediately.
  await page.locator('.move-chip[title="5. O-O"]').click();
  await page.locator('[data-square="f8"]').click();
  await page.locator('[data-square="e7"]').click();
  await expect(page.locator(".feedback-header-box")).toHaveClass(/book/);
  await expect(page.locator(".feedback-header-box")).toHaveAttribute("title", /Recognized opening line:.*Ruy Lopez/);
  expect(errors).toEqual([]);
});

test("a large centipawn advantage is displayed as a score, not a fabricated mate", async ({ page }) => {
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.route("https://fonts.googleapis.com/**", route => route.abort());
  await page.route("https://fonts.gstatic.com/**", route => route.abort());
  await page.goto("/review.html");
  await page.locator("#pgnFile").setInputFiles({ name: "material.pgn", mimeType: "text/plain",
    buffer: Buffer.from('[SetUp "1"]\n[FEN "1nb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQk - 0 1"]\n\n1. e4 *') });
  await expect.poll(async () => Number(await page.locator("#evalBarScore").textContent())).toBeGreaterThan(9);
  await expect(page.locator("#evalBarScore")).not.toContainText("M");
  expect(errors).toEqual([]);
});
