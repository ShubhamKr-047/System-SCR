import { test, expect } from "@playwright/test";

const PGN = "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *";
const engineArrow = page => page.locator('#boardArrows [data-layer="engine"] line');
const plans = page => page.locator('#boardArrows [data-layer="planning"]');
const preview = page => page.locator('#boardArrows [data-layer="preview"]');
let errors;

async function load(page, pgn = PGN) {
  await page.goto("/review.html");
  await page.locator("#pgnFile").setInputFiles({ name: "game.pgn", mimeType: "text/plain", buffer: Buffer.from(pgn) });
  await expect(page.locator("#moveCounter")).toHaveText("Start");
}

async function center(page, square) {
  const box = await page.locator(`[data-square="${square}"]`).boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function startDrag(page, from, to, button = "left") {
  const a = await center(page, from), b = await center(page, to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down({ button });
  await page.mouse.move(b.x, b.y, { steps: 8 });
}

async function drag(page, from, to, button = "left") {
  await startDrag(page, from, to, button);
  await page.mouse.up({ button });
}

async function toggleEngineArrow(page, enabled) {
  await page.locator("#hamburgerBtn").click();
  const checkbox = page.locator("#toggleBestMoveArrow");
  if (await checkbox.isChecked() !== enabled) await page.locator('label:has(#toggleBestMoveArrow)').click();
  await expect(checkbox).toBeChecked({ checked: enabled });
  await page.locator("#closeHamburgerBtn").click();
}

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("https://fonts.googleapis.com/**", route => route.abort());
  await page.route("https://fonts.gstatic.com/**", route => route.abort());
});

test.afterEach(() => expect(errors).toEqual([]));

test("dragging creates one analyzed variation and click-to-move remains available", async ({ page }) => {
  await load(page);
  await page.locator('.move-chip[title="2... Nc6"]').click();
  await startDrag(page, "f1", "c4");
  await expect(page.locator(".drag-piece")).toBeVisible();
  await expect(page.locator('[data-square="f1"]')).toHaveClass(/drag-origin/);
  await expect(page.locator('[data-square="c4"]')).toHaveClass(/drop-target/);
  await expect(engineArrow(page)).toHaveCount(1);
  await expect(page.locator(".drag-piece")).toBeVisible();
  await page.mouse.up();
  await expect(page.locator(".drag-piece")).toHaveCount(0);
  await expect(page.locator("#moveCounter")).toHaveText("3. Bc4");
  await expect(page.locator("#moveList .move-chip")).toHaveCount(7);
  await expect(page.locator('.move-chip[title="3. Bc4"] .move-sign')).toBeVisible();
  await page.locator('[data-square="g8"]').click();
  await page.locator('[data-square="f6"]').click();
  await expect(page.locator("#moveCounter")).toHaveText("3... Nf6");
  await page.locator("#resetVariationBtn").click();
  await expect(page.locator("#moveCounter")).toHaveText("2... Nc6");
});

test("illegal, outside-board, and wrong-side drops preserve the position", async ({ page }) => {
  await load(page);
  await drag(page, "e2", "e5");
  await expect(page.locator("#moveCounter")).toHaveText("Start");
  await startDrag(page, "e2", "e4");
  await page.mouse.move(1, 1);
  await page.mouse.up();
  await expect(page.locator(".drag-piece")).toHaveCount(0);
  await expect(page.locator('[data-square="e2"] img')).toHaveAttribute("alt", "White p");
  await drag(page, "e7", "e5");
  await expect(page.locator("#moveCounter")).toHaveText("Start");
  await expect(page.locator("#moveList .move-chip")).toHaveCount(6);
});

test("right-drag previews, toggles, recolors, and preserves annotations during engine updates", async ({ page }) => {
  await load(page);
  await startDrag(page, "e2", "e4", "right");
  await expect(preview(page).locator("line")).toHaveCount(1);
  await page.mouse.up({ button: "right" });
  await expect(plans(page).locator("line")).toHaveCount(1);
  await expect(engineArrow(page)).toHaveCount(1);
  await expect(plans(page).locator("line")).toHaveCount(1);
  await drag(page, "g1", "f3", "right");
  await expect(plans(page).locator("line")).toHaveCount(2);
  await drag(page, "e2", "e4", "right");
  await expect(plans(page).locator("line")).toHaveCount(1);
  await page.keyboard.down("Control");
  await drag(page, "g1", "f3", "right");
  await page.keyboard.up("Control");
  await expect(plans(page).locator("line")).toHaveCount(1);
  await expect(plans(page).locator("line")).toHaveAttribute("stroke", "#dd6666");
  await page.keyboard.down("Alt");
  await drag(page, "c1", "h6", "right");
  await page.keyboard.up("Alt");
  await expect(plans(page).locator('line[stroke="#6688cc"]')).toHaveCount(1);
  await page.keyboard.down("Control");
  await page.keyboard.down("Alt");
  await drag(page, "d1", "h5", "right");
  await page.keyboard.up("Alt");
  await page.keyboard.up("Control");
  await expect(plans(page).locator('line[stroke="#e0b84d"]')).toHaveCount(1);
  await expect(page.locator("#moveCounter")).toHaveText("Start");
  await page.locator('[data-square="c3"]').click({ button: "right" });
  await expect(plans(page).locator("circle")).toHaveCount(1);
  await page.locator('[data-square="c3"]').click({ button: "right" });
  await expect(plans(page).locator("circle")).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("planning-arrows.png") });
  await page.locator('[data-square="a3"]').click();
  await expect(plans(page).locator("line")).toHaveCount(0);
  await expect(engineArrow(page)).toHaveCount(1);
});

test("engine arrow uses translucent light blue and its toggle does not hide planning arrows", async ({ page }) => {
  await load(page);
  await expect(engineArrow(page)).toHaveCount(1);
  await expect(engineArrow(page)).toHaveAttribute("stroke", "#75BFFF");
  await expect(page.locator('#boardArrows [data-layer="engine"]')).toHaveAttribute("opacity", "0.55");
  await drag(page, "d2", "d4", "right");
  await toggleEngineArrow(page, false);
  await expect(engineArrow(page)).toHaveCount(0);
  await expect(plans(page).locator("line")).toHaveCount(1);
  await toggleEngineArrow(page, true);
  await expect(engineArrow(page)).toHaveCount(1);
  await expect(plans(page).locator("line")).toHaveCount(1);
});

test("flipping repositions annotations and supports dragging in the opposite orientation", async ({ page }) => {
  await load(page);
  await drag(page, "e2", "e4", "right");
  const before = Number(await plans(page).locator("line").getAttribute("x1"));
  await page.keyboard.press("f");
  await expect(page.locator("#board .square").first()).toHaveAttribute("data-square", "h1");
  const after = Number(await plans(page).locator("line").getAttribute("x1"));
  expect(before + after).toBeCloseTo(100);
  await drag(page, "e2", "e4");
  await expect(page.locator("#moveCounter")).toHaveText("1. e4");
  await expect(page.locator("#moveList .move-chip")).toHaveCount(6);
  await expect(plans(page).locator("line")).toHaveCount(0);
});

test("Escape, navigation, and flipping safely cancel unfinished gestures", async ({ page }) => {
  await load(page);
  await startDrag(page, "e2", "e4");
  await page.keyboard.press("Escape");
  await expect(page.locator(".drag-piece")).toHaveCount(0);
  await page.mouse.up();
  await expect(page.locator("#moveCounter")).toHaveText("Start");
  await startDrag(page, "e2", "e4", "right");
  await page.keyboard.press("Escape");
  await page.mouse.up({ button: "right" });
  await expect(preview(page).locator("line")).toHaveCount(0);
  await expect(plans(page).locator("line")).toHaveCount(0);
  await startDrag(page, "e2", "e4");
  await page.keyboard.press("ArrowRight");
  await page.mouse.up();
  await expect(page.locator(".drag-piece")).toHaveCount(0);
  await expect(page.locator("#moveCounter")).toHaveText("1. e4");
  await startDrag(page, "e7", "e5");
  await page.keyboard.press("f");
  await page.mouse.up();
  await expect(page.locator(".drag-piece")).toHaveCount(0);
  await expect(page.locator("#moveCounter")).toHaveText("1. e4");
});

test("drag promotion uses the piece picker and terminal positions have no best-move arrow", async ({ page }) => {
  await load(page, '[SetUp "1"]\n[FEN "7k/P7/8/8/8/8/8/7K w - - 0 30"]\n\n30. a8=Q+ *');
  await drag(page, "a7", "a8");
  await expect(page.locator("#promotionDialog")).toBeVisible();
  await page.getByRole("button", { name: "Knight", exact: true }).click();
  await expect(page.locator("#moveCounter")).toHaveText("30. a8=N");
  await expect(page.locator('.move-chip[title="30. a8=N"] .move-sign')).toBeVisible();
  await expect(engineArrow(page)).toHaveCount(0);
});

test("dragging castling and en passant applies both pieces' board changes", async ({ page }) => {
  await load(page);
  await page.locator('.move-chip[title="3... a6"]').click();
  await drag(page, "e1", "g1");
  await expect(page.locator("#moveCounter")).toHaveText("4. O-O");
  await expect(page.locator('[data-square="g1"] img')).toHaveAttribute("alt", "White k");
  await expect(page.locator('[data-square="f1"] img')).toHaveAttribute("alt", "White r");
  await page.locator("#pgnFile").setInputFiles({ name: "ep.pgn", mimeType: "text/plain", buffer: Buffer.from("1. e4 a6 2. e5 d5 3. Nf3 *") });
  await page.locator('.move-chip[title="2... d5"]').click();
  await drag(page, "e5", "d6");
  await expect(page.locator("#moveCounter")).toHaveText("3. exd6");
  await expect(page.locator('[data-square="d6"] img')).toHaveAttribute("alt", "White p");
  await expect(page.locator('[data-square="d5"] img')).toHaveCount(0);
});

async function delayedEngine(page, invalidFirst = false) {
  await page.addInitScript(({ invalidFirst }) => {
    window.engineRequests = [];
    window.Worker = class extends EventTarget {
      emit(data) { this.dispatchEvent(new MessageEvent("message", { data })); }
      postMessage(command) {
        if (command === "uci") queueMicrotask(() => this.emit("uciok"));
        if (command === "isready") queueMicrotask(() => this.emit("readyok"));
        if (command.startsWith("go ")) {
          window.engineRequests.push(command);
          const invalid = invalidFirst && window.engineRequests.length === 1;
          this.timer = setTimeout(() => {
            this.emit("info depth 12 score cp 30");
            this.emit(`bestmove ${invalid ? "(none)" : "e2e4"}`);
          }, 700);
        }
      }
      terminate() { clearTimeout(this.timer); }
    };
  }, { invalidFirst });
}

test("selecting pieces while analysis is pending preserves the same engine request", async ({ page }) => {
  await delayedEngine(page);
  await load(page);
  await expect.poll(() => page.evaluate(() => window.engineRequests.length)).toBe(1);
  await page.locator('[data-square="d2"]').click();
  await page.locator('[data-square="d2"]').click();
  await page.locator('[data-square="g1"]').click();
  await expect(engineArrow(page)).toHaveCount(1);
  expect(await page.evaluate(() => window.engineRequests.length)).toBe(1);
  await expect(page.locator('[data-square="g1"]')).toHaveClass(/selected/);
});

test("a score without a legal best move exposes Retry and recovers", async ({ page }) => {
  await delayedEngine(page, true);
  await load(page);
  await expect(page.locator("#retryPositionAnalysis")).toBeVisible();
  await expect(engineArrow(page)).toHaveCount(0);
  await page.locator("#retryPositionAnalysis").click();
  await expect(engineArrow(page)).toHaveCount(1);
  await expect(page.locator("#retryPositionAnalysis")).toBeHidden();
  expect(await page.evaluate(() => window.engineRequests.length)).toBe(2);
});

test("enabling the arrow recovers a failed suggestion without moving pieces", async ({ page }) => {
  await delayedEngine(page, true);
  await load(page);
  await expect(page.locator("#retryPositionAnalysis")).toBeVisible();
  await toggleEngineArrow(page, false);
  await toggleEngineArrow(page, true);
  await expect(engineArrow(page)).toHaveCount(1);
  expect(await page.evaluate(() => window.engineRequests.length)).toBe(2);
});

test("importing another game cancels an active drag and clears annotations", async ({ page }) => {
  await load(page);
  await drag(page, "d2", "d4", "right");
  await startDrag(page, "e2", "e4");
  await page.locator("#pgnFile").setInputFiles({ name: "next.pgn", mimeType: "text/plain", buffer: Buffer.from("1. d4 d5 *") });
  await page.mouse.up();
  await expect(page.locator(".drag-piece")).toHaveCount(0);
  await expect(page.locator("#moveCounter")).toHaveText("Start");
  await expect(page.locator("#moveList .move-chip")).toHaveCount(2);
  await expect(plans(page).locator("line")).toHaveCount(0);
});

test("touch gestures move a piece without a second synthetic click", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Playwright touch dragging uses Chromium's input protocol");
  await load(page);
  const protocol = await page.context().newCDPSession(page);
  await protocol.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  const from = await center(page, "e2"), to = await center(page, "e4");
  await protocol.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...from, id: 0 }] });
  await protocol.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...to, id: 0 }] });
  await expect(page.locator(".drag-piece")).toBeVisible();
  await protocol.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(page.locator("#moveCounter")).toHaveText("1. e4");
  await expect(page.locator("#moveList .move-chip")).toHaveCount(6);
  await expect(page.locator(".drag-piece")).toHaveCount(0);
});

test("new variation moves hold the displayed evaluation until calculated, including when flipped", async ({ page }) => {
  // Manually release searches so pending states are deterministic, independent
  // of the browser's speed or how quickly Stockfish would finish a position.
  await page.addInitScript(() => {
    window.pendingSearch = null;
    window.Worker = class extends EventTarget {
      emit(data) { this.dispatchEvent(new MessageEvent("message", { data })); }
      postMessage(command) {
        if (command === "uci") queueMicrotask(() => this.emit("uciok"));
        if (command === "isready") queueMicrotask(() => this.emit("readyok"));
        if (command.startsWith("position fen ")) this.fen = command.slice(13);
        if (command.startsWith("go ")) {
          window.pendingSearch = { worker: this, finish: () => {
            window.pendingSearch = null;
            const black = this.fen.split(" ")[1] === "b";
            const score = window.zeroEvaluation ? 0 : black ? 150 : 300;
            this.emit(`info depth 12 score cp ${score}`);
            this.emit(`bestmove ${black ? "e7e5" : "g1f3"}`);
          } };
        }
      }
      terminate() { if (window.pendingSearch?.worker === this) window.pendingSearch = null; }
    };
  });
  await load(page);
  async function releaseUntil(score) {
    for (let i = 0; i < 8 && await page.locator("#evalBarScore").textContent() !== score; i++) {
      await expect.poll(() => page.evaluate(() => Boolean(window.pendingSearch))).toBe(true);
      await page.evaluate(() => window.pendingSearch.finish());
    }
    await expect(page.locator("#evalBarScore")).toHaveText(score);
  }
  await releaseUntil("3.0");
  const fill = page.locator("#evalBarWhite");
  await expect(fill).toHaveAttribute("style", /height: 69\.5%/);
  await page.evaluate(() => {
    window.fillChanges = [];
    new MutationObserver(() => window.fillChanges.push(document.getElementById("evalBarWhite").style.height))
      .observe(document.getElementById("evalBarWhite"), { attributes: true, attributeFilter: ["style"] });
  });
  await page.locator('[data-square="e2"]').click();
  await page.locator('[data-square="e3"]').click();
  await expect(page.locator("#moveCounter")).toHaveText("1. e3");
  await expect(page.locator("#evalBarScore")).toHaveText("3.0");
  await expect(fill).toHaveAttribute("style", /height: 69\.5%/);
  await page.keyboard.press("f");
  await expect(fill).toHaveAttribute("style", /height: 69\.5%/);
  await releaseUntil("1.5");
  await expect(fill).toHaveAttribute("style", /height: 40\.25%/);
  expect(await page.evaluate(() => window.fillChanges)).not.toContain("50%");
  // A genuine equal evaluation must still replace the held score.
  await page.evaluate(() => { window.zeroEvaluation = true; });
  await page.locator('[data-square="c7"]').click();
  await page.locator('[data-square="c5"]').click();
  await expect(page.locator("#evalBarScore")).toHaveText("1.5");
  await expect(fill).toHaveAttribute("style", /height: 40\.25%/);
  await releaseUntil("0.0");
  await expect(fill).toHaveAttribute("style", /height: 50%/);
  // Importing another game resets the held value rather than leaking it.
  await page.locator("#resetVariationBtn").click();
  await expect(page.locator("#evalBarScore")).toHaveText("3.0");
  await page.locator("#pgnFile").setInputFiles({ name: "next.pgn", mimeType: "text/plain", buffer: Buffer.from("1. d4 d5 *") });
  await expect(fill).toHaveAttribute("style", /height: 50%/);
  await expect(page.locator("#evalBarScore")).toHaveText("0.0");
});
