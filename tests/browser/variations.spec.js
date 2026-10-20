import { test, expect } from "@playwright/test";

const PGN = '[White "Alice"]\n[Black "Bob"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *';

async function load(page, pgn = PGN) {
  await page.locator("#pgnFile").setInputFiles({ name: "game.pgn", mimeType: "text/plain", buffer: Buffer.from(pgn) });
  await expect(page.locator("#moveCounter")).toHaveText("Start");
}

async function play(page, from, to) {
  await page.locator(`[data-square="${from}"]`).click();
  await page.locator(`[data-square="${to}"]`).click();
}

const move = (page, label) => page.locator(`.move-chip[title="${label}"]`);
const pieces = page => page.locator("#board .square").evaluateAll(squares => squares.map(square => [square.dataset.square, square.querySelector("img")?.alt || ""]));

test.beforeEach(async ({ page }) => {
  // These tests use the packaged local engine, with optional external fonts disabled.
  await page.route("https://fonts.googleapis.com/**", route => route.abort());
  await page.route("https://fonts.gstatic.com/**", route => route.abort());
  await page.goto("/review.html");
});

test("variation analysis and Back to game restore the exact board and original continuation", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await load(page);
  await move(page, "2... Nc6").click();
  const original = await pieces(page);
  await play(page, "f1", "c4");
  await play(page, "g8", "f6");
  await expect(move(page, "3. Bc4").locator(".move-sign")).toBeVisible();
  await expect(move(page, "3... Nf6").locator(".move-sign")).toBeVisible();
  await expect(page.locator("#feedbackContent")).toContainText("Nf6");
  await expect(page.locator("#boardArrows line")).toHaveCount(1);
  await expect(page.locator("#resetVariationBtn")).toContainText("2... Nc6");
  await page.locator("#resetVariationBtn").click();
  await expect(page.locator("#moveCounter")).toHaveText("2... Nc6");
  expect(await pieces(page)).toEqual(original);
  await expect(page.locator("#variationIndicator")).toBeHidden();
  await page.locator("#nextMove").click();
  await expect(page.locator("#moveCounter")).toHaveText("3. Bb5");
  await move(page, "3... Nf6").click();
  await expect(page.locator("#feedbackContent")).toContainText("Nf6");
  await expect(page.locator("#moveList .move-chip")).toHaveCount(8);
  expect(errors).toEqual([]);
});

test("nested branches and multiple alternatives stay selectable", async ({ page }) => {
  await load(page);
  await move(page, "2... Nc6").click();
  await play(page, "f1", "c4");
  await play(page, "g8", "f6");
  await move(page, "3. Bc4").click();
  await play(page, "f8", "c5");
  await expect(page.locator("#parentVariationBtn")).toBeVisible();
  await page.locator("#parentVariationBtn").click();
  await expect(page.locator("#moveCounter")).toHaveText("3. Bc4");
  await expect(page.locator("#resetVariationBtn")).toContainText("2... Nc6");
  await page.locator("#resetVariationBtn").click();
  await play(page, "d2", "d4");
  await expect(move(page, "3. Bc4")).toBeVisible();
  await expect(move(page, "3... Bc5")).toBeVisible();
  await expect(move(page, "3. d4")).toBeVisible();
  await expect(page.locator("#moveList .move-chip")).toHaveCount(10);
  await move(page, "3... Nf6").click();
  await expect(page.locator("#moveCounter")).toHaveText("3... Nf6");
  await page.locator("body").press("ArrowLeft");
  await expect(page.locator("#moveCounter")).toHaveText("3. Bc4");
  await page.locator("body").press("ArrowRight");
  await expect(page.locator("#moveCounter")).toHaveText("3... Nf6");
  const outer = page.locator('details[data-branch="7"]');
  await outer.locator(":scope > summary").click();
  await expect(outer).not.toHaveAttribute("open");
  await outer.locator(":scope > summary").click();
  await expect(move(page, "3. Bc4")).toBeVisible();
});

test("original-game accuracy and feedback survive branching and returning", async ({ page }) => {
  await load(page);
  await page.locator("#startReview").click();
  await expect(page.locator("#startReviewText")).toHaveText("Start", { timeout: 30000 });
  const white = await page.locator("#summaryWhiteAcc").textContent();
  const black = await page.locator("#summaryBlackAcc").textContent();
  await page.locator("#tabMoves").click();
  await move(page, "2... Nc6").click();
  const feedback = await page.locator("#feedbackContent").textContent();
  await play(page, "f1", "c4");
  await expect(move(page, "3. Bc4").locator(".move-sign")).toBeVisible();
  await expect(page.locator("#summaryWhiteAcc")).toHaveText(white);
  await expect(page.locator("#summaryBlackAcc")).toHaveText(black);
  await page.locator("#resetVariationBtn").click();
  await expect(page.locator("#feedbackContent")).toHaveText(feedback);
  await expect(page.locator("#startReviewText")).toHaveText("Start");
});

test("leaving a variation during analysis and importing another game cannot overwrite the new board", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await load(page);
  await move(page, "2... Nc6").click();
  await play(page, "f1", "c4");
  await play(page, "g8", "f6");
  await page.locator("#resetVariationBtn").click();
  await expect(page.locator("#moveCounter")).toHaveText("2... Nc6");
  await load(page, '[White "New Game"]\n\n1. d4 d5 *');
  await expect(page.locator("#moveList .move-chip")).toHaveCount(2);
  await expect(page.locator("#bottomPlayerName")).toHaveText("New Game");
  await expect.poll(() => page.locator("#boardArrows line").count()).toBe(1);
  await expect(page.locator("#moveCounter")).toHaveText("Start");
  await expect(page.locator("#moveList .move-chip")).toHaveCount(2);
  await expect(page.locator("#resetVariationBtn")).toBeHidden();
  expect(errors).toEqual([]);
});

test("underpromotion picker supports custom FEN and terminal-position analysis", async ({ page }) => {
  await load(page, '[SetUp "1"]\n[FEN "7k/P7/8/8/8/8/8/7K w - - 0 30"]\n\n30. a8=Q+ *');
  await play(page, "a7", "a8");
  await expect(page.locator("#promotionDialog")).toBeVisible();
  await page.getByRole("button", { name: "Knight", exact: true }).click();
  await expect(page.locator("#moveCounter")).toHaveText("30. a8=N");
  await expect(page.locator('[data-square="a8"] img')).toHaveAttribute("alt", "White n");
  await expect(move(page, "30. a8=N").locator(".move-sign")).toBeVisible();
  await page.locator("#resetVariationBtn").click();
  await expect(page.locator('[data-square="a7"] img')).toHaveAttribute("alt", "White p");
  await expect(page.locator("#moveCounter")).toHaveText("Start");
});

test("exploring during full-game review stops it safely and resumes retained results", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await load(page);
  await page.locator("#startReview").click();
  // Let one original move finish so resuming must preserve its result.
  await page.locator("#tabMoves").click();
  await expect(move(page, "1. e4").locator(".move-sign")).toBeVisible();
  await move(page, "2... Nc6").click();
  await play(page, "f1", "c4");
  await expect(page.locator("#stopReview")).toBeHidden();
  await expect(move(page, "3. Bc4").locator(".move-sign")).toBeVisible();
  await expect(move(page, "1. e4").locator(".move-sign")).toBeVisible();
  await page.locator("#resetVariationBtn").click();
  await expect(page.locator("#moveCounter")).toHaveText("2... Nc6");
  await page.locator("#startReview").click();
  await expect(page.locator("#startReviewText")).toHaveText("Start", { timeout: 30000 });
  await page.locator("#tabMoves").click();
  await expect(move(page, "3. Bc4")).toBeVisible();
  await expect(move(page, "3... a6").locator(".move-sign")).toBeVisible();
  expect(errors).toEqual([]);
});

test("board flipping, keyboard navigation, and identical moves preserve existing branches", async ({ page }) => {
  await load(page);
  await move(page, "2... Nc6").click();
  await play(page, "f1", "c4");
  await expect(move(page, "3. Bc4").locator(".move-sign")).toBeVisible();
  const evaluation = await page.locator("#evalBarScore").textContent();
  await page.screenshot({ path: test.info().outputPath("variation-explorer.png") });
  await page.locator("#hamburgerBtn").click();
  await page.locator("#flipBoard").click();
  await page.locator("#closeHamburgerBtn").click();
  await expect(page.locator("#board .square").first()).toHaveAttribute("data-square", "h1");
  await expect(page.locator("#evalBarScore")).toHaveText(evaluation);
  await page.locator("body").press("ArrowLeft");
  await expect(page.locator("#moveCounter")).toHaveText("2... Nc6");
  await play(page, "f1", "c4");
  await expect(page.locator("#moveList .move-chip")).toHaveCount(7);
  await expect(page.locator("#moveCounter")).toHaveText("3. Bc4");
  await page.locator("#resetVariationBtn").click();
  await page.locator("body").press("ArrowRight");
  await expect(page.locator("#moveCounter")).toHaveText("3. Bb5");
});
