import test from "node:test";
import assert from "node:assert/strict";
import { GameTree } from "../src/game-tree.js";
import { analyzeMove } from "../src/analysis.js";
import { hasReview, reviewGame, REVIEW_POLICY_VERSION } from "../src/review-policy.js";
import { CLASSIFICATION_VERSION } from "../src/move-quality.js";
import { evaluatePosition } from "../src/position-analysis.js";

function save(node, options, { priority = 0, spentMs = 200, needed = true } = {}) {
  node.result = { classificationVersion: CLASSIFICATION_VERSION,
    reviewQuality: { version: REVIEW_POLICY_VERSION, baseTime: options.moveTime,
      complete: options.refine || !needed },
    refinement: { priority, spentMs: options.refine ? spentMs : 0 } };
}

test("review covers every move before refining, then prioritizes the selected position", async () => {
  const nodes = new GameTree("1. e4 e5 2. Nf3 Nc6 *").mainline.slice(1);
  const calls = [];
  await reviewGame(nodes, { selected: () => nodes[2], analyze: async (node, options) => {
    calls.push([node.ply, options.refine]); save(node, options, { priority: node.ply === 2 ? 4 : 0 });
  } });
  assert.deepEqual(calls, [[1, false], [2, false], [3, false], [4, false], [3, true], [2, true], [1, true], [4, true]]);
  assert.ok(nodes.every(node => hasReview(node, 250)));
  await reviewGame(nodes, { analyze: () => assert.fail("A repeat review should reuse completed results") });
});

test("stopping during refinement retains first-pass results and resumes only unfinished checks", async () => {
  const nodes = new GameTree("1. e4 e5 *").mainline.slice(1);
  const controller = new AbortController();
  await assert.rejects(reviewGame(nodes, { signal: controller.signal, analyze: async (node, options) => {
    save(node, options); if (options.refine) controller.abort();
  } }), { name: "AbortError" });
  assert.ok(nodes.every(node => hasReview(node, 250, { complete: false })));
  const calls = [];
  await reviewGame(nodes, { analyze: async (node, options) => { calls.push([node.ply, options.refine]); save(node, options); } });
  assert.deepEqual(calls, [[2, true]]);
});

test("a larger review budget or changed policy invalidates completion without discarding old results", () => {
  const node = new GameTree("1. e4 *").mainline[1];
  save(node, { moveTime: 500, refine: true });
  assert.equal(hasReview(node, 250), true);
  assert.equal(hasReview(node, 1000), false);
  node.result.reviewQuality.version--;
  assert.equal(hasReview(node, 250), false);
  assert.ok(node.result);
});

test("the game refinement budget is shared and can expire without restarting ordinary searches", async () => {
  const nodes = new GameTree("1. e4 e5 2. Nf3 Nc6 *").mainline.slice(1);
  const budgets = [];
  await reviewGame(nodes, { analyze: async (node, options) => {
    if (options.refine) budgets.push(options.refinementBudget);
    save(node, options, { spentMs: Math.min(1500, options.refinementBudget || 0) });
  } });
  assert.deepEqual(budgets, [2500, 1000, 0, 0]);
  assert.ok(nodes.every(node => hasReview(node, 250)));
});

const line = (score, bestmove) => ({ score, scoreType: "cp", rawScore: score * 100, bestmove,
  pv: bestmove, stable: true, depth: 20, complete: true });

test("an ordinary best move gets one short screen, even when its alternatives stay unstable", async () => {
  const node = new GameTree('[SetUp "1"]\n[FEN "7k/pp3ppp/8/8/8/8/PP3PPP/6K1 w - - 0 20"]\n\n20. Kf1 *').mainline[1];
  const requests = [];
  const result = await analyzeMove(node, async (position, options) => {
    requests.push(options);
    if (position === node) return line(0, "h8g8");
    const primary = line(0, "g1f1");
    return options.multiPv === 2 ? { ...primary, complete: false, stable: false,
      candidates: [primary, { ...line(-0.1, "g1h1"), stable: false }] } : primary;
  }, { moveTime: 250 });
  assert.equal(result.key, "best");
  assert.deepEqual(requests.filter(request => request.multiPv === 2).map(request => request.moveTime), [200]);
  assert.equal(result.refinement.spentMs, 200);
});

test("budget exhaustion cannot award an unchecked Brilliant", async () => {
  const node = new GameTree("1. e4 e5 2. Nf3 d6 3. Bc4 Bg4 4. Nc3 g6 5. Nxe5 *").mainline.at(-1);
  const requests = [];
  const result = await analyzeMove(node, async (position, options) => {
    requests.push(options);
    if (position === node) return line(-2, "d6e5");
    const primary = line(2, "f3e5");
    return options.multiPv === 2 ? { ...primary, candidates: [primary, { ...line(0, "d2d4"), depth: 20 }] } : primary;
  }, { moveTime: 250, refinementBudget: 200 });
  assert.notEqual(result.key, "brilliant");
  assert.ok(result.refinement.spentMs <= 200);
  assert.equal(requests.length, 3);
});

test("the initial pass leaves a sacrifice pending without launching optional searches", async () => {
  const node = new GameTree("1. e4 e5 2. Nf3 d6 3. Bc4 Bg4 4. Nc3 g6 5. Nxe5 *").mainline.at(-1);
  const requests = [];
  const result = await analyzeMove(node, async (position, options) => {
    requests.push(options);
    return position === node ? line(-2, "d6e5") : line(2, "f3e5");
  }, { moveTime: 250, refine: false });
  assert.equal(requests.length, 2);
  assert.ok(requests.every(request => request.multiPv === 1 && request.moveTime === 250));
  assert.equal(result.key, "best");
  assert.equal(result.reviewQuality.complete, false);
  assert.ok(result.refinement.reasons.includes("sacrifice"));
});

test("an inconclusive optional search retains the ordinary label; cancellation still propagates", async () => {
  const node = new GameTree('[SetUp "1"]\n[FEN "7k/pp3ppp/8/8/8/8/PP3PPP/6K1 w - - 0 20"]\n\n20. Kf1 *').mainline[1];
  const evaluate = error => async (position, options) => {
    if (options.multiPv === 2) throw error;
    return position === node ? line(0, "h8g8") : line(0, "g1f1");
  };
  const result = await analyzeMove(node, evaluate(new Error("Engine returned no evaluation")), { moveTime: 250 });
  assert.equal(result.key, "best");
  assert.equal(result.refinement.failedChecks.length, 1);
  await assert.rejects(analyzeMove(node, evaluate(new DOMException("Cancelled", "AbortError")),
    { moveTime: 250 }), { name: "AbortError" });
});

test("a required evaluation retries missing UCI evidence once; optional verification cannot overspend on retries", async () => {
  const node = new GameTree("1. e4 *").mainline[1];
  const calls = [];
  const engine = { evaluate: async (fen, time) => {
    calls.push(time);
    if (calls.length === 1) throw new Error("Engine returned no evaluation. Retry analysis.");
    return { ...line(-0.2, "e7e5"), moveTime: time };
  } };
  assert.equal((await evaluatePosition(node, engine, { moveTime: 250 })).bestmove, "e7e5");
  assert.deepEqual(calls, [250, 400]);
  calls.length = 0; node.analysis = null;
  await assert.rejects(evaluatePosition(node, engine, { moveTime: 250, retry: false }), /no evaluation/);
  assert.deepEqual(calls, [250]);
});

for (const scenario of ["king move", "disagreement about mate"]) {
  test(`${scenario} gets a targeted mate check even with negligible chance loss`, async () => {
    const king = scenario === "king move";
    const node = new GameTree(`[SetUp "1"]\n[FEN "7k/pp3ppp/8/8/8/8/PP3PPP/6K1 w - - 0 20"]\n\n20. ${king ? "Kf1" : "a3"} *`).mainline[1];
    const requests = [];
    const result = await analyzeMove(node, async (position, options) => {
      requests.push(options);
      if (position === node) return king ? line(8.1, "h8g8") :
        { ...line(9.97, "h8g8"), scoreType: "mate", rawScore: 3 };
      if (options.searchMoves?.length) return options.moveTime >= 1000 ?
        { ...line(-9.97, options.searchMoves[0]), scoreType: "mate", rawScore: -3 } :
        line(king ? -8.1 : 0, options.searchMoves[0]);
      return line(king ? -8 : 0, "g1h1");
    }, { moveTime: 250 });
    assert.equal(result.key, "blunder");
    assert.equal(result.refinement.priority, 4);
    assert.ok(requests.some(request => request.moveTime === 1000));
  });
}

test("Miss can verify an opponent error while the parent's initial label is still pending refinement", async () => {
  const node = new GameTree("1. h3 e5 2. a3 *").mainline[3];
  node.parent.result = { classificationVersion: CLASSIFICATION_VERSION, chanceLoss: 0,
    reviewQuality: { version: REVIEW_POLICY_VERSION, baseTime: 250, complete: false } };
  const result = await analyzeMove(node, async (position, options) => {
    if (position === node.parent.parent) return options.searchMoves?.length ? line(-2.4, "e7e5") : line(-0.5, "d7d5");
    if (position === node) return line(-0.7, "b8c6");
    return options.searchMoves?.length ? line(0.7, "a2a3") : line(2.4, "g1f3");
  }, { moveTime: 250 });
  assert.equal(result.key, "miss");
  assert.ok(result.classificationEvidence.opportunity.chanceLoss >= 8);
});
