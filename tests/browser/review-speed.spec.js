import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("https://fonts.googleapis.com/**", route => route.abort());
  await page.route("https://fonts.gstatic.com/**", route => route.abort());
  await page.addInitScript(() => {
    window.engineSearches = [];
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      postMessage(command, ...args) {
        if (typeof command === "string" && command.startsWith("go ")) window.engineSearches.push(command);
        super.postMessage(command, ...args);
      }
    };
  });
  await page.goto("/review.html");
});

test("stop and resume retain labels, selection, and completed searches", async ({ page }) => {
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.locator("#pgnFile").setInputFiles({ name: "resume.pgn", mimeType: "text/plain",
    buffer: Buffer.from("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 *") });
  await page.keyboard.press("ArrowRight");
  await page.locator('.move-chip[title="3. Bb5"]').click();
  await page.locator("#backToSummaryBtn").click();
  await page.locator("#summaryReviewBtn").click();
  await expect.poll(() => page.locator(".move-chip .move-sign").count()).toBeGreaterThanOrEqual(2);
  await page.locator("#summaryStopReview").click();
  await expect(page.locator("#summaryReviewBtnText")).toHaveText("Resume review");
  const retained = await page.locator(".move-chip:has(.move-sign)").evaluateAll(chips => chips.map(chip => ({
    id: chip.dataset.node, badge: chip.querySelector(".move-sign").textContent
  })));
  const selected = await page.locator('.move-chip[aria-current="step"]').getAttribute("data-node");
  await page.locator("#summaryReviewBtn").click();
  for (const chip of retained) await expect(page.locator(`[data-node="${chip.id}"] .move-sign`)).toHaveText(chip.badge);
  await expect(page.locator("#summaryStartBtn")).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.move-chip[aria-current="step"]')).toHaveAttribute("data-node", selected);
  expect(errors).toEqual([]);
});

test("a stronger completed review satisfies a faster review without launching searches", async ({ page, browserName, context }) => {
  // Exercise the actual WASM worker under reduced CPU speed where available.
  if (browserName === "chromium") {
    const session = await context.newCDPSession(page);
    await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  }
  await page.locator("#pgnFile").setInputFiles({ name: "mate.pgn", mimeType: "text/plain",
    buffer: Buffer.from("1. f3 e5 2. g4 Qh4# 0-1") });
  await page.locator("#moveTime").selectOption({ value: "500" }, { force: true });
  await page.locator("#summaryReviewBtn").click();
  await expect(page.locator("#summaryStartBtn")).toBeVisible({ timeout: 30000 });
  const searches = await page.evaluate(() => window.engineSearches.length);
  await page.locator("#moveTime").selectOption({ value: "250" }, { force: true });
  await expect(page.locator("#summaryStartBtn")).toBeVisible();
  expect(await page.evaluate(() => window.engineSearches.length)).toBe(searches);
});
