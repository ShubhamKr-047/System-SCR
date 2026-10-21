import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("https://fonts.googleapis.com/**", route => route.abort());
  await page.route("https://fonts.gstatic.com/**", route => route.abort());
  await page.goto("/review.html");
});

test("empty board offers file import and recovers from an invalid file", async ({ page }, info) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await expect(page.getByRole("heading", { name: "Start with your game" })).toBeVisible();
  await expect(page.locator("#hamburgerMenu")).toBeHidden();
  await page.screenshot({ path: info.outputPath("empty-board.png") });
  const choose = async contents => {
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Import PGN file", exact: true }).click();
    await (await chooser).setFiles({ name: "game.pgn", mimeType: "text/plain", buffer: Buffer.from(contents) });
  };
  await choose("not a chess game");
  await expect(page.locator("#emptyImportStatus")).toContainText("Could not read PGN");
  await expect(page.locator("#emptyBoardState")).toBeVisible();
  await choose('[White "Alice"]\n[Black "Bob"]\n\n1. e4 e5 *');
  await expect(page.locator("#emptyBoardState")).toBeHidden();
  await expect(page.locator("#board .square")).toHaveCount(64);
  await expect(page.locator("#bottomPlayerName")).toHaveText("Alice");
  await page.locator("#nextMove").click();
  await expect(page.locator("#moveCounter")).toHaveText("1. e4");
  expect(errors).toEqual([]);
});

test("paste imports directly on a small board with validation and keyboard loading", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Paste PGN", exact: true }).click();
  await expect(page.locator("#emptyPgnText")).toBeFocused();
  await page.getByRole("button", { name: "Load game", exact: true }).click();
  await expect(page.locator("#emptyImportStatus")).toContainText("Paste PGN text");
  await page.locator("#emptyPgnText").fill("1. e4 e5 2. ThisIsNotAMove *");
  await page.locator("#emptyPgnText").press("Control+Enter");
  await expect(page.locator("#emptyImportStatus")).toContainText("Could not read PGN");
  await expect(page.locator("#emptyPgnText")).toHaveValue("1. e4 e5 2. ThisIsNotAMove *");
  await expect(page.locator("#emptyImportStatus")).toBeInViewport();
  await page.screenshot({ path: info.outputPath("paste-validation-mobile.png") });
  await page.locator("#emptyPgnText").fill("1. d4 d5 *");
  await page.locator("#emptyPgnText").press("Control+Enter");
  await expect(page.locator("#emptyBoardState")).toBeHidden();
  await expect(page.locator("#board .square")).toHaveCount(64);
  await expect(page.locator("#hamburgerMenu")).toBeHidden();
  await page.locator("#nextMove").click();
  await expect(page.locator("#moveCounter")).toHaveText("1. d4");
});

test("clicking analysis board starts a fresh new position ready to play", async ({ page }) => {
  await expect(page.getByRole("button", { name: "Analysis board", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Analysis board", exact: true }).click();
  await expect(page.locator("#emptyBoardState")).toBeHidden();
  await expect(page.locator("#board .square")).toHaveCount(64);
  await expect(page.locator("#moveCounter")).toHaveText("Start");
  await expect(page.locator("#bottomPlayerName")).toHaveText("White");
  await expect(page.locator("#topPlayerName")).toHaveText("Black");
  await expect(page.locator("#reviewProgress")).toHaveText("Analysis board");
});
