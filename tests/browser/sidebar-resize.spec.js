import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("https://fonts.googleapis.com/**", route => route.abort());
  await page.route("https://fonts.gstatic.com/**", route => route.abort());
  await page.goto("/review.html");
  await page.getByRole("button", { name: "Paste PGN", exact: true }).click();
  await page.locator("#emptyPgnText").fill("1. e4 e5 2. Nf3 Nc6 *");
  await page.getByRole("button", { name: "Load game", exact: true }).click();
});

async function longFeedback(page) {
  // Exercise overflow without needing credentials or an AI request.
  await page.locator("#feedbackContent").evaluate(element => {
    element.textContent = "The knight supports the central pawn and protects the king. ".repeat(200);
  });
}

test("dragging and keyboard resizing preserve game position and remember the split", async ({ page }) => {
  await longFeedback(page);
  const splitter = page.getByRole("separator", { name: "Resize feedback and moves" });
  const before = await page.locator("#moveListWrapper").boundingBox();
  const handle = await splitter.boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 - 120, { steps: 8 });
  await page.mouse.up();
  const after = await page.locator("#moveListWrapper").boundingBox();
  expect(after.height).toBeGreaterThan(before.height + 100);
  const height = (await page.locator("#feedbackContainer").boundingBox()).height;
  await splitter.press("ArrowUp");
  await expect.poll(async () => (await page.locator("#feedbackContainer").boundingBox()).height).toBeCloseTo(height - 20, 0);
  await expect(page.locator("#moveCounter")).toHaveText("Start");
  const savedHeight = (await page.locator("#feedbackContainer").boundingBox()).height;
  await page.reload();
  await expect.poll(async () => (await page.locator("#feedbackContainer").boundingBox()).height).toBeCloseTo(savedHeight, 0);
  await splitter.dblclick();
  await expect(page.locator(".sidebar-panel")).not.toHaveClass(/has-feedback-split/);
  expect(await page.evaluate(() => localStorage.getItem("zen-chess-feedback-split"))).toBeNull();
});

test("both panes stay usable at resize limits, on both tabs and small screens", async ({ page }, info) => {
  await longFeedback(page);
  const splitter = page.getByRole("separator", { name: "Resize feedback and moves" });
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await splitter.scrollIntoViewIfNeeded();
    for (const key of ["Home", "End"]) {
      await splitter.press(key);
      for (const [tab, pane] of [["#tabMoves", "#moveListWrapper"], ["#tabSummary", "#summaryPanel"]]) {
        await page.locator(tab).click();
        const lower = await page.locator(pane).boundingBox();
        const footer = await page.locator(".sidebar-footer").boundingBox();
        const feedback = await page.locator("#feedbackContainer").boundingBox();
        expect(lower.height).toBeGreaterThanOrEqual(139);
        expect(feedback.height).toBeGreaterThanOrEqual(99);
        expect(feedback.y + feedback.height).toBeLessThanOrEqual(lower.y);
        expect(lower.y + lower.height).toBeLessThanOrEqual(footer.y + 1);
      }
    }
    await splitter.press("Home");
    await page.screenshot({ path: info.outputPath(`resized-summary-${viewport.width}.png`), fullPage: true });
  }
});
