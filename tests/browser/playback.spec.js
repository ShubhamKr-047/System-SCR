import { test, expect } from "@playwright/test";

const PGN = '1. e4 e5 2. Nf3 Nc6 *';
const pageErrors = new WeakMap();
const pieces = page => page.locator("#board .square").evaluateAll(squares => squares.map(square => [square.dataset.square, square.querySelector("img")?.alt || ""]));
async function load(page, pgn = PGN) {
  await page.locator("#pgnFile").setInputFiles({ name: "game.pgn", mimeType: "text/plain", buffer: Buffer.from(pgn) });
}
async function play(page, from, to) {
  await page.locator(`[data-square="${from}"]`).click();
  await page.locator(`[data-square="${to}"]`).click();
}
test.beforeEach(async ({ page }) => {
  pageErrors.set(page, []);
  page.on("pageerror", error => pageErrors.get(page).push(error.message));
  await page.route("https://fonts.googleapis.com/**", route => route.abort());
  await page.route("https://fonts.gstatic.com/**", route => route.abort());
  await page.goto("/review.html");
});
test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page)).toEqual([]);
});

test("playing the first move opens Moves; only the navbar menu remains", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await load(page);
  await expect(page.locator("#gameSummaryView")).toBeVisible();
  await play(page, "f2", "f3");
  await expect(page.locator("#gameMovesView")).toBeVisible();
  await expect(page.locator("#gameSummaryView")).toBeHidden();
  await expect(page.getByRole("button", { name: "Menu", exact: true })).toHaveCount(1);
  await expect(page.locator("#hamburgerBtn, #openAiSettingsBtn, .dock-progress-wrapper")).toHaveCount(0);
  await page.locator("#topbarMenuBtn").click();
  await expect(page.locator("#hamburgerMenu")).toBeVisible();
  await expect(page.locator("#aiProvider")).toBeVisible();
  await page.locator("#closeHamburgerBtn").click();
  await expect(page.locator("#topbarMenuBtn")).toHaveAttribute("aria-expanded", "false");
  expect(errors).toEqual([]);
});

test("AutoPlay advances original moves, pauses, restarts at the end and stops on navigation", async ({ page }) => {
  await load(page);
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#gameMovesView")).toBeVisible();
  await page.locator("#startReview").click();
  await expect(page.locator("#startReviewText")).toHaveText("Pause");
  await expect(page.locator("#moveCounter")).toHaveText("1... e5");
  await page.locator("#startReview").click();
  await expect(page.locator("#startReviewText")).toHaveText("Play");
  await page.waitForTimeout(1250);
  await expect(page.locator("#moveCounter")).toHaveText("1... e5");
  await page.locator("#startReview").click();
  await expect(page.locator("#moveCounter")).toHaveText("2... Nc6", { timeout: 6000 });
  await expect(page.locator("#startReviewText")).toHaveText("Play");
  await page.locator("#startReview").click();
  await expect(page.locator("#moveCounter")).toHaveText("1. e4");
  await page.locator("#prevMove").click();
  await page.waitForTimeout(1250);
  await expect(page.locator("#moveCounter")).toHaveText("Start");
  await expect(page.locator("#startReview")).toHaveAttribute("aria-pressed", "false");
});

test("Show Move plays a separate Stockfish preview and restores the exact original board", async ({ page }, info) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await load(page);
  await play(page, "f2", "f3");
  await page.locator("#askAiCoachingBtn").click(); // No key: reveal local Stockfish feedback.
  await expect(page.locator("#showContinuationBtn")).toHaveText("Show Move");
  const original = await pieces(page);
  const chips = await page.locator("#moveList .move-chip").count();
  const line = await page.locator("#positionFeedback .pv-line").innerText();
  await page.locator("#showContinuationBtn").click();
  await expect(page.locator("#continuationPreview")).toBeVisible();
  await expect(page.locator("#startReview")).toBeDisabled();
  await expect(page.locator("#nextMove")).toBeDisabled();
  await expect(page.locator("#continuationPreviewStatus")).toContainText(line.split(/\s+/)[0], { timeout: 5000 });
  expect(await pieces(page)).not.toEqual(original);
  await page.screenshot({ path: info.outputPath("stockfish-preview.png") });
  await page.locator("#returnFromPreview").click();
  expect(await pieces(page)).toEqual(original);
  await expect(page.locator("#moveCounter")).toHaveText("1. f3");
  await expect(page.locator("#moveList .move-chip")).toHaveCount(chips);
  await expect(page.locator("#positionFeedback .pv-line")).toHaveText(line);
  await page.locator("#showContinuationBtn").click();
  await page.keyboard.press("Escape");
  await expect(page.locator("#continuationPreview")).toBeHidden();
  expect(await pieces(page)).toEqual(original);
  expect(errors).toEqual([]);
});

test("new imports cancel playback and Summary retains game analysis", async ({ page }) => {
  await load(page);
  await page.keyboard.press("ArrowRight");
  await page.locator("#startReview").click();
  await load(page, '1. d4 d5 *');
  await page.waitForTimeout(1250);
  await expect(page.locator("#moveCounter")).toHaveText("Start");
  await expect(page.locator("#gameSummaryView")).toBeVisible();
  await page.locator("#summaryReviewBtn").click();
  await expect(page.locator("#summaryProgressBox")).toBeVisible();
  await expect(page.locator("#summaryStartBtn")).toBeVisible({ timeout: 20000 });
  await page.locator("#summaryStartBtn").click();
  await expect(page.locator("#gameMovesView")).toBeVisible();
  await expect(page.locator("#startReviewText")).toHaveText("Play");
});
