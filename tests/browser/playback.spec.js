import { Chess } from "chess.js";
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

test("Show Move previews without saving, goes back, and saves the line only on a legal continuation", async ({ page }, info) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await load(page);
  await play(page, "f2", "f3");
  await expect(page.locator("#askAiCoachingBtn")).toBeVisible();
  await expect(page.locator("#positionFeedback")).toHaveCount(0);
  await expect(page.locator("#showContinuationBtn")).toHaveText("Show Move");
  const original = await pieces(page);
  const chips = await page.locator("#moveList .move-chip").count();
  const line = await page.locator(".stockfish-continuation .pv-line").innerText();
  await expect(page.locator(".pv-move.is-played")).toHaveCount(0);
  const card = await page.locator(".stockfish-continuation").boundingBox();
  const button = await page.locator("#showContinuationBtn").boundingBox();
  expect(button.x).toBeGreaterThan(card.x + card.width / 2);
  expect(Math.abs(button.y + button.height / 2 - card.y - card.height / 2)).toBeLessThan(1);
  await page.locator("#showContinuationBtn").click();
  await expect(page.locator("#showContinuationBtn")).toHaveText("Go back");
  await expect(page.locator("#moveCounter")).toHaveText("Preview 1/" + Math.min(8, line.split(/\s+/).length), { timeout: 5000 });
  await expect(page.locator("#moveList .move-chip")).toHaveCount(chips);
  await expect(page.locator(".stockfish-continuation .pv-line")).toHaveText(line);
  await page.locator("#showContinuationBtn").click();
  expect(await pieces(page)).toEqual(original);
  await expect(page.locator("#moveCounter")).toHaveText("1. f3");
  await expect(page.locator(".pv-move.is-played")).toHaveCount(0);
  const chess = new Chess();
  const tokens = line.split(/\s+/).slice(0, 8);
  for (const token of tokens) chess.move(token);
  const total = tokens.length;
  const evaluation = await page.locator("#evalBarScore").textContent();
  const feedback = await page.locator(".feedback-header-box").innerText();
  await page.locator("#showContinuationBtn").click();
  await expect(page.locator("#moveCounter")).toHaveText(`Preview ${total}/${total}`, { timeout: 12000 });
  await expect(page.locator("#moveList .move-chip")).toHaveCount(chips);
  await expect(page.locator("#evalBarScore")).toHaveText(evaluation);
  await expect(page.locator(".feedback-header-box")).toHaveText(feedback, { useInnerText: true });
  await expect(page.locator(".pv-move.is-played")).toHaveCount(total);
  await page.screenshot({ path: info.outputPath("stockfish-preview.png") });
  // A selection and an illegal destination must not save the preview.
  const next = chess.moves({ verbose: true })[0];
  await play(page, next.from, next.from);
  await expect(page.locator("#moveList .move-chip")).toHaveCount(chips);
  await page.locator("#showContinuationBtn").click();
  expect(await pieces(page)).toEqual(original);
  await page.locator("#showContinuationBtn").click();
  await expect(page.locator("#moveCounter")).toHaveText(`Preview ${total}/${total}`, { timeout: 12000 });
  await play(page, next.from, next.to);
  if (next.promotion) await page.getByRole("button", { name: { q: "Queen", r: "Rook", b: "Bishop", n: "Knight" }[next.promotion], exact: true }).click();
  await expect(page.locator("#board")).not.toHaveClass(/is-previewing/);
  expect(await page.locator("#moveList .move-chip").count()).toBeGreaterThan(chips);
  await expect(page.locator("#variationIndicator")).toBeVisible();
  await page.locator('#moveList .move-chip[title="1. f3"]').click();
  expect(await pieces(page)).toEqual(original);
  await expect(page.locator(".stockfish-continuation .pv-line")).toHaveText(line);
  // Revealing local coaching must not duplicate or hide the independent line.
  await page.locator("#askAiCoachingBtn").click();
  await expect(page.locator("#positionFeedback")).toBeVisible();
  await expect(page.locator(".stockfish-continuation")).toHaveCount(1);
  await expect(page.locator("#positionFeedback .stockfish-continuation")).toHaveCount(0);
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
